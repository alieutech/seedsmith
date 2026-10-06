# Changelog

## 0.4.0

### Added

- Zero-config CLI: `seedsmith` with no flags detects a Prisma schema or a Mongoose models folder and reads the connection string from `.env.local` or `.env`.
- The CLI seeds Prisma projects (`--orm prisma`, or detected). A client that needs constructor options can be supplied as `prismaClient` in the config file.
- TypeScript model files and `seed.config.ts` are loaded, using the `tsx`, `ts-node` or `esbuild-register` in the project, or Node's own type stripping.
- `seedsmith init` writes a starter config file and adds a `"seed"` script to `package.json`.
- Factories for tests: `createFactory(mongoose)` and `createPrismaFactory(prisma)` with `create`, `createMany` and `build`, which make single documents on demand and create the documents their required refs need.
- New flags: `--orm`, `--env-file`, `--yes`. New config keys: `orm`, `uri`, `prismaClient`. `SeedConfig` type for config files.

### Changed

- When the CLI finds the connection string by itself and it is not a local database, it asks for confirmation before writing; non-interactive runs need `--yes`. A connection string passed with `--uri` is unaffected.
- `modelsPath` now loads model files in subfolders too, and skips `*.test.*`, `*.spec.*` and `*.d.ts` files.
- The CLI uses the `mongoose` installed in the project it runs in, so a globally installed CLI shares one copy with the project's models.
- An empty `includeModels` list now means "all models"; it used to seed nothing.
- CLI errors the user can fix are printed as one line, without a stack trace.

## 0.3.0

### Added

- Dry run: `--dry-run` on the CLI and `dryRun: true` for `seedDatabase` and `seedPrisma` generate and validate documents without writing anything, and return them in `summary.samples`. The CLI no longer needs `--uri` for a dry run.
- `overrides` option for `seedDatabase`, `seedPrisma` and `seed.config.js`: set specific fields to a fixed value or to the result of a function that receives `faker` and `{ model, index, doc }`.

## 0.2.0

### Breaking

- Node.js 20.19 or newer is required (was 18). `@faker-js/faker` 10 is ES-module only and needs it.
- `mongoose` is now an optional peer dependency (`^8.5.2 || ^9.0.0`) instead of a bundled dependency. Install it alongside SeedSmith for Mongoose projects.
- Fields with a schema `default` are no longer generated; Mongoose applies the default itself.
- Documents are inserted one at a time, in order, instead of in a parallel batch.

### Added

- `seedPrisma(prisma, options)`: seeds a Prisma database from the Prisma schema, with no Mongoose models needed. Handles enums, foreign keys, one-to-one relations and self relations.
- Support for typed arrays, nested arrays, subdocuments, arrays of subdocuments, maps, UUID and BigInt in Mongoose schemas.
- `min`, `max`, `minlength`, `maxlength` and simple `match` validators are respected.
- Referenced models are seeded before the models that point at them.
- TypeScript declarations are published, and the package can be loaded with `import` from ES modules.
- CLI: `--help`, and validation of `--count` and `--seed`.
- `PartialInsertError`, so adapters can report how many documents were written before a failure.
- ESLint, and a changelog.

### Fixed

- CLI: `dropBeforeSeed`, `useTransactions` and `verbose` from `seed.config.js` were always overridden to `false`.
- Transactions: batch inserts always fell back to single inserts, and refs created a duplicate stub document for every reference.
- Refs to a model outside the run were filled with ids that pointed at nothing; they now link to existing documents, or are left empty with a warning.
- Prisma adapter: Mongoose model names (`User`) are matched to Prisma delegates (`user`), and `__v` is no longer sent.
- A failed batch could insert some documents twice.
- README: broken code block in the CLI section.

### Security

- `@faker-js/faker` upgraded to 10.x (GHSA-qxc2-j82w-r537) and Jest to 30.x; `npm audit` reports no vulnerabilities.

## 0.1.4

- README, docs and CI/CD updates.

## 0.1.3

- Adapter pattern and Prisma adapter.
