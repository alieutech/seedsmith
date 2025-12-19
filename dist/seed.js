"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedDatabase = seedDatabase;
const faker_1 = require("@faker-js/faker");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const envCheck_1 = require("./utils/envCheck");
const defaults_1 = require("./config/defaults");
const extractSchema_1 = require("./mongoose/extractSchema");
const generateValue_1 = require("./mongoose/generateValue");
const relationResolver_1 = require("./mongoose/relationResolver");
const logger_1 = require("./utils/logger");
function normalizeList(input) {
    if (!input)
        return undefined;
    if (Array.isArray(input))
        return input;
    return String(input)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}
function loadModelsFromDir(modelsPath) {
    const abs = path_1.default.isAbsolute(modelsPath)
        ? modelsPath
        : path_1.default.resolve(process.cwd(), modelsPath);
    let files = [];
    try {
        files = fs_1.default.readdirSync(abs);
    }
    catch (e) {
        throw new Error(`SeedSmith: Failed to read models directory: ${abs}. ${(e === null || e === void 0 ? void 0 : e.message) || e}`);
    }
    const loadableExt = new Set([".js", ".cjs", ".mjs"]);
    files
        .filter((f) => loadableExt.has(path_1.default.extname(f)))
        .forEach((f) => {
        const full = path_1.default.join(abs, f);
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            require(full);
        }
        catch (e) {
            throw new Error(`SeedSmith: Failed to load model file ${full}. ${(e === null || e === void 0 ? void 0 : e.message) || e}`);
        }
    });
}
async function fetchRandomId(model) {
    var _a;
    const count = await model.estimatedDocumentCount();
    if (count === 0)
        return null;
    const skip = faker_1.faker.number.int({ min: 0, max: Math.max(0, count - 1) });
    const doc = await model.findOne({}, { _id: 1 }).skip(skip).lean();
    return (_a = doc === null || doc === void 0 ? void 0 : doc._id) !== null && _a !== void 0 ? _a : null;
}
function setDeep(target, pathStr, value) {
    const parts = pathStr.split(".");
    let cur = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (cur[key] == null || typeof cur[key] !== "object")
            cur[key] = {};
        cur = cur[key];
    }
    cur[parts[parts.length - 1]] = value;
}
async function seedDatabase(mongoose, options) {
    var _a, _b, _c;
    (0, envCheck_1.ensureNotProduction)();
    const { modelsPath, docsPerModel = defaults_1.defaults.docsPerModel, includeModels, excludeModels, dropBeforeSeed = defaults_1.defaults.dropBeforeSeed, useTransactions = defaults_1.defaults.useTransactions, seed = defaults_1.defaults.seed, verbose = defaults_1.defaults.verbose, logger: userLogger, } = options;
    const logger = userLogger !== null && userLogger !== void 0 ? userLogger : (0, logger_1.createLogger)(verbose);
    if (seed !== undefined) {
        faker_1.faker.seed(seed);
        logger.info(`Using deterministic seed: ${seed}`);
    }
    const start = Date.now();
    // Load models if a path is provided
    if (modelsPath)
        loadModelsFromDir(modelsPath);
    // Build model map from registered models
    const names = mongoose.modelNames();
    const include = (_a = normalizeList(includeModels)) !== null && _a !== void 0 ? _a : names;
    const exclude = new Set((_b = normalizeList(excludeModels)) !== null && _b !== void 0 ? _b : []);
    const targetNames = include.filter((n) => !exclude.has(n));
    const models = {};
    for (const name of targetNames) {
        try {
            models[name] = mongoose.model(name);
        }
        catch (e) {
            logger.warn(`Model '${name}' not registered with Mongoose. Skipping.`);
        }
    }
    // Prepare descriptors
    const descriptors = {};
    for (const [name, model] of Object.entries(models)) {
        try {
            descriptors[name] = (0, extractSchema_1.extractSchema)(model);
        }
        catch (e) {
            throw new Error(`SeedSmith: Failed to extract schema for model '${name}'. ${(e === null || e === void 0 ? void 0 : e.message) || e}`);
        }
    }
    // Context to resolve refs
    const ctx = {
        models,
        fetchRandomId: async (modelName) => fetchRandomId(models[modelName]),
        createStub: async (modelName) => {
            const model = models[modelName];
            const descriptor = descriptors[modelName];
            const resolver = (0, relationResolver_1.makeRefResolver)(ctx);
            const doc = {};
            for (const field of descriptor.fields) {
                if (field.ref)
                    continue; // avoid infinite recursion on stubs
                doc[field.path] = await (0, generateValue_1.generateValue)(field, resolver);
            }
            const created = await model.create(doc);
            return created._id;
        },
    };
    const refResolver = (0, relationResolver_1.makeRefResolver)(ctx);
    const summary = { inserted: {}, durationMs: 0 };
    const session = useTransactions ? await mongoose.startSession() : null;
    if (session)
        session.startTransaction();
    try {
        // Optionally drop collections
        if (dropBeforeSeed) {
            for (const name of Object.keys(models)) {
                try {
                    await models[name].collection.drop();
                }
                catch (e) {
                    // ignore if collection doesn't exist
                    if (e && e.codeName !== "NamespaceNotFound") {
                        throw new Error(`SeedSmith: Failed to drop collection for '${name}'. ${(e === null || e === void 0 ? void 0 : e.message) || e}`);
                    }
                }
            }
        }
        // Seed each model
        for (const [name, model] of Object.entries(models)) {
            const descriptor = descriptors[name];
            const countForModel = typeof docsPerModel === "number"
                ? docsPerModel
                : (_c = docsPerModel[name]) !== null && _c !== void 0 ? _c : defaults_1.defaults.docsPerModel;
            const docs = [];
            for (let i = 0; i < countForModel; i++) {
                const doc = {};
                for (const field of descriptor.fields) {
                    // Skip _id so Mongo/Mongoose can generate a proper ObjectId
                    if (field.path === "_id")
                        continue;
                    try {
                        const val = await (0, generateValue_1.generateValue)(field, refResolver);
                        setDeep(doc, field.path, val);
                    }
                    catch (e) {
                        throw new Error(`SeedSmith: Failed to generate value for ${name}.${field.path}. ${(e === null || e === void 0 ? void 0 : e.message) || e}`);
                    }
                }
                docs.push(doc);
            }
            // Insert with small retry for uniqueness errors
            let inserted = 0;
            try {
                const createdAll = await model.create(docs, {
                    session: session !== null && session !== void 0 ? session : undefined,
                });
                const createdCount = Array.isArray(createdAll)
                    ? createdAll.length
                    : createdAll
                        ? 1
                        : 0;
                inserted += createdCount;
            }
            catch (e) {
                logger.warn(`Batch create failed for '${name}'. Falling back to individual inserts. ${(e === null || e === void 0 ? void 0 : e.message) || e}`);
                // retry individually
                for (const d of docs) {
                    let attempts = 0;
                    while (attempts < 3) {
                        try {
                            const created = await model.create(d, {
                                session: session !== null && session !== void 0 ? session : undefined,
                            });
                            inserted += created ? 1 : 0;
                            break;
                        }
                        catch (err) {
                            attempts++;
                            // mutate one field to try unique again
                            const field = descriptor.fields.find((f) => f.instance === "String" || f.instance === "Number");
                            if (field)
                                d[field.path] = await (0, generateValue_1.generateValue)(field, refResolver);
                            if (attempts >= 3)
                                throw err;
                        }
                    }
                }
            }
            summary.inserted[name] = inserted;
            logger.info(`Seeded ${inserted} document(s) for '${name}'.`);
        }
        if (session)
            await session.commitTransaction();
    }
    catch (err) {
        if (session)
            await session.abortTransaction();
        const message = err && err.message ? err.message : String(err);
        throw new Error(`SeedSmith: Seeding failed. ${message}`);
    }
    finally {
        if (session)
            session.endSession();
        summary.durationMs = Date.now() - start;
    }
    return summary;
}
