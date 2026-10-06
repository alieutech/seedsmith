#!/usr/bin/env node
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import util from "util";
import { seedDatabase } from "./seed";
import { resolveCliOptions, USAGE } from "./cliOptions";
import { ensureNotProduction } from "./utils/envCheck";
import { createLogger } from "./utils/logger";

const DRY_RUN_SAMPLES = 3;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }

  ensureNotProduction();

  // Load optional seed.config.js from project root
  const cfgPath = path.resolve(process.cwd(), "seed.config.js");
  let fileConfig: any = {};
  if (fs.existsSync(cfgPath)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(cfgPath);
    fileConfig = mod?.default ?? mod ?? {};
  }

  let uri: string | undefined;
  let options;
  try {
    const resolved = resolveCliOptions(argv, fileConfig);
    uri = resolved.uri;
    options = {
      ...resolved.seedOptions,
      logger: createLogger(Boolean(resolved.seedOptions.verbose)),
    };
  } catch (err: any) {
    console.error(`seedsmith: ${err?.message || err}\n\n${USAGE}`);
    process.exit(1);
  }

  // A dry run can work from the schemas alone
  if (!uri && !options.dryRun) {
    console.error(USAGE);
    process.exit(1);
  }

  if (uri) await mongoose.connect(uri);
  let summary;
  try {
    summary = await seedDatabase(mongoose, options);
  } finally {
    if (uri) await mongoose.disconnect();
  }

  if (summary.dryRun) {
    for (const [name, docs] of Object.entries(summary.samples ?? {})) {
      const shown = docs.slice(0, DRY_RUN_SAMPLES);
      console.log(
        `\n${name}: ${docs.length} generated, showing ${shown.length}`,
      );
      for (const doc of shown) {
        console.log(util.inspect(doc, { depth: null, colors: false }));
      }
    }
    console.log("\nDry run complete. Nothing was written.");
    return;
  }

  console.log("Seed complete");
  console.table(summary.inserted);
  console.log(`Duration: ${summary.durationMs}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
