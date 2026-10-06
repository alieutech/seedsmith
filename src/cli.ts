#!/usr/bin/env node
import path from "path";
import readline from "readline";
import util from "util";
import { seedDatabase, type SeedOptions, type SeedSummary } from "./seed";
import { seedPrisma } from "./prisma/seedPrisma";
import {
  getArg,
  hasFlag,
  resolveCliOptions,
  USAGE,
  type CliOptions,
} from "./cliOptions";
import { runInit } from "./init";
import {
  chooseOrm,
  detectProject,
  findConfigFile,
  MODEL_DIRS,
  readPrismaDatabaseUrl,
  type Orm,
  type ProjectInfo,
} from "./project/detect";
import { findMongoUri, loadEnvFiles } from "./project/env";
import {
  isTypeScriptFile,
  loadFile,
  registerTypeScript,
  requireFromProject,
} from "./project/loadModules";
import { describeTarget } from "./project/target";
import { ensureNotProduction } from "./utils/envCheck";
import { createLogger } from "./utils/logger";

const DRY_RUN_SAMPLES = 3;

// A problem the user can fix: shown as a message, without a stack trace
class CliError extends Error {}

function parseOrmFlag(argv: string[]): Orm | undefined {
  const value = getArg(argv, "--orm");
  if (value === undefined || value === "mongoose" || value === "prisma") {
    return value;
  }
  throw new CliError(`--orm expects 'mongoose' or 'prisma', got '${value}'.`);
}

async function loadConfig(cwd: string): Promise<Record<string, any>> {
  const name = findConfigFile(cwd);
  if (!name) return {};
  const file = path.join(cwd, name);
  try {
    if (isTypeScriptFile(file)) registerTypeScript(cwd);
    const mod = await loadFile(file);
    const config = mod?.default ?? mod ?? {};
    return config?.default ?? config;
  } catch (e: any) {
    throw new CliError(`Could not load ${name}. ${e?.message || e}`);
  }
}

/** Auto-detected databases that are not local need a yes before anything is written. */
async function confirmTarget(
  display: string,
  action: string,
  yes: boolean,
): Promise<void> {
  if (yes) return;
  const question = `This will ${action} ${display}, which is not a local database. Continue? [y/N] `;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError(
      `Refusing to ${action} ${display} without confirmation, because it is not a local database ` +
        `and was found automatically. Re-run with --yes to confirm.`,
    );
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  // Otherwise the terminal's input stream keeps the process alive after seeding
  process.stdin.pause();
  process.stdin.unref?.();
  if (!/^y(es)?$/i.test(answer.trim())) throw new CliError("Cancelled.");
}

async function runMongoose(
  cwd: string,
  project: ProjectInfo,
  cli: CliOptions,
  options: SeedOptions,
): Promise<SeedSummary> {
  let mongoose: any;
  try {
    const mod = requireFromProject(cwd, "mongoose");
    mongoose = mod?.default ?? mod;
  } catch {
    throw new CliError(
      "mongoose is not installed in this project. Run: npm install mongoose",
    );
  }

  const modelsPath = options.modelsPath ?? project.modelsDir;
  if (!modelsPath) {
    throw new CliError(
      `Could not find a models folder (looked in ${MODEL_DIRS.slice(0, 4).join(", ")}, ...). ` +
        `Pass --models <dir>, or run 'seedsmith init'.`,
    );
  }

  let uri = cli.uri;
  let foundIn: string | undefined;
  if (!uri) {
    const found = findMongoUri();
    uri = found?.uri;
    foundIn = found?.variable;
  }
  if (!uri && !options.dryRun) {
    throw new CliError(
      "No MongoDB connection string found. Set MONGO_URI in .env or pass --uri <uri>. " +
        "To preview without a database, add --dry-run.",
    );
  }

  console.log(`Project:  Mongoose, models in ${modelsPath}`);
  if (uri) {
    const target = describeTarget(uri);
    console.log(
      `Database: ${target.display}${foundIn ? ` (from ${foundIn})` : ""}`,
    );
    // A connection string the user typed or configured is taken as intended
    if (foundIn && !target.local && !options.dryRun) {
      await confirmTarget(target.display, "write to", cli.yes);
    }
  }

  if (uri) await mongoose.connect(uri);
  try {
    return await seedDatabase(mongoose, { ...options, modelsPath });
  } finally {
    if (uri) await mongoose.disconnect();
  }
}

