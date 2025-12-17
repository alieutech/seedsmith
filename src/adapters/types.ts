// Adapter interfaces to enable future support for ORMs like Prisma without breaking the API

export interface SeedSession {
  commit(): Promise<void>;
  abort(): Promise<void>;
  end(): void | Promise<void>;
}

export interface SeedAdapterModel<ID = unknown> {
  name: string;
  estimatedCount(): Promise<number>;
  randomId(): Promise<ID | null>;
  insertMany(
    docs: Record<string, any>[],
    session?: SeedSession | null
  ): Promise<number>;
  insertOne(
    doc: Record<string, any>,
    session?: SeedSession | null
  ): Promise<ID>;
  drop(): Promise<void>;
}

export interface SeedAdapter<ID = unknown> {
  // List of model names available for seeding
  listModels(): string[];
  // Retrieve a model facade by name
  getModel(name: string): SeedAdapterModel<ID>;
  // Start an optional transactional session
  startSession?(): Promise<SeedSession>;
}

// Prisma adapter interface placeholder; implementers should wrap Prisma client models
// so they conform to SeedAdapter and SeedAdapterModel contracts above.
export type PrismaSeedAdapter<ID = unknown> = SeedAdapter<ID>;
