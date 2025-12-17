#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const seed_1 = require("./seed");
const envCheck_1 = require("./utils/envCheck");
const logger_1 = require("./utils/logger");
function getArg(flag) {
    const idx = process.argv.indexOf(flag);
    if (idx >= 0 && idx + 1 < process.argv.length)
        return process.argv[idx + 1];
    return undefined;
}
function hasFlag(flag) {
    return process.argv.includes(flag);
}
async function main() {
    var _a, _b;
    (0, envCheck_1.ensureNotProduction)();
    const uri = getArg("--uri") || getArg("-u");
    const modelsPath = getArg("--models") || getArg("-m");
    const countStr = getArg("--count") || getArg("-c");
    const includeStr = getArg("--include") || getArg("-i");
    const excludeStr = getArg("--exclude") || getArg("-e");
    const drop = hasFlag("--drop");
    const transactions = hasFlag("--transactions");
    const seedStr = getArg("--seed");
    const verbose = hasFlag("--verbose");
    if (!uri) {
        console.error("Usage: seedsmith --uri <mongo-uri> [--models <models-dir>] [--count N] [--include A,B] [--exclude X,Y] [--drop] [--transactions]");
        process.exit(1);
    }
    const docsPerModel = countStr ? Number(countStr) : undefined;
    const includeModels = includeStr
        ? includeStr
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
    const excludeModels = excludeStr
        ? excludeStr
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;
    // Load optional seed.config.js from project root
    const cfgPath = path_1.default.resolve(process.cwd(), "seed.config.js");
    let fileConfig = {};
    if (fs_1.default.existsSync(cfgPath)) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(cfgPath);
        fileConfig = (_b = (_a = mod === null || mod === void 0 ? void 0 : mod.default) !== null && _a !== void 0 ? _a : mod) !== null && _b !== void 0 ? _b : {};
    }
    const options = {
        ...fileConfig,
        modelsPath: modelsPath !== null && modelsPath !== void 0 ? modelsPath : fileConfig.modelsPath,
        docsPerModel: docsPerModel !== null && docsPerModel !== void 0 ? docsPerModel : fileConfig.docsPerModel,
        includeModels: includeModels !== null && includeModels !== void 0 ? includeModels : fileConfig.includeModels,
        excludeModels: excludeModels !== null && excludeModels !== void 0 ? excludeModels : fileConfig.excludeModels,
        dropBeforeSeed: typeof drop === "boolean" ? drop : fileConfig.dropBeforeSeed,
        useTransactions: typeof transactions === "boolean"
            ? transactions
            : fileConfig.useTransactions,
        seed: seedStr ? Number(seedStr) : fileConfig.seed,
        verbose: verbose !== null && verbose !== void 0 ? verbose : fileConfig.verbose,
        logger: (0, logger_1.createLogger)(verbose !== null && verbose !== void 0 ? verbose : fileConfig.verbose),
    };
    await mongoose_1.default.connect(uri);
    const summary = await (0, seed_1.seedDatabase)(mongoose_1.default, options);
    await mongoose_1.default.disconnect();
    console.log("Seed complete");
    console.table(summary.inserted);
    console.log(`Duration: ${summary.durationMs}ms`);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
