import type { SeedOptions } from "./seed";
import type { Orm } from "./project/detect";
import type { PrismaClientLike } from "./adapters/prismaAdapter";

/** The shape of `seed.config.js`: seeding options plus settings for the CLI. */
export interface SeedConfig extends Omit<SeedOptions, "adapter" | "logger"> {
  /** Which ORM to seed with; detected from the project when omitted */
  orm?: Orm;
  /** Database connection string; read from .env when omitted */
  uri?: string;
  /** A Prisma client, or a function returning one, for clients that need options */
  prismaClient?:
    | PrismaClientLike
    | (() => PrismaClientLike | Promise<PrismaClientLike>);
}

export const USAGE = `Usage: seedsmith [options]       Seed the database of the project in this folder
       seedsmith init            Create seed.config.js and add an npm "seed" script

With no options, SeedSmith detects a Prisma schema or a Mongoose models folder
and reads the connection string from .env.

Options:
      --orm <name>       Force "mongoose" or "prisma" instead of detecting it
  -u, --uri <uri>        Database connection string
                         (default: MONGO_URI, MONGODB_URI or DATABASE_URL)
  -m, --models <dir>     Mongoose models folder (.js or .ts files)
                         (default: ./models, ./src/models, ...)
  -c, --count <n>        Documents to create per model
  -i, --include <A,B>    Only seed these models
  -e, --exclude <X,Y>    Skip these models
      --drop             Empty the seeded collections or tables first
      --transactions     Wrap seeding in a transaction
      --dry-run          Show sample documents without writing anything
      --seed <n>         Seed for deterministic fake data
      --env-file <path>  Read this file instead of .env.local and .env
  -y, --yes              Do not ask before seeding a non-local database
      --verbose          Detailed logging
      --force            With init: overwrite an existing config file
  -h, --help             Show this help

Flags override values from seed.config.js in the current directory.`;

export interface CliOptions {
  uri?: string;
  /** Set by --orm or the config file; detected from the project when absent */
  orm?: Orm;
  /** Skip the confirmation for non-local databases */
  yes: boolean;
  help: boolean;
  seedOptions: SeedOptions;
}

// Config file keys that steer the CLI rather than the seeding itself
const CLI_ONLY_KEYS = ["uri", "orm", "prismaClient"];

function parseOrm(value: unknown): Orm | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "mongoose" || value === "prisma") return value;
  throw new Error(`--orm expects 'mongoose' or 'prisma', got '${value}'.`);
}

export function getArg(argv: string[], ...flags: string[]): string | undefined {
  for (const flag of flags) {
    const idx = argv.indexOf(flag);
    if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  }
  return undefined;
}

export function hasFlag(argv: string[], ...flags: string[]): boolean {
  return flags.some((flag) => argv.includes(flag));
}

function parseList(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseInteger(flag: string, value?: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (value.trim() === "" || !Number.isInteger(n)) {
    throw new Error(`${flag} expects an integer, got '${value}'.`);
  }
  return n;
}

/**
 * Merges command-line flags over the values from seed.config.js.
 * A boolean flag that is absent leaves the config file's value in place.
 */
export function resolveCliOptions(
  argv: string[],
  fileConfig: Record<string, any> = {},
): CliOptions {
  const count = parseInteger("--count", getArg(argv, "--count", "-c"));
  if (count !== undefined && count < 0) {
    throw new Error(`--count must not be negative, got '${count}'.`);
  }
  const seed = parseInteger("--seed", getArg(argv, "--seed"));

  const seedConfig = Object.fromEntries(
    Object.entries(fileConfig).filter(([key]) => !CLI_ONLY_KEYS.includes(key)),
  );

  return {
    uri: getArg(argv, "--uri", "-u") ?? fileConfig.uri,
    orm: parseOrm(getArg(argv, "--orm") ?? fileConfig.orm),
    yes: hasFlag(argv, "--yes", "-y"),
    help: hasFlag(argv, "--help", "-h"),
    seedOptions: {
      ...seedConfig,
      modelsPath: getArg(argv, "--models", "-m") ?? fileConfig.modelsPath,
      docsPerModel: count ?? fileConfig.docsPerModel,
      includeModels:
        parseList(getArg(argv, "--include", "-i")) ?? fileConfig.includeModels,
      excludeModels:
        parseList(getArg(argv, "--exclude", "-e")) ?? fileConfig.excludeModels,
      dropBeforeSeed: hasFlag(argv, "--drop") || fileConfig.dropBeforeSeed,
      useTransactions:
        hasFlag(argv, "--transactions") || fileConfig.useTransactions,
      dryRun: hasFlag(argv, "--dry-run") || fileConfig.dryRun,
      seed: seed ?? fileConfig.seed,
      verbose: hasFlag(argv, "--verbose") || fileConfig.verbose,
    },
  };
}
