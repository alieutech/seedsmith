import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { resolveCliOptions } from "../src/cliOptions";
import { runInit } from "../src/init";
import {
  chooseOrm,
  detectProject,
  readPrismaDatabaseUrl,
} from "../src/project/detect";
import { findMongoUri, loadEnvFiles } from "../src/project/env";
import { collectModelFiles } from "../src/project/loadModules";
import { describeTarget } from "../src/project/target";

jest.setTimeout(60000);

const repoRoot = path.resolve(__dirname, "..");
const tempDirs: string[] = [];

// A throwaway project folder; `files` maps relative paths to contents
function project(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seedsmith-test-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

afterAll(() => {
  tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

const model = 'require("mongoose");\n';
const schema = (url: string) =>
  `datasource db {\n  provider = "postgresql"\n  url      = ${url}\n}\n`;

describe("describeTarget", () => {
  it.each([
    ["mongodb://localhost:27017/app", "mongodb://localhost:27017/app", true],
    ["mongodb://127.0.0.1/app?replicaSet=rs0", "mongodb://127.0.0.1/app", true],
    ["mongodb://root:pw@mongo:27017/app", "mongodb://mongo:27017/app", true],
    ["postgresql://u:p@192.168.1.20:5432/shop", "postgresql://192.168.1.20:5432/shop", true],
    ["mongodb://[::1]:27017/app", "mongodb://[::1]:27017/app", true],
    ["file:./dev.db", "file:./dev.db", true],
    [
      "mongodb+srv://bob:s3cret@cluster0.abcde.mongodb.net/prod?retryWrites=true",
      "mongodb+srv://cluster0.abcde.mongodb.net/prod",
      false,
    ],
    ["mongodb://a:b@localhost:27017,db.example.com:27017/app", "mongodb://localhost:27017,db.example.com:27017/app", false],
    ["postgresql://u:p%40ss@db.example.com:5432/shop?sslmode=require", "postgresql://db.example.com:5432/shop", false],
    ["sqlserver://sql.example.com:1433;database=shop;password=pw", "sqlserver://sql.example.com:1433", false],
    ["prisma+postgres://accelerate.prisma-data.net/?api_key=secret", "prisma+postgres://accelerate.prisma-data.net/", false],
    ["not a url", "(unrecognised connection string)", false],
  ])("%s", (uri, display, local) => {
    const target = describeTarget(uri);
    expect(target).toEqual({ display, local });
    expect(target.display).not.toMatch(/s3cret|pw|secret|p%40ss/);
  });
});

describe("env files", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  });

  it("loads .env.local before .env and never overrides variables that are set", () => {
    const dir = project({
      ".env": '# comment\nSS_A=from-env\nSS_B="quoted value"\nSS_C=from-env\n',
      ".env.local": "SS_A=from-local\n",
    });
    process.env.SS_C = "from-shell";

    expect(loadEnvFiles(dir)).toEqual([".env.local", ".env"]);
    expect(process.env.SS_A).toBe("from-local");
    expect(process.env.SS_B).toBe("quoted value");
    expect(process.env.SS_C).toBe("from-shell");
  });

  it("reads only the explicit file, and fails if it is missing", () => {
    const dir = project({ ".env": "SS_D=default\n", "ci.env": "SS_E=ci\n" });
    expect(loadEnvFiles(dir, "ci.env")).toEqual(["ci.env"]);
    expect(process.env.SS_E).toBe("ci");
    expect(process.env.SS_D).toBeUndefined();
    expect(() => loadEnvFiles(dir, "nope.env")).toThrow(/Env file not found/);
    expect(loadEnvFiles(project())).toEqual([]);
  });

  it("finds a MongoDB connection string by its usual names", () => {
    expect(findMongoUri({})).toBeUndefined();
    expect(findMongoUri({ DATABASE_URL: "postgresql://localhost/db" })).toBeUndefined();
    expect(
      findMongoUri({
        DATABASE_URL: "mongodb://localhost/a",
        MONGODB_URI: "mongodb+srv://x.example.net/b",
      }),
    ).toEqual({ uri: "mongodb+srv://x.example.net/b", variable: "MONGODB_URI" });
  });
});

