#!/usr/bin/env node
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { seedDatabase } from "./seed";
import { ensureNotProduction } from "./utils/envCheck";
import { createLogger } from "./utils/logger";

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main() {
  ensureNotProduction();

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
    console.error(
      "Usage: seedsmith --uri <mongo-uri> [--models <models-dir>] [--count N] [--include A,B] [--exclude X,Y] [--drop] [--transactions]"
    );
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
  const cfgPath = path.resolve(process.cwd(), "seed.config.js");
  let fileConfig: any = {};
  if (fs.existsSync(cfgPath)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(cfgPath);
    fileConfig = mod?.default ?? mod ?? {};
  }

  const options = {
    ...fileConfig,
    modelsPath: modelsPath ?? fileConfig.modelsPath,
    docsPerModel: docsPerModel ?? fileConfig.docsPerModel,
    includeModels: includeModels ?? fileConfig.includeModels,
    excludeModels: excludeModels ?? fileConfig.excludeModels,
    dropBeforeSeed:
      typeof drop === "boolean" ? drop : fileConfig.dropBeforeSeed,
    useTransactions:
      typeof transactions === "boolean"
        ? transactions
        : fileConfig.useTransactions,
    seed: seedStr ? Number(seedStr) : fileConfig.seed,
    verbose: verbose ?? fileConfig.verbose,
    logger: createLogger(verbose ?? fileConfig.verbose),
  };

  await mongoose.connect(uri);
  const summary = await seedDatabase(mongoose, options);
  await mongoose.disconnect();

  console.log("Seed complete");
  console.table(summary.inserted);
  console.log(`Duration: ${summary.durationMs}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
