export { seedDatabase } from "./seed";
export type { SeedOptions, SeedSummary } from "./seed";

// Adapter types for custom ORM implementations
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

// Prisma adapter
export {
  createPrismaAdapter,
  PrismaAdapter,
  type PrismaClientLike,
  type PrismaModelConfig,
  type PrismaAdapterOptions,
} from "./adapters/prismaAdapter";
