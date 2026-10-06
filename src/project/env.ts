import fs from "fs";
import path from "path";
import util from "util";

const DEFAULT_ENV_FILES = [".env.local", ".env"];

// Environment variables that commonly hold a MongoDB connection string
const MONGO_URI_VARIABLES = [
  "MONGO_URI",
  "MONGODB_URI",
  "MONGO_URL",
  "MONGODB_URL",
  "DATABASE_URL",
  "DB_URI",
  "DB_URL",
];

function parseEnv(content: string): Record<string, string> {
  const builtin = (util as any).parseEnv;
  if (typeof builtin === "function") return builtin(content);
  // Fallback for runtimes without util.parseEnv
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
    if (!match) continue;
    let value = (match[2] ?? "").trim();
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, "");
    values[match[1]] = value;
  }
  return values;
}

/**
 * Loads `.env.local` and `.env` (or one explicit file) into process.env.
 * Variables that are already set are left alone. Returns the files that were read.
 */
export function loadEnvFiles(cwd: string, explicitFile?: string): string[] {
  const files = explicitFile
    ? [path.resolve(cwd, explicitFile)]
    : DEFAULT_ENV_FILES.map((name) => path.join(cwd, name));
  const loaded: string[] = [];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      if (explicitFile) throw new Error(`Env file not found: ${file}`);
      continue;
    }
    const values = parseEnv(fs.readFileSync(file, "utf8"));
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
    loaded.push(path.relative(cwd, file) || file);
  }
  return loaded;
}

export function findMongoUri(
  env: NodeJS.ProcessEnv = process.env,
): { uri: string; variable: string } | undefined {
  for (const variable of MONGO_URI_VARIABLES) {
    const uri = env[variable];
    if (uri && /^mongodb(\+srv)?:\/\//i.test(uri)) return { uri, variable };
  }
  return undefined;
}
