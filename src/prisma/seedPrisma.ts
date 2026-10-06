import { faker } from "@faker-js/faker";
import { ensureNotProduction } from "../utils/envCheck";
import { defaults } from "../config/defaults";
import { createLogger, type Logger } from "../utils/logger";
import type { PrismaClientLike } from "../adapters/prismaAdapter";
import type { SeedSummary } from "../seed";
import { validateOverrides, type SeedOverrides } from "../overrides";
import {
  orderPlans,
  planModels,
  type PrismaDatamodel,
  type PrismaModelPlan,
} from "./datamodel";
import { createRowEngine } from "./engine";

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
  /** Fixed values or functions for specific fields, keyed by model name then field name */
  overrides?: SeedOverrides;
  /**
   * Generate rows without writing anything; see `samples` in the summary.
   * Existing rows are still read so relations can point at them, and keys the
   * database would generate are shown as placeholders.
   */
  dryRun?: boolean;
  verbose?: boolean;
  logger?: Logger;
}

const TRANSACTION_TIMEOUT_MS = 10 * 60 * 1000;

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

  const overrides = validateOverrides(options.overrides);
  const dryRun = Boolean(options.dryRun);

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
  const targetNames = (
    includeModels?.length ? includeModels : [...plans.keys()]
  ).filter(
    (name) => !exclude.has(name),
  );
  const targets: PrismaModelPlan[] = [];
  for (const name of targetNames) {
    const plan = plans.get(name);
    if (plan) targets.push(plan);
    else logger.warn(`Model '${name}' not found in the Prisma schema. Skipping.`);
  }
  const included = new Set(targets.map((p) => p.name));

  for (const [name, fields] of Object.entries(overrides ?? {})) {
    const plan = plans.get(name);
    if (!plan || !included.has(name)) {
      warnOnce(`Overrides for '${name}' ignored: it is not being seeded.`);
      continue;
    }
    for (const key of Object.keys(fields)) {
      if (!plan.fieldNames.includes(key)) {
        warnOnce(
          `Override '${name}.${key}' does not match a field in the schema.`,
        );
      }
    }
  }
  const ordered = orderPlans(targets);

  const summary: SeedSummary = { inserted: {}, durationMs: 0 };

  const run = async (client: any) => {
    const { delegateFor, insertRow } = createRowEngine({
      client,
      plans,
      canCreate: (model) => included.has(model),
      overrides,
      counters: {},
      simulate: dryRun,
      // In a dry run with dropBeforeSeed, the seeded tables count as empty
      startsEmpty: (model) => dryRun && dropBeforeSeed && included.has(model),
      onStub: (model) => {
        summary.inserted[model] = (summary.inserted[model] ?? 0) + 1;
      },
      onSimulated: (model, row) => {
        ((summary.samples ??= {})[model] ??= []).push(row);
      },
    });

    if (dropBeforeSeed && !dryRun) {
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
      logger.info(
        dryRun
          ? `Generated ${inserted} row(s) for '${plan.name}' (dry run).`
          : `Seeded ${inserted} row(s) for '${plan.name}'.`,
      );
    }
  };

  if (dryRun) {
    summary.dryRun = true;
    summary.samples = {};
    logger.info("Dry run: nothing will be written.");
  }

  try {
    if (useTransactions && !dryRun) {
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

  if (dryRun) {
    summary.generated = summary.inserted;
    summary.inserted = Object.fromEntries(
      Object.keys(summary.generated).map((name) => [name, 0]),
    );
  }

  return summary;
}