describe("project detection", () => {
  it("finds Mongoose models, skipping tests, type declarations and duplicates", () => {
    const dir = project({
      "package.json": JSON.stringify({ dependencies: { mongoose: "^8" } }),
      "src/models/user.ts": model,
      "src/models/user.js": model,
      "src/models/user.test.ts": model,
      "src/models/types.d.ts": "",
      "src/models/blog/post.ts": model,
      "src/models/__mocks__/fake.ts": model,
      "src/models/README.md": "",
    });
    const info = detectProject(dir);
    expect(info).toMatchObject({
      modelsDir: "src/models",
      hasMongoose: true,
      isEsm: false,
      prismaSchema: undefined,
    });
    expect(chooseOrm(info)).toBe("mongoose");
    expect(
      collectModelFiles(path.join(dir, "src/models")).map((f) =>
        path.relative(dir, f),
      ),
    ).toEqual(["src/models/blog/post.ts", "src/models/user.js"]);
  });

  it("finds a Prisma schema, including one named in package.json", () => {
    const standard = project({ "prisma/schema.prisma": schema('env("DATABASE_URL")') });
    expect(chooseOrm(detectProject(standard))).toBe("prisma");

    const custom = project({
      "package.json": JSON.stringify({ type: "module", prisma: { schema: "db/app.prisma" } }),
      "db/app.prisma": schema('"file:./dev.db"'),
      "models/helpers.js": "",
    });
    const info = detectProject(custom);
    expect(info).toMatchObject({ prismaSchema: "db/app.prisma", isEsm: true });
    // a models folder without mongoose installed does not make it ambiguous
    expect(chooseOrm(info)).toBe("prisma");
  });

  it("asks for a choice when both are present, and defaults to Mongoose when neither is", () => {
    const both = project({
      "package.json": JSON.stringify({ dependencies: { mongoose: "^8" } }),
      "models/user.js": model,
      "prisma/schema.prisma": schema('env("DATABASE_URL")'),
    });
    expect(() => chooseOrm(detectProject(both))).toThrow(/--orm prisma or --orm mongoose/);
    expect(chooseOrm(detectProject(project()))).toBe("mongoose");
  });

  it("reads the database URL a Prisma schema points at", () => {
    const dir = project({
      "a.prisma": schema('env("SHOP_DB")'),
      "b.prisma": schema('"file:./dev.db"'),
      "c.prisma": 'generator client {\n  provider = "prisma-client"\n}\n',
      "multi/models.prisma": "model A {\n  id Int @id\n}\n",
      "multi/base.prisma": schema('env("SHOP_DB")'),
    });
    const env = { SHOP_DB: "postgresql://localhost/shop", DATABASE_URL: "postgresql://localhost/other" };
    expect(readPrismaDatabaseUrl(dir, "a.prisma", env)).toEqual({ url: env.SHOP_DB, variable: "SHOP_DB" });
    expect(readPrismaDatabaseUrl(dir, "a.prisma", {})).toBeUndefined();
    expect(readPrismaDatabaseUrl(dir, "b.prisma", env)).toEqual({ url: "file:./dev.db" });
    expect(readPrismaDatabaseUrl(dir, "c.prisma", env)).toEqual({ url: env.DATABASE_URL, variable: "DATABASE_URL" });
    expect(readPrismaDatabaseUrl(dir, "multi", env)).toEqual({ url: env.SHOP_DB, variable: "SHOP_DB" });
    expect(readPrismaDatabaseUrl(dir, "missing.prisma", env)).toBeUndefined();
  });
});

describe("seedsmith init", () => {
  it("writes a config for the detected models and adds a seed script, keeping the file's formatting", () => {
    const pkg = '{\n\t"name": "app",\n\t"scripts": {\n\t\t"dev": "node ."\n\t},\n\t"dependencies": {\n\t\t"mongoose": "^8"\n\t}\n}\n';
    const dir = project({ "package.json": pkg, "src/models/user.js": model });

    const lines = runInit(dir).join("\n");

    expect(lines).toMatch(/Detected Mongoose models in \.\/src\/models/);
    expect(lines).toMatch(/npm install -D @alieutech\/seedsmith/);
    const written = { exports: {} };
    new Function("module", fs.readFileSync(path.join(dir, "seed.config.js"), "utf8"))(written);
    expect(written.exports).toEqual({
      orm: "mongoose",
      modelsPath: "./src/models",
      docsPerModel: 20,
      dropBeforeSeed: false,
    });
    expect(fs.readFileSync(path.join(dir, "package.json"), "utf8")).toBe(
      pkg.replace('"dev": "node ."', '"dev": "node .",\n\t\t"seed": "seedsmith"'),
    );
  });

  it("keeps an existing config and script unless forced", () => {
    const dir = project({
      "package.json": JSON.stringify({ scripts: { seed: "node seed.js" }, devDependencies: { "@alieutech/seedsmith": "^0.4.0" } }),
      "seed.config.js": "module.exports = { docsPerModel: 3 };\n",
      "prisma/schema.prisma": schema('env("DATABASE_URL")'),
    });

    const kept = runInit(dir).join("\n");
    expect(kept).toMatch(/Kept seed\.config\.js/);
    expect(kept).toMatch(/Kept the existing "seed" script/);
    expect(kept).not.toMatch(/npm install -D/);
    expect(fs.readFileSync(path.join(dir, "seed.config.js"), "utf8")).toMatch(/docsPerModel: 3/);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).scripts.seed).toBe("node seed.js");

    expect(runInit(dir, { force: true }).join("\n")).toMatch(/Wrote seed\.config\.js/);
    expect(fs.readFileSync(path.join(dir, "seed.config.js"), "utf8")).toMatch(/orm: "prisma"/);
  });

  it("writes a .cjs config in an ES module project, and works without a package.json", () => {
    const esm = project({ "package.json": JSON.stringify({ type: "module" }) });
    expect(runInit(esm, { orm: "prisma" }).join("\n")).toMatch(/Wrote seed\.config\.cjs/);
    expect(fs.existsSync(path.join(esm, "seed.config.cjs"))).toBe(true);

    const bare = project();
    const lines = runInit(bare).join("\n");
    expect(lines).toMatch(/No package\.json here/);
    expect(lines).toMatch(/npx seedsmith --dry-run/);
  });
});

