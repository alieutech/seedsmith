import fs from "fs";
import path from "path";
import {
  chooseOrm,
  detectProject,
  findConfigFile,
  type Orm,
} from "./project/detect";

const PACKAGE_NAME = "@alieutech/seedsmith";

function configTemplate(orm: Orm, modelsDir?: string): string {
  const header =
    "// SeedSmith config. Flags on the command line override these values.\n" +
    `/** @type {import("${PACKAGE_NAME}").SeedConfig} */\n` +
    "module.exports = {\n";
  const common =
    "  docsPerModel: 20,\n" +
    "  dropBeforeSeed: false,\n" +
    "  // seed: 42, // same fake data on every run\n";

  if (orm === "prisma") {
    return (
      header +
      '  orm: "prisma",\n' +
      common +
      "  // If your Prisma client needs options (for example a driver adapter), provide it:\n" +
      '  // prismaClient: () => require("./src/db").prisma,\n' +
      "  // Fixed values or functions for specific fields:\n" +
      "  // overrides: {\n" +
      "  //   User: { email: (faker, { index }) => `user${index}@example.com` },\n" +
      "  // },\n" +
      "};\n"
    );
  }
  const models = modelsDir
    ? `  modelsPath: "./${modelsDir}",\n`
    : '  // modelsPath: "./models", // folder with your Mongoose models\n';
  return (
    header +
    '  orm: "mongoose",\n' +
    models +
    common +
    "  // Fixed values or functions for specific fields:\n" +
    "  // overrides: {\n" +
    '  //   User: { role: "admin", email: (faker, { index }) => `user${index}@example.com` },\n' +
    "  // },\n" +
    "};\n"
  );
}

// Adds the script without disturbing the file's formatting or key order
function addSeedScript(cwd: string): "added" | "exists" | "no-package" {
  const file = path.join(cwd, "package.json");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return "no-package";
  }
  const pkg = JSON.parse(raw);
  if (pkg.scripts?.seed) return "exists";
  pkg.scripts = { ...pkg.scripts, seed: "seedsmith" };
  const indent = /^(\s+)"/m.exec(raw)?.[1] ?? "  ";
  const eol = raw.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(file, JSON.stringify(pkg, null, indent) + eol);
  return "added";
}

/** Sets a project up for SeedSmith. Returns the lines to show the user. */
export function runInit(
  cwd: string,
  options: { force?: boolean; orm?: Orm } = {},
): string[] {
  const project = detectProject(cwd);
  const orm = options.orm ?? chooseOrm(project);
  const lines: string[] = [];

  if (orm === "prisma") {
    lines.push(
      project.prismaSchema
        ? `Detected a Prisma project (${project.prismaSchema}).`
        : "Setting up for Prisma.",
    );
  } else if (project.modelsDir) {
    lines.push(`Detected Mongoose models in ./${project.modelsDir}.`);
  } else {
    lines.push(
      "No Prisma schema or models folder found; wrote a Mongoose config to fill in.",
    );
  }

  const existing = findConfigFile(cwd);
  // A CommonJS config must be .cjs in an ES module project
  const name = project.isEsm ? "seed.config.cjs" : "seed.config.js";
  if (existing && !options.force) {
    lines.push(`Kept ${existing} (use --force to overwrite).`);
  } else {
    fs.writeFileSync(
      path.join(cwd, name),
      configTemplate(orm, orm === "mongoose" ? project.modelsDir : undefined),
    );
    lines.push(`Wrote ${name}.`);
    if (existing && existing !== name) {
      lines.push(
        `Note: ${existing} also exists; remove one of the two config files.`,
      );
    }
  }

  const script = addSeedScript(cwd);
  if (script === "added") lines.push('Added "seed" script to package.json.');
  if (script === "exists") lines.push('Kept the existing "seed" script in package.json.');
  if (script === "no-package") lines.push("No package.json here, so no script was added.");

  const deps = { ...project.pkg?.dependencies, ...project.pkg?.devDependencies };
  if (project.pkg && !(PACKAGE_NAME in deps)) {
    lines.push(`Install SeedSmith in this project: npm install -D ${PACKAGE_NAME}`);
  }

  const run = script === "no-package" ? "npx seedsmith" : "npm run seed";
  const dash = script === "no-package" ? "" : " --";
  lines.push(
    "",
    "Next steps:",
    `  ${run}${dash} --dry-run   preview the data, nothing is written`,
    `  ${run}               seed the database`,
  );
  return lines;
}
