# SeedSmith

A Node.js + TypeScript CLI and library that auto-generates MongoDB seed data from Mongoose schemas.

## Features

- Uses `@faker-js/faker` to generate realistic values
- Inspects Mongoose schemas automatically
- Handles refs by linking to existing docs or creating stubs
- Prevents seeding when `NODE_ENV=production`

## Install

```bash
npm install
```

## Build

```bash
npm run build
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
