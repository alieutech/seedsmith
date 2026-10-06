import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const JS_EXTENSIONS = [".js", ".cjs", ".mjs"];
const TS_EXTENSIONS = [".ts", ".cts", ".mts"];
const SKIPPED_FILE = /\.(d|test|spec)\.[cm]?[jt]s$/;
const MAX_DEPTH = 5;

export function isTypeScriptFile(file: string): boolean {
  return TS_EXTENSIONS.includes(path.extname(file));
}

/** Lists the loadable files under a models directory, including subfolders. */
export function collectModelFiles(dir: string, depth = 0): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  const seen = new Set<string>();
  // .js first: when a file is compiled next to its source, load it once
  const ordered = [...entries].sort(
    (a, b) =>
      Number(isTypeScriptFile(a.name)) - Number(isTypeScriptFile(b.name)) ||
      a.name.localeCompare(b.name),
  );
  for (const entry of ordered) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hidden = /^(\.|__)/.test(entry.name) || entry.name === "node_modules";
      if (!hidden && depth < MAX_DEPTH) {
        files.push(...collectModelFiles(full, depth + 1));
      }
      continue;
    }
    const ext = path.extname(entry.name);
    if (![...JS_EXTENSIONS, ...TS_EXTENSIONS].includes(ext)) continue;
    if (SKIPPED_FILE.test(entry.name)) continue;
    const stem = entry.name.slice(0, -ext.length);
    if (seen.has(stem)) continue;
    seen.add(stem);
    files.push(full);
  }
  return files.sort();
}

function resolveFrom(cwd: string, request: string): string | undefined {
  try {
    return require.resolve(request, { paths: [cwd] });
  } catch {
    return undefined;
  }
}

/** Loads a package from the user's project, so its models and SeedSmith share one copy. */
export function requireFromProject(cwd: string, request: string): any {
  const resolved = resolveFrom(cwd, request);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(resolved ?? request);
}

let typeScriptLoader: string | undefined;

/**
 * Makes `.ts` files loadable, using a loader from the user's project when there is one.
 * Returns the name of the loader in use.
 */
export function registerTypeScript(cwd: string): string {
  if (typeScriptLoader) return typeScriptLoader;

  const native = Boolean((process as any).features?.typescript);
  // Already running under a loader (tsx, ts-node, a test runner)
  if (require.extensions[".ts"] && !native) {
    return (typeScriptLoader = "existing loader");
  }

  const tsx = resolveFrom(cwd, "tsx/cjs/api");
  if (tsx) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(tsx).register();
    return (typeScriptLoader = "tsx");
  }
  const tsNode = resolveFrom(cwd, "ts-node");
  if (tsNode) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(tsNode).register({
      transpileOnly: true,
      compilerOptions: { module: "commonjs" },
    });
    return (typeScriptLoader = "ts-node");
  }
  const esbuildRegister = resolveFrom(cwd, "esbuild-register/dist/node");
  if (esbuildRegister) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(esbuildRegister).register();
    return (typeScriptLoader = "esbuild-register");
  }
  if (native) return (typeScriptLoader = "Node.js type stripping");

  throw new Error(
    "TypeScript files need a loader. Install one in your project: npm install -D tsx",
  );
}

// Kept out of the TypeScript compiler's reach, which would turn import() into require()
const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<any>;

/** Loads a CommonJS or ES module file and returns its exports. */
export async function loadFile(file: string): Promise<any> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(file);
  } catch (e: any) {
    if (e?.code === "ERR_REQUIRE_ESM" || e?.code === "ERR_REQUIRE_ASYNC_MODULE") {
      return dynamicImport(pathToFileURL(file).href);
    }
    throw e;
  }
}

/** Loads every model file in a directory so the models register themselves. */
export async function loadModelsFromDir(modelsPath: string): Promise<string[]> {
  const abs = path.isAbsolute(modelsPath)
    ? modelsPath
    : path.resolve(process.cwd(), modelsPath);
  let files: string[];
  try {
    files = collectModelFiles(abs);
  } catch (e: any) {
    throw new Error(
      `SeedSmith: Failed to read models directory: ${abs}. ${e?.message || e}`,
    );
  }
  if (files.some(isTypeScriptFile)) {
    try {
      registerTypeScript(process.cwd());
    } catch (e: any) {
      throw new Error(`SeedSmith: ${e?.message || e}`);
    }
  }
  for (const file of files) {
    try {
      await loadFile(file);
    } catch (e: any) {
      throw new Error(
        `SeedSmith: Failed to load model file ${file}. ${e?.message || e}`,
      );
    }
  }
  return files;
}
