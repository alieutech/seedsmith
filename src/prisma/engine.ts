import { faker } from "@faker-js/faker";
import { generateValue } from "../mongoose/generateValue";
import type { FieldDescriptor } from "../mongoose/extractSchema";
import {
  applyOverrides,
  type FieldOverride,
  type SeedOverrides,
} from "../overrides";
import type { PrismaModelPlan, PrismaRelation } from "./datamodel";

const MAX_UNIQUE_RETRIES = 5;
const MAX_STUB_DEPTH = 5;
const KEY_CACHE_LIMIT = 1000;

const noRefs = async () => null;

async function generateField(field: FieldDescriptor): Promise<any> {
  const one = (instance: string) => {
    switch (instance) {
      case "ObjectIdString":
        return faker.database.mongodbObjectId();
      case "UniqueInt":
        return faker.number.int({ min: 1, max: 2147483647 });
      default:
        return undefined;
    }
  };
  if (field.isArray && field.item) {
    const special = one(field.item.instance);
    if (special !== undefined) {
      const len = faker.number.int({ min: 0, max: 3 });
      return Array.from({ length: len }, () => one(field.item!.instance));
    }
  }
  return one(field.instance) ?? generateValue(field, noRefs);
}

function isUniqueViolation(err: any): boolean {
  return err?.code === "P2002";
}

export interface RowEngineOptions {
  client: any; // Prisma client or transaction client
  plans: Map<string, PrismaModelPlan>;
  /** May rows of this model be created to satisfy a required relation? */
  canCreate: (model: string) => boolean;
  overrides?: SeedOverrides;
  /** Rows generated so far per model; shared so indexes continue across engines */
  counters: Record<string, number>;
  /** Do not write: stand in for the row the database would return */
  simulate?: boolean;
  /** Treat this model's table as empty instead of reading it */
  startsEmpty?: (model: string) => boolean;
  onStub?: (model: string) => void;
  onSimulated?: (model: string, row: Record<string, any>) => void;
}

