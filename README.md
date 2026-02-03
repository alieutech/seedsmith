# SeedSmith

[![CI](https://github.com/alieutech/seedsmith/actions/workflows/ci.yml/badge.svg)](https://github.com/alieutech/seedsmith/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/@alieutech%2Fseedsmith.svg)](https://www.npmjs.com/package/@alieutech/seedsmith)

A Node.js + TypeScript CLI and library that auto-generates seed data for MongoDB (Mongoose) and Prisma with realistic fake data.

## Features

- 🎭 Uses `@faker-js/faker` to generate realistic values
- 🔍 Inspects Mongoose schemas automatically
- 🔗 Handles refs by linking to existing docs or creating stubs
- 🛡️ Prevents seeding when `NODE_ENV=production`
- 🔌 Pluggable adapter pattern for multiple ORMs
- 📦 Built-in adapters: Mongoose, Prisma
- 🎲 Deterministic seeding via seed option
- 🔄 Transaction support
- 🎯 Smart field-name mapping (email, phone, price, etc.)

## Install

```bash
npm install @alieutech/seedsmith

# or for CLI usage
npm install -g @alieutech/seedsmith
```

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
```

# Include/Exclude models

seedsmith --uri mongodb://localhost:27017/mydb --models ./models --include User,Post --exclude Log

# Drop collections before seeding

seedsmith --uri mongodb://localhost:27017/mydb --models ./models --drop

````

### Optional config file

Create `seed.config.js` in your project root to customize defaults:

```js
// seed.config.js
module.exports = {
  docsPerModel: 25,
  includeModels: ["User", "Post"],
  dropBeforeSeed: false,
  useTransactions: false,
};
````

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

SeedSmith supports Prisma via the adapter pattern:

```ts
import { PrismaClient } from "@prisma/client";
import { createPrismaAdapter } from "@alieutech/seedsmith";

const prisma = new PrismaClient();

const adapter = createPrismaAdapter(prisma, {
  models: [
    { name: "user" }, // model name must match Prisma schema (lowercase)
    { name: "post" },
    { name: "comment", idField: "commentId" }, // custom ID field
  ],
});

// Note: Currently requires Mongoose for schema extraction
// Pure Prisma seeding (without Mongoose) coming soon
await seedDatabase(mongoose, {
  adapter,
  docsPerModel: 10,
});

await prisma.$disconnect();
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
