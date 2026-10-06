import type mongooseType from "mongoose";
import { faker } from "@faker-js/faker";
import { ensureNotProduction } from "./utils/envCheck";
import { defaults } from "./config/defaults";
import {
  extractSchema,
  type FieldDescriptor,
  type ModelDescriptor,
} from "./mongoose/extractSchema";
import {
  buildDocument,
  generateValue,
  setDeep,
} from "./mongoose/generateValue";
import {
  makeRefResolver,
  type ResolveContext,
} from "./mongoose/relationResolver";
import { createLogger, type Logger } from "./utils/logger";
import {
  PartialInsertError,
  type SeedAdapter,
  type SeedSession,
} from "./adapters/types";
import { createMongooseAdapter } from "./adapters/mongooseAdapter";
import { loadModelsFromDir } from "./project/loadModules";
import {
  applyOverrides,
  isOverridden,
  unknownOverrideKeys,
  validateOverrides,
  type SeedOverrides,
} from "./overrides";

export interface SeedOptions {
  modelsPath?: string; // Directory of model files (.js or .ts, subfolders included) that register with mongoose
  docsPerModel?: number | Record<string, number>;
  includeModels?: string[];
  excludeModels?: string[];
  dropBeforeSeed?: boolean;
  useTransactions?: boolean;
  seed?: number; // deterministic seeding
  /** Fixed values or functions for specific fields, keyed by model name then field path */
  overrides?: SeedOverrides;
  /** Generate and validate documents without writing anything; see `samples` in the summary */
  dryRun?: boolean;
  verbose?: boolean;
  logger?: Logger;
  /** Optional adapter for ORM abstraction; defaults to Mongoose adapter */
  adapter?: SeedAdapter;
}

export interface SeedSummary {
  inserted: Record<string, number>;
  durationMs: number;
  /** Set when the run was a dry run: nothing was written */
  dryRun?: boolean;
  /** Dry run only: how many documents were generated per model */
  generated?: Record<string, number>;
  /** Dry run only: the generated documents per model */
  samples?: Record<string, Record<string, any>[]>;
}

function normalizeList(input?: string[] | string): string[] | undefined {
  if (!input) return undefined;
  // An empty list means "no filter"
  if (Array.isArray(input)) return input.length ? input : undefined;
  return String(input)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function fetchRandomId(
  model: mongooseType.Model<any>,
  rawSession?: mongooseType.ClientSession,
): Promise<mongooseType.Types.ObjectId | null> {
  // Inside a transaction, read through the session so uncommitted documents are visible
  const count = rawSession
    ? await model.countDocuments({}).session(rawSession)
    : await model.estimatedDocumentCount();
  if (count === 0) return null;
  const skip = faker.number.int({ min: 0, max: Math.max(0, count - 1) });
  const query = model.findOne({}, { _id: 1 }).skip(skip).lean();
  if (rawSession) query.session(rawSession);
  const doc: any = await query;
  return doc?._id ?? null;
}

function collectRefs(fields: FieldDescriptor[], out: Set<string>) {
  for (const field of fields) {
    if (field.ref) out.add(field.ref);
    if (field.item) collectRefs([field.item], out);
    if (field.of) collectRefs([field.of], out);
    if (field.fields) collectRefs(field.fields, out);
  }
}

// Order models so that referenced models are seeded before the models that point at them
function orderByRefs(
  names: string[],
  descriptors: Record<string, ModelDescriptor>,
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const refs = new Set<string>();
    collectRefs(descriptors[name].fields, refs);
    for (const ref of refs) {
      if (descriptors[ref]) visit(ref);
    }
    ordered.push(name);
  };
  names.forEach(visit);
  return ordered;
}