/** Builds and inserts rows for Prisma models, keeping foreign keys valid. */
export function createRowEngine(opts: RowEngineOptions) {
  const { client, plans, counters } = opts;

  const delegateFor = (plan: PrismaModelPlan) => {
    const delegate = client[plan.delegate];
    if (!delegate) {
      throw new Error(
        `Prisma client has no '${plan.delegate}' delegate for model '${plan.name}'.`,
      );
    }
    return delegate;
  };

  // Rows that relations can point at, per model
  const keyCache = new Map<string, Record<string, any>[]>();
  const keyRows = async (modelName: string) => {
    let rows = keyCache.get(modelName);
    if (!rows) {
      const plan = plans.get(modelName);
      rows =
        plan && !opts.startsEmpty?.(modelName)
          ? await delegateFor(plan).findMany({ take: KEY_CACHE_LIMIT })
          : [];
      keyCache.set(modelName, rows!);
    }
    return rows!;
  };

  // For one-to-one relations: target rows not referenced yet
  const uniquePools = new Map<string, Record<string, any>[]>();
  const uniquePool = async (plan: PrismaModelPlan, rel: PrismaRelation) => {
    const key = `${plan.name}:${rel.from.join(",")}`;
    let pool = uniquePools.get(key);
    if (!pool) {
      const taken = new Set(
        (await keyRows(plan.name)).map((row) =>
          JSON.stringify(rel.from.map((f) => String(row[f]))),
        ),
      );
      const free = (await keyRows(rel.target)).filter(
        (row) => !taken.has(JSON.stringify(rel.to.map((f) => String(row[f])))),
      );
      pool = faker.helpers.shuffle(free);
      uniquePools.set(key, pool);
    }
    return pool;
  };

  const insertStub = async (
    plan: PrismaModelPlan,
    rel: PrismaRelation,
    depth: number,
  ) => {
    const target = plans.get(rel.target);
    if (!target || !opts.canCreate(rel.target)) {
      throw new Error(
        `'${plan.name}' requires a '${rel.target}' row, but '${rel.target}' has no free rows and is not being seeded.`,
      );
    }
    if (depth >= MAX_STUB_DEPTH) {
      throw new Error(
        `'${plan.name}' and '${rel.target}' require each other; cannot create either first.`,
      );
    }
    const created = await insertRow(target, depth + 1);
    if (!created) {
      throw new Error(
        `Could not create a '${rel.target}' row required by '${plan.name}'.`,
      );
    }
    opts.onStub?.(target.name);
    return created;
  };

  const pickTarget = async (
    plan: PrismaModelPlan,
    rel: PrismaRelation,
    depth: number,
    allowStubs: boolean,
  ): Promise<Record<string, any> | undefined> => {
    if (rel.unique) {
      const free = (await uniquePool(plan, rel)).pop();
      if (free || !rel.required || !allowStubs) return free;
      return insertStub(plan, rel, depth);
    }
    const rows = await keyRows(rel.target);
    if (rows.length) return faker.helpers.arrayElement(rows);
    if (!rel.required || !allowStubs) return undefined;
    return insertStub(plan, rel, depth);
  };

  const nextIndex = (plan: PrismaModelPlan) => {
    const index = counters[plan.name] ?? 0;
    counters[plan.name] = index + 1;
    return index;
  };

  /**
   * Generates the data for one row. With `allowStubs` off nothing is written:
   * a required relation with no row to point at is left unset.
   */
  const buildRow = async (
    plan: PrismaModelPlan,
    depth: number,
    index: number,
    callOverrides?: Record<string, FieldOverride>,
    allowStubs = true,
  ) => {
    const base = opts.overrides?.[plan.name];
    const modelOverrides = callOverrides ? { ...base, ...callOverrides } : base;
    const overridden = (field: string) =>
      modelOverrides !== undefined &&
      Object.prototype.hasOwnProperty.call(modelOverrides, field);

    const row: Record<string, any> = {};
    for (const field of plan.fields) {
      if (overridden(field.path)) continue;
      const val = await generateField(field);
      if (val !== undefined) row[field.path] = val;
    }
    for (const rel of plan.relations) {
      // An overridden foreign key decides the relation
      if (rel.from.some(overridden)) continue;
      const target = await pickTarget(plan, rel, depth, allowStubs);
      if (!target) continue;
      rel.from.forEach((f, i) => {
        row[f] = target[rel.to[i]];
      });
    }
    await applyOverrides(row, modelOverrides, { model: plan.name, index });
    return row;
  };

  // Stand in for the row the database would return
  const simulateCreate = async (
    plan: PrismaModelPlan,
    data: Record<string, any>,
  ) => {
    const existing = await keyRows(plan.name);
    const row = { ...data };
    for (const key of plan.databaseKeys) {
      if (row[key.name] !== undefined) continue;
      if (key.type === "Int" || key.type === "BigInt") {
        const max = existing.reduce(
          (m, r) => Math.max(m, Number(r[key.name]) || 0),
          0,
        );
        row[key.name] = key.type === "BigInt" ? BigInt(max + 1) : max + 1;
      } else if (key.type === "String") {
        row[key.name] = faker.string.uuid();
      }
    }
    opts.onSimulated?.(plan.name, row);
    return row;
  };

  // Returns null when no unique row could be generated
  async function insertRow(
    plan: PrismaModelPlan,
    depth: number,
    callOverrides?: Record<string, FieldOverride>,
  ): Promise<Record<string, any> | null> {
    const delegate = delegateFor(plan);
    const index = nextIndex(plan);
    for (let attempt = 0; attempt < MAX_UNIQUE_RETRIES; attempt++) {
      const data = await buildRow(plan, depth, index, callOverrides);
      try {
        const created = opts.simulate
          ? await simulateCreate(plan, data)
          : await delegate.create({ data });
        keyCache.get(plan.name)?.push(created);
        return created;
      } catch (err: any) {
        // regenerate the row to try unique again
        if (!isUniqueViolation(err)) throw err;
      }
    }
    return null;
  }

  return { delegateFor, nextIndex, buildRow, insertRow };
}
