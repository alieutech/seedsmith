#!/usr/bin/env node
import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import { seedDatabase } from "./seed";
import { resolveCliOptions, USAGE } from "./cliOptions";
import { ensureNotProduction } from "./utils/envCheck";
import { createLogger } from "./utils/logger";

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

  if (!uri) {
    console.error(USAGE);
    process.exit(1);
  }

  await mongoose.connect(uri);
  let summary;
  try {
    summary = await seedDatabase(mongoose, options);
  } finally {
    await mongoose.disconnect();
  }

  console.log("Seed complete");
  console.table(summary.inserted);
  console.log(`Duration: ${summary.durationMs}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
