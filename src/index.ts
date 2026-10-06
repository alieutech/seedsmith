export { seedDatabase } from "./seed";
export type { SeedOptions, SeedSummary } from "./seed";
export type {
  SeedOverrides,
  FieldOverride,
  OverrideFunction,
  OverrideContext,
} from "./overrides";

export type { SeedConfig } from "./cliOptions";

// Factories: single documents or rows on demand, for tests
export { createFactory, type Factory, type FactoryOptions } from "./factory";
export {
  createPrismaFactory,
  type PrismaFactory,
  type PrismaFactoryOptions,
} from "./prisma/factory";

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
