import type mongoose from "mongoose";
import {
  PartialInsertError,
  type SeedAdapter,
  type SeedAdapterModel,
  type SeedSession,
} from "./types";

/**
 * Wraps a Mongoose ClientSession as a SeedSession.
 */
class MongooseSession implements SeedSession {
  constructor(private session: mongoose.ClientSession) {}

  async commit(): Promise<void> {
    await this.session.commitTransaction();
  }

  async abort(): Promise<void> {
    await this.session.abortTransaction();
  }

  end(): void {
    this.session.endSession();
  }

  /** Access the underlying Mongoose session for passing to model operations */
  get raw(): mongoose.ClientSession {
    return this.session;
  }
}

/**
 * Wraps a Mongoose Model as a SeedAdapterModel.
 */
class MongooseAdapterModel implements SeedAdapterModel<mongoose.Types.ObjectId> {
  readonly name: string;

  constructor(private model: mongoose.Model<any>) {
    this.name = model.modelName;
  }

  async estimatedCount(): Promise<number> {
    return this.model.estimatedDocumentCount();
  }

  async randomId(): Promise<mongoose.Types.ObjectId | null> {
    const count = await this.estimatedCount();
    if (count === 0) return null;
    // Use Math.random for simplicity; caller can seed faker externally
    const skip = Math.floor(Math.random() * count);
    const doc = await this.model.findOne({}, { _id: 1 }).skip(skip).lean();
    return (doc as any)?._id ?? null;
  }

  async insertMany(
    docs: Record<string, any>[],
    session?: SeedSession | null,
  ): Promise<number> {
    const mongooseSession =
      session && session instanceof MongooseSession ? session.raw : undefined;
    // Insert in order, one at a time: sessions require it, and it lets us report
    // exactly how many documents were written if one of them fails.
    let inserted = 0;
    for (const doc of docs) {
      try {
        await this.model.create([doc], { session: mongooseSession });
      } catch (e: any) {
        throw new PartialInsertError(e?.message || String(e), inserted, e);
      }
      inserted++;
    }
    return inserted;
  }

  async insertOne(
    doc: Record<string, any>,
    session?: SeedSession | null,
  ): Promise<mongoose.Types.ObjectId> {
    const mongooseSession =
      session && session instanceof MongooseSession ? session.raw : undefined;
    const created = await this.model.create([doc], {
      session: mongooseSession,
    });
    const result = Array.isArray(created) ? created[0] : created;
    return result._id as mongoose.Types.ObjectId;
  }

  async drop(): Promise<void> {
    try {
      await this.model.collection.drop();
    } catch (e: any) {
      // Ignore if collection doesn't exist
      if (e?.codeName !== "NamespaceNotFound") throw e;
    }
  }
}

/**
 * Creates a SeedAdapter from a Mongoose connection/instance.
 */
export class MongooseAdapter implements SeedAdapter<mongoose.Types.ObjectId> {
  private modelCache: Map<string, MongooseAdapterModel> = new Map();

  constructor(private mongooseInstance: typeof mongoose) {}

  listModels(): string[] {
    return this.mongooseInstance.modelNames();
  }

  getModel(name: string): SeedAdapterModel<mongoose.Types.ObjectId> {
    let cached = this.modelCache.get(name);
    if (!cached) {
      // Cast: the generic defaults of Model differ between Mongoose 8 and 9
      const model = this.mongooseInstance.model(name) as mongoose.Model<any>;
      cached = new MongooseAdapterModel(model);
      this.modelCache.set(name, cached);
    }
    return cached;
  }

  async startSession(): Promise<SeedSession> {
    const session = await this.mongooseInstance.startSession();
    session.startTransaction();
    return new MongooseSession(session);
  }
}

/**
 * Factory function for convenience.
 */
export function createMongooseAdapter(
  mongooseInstance: typeof mongoose,
): SeedAdapter<mongoose.Types.ObjectId> {
  return new MongooseAdapter(mongooseInstance);
}