describe("CLI options", () => {
  it("reads orm and uri from flags or the config file, and keeps them out of the seed options", () => {
    const config = { orm: "prisma", uri: "file:./dev.db", prismaClient: () => ({}), docsPerModel: 4 };
    const fromConfig = resolveCliOptions([], config);
    expect(fromConfig).toMatchObject({ orm: "prisma", uri: "file:./dev.db", yes: false });
    expect(fromConfig.seedOptions).toMatchObject({ docsPerModel: 4 });
    expect(fromConfig.seedOptions).not.toHaveProperty("orm");
    expect(fromConfig.seedOptions).not.toHaveProperty("uri");
    expect(fromConfig.seedOptions).not.toHaveProperty("prismaClient");

    const fromFlags = resolveCliOptions(["--orm", "mongoose", "-u", "mongodb://localhost/x", "-y"], config);
    expect(fromFlags).toMatchObject({ orm: "mongoose", uri: "mongodb://localhost/x", yes: true });
    expect(() => resolveCliOptions(["--orm", "sequelize"])).toThrow(/--orm expects/);
  });
});

describe("CLI, end to end", () => {
  // Runs the real CLI in a separate process, in a TypeScript project with nothing configured
  function cli(cwd: string, ...args: string[]) {
    const tsx = require.resolve("tsx/cli");
    const entry = path.join(repoRoot, "src/cli.ts");
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test" };
    delete env.MONGO_URI;
    delete env.MONGODB_URI;
    delete env.DATABASE_URL;
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(process.execPath, [tsx, entry, ...args], { cwd, env, timeout: 50000 }, (err, stdout, stderr) =>
        resolve({ code: err ? ((err as any).code ?? 1) : 0, stdout, stderr }),
      );
    });
  }

  function typeScriptProject(extra: Record<string, string> = {}) {
    const dir = project({
      "package.json": JSON.stringify({ dependencies: { mongoose: "^8" } }),
      "src/models/user.ts": [
        'import mongoose, { Schema } from "mongoose";',
        'export enum Role { User = "user", Admin = "admin" }',
        "const userSchema = new Schema({",
        "  email: { type: String, required: true, unique: true },",
        "  role: { type: String, enum: Object.values(Role), default: Role.User },",
        "});",
        'export default mongoose.model("User", userSchema);',
      ].join("\n"),
      "src/models/blog/post.ts": [
        'import mongoose, { Schema } from "mongoose";',
        'import "../user";',
        "interface Post { title: string; author: mongoose.Types.ObjectId }",
        "const postSchema = new Schema<Post>({",
        "  title: { type: String, required: true },",
        '  author: { type: Schema.Types.ObjectId, ref: "User", required: true },',
        "});",
        'export const PostModel = mongoose.model<Post>("Post", postSchema);',
      ].join("\n"),
      ...extra,
    });
    // Lets the project resolve mongoose and tsx, as an installed project would
    fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
    return dir;
  }

  it("previews TypeScript models with no flags beyond --dry-run", async () => {
    const dir = typeScriptProject({
      "seed.config.js": 'module.exports = { overrides: { Post: { title: "From config" } } };\n',
    });
    const result = await cli(dir, "--dry-run", "--count", "2");

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/Project: {2}Mongoose, models in src\/models/);
    expect(result.stdout).toMatch(/User: 2 generated/);
    expect(result.stdout).toMatch(/Post: 2 generated/);
    expect(result.stdout).toMatch(/title: 'From config'/);
    expect(result.stdout).toMatch(/Nothing was written/);
  });

  it("explains what is missing when there is no connection string", async () => {
    const result = await cli(typeScriptProject());
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^seedsmith: No MongoDB connection string found/);
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });

  it("refuses to write to a remote database it found in .env without --yes", async () => {
    const dir = typeScriptProject({
      ".env": "MONGO_URI=mongodb+srv://bob:s3cret@cluster0.example.mongodb.net/prod\n",
    });
    const result = await cli(dir);

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/Database: mongodb\+srv:\/\/cluster0\.example\.mongodb\.net\/prod \(from MONGO_URI\)/);
    expect(result.stderr).toMatch(/Refusing to write to .* Re-run with --yes/);
    expect(result.stdout + result.stderr).not.toMatch(/s3cret/);
  });
});
