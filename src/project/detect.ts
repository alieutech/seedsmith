import fs from "fs";
import path from "path";
import { collectModelFiles } from "./loadModules";

export type Orm = "mongoose" | "prisma";

export interface ProjectInfo {
  cwd: string;
  /** Parsed package.json, if there is one */
  pkg?: Record<string, any>;
  /** True when package.json has "type": "module" */
  isEsm: boolean;
  /** Path to the Prisma schema file or folder, relative to cwd */
  prismaSchema?: string;
  /** Path to the Mongoose models folder, relative to cwd */
  modelsDir?: string;
  hasMongoose: boolean;
}

export const MODEL_DIRS = [
  "models",
  "src/models",
  "server/models",
  "src/server/models",
  "backend/models",
  "api/models",
  "app/models",
  "lib/models",
  "db/models",
  "src/db/models",
];

const PRISMA_SCHEMAS = [
  "prisma/schema.prisma",
  "schema.prisma",
  "prisma/schema",
  "src/prisma/schema.prisma",
  "db/schema.prisma",
];

export const CONFIG_FILES = [
  "seed.config.js",
  "seed.config.cjs",
  "seed.config.mjs",
  "seed.config.ts",
];

function readPackageJson(cwd: string): Record<string, any> | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
}

function hasModelFiles(dir: string): boolean {
  try {
    return collectModelFiles(dir).length > 0;
  } catch {
    return false;
  }
}

export function detectProject(cwd: string): ProjectInfo {
  const pkg = readPackageJson(cwd);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };

  const schemaCandidates = [pkg?.prisma?.schema, ...PRISMA_SCHEMAS].filter(
    (p): p is string => typeof p === "string",
  );

  return {
    cwd,
    pkg,
    isEsm: pkg?.type === "module",
    prismaSchema: schemaCandidates.find((p) =>
      fs.existsSync(path.resolve(cwd, p)),
    ),
    modelsDir: MODEL_DIRS.find((dir) => hasModelFiles(path.join(cwd, dir))),
    hasMongoose: "mongoose" in deps,
  };
}

/** Picks the ORM to seed with, or explains why it cannot tell. */
export function chooseOrm(project: ProjectInfo): Orm {
  const mongooseLikely = project.hasMongoose && Boolean(project.modelsDir);
  if (project.prismaSchema && mongooseLikely) {
    throw new Error(
      `Found both a Prisma schema (${project.prismaSchema}) and Mongoose models (${project.modelsDir}). ` +
        `Choose one with --orm prisma or --orm mongoose, or set \`orm\` in seed.config.js.`,
    );
  }
  return project.prismaSchema ? "prisma" : "mongoose";
}

export function findConfigFile(cwd: string): string | undefined {
  return CONFIG_FILES.find((name) => fs.existsSync(path.join(cwd, name)));
}

/**
 * Finds the database URL a Prisma schema points at: the value of the
 * environment variable it names, or a URL written in the schema itself.
 */
export function readPrismaDatabaseUrl(
  cwd: string,
  schemaPath: string,
  env: NodeJS.ProcessEnv = process.env,
): { url: string; variable?: string } | undefined {
  const abs = path.resolve(cwd, schemaPath);
  let source = "";
  try {
    source = fs.statSync(abs).isDirectory()
      ? fs
          .readdirSync(abs)
          .filter((f) => f.endsWith(".prisma"))
          .map((f) => fs.readFileSync(path.join(abs, f), "utf8"))
          .join("\n")
      : fs.readFileSync(abs, "utf8");
  } catch {
    return undefined;
  }
  const block = /datasource\s+\w+\s*\{([^}]*)\}/.exec(source)?.[1] ?? "";
  const viaEnv = /^\s*url\s*=\s*env\(\s*"([^"]+)"\s*\)/m.exec(block);
  if (viaEnv) {
    const url = env[viaEnv[1]];
    return url ? { url, variable: viaEnv[1] } : undefined;
  }
  const literal = /^\s*url\s*=\s*"([^"]+)"/m.exec(block);
  if (literal) return { url: literal[1] };
  // Newer Prisma versions keep the URL outside the schema
  return env.DATABASE_URL
    ? { url: env.DATABASE_URL, variable: "DATABASE_URL" }
    : undefined;
}
