import type { SeedOptions } from "./seed";

export const USAGE = `Usage: seedsmith --uri <mongo-uri> [options]
       seedsmith --dry-run --models <dir> [options]

Options:
  -u, --uri <uri>        MongoDB connection string (required)
  -m, --models <dir>     Directory of model files to load
  -c, --count <n>        Documents to create per model
  -i, --include <A,B>    Only seed these models
  -e, --exclude <X,Y>    Skip these models
      --drop             Drop collections before seeding
      --transactions     Wrap seeding in a transaction
      --dry-run          Show sample documents without writing anything
                         (--uri is optional; without it refs are not looked up)
      --seed <n>         Seed for deterministic fake data
      --verbose          Detailed logging
  -h, --help             Show this help

Flags override values from seed.config.js in the current directory.`;

export interface CliOptions {
  uri?: string;
  help: boolean;
  seedOptions: SeedOptions;
}

function getArg(argv: string[], ...flags: string[]): string | undefined {
  for (const flag of flags) {
    const idx = argv.indexOf(flag);
    if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  }
  return undefined;
}

function hasFlag(argv: string[], ...flags: string[]): boolean {
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

  return {
    uri: getArg(argv, "--uri", "-u"),
    help: hasFlag(argv, "--help", "-h"),
    seedOptions: {
      ...fileConfig,
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
