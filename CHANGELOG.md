# Changelog

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