export async function seedDatabase(
  mongoose: typeof mongooseType,
  options: SeedOptions,
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

  const overrides = validateOverrides(options.overrides);
  const dryRun = Boolean(options.dryRun);

  const start = Date.now();
  // Load models if a path is provided
  if (modelsPath) await loadModelsFromDir(modelsPath);

  // Build model map from registered models
  const names = mongoose.modelNames();
  const include = normalizeList(includeModels) ?? names;
  const exclude = new Set(normalizeList(excludeModels) ?? []);
  const targetNames = include.filter((n) => !exclude.has(n));

  const models: Record<string, mongooseType.Model<any>> = {};
  for (const name of targetNames) {
    try {
      // Cast: the generic defaults of Model differ between Mongoose 8 and 9
      models[name] = mongoose.model(name) as mongooseType.Model<any>;
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
        }`,
      );
    }
  }

  // Create adapter (use provided or default to Mongoose)
  const adapter: SeedAdapter =
    options.adapter ?? createMongooseAdapter(mongoose);

  // Start session if transactions enabled
  let session: SeedSession | null = null;
  if (useTransactions && adapter.startSession && !dryRun) {
    session = await adapter.startSession();
  }
  const rawSession: mongooseType.ClientSession | undefined =
    session && "raw" in session ? (session as any).raw : undefined;

  const warned = new Set<string>();
  const warnOnce = (message: string) => {
    if (warned.has(message)) return;
    warned.add(message);
    logger.warn(message);
  };
  const genOptions = { warn: warnOnce };

  for (const [name, fields] of Object.entries(overrides ?? {})) {
    const descriptor = descriptors[name];
    if (!descriptor) {
      warnOnce(`Overrides for '${name}' ignored: it is not being seeded.`);
      continue;
    }
    const paths = descriptor.fields.map((f) => f.path);
    for (const key of unknownOverrideKeys(paths, fields)) {
      warnOnce(
        `Override '${name}.${key}' does not match a field in the schema.`,
      );
    }
  }

  // Builds one document for a model: generated values first, then its overrides
  const docIndexes = new WeakMap<object, number>();
  const docCounts: Record<string, number> = {};
  const buildFor = async (name: string, opts: { skipRefs?: boolean } = {}) => {
    const modelOverrides = overrides?.[name];
    const doc = await buildDocument(
      descriptors[name].fields,
      refResolver,
      { ...genOptions, ...opts },
      (path) => isOverridden(path, modelOverrides),
    );
    const index = docCounts[name] ?? 0;
    docCounts[name] = index + 1;
    docIndexes.set(doc, index);
    await applyOverrides(doc, modelOverrides, { model: name, index });
    return doc;
  };

  // Context to resolve refs
  const ctx: ResolveContext = {
    models,
    fetchRandomId: async (modelName: string) => {
      // In a dry run, link to the documents generated so far
      const generated = dryIds[modelName];
      if (generated && generated.length) {
        return faker.helpers.arrayElement(generated);
      }
      // Models outside this run can still be linked to if they already have documents
      const model = models[modelName] ?? mongoose.models[modelName];
      if (!model) return null;
      // A dry run may be offline; only read when there is a connection
      if (dryRun && mongoose.connection?.readyState !== 1) return null;
      return fetchRandomId(model, rawSession);
    },
    createStub: async (modelName: string) => {
      const model = models[modelName];
      const descriptor = descriptors[modelName];
      // Guard: never write to a model that is not part of this run
      if (!model || !descriptor) {
        warnOnce(
          `Ref target '${modelName}' is not being seeded and has no documents. ` +
            `Optional refs to it are left empty; required refs get a placeholder id.`,
        );
        return null;
      }
      // skipRefs avoids infinite recursion on stubs
      const doc = await buildFor(modelName, { skipRefs: true });
      if (dryRun) return (await recordDryDoc(modelName, doc))._id;
      // Pass session to create if available
      const created = await model.create([doc], { session: rawSession });
      const result = Array.isArray(created) ? created[0] : created;
      return result._id as mongooseType.Types.ObjectId;
    },
  };
  const refResolver = makeRefResolver(ctx);

  const summary: SeedSummary = { inserted: {}, durationMs: 0 };

  // Dry run: validate each document the way a save would, and keep it instead of writing it
  const dryIds: Record<string, mongooseType.Types.ObjectId[]> = {};
  const recordDryDoc = async (name: string, doc: Record<string, any>) => {
    const instance = new models[name](doc);
    try {
      await instance.validate();
    } catch (e: any) {
      throw new Error(`'${name}' would fail validation. ${e?.message || e}`);
    }
    const stored = instance.toObject({ flattenMaps: true });
    (dryIds[name] ??= []).push(stored._id);
    ((summary.samples ??= {})[name] ??= []).push(stored);
    return stored;
  };
  if (dryRun) {
    summary.dryRun = true;
    summary.generated = {};
    summary.samples = {};
    logger.info("Dry run: nothing will be written.");
  }

  try {
    // Optionally drop collections via adapter
    if (dropBeforeSeed && !dryRun) {
      for (const name of Object.keys(models)) {
        try {
          const adapterModel = adapter.getModel(name);
          await adapterModel.drop();
        } catch (e: any) {
          // ignore if collection doesn't exist
          if (e && e.codeName !== "NamespaceNotFound") {
            throw new Error(
              `SeedSmith: Failed to drop collection for '${name}'. ${
                e?.message || e
              }`,
            );
          }
        }
      }
    }

    // Seed each model, referenced models first
    for (const name of orderByRefs(Object.keys(models), descriptors)) {
      const descriptor = descriptors[name];

      const countForModel =
        typeof docsPerModel === "number"
          ? docsPerModel
          : (docsPerModel[name] ?? defaults.docsPerModel);
      if (!Number.isInteger(countForModel) || countForModel < 0) {
        throw new Error(
          `SeedSmith: docsPerModel for '${name}' must be a non-negative integer, got ${countForModel}.`,
        );
      }
      const docs: Record<string, any>[] = [];
      for (let i = 0; i < countForModel; i++) {
        let doc: Record<string, any>;
        try {
          doc = await buildFor(name);
        } catch (e: any) {
          throw new Error(
            `SeedSmith: Failed to generate a document for '${name}'. ${
              e?.message || e
            }`,
          );
        }
        // Recorded one by one so later documents can reference earlier ones
        if (dryRun) await recordDryDoc(name, doc);
        else docs.push(doc);
      }

      if (dryRun) {
        const generated = summary.samples?.[name]?.length ?? 0;
        (summary.generated ??= {})[name] = generated;
        summary.inserted[name] = 0;
        logger.info(`Generated ${generated} document(s) for '${name}' (dry run).`);
        continue;
      }

      // Insert via adapter with retry for uniqueness errors
      const adapterModel = adapter.getModel(name);
      let inserted = 0;
      try {
        inserted = await adapterModel.insertMany(docs, session);
      } catch (e: any) {
        logger.warn(
          `Batch insert failed for '${name}'. Falling back to individual inserts. ${
            e?.message || e
          }`,
        );
        // Documents written before the failure must not be inserted twice
        const alreadyInserted =
          e instanceof PartialInsertError ? e.insertedCount : 0;
        inserted = alreadyInserted;
        // On retry, regenerate the fields that can collide
        const modelOverrides = overrides?.[name];
        const regenerable = descriptor.fields.filter(
          (f) => f.path !== "_id" && !isOverridden(f.path, modelOverrides),
        );
        const uniqueFields = regenerable.filter((f) => f.unique);
        const fallbackField = regenerable.find(
          (f) => f.instance === "String" || f.instance === "Number",
        );
        const retryFields = uniqueFields.length
          ? uniqueFields
          : fallbackField
            ? [fallbackField]
            : [];
        // retry individually
        for (const d of docs.slice(alreadyInserted)) {
          let attempts = 0;
          const MAX_RETRIES = 3;
          while (attempts < MAX_RETRIES) {
            try {
              await adapterModel.insertOne(d, session);
              inserted += 1;
              break;
            } catch (err: any) {
              attempts++;
              if (attempts >= MAX_RETRIES) throw err;
              // regenerate the colliding fields to try unique again
              for (const field of retryFields) {
                const val = await generateValue(field, refResolver, genOptions);
                if (val !== undefined) setDeep(d, field.path, val);
              }
              // override functions get another chance to produce a unique value
              await applyOverrides(d, modelOverrides, {
                model: name,
                index: docIndexes.get(d) ?? 0,
              });
            }
          }
        }
      }

      summary.inserted[name] = inserted;
      logger.info(`Seeded ${inserted} document(s) for '${name}'.`);
    }

    if (session) await session.commit();
  } catch (err) {
    if (session) await session.abort();
    const message =
      err && (err as any).message ? (err as any).message : String(err);
    throw new Error(`SeedSmith: Seeding failed. ${message}`);
  } finally {
    if (session) await session.end();
    summary.durationMs = Date.now() - start;
  }

  return summary;
}