async function runPrisma(
  cwd: string,
  project: ProjectInfo,
  cli: CliOptions,
  options: SeedOptions,
  config: Record<string, any>,
): Promise<SeedSummary> {
  let client: any = config.prismaClient;
  let datamodel: any;
  if (typeof client === "function") client = await client();

  if (!client) {
    let mod: any;
    try {
      mod = requireFromProject(cwd, "@prisma/client");
    } catch {
      throw new CliError(
        "@prisma/client is not installed in this project. Run: npm install @prisma/client && npx prisma generate",
      );
    }
    datamodel = mod.Prisma?.dmmf?.datamodel;
    try {
      client = cli.uri
        ? new mod.PrismaClient({ datasourceUrl: cli.uri })
        : new mod.PrismaClient();
    } catch (e: any) {
      throw new CliError(
        `Could not create a Prisma client. ${e?.message || e}\n` +
          "If your client needs options (for example a driver adapter) or is generated to a custom folder, " +
          "export it as `prismaClient` from seed.config.js.",
      );
    }
  }

  const found = cli.uri
    ? undefined
    : project.prismaSchema
      ? readPrismaDatabaseUrl(cwd, project.prismaSchema)
      : undefined;
  const url = cli.uri ?? found?.url;
  const target = url ? describeTarget(url) : undefined;

  console.log(
    `Project:  Prisma${project.prismaSchema ? `, schema ${project.prismaSchema}` : ""}`,
  );
  console.log(
    `Database: ${target?.display ?? "(could not be determined)"}${
      found?.variable ? ` (from ${found.variable})` : ""
    }`,
  );
  if (!cli.uri && !target?.local && !options.dryRun) {
    await confirmTarget(target?.display ?? "the configured database", "write to", cli.yes);
  }

  try {
    return await seedPrisma(client, {
      datamodel,
      docsPerModel: options.docsPerModel,
      includeModels: options.includeModels,
      excludeModels: options.excludeModels,
      dropBeforeSeed: options.dropBeforeSeed,
      useTransactions: options.useTransactions,
      seed: options.seed,
      overrides: options.overrides,
      dryRun: options.dryRun,
      verbose: options.verbose,
      logger: options.logger,
    });
  } finally {
    await client.$disconnect?.();
  }
}

function printSummary(summary: SeedSummary) {
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

async function main() {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, "--help", "-h")) {
    console.log(USAGE);
    return;
  }

  const cwd = process.cwd();

  if (argv[0] === "init") {
    let lines: string[];
    try {
      lines = runInit(cwd, {
        force: hasFlag(argv, "--force"),
        orm: parseOrmFlag(argv),
      });
    } catch (e: any) {
      throw e instanceof CliError ? e : new CliError(e?.message || String(e));
    }
    lines.forEach((line) => console.log(line));
    return;
  }

  try {
    loadEnvFiles(cwd, getArg(argv, "--env-file"));
    ensureNotProduction();
  } catch (e: any) {
    throw new CliError(e?.message || String(e));
  }

  const config = await loadConfig(cwd);
  let cli: CliOptions;
  try {
    cli = resolveCliOptions(argv, config);
  } catch (err: any) {
    throw new CliError(`${err?.message || err}\n\n${USAGE}`);
  }
  const options: SeedOptions = {
    ...cli.seedOptions,
    logger: createLogger(Boolean(cli.seedOptions.verbose)),
  };

  const project = detectProject(cwd);
  // Mongoose-only flags settle the question in a project that has both
  const impliedMongoose =
    getArg(argv, "--models", "-m") !== undefined ||
    /^mongodb(\+srv)?:\/\//i.test(getArg(argv, "--uri", "-u") ?? "");
  let orm: Orm;
  try {
    orm = cli.orm ?? (impliedMongoose ? "mongoose" : chooseOrm(project));
  } catch (e: any) {
    throw new CliError(e?.message || String(e));
  }

  const summary =
    orm === "prisma"
      ? await runPrisma(cwd, project, cli, options, config)
      : await runMongoose(cwd, project, cli, options);
  printSummary(summary);
}

main().catch((err) => {
  if (err instanceof CliError) console.error(`seedsmith: ${err.message}`);
  else console.error(err);
  process.exit(1);
});
