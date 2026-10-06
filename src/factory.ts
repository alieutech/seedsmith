import type mongooseType from "mongoose";
import { faker } from "@faker-js/faker";
import { ensureNotProduction } from "./utils/envCheck";
import { createLogger, type Logger } from "./utils/logger";
import { extractSchema, type ModelDescriptor } from "./mongoose/extractSchema";
import { buildDocument } from "./mongoose/generateValue";
import { fetchRandomId } from "./seed";
import {
  applyOverrides,
  isOverridden,
  unknownOverrideKeys,
  validateOverrides,
  type FieldOverride,
  type SeedOverrides,
} from "./overrides";

export interface FactoryOptions {
  /** Defaults applied to every document of a model; per-call overrides win over these */
  overrides?: SeedOverrides;
  seed?: number; // deterministic fake data
  verbose?: boolean;
  logger?: Logger;
}

export interface Factory {
  /** Returns an unsaved document. Nothing is read from or written to the database. */
  build<T = any>(
    model: string,
    overrides?: Record<string, FieldOverride>,
  ): Promise<mongooseType.HydratedDocument<T>>;
  /** Saves and returns one document, creating the documents its required refs need. */
  create<T = any>(
    model: string,
    overrides?: Record<string, FieldOverride>,
  ): Promise<mongooseType.HydratedDocument<T>>;
  createMany<T = any>(
    model: string,
    count: number,
    overrides?: Record<string, FieldOverride>,
  ): Promise<mongooseType.HydratedDocument<T>[]>;
}

const MAX_UNIQUE_RETRIES = 5;
const MAX_REF_DEPTH = 5;

function isDuplicateKey(err: any): boolean {
  return err?.code === 11000;
}

/**
 * Creates single documents on demand, for tests and scripts.
 *
 * @example
 * ```ts
 * const factory = createFactory(mongoose);
 * const admin = await factory.create("User", { role: "admin" });
 * const post = await factory.create("Post", { author: admin._id });
 * ```
 */
export function createFactory(
  mongoose: typeof mongooseType,
  options: FactoryOptions = {},
): Factory {
  ensureNotProduction();

  const baseOverrides = validateOverrides(options.overrides);
  const logger = options.logger ?? createLogger(options.verbose);
  if (options.seed !== undefined) faker.seed(options.seed);

  const warned = new Set<string>();
  const warnOnce = (message: string) => {
    if (warned.has(message)) return;
    warned.add(message);
    logger.warn(message);
  };

  const modelFor = (name: string) => {
    try {
      // Cast: the generic defaults of Model differ between Mongoose 8 and 9
      return mongoose.model(name) as mongooseType.Model<any>;
    } catch {
      throw new Error(
        `SeedSmith: Model '${name}' is not registered with Mongoose.`,
      );
    }
  };

  // Keyed by model object, so a model that is re-registered is read again
  const descriptors = new WeakMap<object, ModelDescriptor>();
  const describe = (model: mongooseType.Model<any>) => {
    let descriptor = descriptors.get(model);
    if (!descriptor) {
      descriptor = extractSchema(model);
      descriptors.set(model, descriptor);
    }
    return descriptor;
  };

  const counters: Record<string, number> = {};
  const nextIndex = (name: string) => {
    const index = counters[name] ?? 0;
    counters[name] = index + 1;
    return index;
  };

  // `chain` holds the models being created further up, to stop ref cycles
  const buildData = async (
    name: string,
    index: number,
    callOverrides: Record<string, FieldOverride> | undefined,
    write: boolean,
    chain: string[],
  ) => {
    const descriptor = describe(modelFor(name));
    const modelOverrides = { ...baseOverrides?.[name], ...callOverrides };
    const paths = descriptor.fields.map((f) => f.path);
    for (const key of unknownOverrideKeys(paths, modelOverrides)) {
      warnOnce(`Override '${name}.${key}' does not match a field in the schema.`);
    }

    const resolveRef = async (refName: string) => {
      // build() never touches the database: required refs get a placeholder id
      if (!write) return null;
      const refModel = mongoose.models[refName] as
        | mongooseType.Model<any>
        | undefined;
      if (!refModel) {
        warnOnce(
          `Ref target '${refName}' is not registered with Mongoose. ` +
            `Optional refs to it are left empty; required refs get a placeholder id.`,
        );
        return null;
      }
      const existing = await fetchRandomId(refModel);
      if (existing) return existing;
      const inCycle = refName === name || chain.includes(refName);
      if (inCycle || chain.length >= MAX_REF_DEPTH) return null;
      const parent = await createOne(refName, undefined, [...chain, name]);
      return parent._id as mongooseType.Types.ObjectId;
    };

    const data = await buildDocument(
      descriptor.fields,
      resolveRef,
      { warn: warnOnce },
      (path) => isOverridden(path, modelOverrides),
    );
    await applyOverrides(data, modelOverrides, { model: name, index });
    return data;
  };

  async function createOne(
    name: string,
    callOverrides: Record<string, FieldOverride> | undefined,
    chain: string[],
  ) {
    const Model = modelFor(name);
    const index = nextIndex(name);
    for (let attempt = 1; ; attempt++) {
      const data = await buildData(name, index, callOverrides, true, chain);
      try {
        const doc = new Model(data);
        await doc.save();
        return doc;
      } catch (err: any) {
        // regenerate the document to try unique again
        if (!isDuplicateKey(err) || attempt >= MAX_UNIQUE_RETRIES) {
          throw new Error(
            `SeedSmith: Failed to create '${name}'. ${err?.message || err}`,
          );
        }
      }
    }
  }

  return {
    async build(name, callOverrides) {
      const Model = modelFor(name);
      const data = await buildData(
        name,
        nextIndex(name),
        callOverrides,
        false,
        [],
      );
      return new Model(data);
    },
    create(name, callOverrides) {
      return createOne(name, callOverrides, []);
    },
    async createMany(name, count, callOverrides) {
      if (!Number.isInteger(count) || count < 0) {
        throw new Error(
          `SeedSmith: count must be a non-negative integer, got ${count}.`,
        );
      }
      const docs = [];
      for (let i = 0; i < count; i++) {
        docs.push(await createOne(name, callOverrides, []));
      }
      return docs;
    },
  };
}
