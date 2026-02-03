import type { SeedAdapter, SeedAdapterModel, SeedSession } from "./types";

/**
 * Type for Prisma Client instance.
 * We use a loose type to avoid requiring @prisma/client as a dependency.
 */
export interface PrismaClientLike {
  $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
  [modelName: string]: any;
}

/**
 * Configuration for a Prisma model to enable seeding.
 */
export interface PrismaModelConfig {
  /** The Prisma model name (e.g., "user", "post") - must match Prisma delegate name (lowercase) */
  name: string;
  /** The primary key field name (default: "id") */
  idField?: string;
}

/**
 * Wraps a Prisma interactive transaction as a SeedSession.
 * Note: Prisma transactions work differently - they're callback-based.
 * This session collects operations to run in a single transaction.
 */
class PrismaSession implements SeedSession {
  private operations: Array<(tx: any) => Promise<void>> = [];
  private committed = false;
  private aborted = false;

  constructor(private prisma: PrismaClientLike) {}

  addOperation(op: (tx: any) => Promise<void>): void {
    this.operations.push(op);
  }

  async commit(): Promise<void> {
    if (this.aborted) throw new Error("Session was aborted");
    if (this.committed) return;

    await this.prisma.$transaction(async (tx) => {
      for (const op of this.operations) {
        await op(tx);
      }
    });
    this.committed = true;
  }

  async abort(): Promise<void> {
    this.aborted = true;
    this.operations = [];
  }

  async end(): Promise<void> {
    this.operations = [];
  }

  /** Check if this session is pending (not yet committed/aborted) */
  get isPending(): boolean {
    return !this.committed && !this.aborted;
  }
}

/**
 * Wraps a Prisma model delegate as a SeedAdapterModel.
 */
class PrismaAdapterModel<ID = string | number> implements SeedAdapterModel<ID> {
  readonly name: string;
  private idField: string;

  constructor(
    private prisma: PrismaClientLike,
    private modelName: string,
    idField: string = "id",
  ) {
    this.name = modelName;
    this.idField = idField;
  }

  private get delegate(): any {
    const delegate = this.prisma[this.modelName];
    if (!delegate) {
      throw new Error(
        `Prisma model '${this.modelName}' not found. Make sure the model name matches your Prisma schema (usually lowercase).`,
      );
    }
    return delegate;
  }

  async estimatedCount(): Promise<number> {
    return this.delegate.count();
  }

  async randomId(): Promise<ID | null> {
    const count = await this.estimatedCount();
    if (count === 0) return null;

    const skip = Math.floor(Math.random() * count);
    const record = await this.delegate.findFirst({
      skip,
      select: { [this.idField]: true },
    });
    return record?.[this.idField] ?? null;
  }

  async insertMany(
    docs: Record<string, any>[],
    session?: SeedSession | null,
  ): Promise<number> {
    const doInsert = async (client: any) => {
      try {
        // Prisma's createMany doesn't return created records, just count
        // Note: createMany has limitations (no nested creates, not all DBs support it)
        const result = await client[this.modelName].createMany({
          data: docs,
          skipDuplicates: true,
        });
        return result.count;
      } catch {
        // Fallback to individual creates if createMany fails (e.g., SQLite)
        let count = 0;
        for (const doc of docs) {
          try {
            await client[this.modelName].create({ data: doc });
            count++;
          } catch {
            // Skip failed inserts (e.g., unique constraint violations)
          }
        }
        return count;
      }
    };

    if (session && session instanceof PrismaSession && session.isPending) {
      // Queue for transaction - actual count determined at commit time
      session.addOperation(async (tx) => {
        await doInsert(tx);
      });
      return docs.length; // Return expected count
    }

    return doInsert(this.prisma);
  }

  async insertOne(
    doc: Record<string, any>,
    session?: SeedSession | null,
  ): Promise<ID> {
    const doInsert = async (client: any): Promise<ID> => {
      const created = await client[this.modelName].create({
        data: doc,
        select: { [this.idField]: true },
      });
      return created[this.idField];
    };

    if (session && session instanceof PrismaSession && session.isPending) {
      // For transactions, we execute outside to get ID immediately
      // This is a limitation of Prisma's transaction model
      return doInsert(this.prisma);
    }

    return doInsert(this.prisma);
  }

  async drop(): Promise<void> {
    // Prisma doesn't have a direct "drop" - use deleteMany
    // For a true drop, you'd need raw SQL: prisma.$executeRaw`TRUNCATE TABLE ...`
    await this.delegate.deleteMany({});
  }
}

/**
 * Prisma adapter configuration options.
 */
export interface PrismaAdapterOptions {
  /**
   * List of model configurations.
   * Each model must be registered for the adapter to seed it.
   */
  models?: PrismaModelConfig[];
  /** Default ID field name for all models (default: "id") */
  defaultIdField?: string;
}

/**
 * Creates a SeedAdapter from a Prisma Client instance.
 *
 * @example
 * ```ts
 * import { PrismaClient } from '@prisma/client';
 * import { createPrismaAdapter } from '@alieutech/seedsmith';
 *
 * const prisma = new PrismaClient();
 * const adapter = createPrismaAdapter(prisma, {
 *   models: [
 *     { name: 'user' },
 *     { name: 'post' },
 *   ]
 * });
 *
 * // Use with seedWithAdapter or pass to seedDatabase
 * ```
 */
export class PrismaAdapter<ID = string | number> implements SeedAdapter<ID> {
  private modelConfigs: Map<string, PrismaModelConfig> = new Map();
  private modelCache: Map<string, PrismaAdapterModel<ID>> = new Map();
  private defaultIdField: string;

  constructor(
    private prisma: PrismaClientLike,
    options: PrismaAdapterOptions = {},
  ) {
    this.defaultIdField = options.defaultIdField ?? "id";

    if (options.models) {
      for (const config of options.models) {
        this.registerModel(config);
      }
    }
  }

  /**
   * Register a model for seeding.
   * @param config - Model configuration
   * @returns this (for chaining)
   */
  registerModel(config: PrismaModelConfig): this {
    this.modelConfigs.set(config.name, config);
    return this;
  }

  listModels(): string[] {
    return Array.from(this.modelConfigs.keys());
  }

  getModel(name: string): SeedAdapterModel<ID> {
    let cached = this.modelCache.get(name);
    if (!cached) {
      const config = this.modelConfigs.get(name);
      if (!config) {
        throw new Error(
          `Model '${name}' not registered with PrismaAdapter. ` +
            `Call adapter.registerModel({ name: '${name}' }) first, or include it in the models option.`,
        );
      }
      cached = new PrismaAdapterModel<ID>(
        this.prisma,
        config.name,
        config.idField ?? this.defaultIdField,
      );
      this.modelCache.set(name, cached);
    }
    return cached;
  }

  async startSession(): Promise<SeedSession> {
    return new PrismaSession(this.prisma);
  }
}

/**
 * Factory function to create a Prisma adapter.
 *
 * @param prisma - Prisma Client instance
 * @param options - Adapter configuration
 */
export function createPrismaAdapter<ID = string | number>(
  prisma: PrismaClientLike,
  options: PrismaAdapterOptions = {},
): PrismaAdapter<ID> {
  return new PrismaAdapter<ID>(prisma, options);
}
