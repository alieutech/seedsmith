import type mongooseType from "mongoose";
import { faker } from "@faker-js/faker";
import path from "path";
import fs from "fs";
import { ensureNotProduction } from "./utils/envCheck";
import { defaults } from "./config/defaults";
import { extractSchema, type ModelDescriptor } from "./mongoose/extractSchema";
import { generateValue } from "./mongoose/generateValue";
import { makeRefResolver } from "./mongoose/relationResolver";
import { createLogger, type Logger } from "./utils/logger";

export interface SeedOptions {
  modelsPath?: string; // Directory containing model files that register with mongoose
  docsPerModel?: number | Record<string, number>;
  includeModels?: string[];
  excludeModels?: string[];
  dropBeforeSeed?: boolean;
  useTransactions?: boolean;
  seed?: number; // deterministic seeding
  verbose?: boolean;
  logger?: Logger;
}

export interface SeedSummary {
  inserted: Record<string, number>;
  durationMs: number;
}

function normalizeList(input?: string[] | string): string[] | undefined {
  if (!input) return undefined;
  if (Array.isArray(input)) return input;
  return String(input)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadModelsFromDir(modelsPath: string) {
  const abs = path.isAbsolute(modelsPath)
    ? modelsPath
    : path.resolve(process.cwd(), modelsPath);
  let files: string[] = [];
  try {
    files = fs.readdirSync(abs);
  } catch (e: any) {
    throw new Error(
      `SeedSmith: Failed to read models directory: ${abs}. ${e?.message || e}`
    );
  }
  const loadableExt = new Set([".js", ".cjs", ".mjs"]);
  files
    .filter((f) => loadableExt.has(path.extname(f)))
    .forEach((f) => {
      const full = path.join(abs, f);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require(full);
      } catch (e: any) {
        throw new Error(
          `SeedSmith: Failed to load model file ${full}. ${e?.message || e}`
        );
      }
    });
}

async function fetchRandomId(
  model: mongooseType.Model<any>
): Promise<mongooseType.Types.ObjectId | null> {
  const count = await model.estimatedDocumentCount();
  if (count === 0) return null;
  const skip = faker.number.int({ min: 0, max: Math.max(0, count - 1) });
  const doc: any = await model.findOne({}, { _id: 1 }).skip(skip).lean();
  return doc?._id ?? null;
}

function setDeep(target: Record<string, any>, pathStr: string, value: any) {
  const parts = pathStr.split(".");
  let cur: any = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (cur[key] == null || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

export async function seedDatabase(
  mongoose: typeof mongooseType,
  options: SeedOptions
): Promise<SeedSummary> {
  ensureNotProduction();

  const {
    modelsPath,
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
  // Load models if a path is provided
  if (modelsPath) loadModelsFromDir(modelsPath);

  // Build model map from registered models
  const names = mongoose.modelNames();
  const include = normalizeList(includeModels) ?? names;
  const exclude = new Set(normalizeList(excludeModels) ?? []);
  const targetNames = include.filter((n) => !exclude.has(n));

  const models: Record<string, mongooseType.Model<any>> = {};
  for (const name of targetNames) {
    try {
      models[name] = mongoose.model(name);
    } catch (e: any) {
      logger.warn(`Model '${name}' not registered with Mongoose. Skipping.`);
    }
  }

  // Prepare descriptors
  const descriptors: Record<string, ModelDescriptor> = {};
  for (const [name, model] of Object.entries(models)) {
    try {
      descriptors[name] = extractSchema(model);
    } catch (e: any) {
      throw new Error(
        `SeedSmith: Failed to extract schema for model '${name}'. ${
          e?.message || e
        }`
      );
    }
  }

  // Context to resolve refs
  const ctx = {
    models,
    fetchRandomId: async (modelName: string) =>
      fetchRandomId(models[modelName]),
    createStub: async (modelName: string) => {
      const model = models[modelName];
      const descriptor = descriptors[modelName];
      const resolver = makeRefResolver(ctx);
      const doc: Record<string, any> = {};
      for (const field of descriptor.fields) {
        if (field.ref) continue; // avoid infinite recursion on stubs
        doc[field.path] = await generateValue(field, resolver);
      }
      const created = await model.create(doc);
      return created._id as mongooseType.Types.ObjectId;
    },
  };
  const refResolver = makeRefResolver(ctx);

  const summary: SeedSummary = { inserted: {}, durationMs: 0 };

  const session = useTransactions ? await mongoose.startSession() : null;
  if (session) session.startTransaction();

  try {
    // Optionally drop collections
    if (dropBeforeSeed) {
      for (const name of Object.keys(models)) {
        try {
          await models[name].collection.drop();
        } catch (e: any) {
          // ignore if collection doesn't exist
          if (e && e.codeName !== "NamespaceNotFound") {
            throw new Error(
              `SeedSmith: Failed to drop collection for '${name}'. ${
                e?.message || e
              }`
            );
          }
        }
      }
    }

    // Seed each model
    for (const [name, model] of Object.entries(models)) {
      const descriptor = descriptors[name];

      const countForModel =
        typeof docsPerModel === "number"
          ? docsPerModel
          : docsPerModel[name] ?? defaults.docsPerModel;
      const docs: Record<string, any>[] = [];
      for (let i = 0; i < countForModel; i++) {
        const doc: Record<string, any> = {};
        for (const field of descriptor.fields) {
          try {
            const val = await generateValue(field, refResolver);
            setDeep(doc, field.path, val);
          } catch (e: any) {
            throw new Error(
              `SeedSmith: Failed to generate value for ${name}.${field.path}. ${
                e?.message || e
              }`
            );
          }
        }
        docs.push(doc);
      }

      // Insert with small retry for uniqueness errors
      let inserted = 0;
      const ordered = false; // continue on error
      try {
        const res = await model.insertMany(docs, {
          ordered,
          session: session ?? undefined,
        });
        inserted += res.length;
      } catch (e: any) {
        logger.warn(
          `Bulk insert failed for '${name}'. Falling back to individual inserts. ${
            e?.message || e
          }`
        );
        // retry individually
        for (const d of docs) {
          let attempts = 0;
          while (attempts < 3) {
            try {
              const created = await model.create([d], {
                session: session ?? undefined,
              });
              inserted += created.length;
              break;
            } catch (err: any) {
              attempts++;
              // mutate one field to try unique again
              const field = descriptor.fields.find(
                (f) => f.instance === "String" || f.instance === "Number"
              );
              if (field)
                d[field.path] = await generateValue(field, refResolver);
              if (attempts >= 3) throw err;
            }
          }
        }
      }

      summary.inserted[name] = inserted;
      logger.info(`Seeded ${inserted} document(s) for '${name}'.`);
    }

    if (session) await session.commitTransaction();
  } catch (err) {
    if (session) await session.abortTransaction();
    const message =
      err && (err as any).message ? (err as any).message : String(err);
    throw new Error(`SeedSmith: Seeding failed. ${message}`);
  } finally {
    if (session) session.endSession();
    summary.durationMs = Date.now() - start;
  }

  return summary;
}
