import { faker } from "@faker-js/faker";
import { ensureNotProduction } from "../utils/envCheck";
import { defaults } from "../config/defaults";
import { createLogger, type Logger } from "../utils/logger";
import { generateValue } from "../mongoose/generateValue";
import type { FieldDescriptor } from "../mongoose/extractSchema";
import type { PrismaClientLike } from "../adapters/prismaAdapter";
import type { SeedSummary } from "../seed";
import {
  orderPlans,
  planModels,
  type PrismaDatamodel,
  type PrismaModelPlan,
  type PrismaRelation,
} from "./datamodel";

export interface PrismaSeedOptions {
  /**
   * The Prisma schema description: pass `Prisma.dmmf.datamodel` from your generated client.
   * If omitted, SeedSmith tries to read it from the client instance.
   */
  datamodel?: PrismaDatamodel;
  docsPerModel?: number | Record<string, number>;
  includeModels?: string[];
  excludeModels?: string[];
  dropBeforeSeed?: boolean;
  useTransactions?: boolean;
  seed?: number; // deterministic seeding
  verbose?: boolean;
  logger?: Logger;
}

const MAX_UNIQUE_RETRIES = 5;
const MAX_STUB_DEPTH = 5;
const KEY_CACHE_LIMIT = 1000;
const TRANSACTION_TIMEOUT_MS = 10 * 60 * 1000;

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

export async function seedPrisma(
  prisma: PrismaClientLike,
  options: PrismaSeedOptions = {},
): Promise<SeedSummary> {
  ensureNotProduction();

  const {
    docsPerModel = defaults.docsPerModel,
    includeModels,
    excludeModels,
    dropBeforeSeed = defaults.dropBeforeSeed,
    useTransactions = defaults.useTransactions,
    seed = defaults.seed,
    verbose = defaults.verbose,
    logger: userLogger,
  } = options;

  const logger = userLogger ?? createLogger(verbose);
  if (seed !== undefined) {
    faker.seed(seed);
    logger.info(`Using deterministic seed: ${seed}`);
  }

  const start = Date.now();
  const datamodel: PrismaDatamodel | undefined =
    options.datamodel ?? (prisma as any)._runtimeDataModel;
  if (!datamodel || !datamodel.models) {
    throw new Error(
      "SeedSmith: Could not read the Prisma schema. Pass `datamodel: Prisma.dmmf.datamodel` in the options.",
    );
  }

  const warned = new Set<string>();
  const warnOnce = (message: string) => {
    if (warned.has(message)) return;
    warned.add(message);
    logger.warn(message);
  };

  const plans = new Map(
    planModels(datamodel, warnOnce).map((plan) => [plan.name, plan]),
  );
  const exclude = new Set(excludeModels ?? []);
  const targetNames = (includeModels ?? [...plans.keys()]).filter(
    (name) => !exclude.has(name),
  );
  const targets: PrismaModelPlan[] = [];
  for (const name of targetNames) {
    const plan = plans.get(name);
    if (plan) targets.push(plan);
    else logger.warn(`Model '${name}' not found in the Prisma schema. Skipping.`);
  }
  const included = new Set(targets.map((p) => p.name));
  const ordered = orderPlans(targets);

  const summary: SeedSummary = { inserted: {}, durationMs: 0 };

  const run = async (client: any) => {
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
        rows = plan
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
          (row) =>
            !taken.has(JSON.stringify(rel.to.map((f) => String(row[f])))),
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
      if (!target || !included.has(rel.target)) {
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
      summary.inserted[target.name] = (summary.inserted[target.name] ?? 0) + 1;
      return created;
    };

    const pickTarget = async (
      plan: PrismaModelPlan,
      rel: PrismaRelation,
      depth: number,
    ): Promise<Record<string, any> | undefined> => {
      if (rel.unique) {
        const free = (await uniquePool(plan, rel)).pop();
        if (free || !rel.required) return free;
        return insertStub(plan, rel, depth);
      }
      const rows = await keyRows(rel.target);
      if (rows.length) return faker.helpers.arrayElement(rows);
      if (!rel.required) return undefined;
      return insertStub(plan, rel, depth);
    };

    const buildRow = async (plan: PrismaModelPlan, depth: number) => {
      const row: Record<string, any> = {};
      for (const field of plan.fields) {
        const val = await generateField(field);
        if (val !== undefined) row[field.path] = val;
      }
      for (const rel of plan.relations) {
        const target = await pickTarget(plan, rel, depth);
        if (!target) continue;
        rel.from.forEach((f, i) => {
          row[f] = target[rel.to[i]];
        });
      }
      return row;
    };

    // Returns null when no unique row could be generated
    async function insertRow(
      plan: PrismaModelPlan,
      depth: number,
    ): Promise<Record<string, any> | null> {
      const delegate = delegateFor(plan);
      for (let attempt = 0; attempt < MAX_UNIQUE_RETRIES; attempt++) {
        const data = await buildRow(plan, depth);
        try {
          const created = await delegate.create({ data });
          keyCache.get(plan.name)?.push(created);
          return created;
        } catch (err: any) {
          // regenerate the row to try unique again
          if (!isUniqueViolation(err)) throw err;
        }
      }
      return null;
    }

    if (dropBeforeSeed) {
      // Delete dependents first so foreign keys stay valid
      for (const plan of [...ordered].reverse()) {
        try {
          await delegateFor(plan).deleteMany({});
        } catch (e: any) {
          throw new Error(
            `Failed to clear '${plan.name}'. ${e?.message || e}`,
          );
        }
      }
    }

    for (const plan of ordered) {
      const countForModel =
        typeof docsPerModel === "number"
          ? docsPerModel
          : (docsPerModel[plan.name] ?? defaults.docsPerModel);
      if (!Number.isInteger(countForModel) || countForModel < 0) {
        throw new Error(
          `docsPerModel for '${plan.name}' must be a non-negative integer, got ${countForModel}.`,
        );
      }

      let inserted = 0;
      for (let i = 0; i < countForModel; i++) {
        let created;
        try {
          created = await insertRow(plan, 0);
        } catch (e: any) {
          throw new Error(
            `Failed to insert into '${plan.name}'. ${e?.message || e}`,
          );
        }
        if (!created) {
          logger.warn(
            `Stopped seeding '${plan.name}' after ${inserted} row(s): could not generate a row that satisfies its unique constraints.`,
          );
          break;
        }
        inserted++;
      }

      summary.inserted[plan.name] =
        (summary.inserted[plan.name] ?? 0) + inserted;
      logger.info(`Seeded ${inserted} row(s) for '${plan.name}'.`);
    }
  };

  try {
    if (useTransactions) {
      await (prisma.$transaction as any)(run, {
        timeout: TRANSACTION_TIMEOUT_MS,
      });
    } else {
      await run(prisma);
    }
  } catch (err) {
    const message =
      err && (err as any).message ? (err as any).message : String(err);
    throw new Error(`SeedSmith: Seeding failed. ${message}`);
  } finally {
    summary.durationMs = Date.now() - start;
  }

  return summary;
}
