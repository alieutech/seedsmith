// Adapter interfaces to enable future support for ORMs like Prisma without breaking the API

export interface SeedSession {
  commit(): Promise<void>;
  abort(): Promise<void>;
  end(): void | Promise<void>;
}

/**
 * Thrown by insertMany when a batch fails part-way, so the caller knows how many
 * documents (counted from the start of the batch) were already written.
 */
export class PartialInsertError extends Error {
  constructor(
    message: string,
    readonly insertedCount: number,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "PartialInsertError";
  }
}

export interface SeedAdapterModel<ID = unknown> {
  name: string;
  estimatedCount(): Promise<number>;
  randomId(): Promise<ID | null>;
  // May throw PartialInsertError if some documents were written before a failure
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
