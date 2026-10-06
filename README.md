# SeedSmith

[![CI](https://github.com/alieutech/seedsmith/actions/workflows/ci.yml/badge.svg)](https://github.com/alieutech/seedsmith/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/@alieutech%2Fseedsmith.svg)](https://www.npmjs.com/package/@alieutech/seedsmith)

A Node.js + TypeScript CLI and library that auto-generates seed data for MongoDB (Mongoose) and Prisma with realistic fake data.

## Features

- 🎭 Uses `@faker-js/faker` to generate realistic values
- 🔍 Inspects Mongoose schemas automatically, including arrays, nested subdocuments and maps
- ✅ Respects `enum`, `min`, `max`, `minlength`, `maxlength` and simple `match` validators
- 🔗 Handles refs and relations by seeding referenced models first and linking to their rows
- 🛡️ Prevents seeding when `NODE_ENV=production`
- 🔌 Pluggable adapter pattern for multiple ORMs
- 📦 Works with Mongoose and with Prisma (reads your Prisma schema directly)
- 🎲 Deterministic seeding via seed option
- 🔄 Transaction support
- 🎯 Smart field-name mapping (email, phone, price, etc.)
- ✏️ Per-field overrides: fixed values or your own generator functions
- 👀 Dry run: preview the generated documents without writing anything

## Install

```bash
# Mongoose projects
npm install @alieutech/seedsmith mongoose

# Prisma projects (no mongoose needed)
npm install @alieutech/seedsmith

# CLI usage (MongoDB only)
npm install -g @alieutech/seedsmith mongoose
```

Requires Node.js 20.19 or newer. `mongoose` (v8 or v9) is an optional peer dependency, so SeedSmith uses the same copy as your models.

## CLI usage

```bash
# Basic
seedsmith --uri mongodb://localhost:27017/mydb --models ./path/to/models --count 25

# Quick start with your Atlas cluster (use environment variable – do NOT hardcode secrets)
export MONGO_URI="mongodb+srv://<username>:<password>@<cluster-host>/<dbName>?retryWrites=true&w=majority&appName=SeedSmith"

NODE_ENV=development \
seedsmith \
  --uri "$MONGO_URI" \
  --models ./models \
  --count 25

# Include/Exclude models
seedsmith --uri mongodb://localhost:27017/mydb --models ./models --include User,Post --exclude Log

# Drop collections before seeding
seedsmith --uri mongodb://localhost:27017/mydb --models ./models --drop
```

### CLI options

| Flag | Description |
| --- | --- |
| `-u, --uri <uri>` | MongoDB connection string (required) |
| `-m, --models <dir>` | Directory of model files to load |
| `-c, --count <n>` | Documents to create per model |
| `-i, --include <A,B>` | Only seed these models |
| `-e, --exclude <X,Y>` | Skip these models |
| `--drop` | Drop collections before seeding |
| `--transactions` | Wrap seeding in a transaction (requires a replica set) |
| `--dry-run` | Show sample documents without writing anything |
| `--seed <n>` | Seed for deterministic fake data |
| `--verbose` | Detailed logging |
| `-h, --help` | Show help |

### Optional config file

Create `seed.config.js` in your project root to customize defaults. Flags override these values:

```js
// seed.config.js
module.exports = {
  docsPerModel: 25,
  includeModels: ["User", "Post"],
  dropBeforeSeed: false,
  useTransactions: false,
};
```

## Library usage

```ts
import mongoose from "mongoose";
import { seedDatabase } from "@alieutech/seedsmith";

await mongoose.connect("mongodb://localhost:27017/mydb");
await seedDatabase(mongoose, {
  // modelsPath: "./models", // optional: if omitted, uses already-registered models
  docsPerModel: 20,
  includeModels: ["User", "Post"],
  dropBeforeSeed: false,
  useTransactions: false,
});
await mongoose.disconnect();
```

Note: SeedSmith inspects models that are registered with the Mongoose instance you pass in. If your models live in files (for example `./models/user.js`), require/import them before calling `seedDatabase`, or pass `modelsPath` to automatically load them. Example:

```ts
// require the model files so they register with mongoose
require("./models/user");
require("./models/post");

// then call seedDatabase
await seedDatabase(mongoose, { docsPerModel: 10 });
```

## Using with Prisma

`seedPrisma` reads your models, enums and relations from Prisma itself, so no Mongoose models are needed:

```ts
import { PrismaClient, Prisma } from "@prisma/client";
import { seedPrisma } from "@alieutech/seedsmith";

const prisma = new PrismaClient();

const summary = await seedPrisma(prisma, {
  datamodel: Prisma.dmmf.datamodel, // optional: read from the client if omitted
  docsPerModel: 10, // or { User: 50, Post: 100 }
  includeModels: ["User", "Post"], // Prisma model names
  dropBeforeSeed: true, // deleteMany on the seeded models, dependents first
  useTransactions: false, // wrap the run in prisma.$transaction
  seed: 12345,
});

console.log(summary.inserted); // { User: 10, Post: 10 }
await prisma.$disconnect();
```

How it handles your schema:

- Fields with `@default(...)`, `@updatedAt` or generated values are left for Prisma and the database to fill.
- Foreign keys point at real rows. Related models are seeded first; if a required relation has no row to point at, one is created (and counted in the summary).
- One-to-one relations get a different target row each time.
- Optional relations are left empty when there is nothing to point at, including self relations on the first rows.
- Implicit many-to-many relations (lists on both sides, no foreign key) are not linked.
- If a model's unique constraints cannot be satisfied after a few attempts, seeding of that model stops with a warning.

Verified against Prisma 6 with SQLite. On PostgreSQL, a unique-constraint collision inside a transaction aborts the transaction, so prefer `useTransactions: false` there.

### Prisma adapter for `seedDatabase` (legacy)

`createPrismaAdapter` routes the writes of `seedDatabase` to Prisma, but still reads schemas from Mongoose models that mirror your Prisma models. Prefer `seedPrisma` above.

```ts
import { createPrismaAdapter, seedDatabase } from "@alieutech/seedsmith";

const adapter = createPrismaAdapter(prisma, {
  models: [{ name: "user" }, { name: "comment", idField: "commentId" }],
});
await seedDatabase(mongoose, { adapter, docsPerModel: 10 });
```

## Advanced Options

```ts
await seedDatabase(mongoose, {
  modelsPath: "./models", // auto-load model files
  docsPerModel: 20, // or { User: 50, Post: 100 }
  includeModels: ["User", "Post"], // filter models
  excludeModels: ["Log"], // exclude models
  dropBeforeSeed: true, // drop collections first
  useTransactions: true, // wrap in transaction
  seed: 12345, // deterministic faker seed
  verbose: true, // detailed logging
});
```

## Dry run

Preview what SeedSmith would create before it touches your database:

```bash
# from the schemas alone, no database needed
seedsmith --dry-run --models ./models --count 5

# with a connection, refs to models outside the run point at their existing documents
seedsmith --dry-run --uri "$MONGO_URI" --models ./models
```

The CLI prints three sample documents per model. Nothing is inserted and `--drop` is ignored.

From code, pass `dryRun: true` to `seedDatabase` or `seedPrisma` and read the result:

```ts
const summary = await seedDatabase(mongoose, { docsPerModel: 5, dryRun: true });
summary.generated; // { User: 5, Post: 5 }
summary.samples.User; // the documents, as they would be stored
summary.inserted; // { User: 0, Post: 0 }
```

- Mongoose documents are validated the way a save would validate them, so a schema the generator cannot satisfy fails in the dry run too. Unique-index collisions are not detected.
- With Prisma, existing rows are still read so relations can point at them. Keys the database would generate (autoincrement ids, uuids) are shown as placeholders.

## Overrides

By default SeedSmith guesses a value from each field's type and name. Use `overrides` to decide specific fields yourself, with a fixed value or a function. It works the same in `seedDatabase`, `seedPrisma` and `seed.config.js`:

```js
// seed.config.js
module.exports = {
  docsPerModel: 25,
  overrides: {
    User: {
      role: "admin", // fixed value
      sku: (faker) => faker.helpers.fromRegExp("[A-Z]{3}-[0-9]{4}"),
      position: (faker, { index }) => index + 1, // 1, 2, 3, ...
      "address.city": "Banjul", // nested path
      // listed last, so it can read the fields above
      handle: (faker, { doc }) => `${doc.role}-${doc.position}`,
    },
    Post: {
      status: "published",
    },
  },
};
```

- Keys are model names, then field paths (field names for Prisma).
- A function receives `faker` and `{ model, index, doc }`, where `index` counts the documents generated for that model in this run and `doc` is the document so far. It may be async.
- Overrides are applied after the generated values, in the order you list them.
- An override wins over schema defaults, and an overridden ref or foreign key is used as given, so nothing is looked up or created for it.
- Returning `undefined` from a function leaves the field unset.
- If a unique field collides, override functions are called again for that document.

## Supported schema features

- Types: String, Number, Boolean, Date, ObjectId, Decimal128, Buffer, UUID, BigInt, Mixed, Map, arrays of any of these, nested subdocuments and arrays of subdocuments. Fields of any other type are left unset with a warning.
- Validators: `enum`, `min`, `max`, `minlength`, `maxlength`. `match` is best-effort: simple patterns such as `/^\d{5}$/` are satisfied; for complex ones the generated value may fail validation.
- Fields with a schema `default` are left for Mongoose to fill.
- Refs: referenced models are seeded first. A ref to a model outside the run links to its existing documents; if it has none, optional refs are left empty and required refs get a placeholder id (with a warning).

## Notes

- SeedSmith throws if `NODE_ENV` is `production`.
- Models must register themselves with Mongoose (e.g., `mongoose.model('User', userSchema)`).
- CLI loads `seed.config.js` if present and merges with flags.

## Security

- Never hardcode credentials in code or docs. Prefer environment variables (e.g., `MONGO_URI`) or a secrets manager.
- Avoid passing credentials directly in shell history. Use `export MONGO_URI=...` or a `.env` file that is not committed.
- Use a least-privilege database user for seeding (only the necessary permissions for inserts/updates).
- If credentials were exposed, rotate them immediately and revoke any leaked tokens.
- Keep seeding to non-production environments; SeedSmith blocks when `NODE_ENV=production`.
