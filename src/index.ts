export { seedDatabase } from "./seed";
export type { SeedOptions, SeedSummary } from "./seed";
export type {
  SeedOverrides,
  FieldOverride,
  OverrideFunction,
  OverrideContext,
} from "./overrides";

// Adapter types for custom ORM implementations
export { PartialInsertError } from "./adapters/types";
export type {
  SeedAdapter,
  SeedAdapterModel,
  SeedSession,
} from "./adapters/types";

// Mongoose adapter (default)
export {
  createMongooseAdapter,
  MongooseAdapter,
} from "./adapters/mongooseAdapter";

// Prisma seeding (reads the schema from Prisma, no Mongoose needed)
export { seedPrisma, type PrismaSeedOptions } from "./prisma/seedPrisma";
export type {
  PrismaDatamodel,
  PrismaModel,
  PrismaField,
} from "./prisma/datamodel";

// Prisma adapter for seedDatabase (requires mirrored Mongoose models)
export {
  createPrismaAdapter,
  PrismaAdapter,
  type PrismaClientLike,
  type PrismaModelConfig,
  type PrismaAdapterOptions,
} from "./adapters/prismaAdapter";
