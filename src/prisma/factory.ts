import { faker } from "@faker-js/faker";
import { ensureNotProduction } from "../utils/envCheck";
import { createLogger, type Logger } from "../utils/logger";
import type { PrismaClientLike } from "../adapters/prismaAdapter";
import {
  validateOverrides,
  type FieldOverride,
  type SeedOverrides,
} from "../overrides";
import { planModels, type PrismaDatamodel } from "./datamodel";
import { createRowEngine } from "./engine";

export interface PrismaFactoryOptions {
  /**
   * The Prisma schema description: pass `Prisma.dmmf.datamodel` from your generated client.
   * If omitted, SeedSmith tries to read it from the client instance.
   */
  datamodel?: PrismaDatamodel;
  /** Defaults applied to every row of a model; per-call overrides win over these */
  overrides?: SeedOverrides;
  seed?: number; // deterministic fake data
  verbose?: boolean;
  logger?: Logger;
}

export interface PrismaFactory {
  /**
   * Returns the data for one row without writing it. Existing rows are read so
   * relations can point at them; a required relation with no row to point at is left unset.
   */
  build<T = Record<string, any>>(
    model: string,
    overrides?: Record<string, FieldOverride>,
  ): Promise<T>;
  /** Inserts and returns one row, creating the rows its required relations need. */
  create<T = Record<string, any>>(
    model: string,
    overrides?: Record<string, FieldOverride>,
  ): Promise<T>;
  createMany<T = Record<string, any>>(
    model: string,
    count: number,
    overrides?: Record<string, FieldOverride>,
  ): Promise<T[]>;
}

/**
 * Creates single rows on demand, for tests and scripts.
 *
 * @example
 * ```ts
 * const factory = createPrismaFactory(prisma, { datamodel: Prisma.dmmf.datamodel });
 * const admin = await factory.create("User", { role: "ADMIN" });
 * const post = await factory.create("Post", { authorId: admin.id });
 * ```
 */
export function createPrismaFactory(
  prisma: PrismaClientLike,
  options: PrismaFactoryOptions = {},
): PrismaFactory {
  ensureNotProduction();

  const overrides = validateOverrides(options.overrides);
  const logger = options.logger ?? createLogger(options.verbose);
  if (options.seed !== undefined) faker.seed(options.seed);

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
  const counters: Record<string, number> = {};

  const planFor = (
    name: string,
    callOverrides?: Record<string, FieldOverride>,
  ) => {
    const plan = plans.get(name);
    if (!plan) {
      throw new Error(
        `SeedSmith: Model '${name}' not found in the Prisma schema.`,
      );
    }
    for (const key of Object.keys({ ...overrides?.[name], ...callOverrides })) {
      if (!plan.fieldNames.includes(key)) {
        warnOnce(
          `Override '${name}.${key}' does not match a field in the schema.`,
        );
      }
    }
    return plan;
  };

  // A fresh engine per call: tests clear tables between calls, so rows are not cached
  const engine = () =>
    createRowEngine({
      client: prisma,
      plans,
      canCreate: () => true,
      overrides,
      counters,
    });

  const createOne = async (
    name: string,
    callOverrides?: Record<string, FieldOverride>,
  ) => {
    const plan = planFor(name, callOverrides);
    let row;
    try {
      row = await engine().insertRow(plan, 0, callOverrides);
    } catch (err: any) {
      throw new Error(
        `SeedSmith: Failed to create '${name}'. ${err?.message || err}`,
      );
    }
    if (!row) {
      throw new Error(
        `SeedSmith: Failed to create '${name}': could not generate a row that satisfies its unique constraints.`,
      );
    }
    return row;
  };

  return {
    async build(name, callOverrides) {
      const plan = planFor(name, callOverrides);
      const rows = engine();
      const row = await rows.buildRow(
        plan,
        0,
        rows.nextIndex(plan),
        callOverrides,
        false,
      );
      return row as any;
    },
    async create(name, callOverrides) {
      return (await createOne(name, callOverrides)) as any;
    },
    async createMany(name, count, callOverrides) {
      if (!Number.isInteger(count) || count < 0) {
        throw new Error(
          `SeedSmith: count must be a non-negative integer, got ${count}.`,
        );
      }
      const rows = [];
      for (let i = 0; i < count; i++) {
        rows.push(await createOne(name, callOverrides));
      }
      return rows as any;
    },
  };
}
