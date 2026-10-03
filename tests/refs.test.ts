import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  seedDatabase,
  createPrismaAdapter,
  PartialInsertError,
  type SeedAdapter,
} from "../src";

jest.setTimeout(120000);

const { Schema } = mongoose;

function collectingLogger() {
  const warnings: string[] = [];
  return {
    warnings,
    info() {},
    warn: (...args: any[]) => void warnings.push(args.join(" ")),
    error() {},
    debug() {},
  };
}

describe("refs, ordering and transactions", () => {
  let replSet: MongoMemoryReplSet;
  let Author: mongoose.Model<any>;
  let Book: mongoose.Model<any>;

  beforeAll(async () => {
    // A replica set is needed for transactions
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri("refs_db"));
    process.env.NODE_ENV = "test";

    // Book is registered first on purpose: Author must still be seeded before it
    Book = mongoose.model(
      "Book",
      new Schema({
        title: String,
        author: { type: Schema.Types.ObjectId, ref: "Author", required: true },
        editor: { type: Schema.Types.ObjectId, ref: "Author" },
        reviewers: [{ type: Schema.Types.ObjectId, ref: "Author" }],
      }),
    );
    Author = mongoose.model(
      "Author",
      new Schema({
        email: { type: String, required: true, unique: true },
        name: String,
      }),
    );
    await Author.init();
    await Book.createCollection();
  });

  beforeEach(async () => {
    await Author.deleteMany({});
    await Book.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  async function expectBooksLinked() {
    const authorIds = (await Author.find().lean()).map((a) => String(a._id));
    const books = await Book.find().lean();
    for (const book of books) {
      expect(authorIds).toContain(String(book.author));
      book.reviewers.forEach((r: any) =>
        expect(authorIds).toContain(String(r)),
      );
    }
    return books;
  }

  it("seeds referenced models first, without creating stubs", async () => {
    const summary = await seedDatabase(mongoose, {
      includeModels: ["Book", "Author"],
      docsPerModel: 6,
      seed: 3,
      logger: collectingLogger(),
    });
    expect(summary.inserted).toEqual({ Author: 6, Book: 6 });
    expect(await Author.countDocuments()).toBe(6);
    const books = await expectBooksLinked();
    expect(new Set(books.map((b) => String(b.author))).size).toBeGreaterThan(1);
  });

  it("links to existing documents of a model outside the run", async () => {
    const existing = await Author.create({ email: "a@example.com" });
    await seedDatabase(mongoose, {
      includeModels: ["Book"],
      docsPerModel: 3,
      logger: collectingLogger(),
    });
    expect(await Author.countDocuments()).toBe(1);
    const books = await Book.find().lean();
    books.forEach((b) => expect(String(b.author)).toBe(String(existing._id)));
  });

  it("warns and leaves optional refs empty when the target is outside the run and empty", async () => {
    const logger = collectingLogger();
    await seedDatabase(mongoose, {
      includeModels: ["Book"],
      docsPerModel: 3,
      logger,
    });
    expect(await Author.countDocuments()).toBe(0);
    expect(logger.warnings.filter((w) => /Ref target 'Author'/.test(w))).toHaveLength(1);
    const books = await Book.find().lean();
    expect(books).toHaveLength(3);
    for (const book of books) {
      expect(book.author).toBeDefined(); // required: placeholder id
      expect(book.editor).toBeUndefined();
      expect(book.reviewers).toEqual([]);
    }
  });

  it("commits a transaction without duplicating referenced documents", async () => {
    const logger = collectingLogger();
    const summary = await seedDatabase(mongoose, {
      includeModels: ["Author", "Book"],
      docsPerModel: 5,
      useTransactions: true,
      logger,
    });
    expect(summary.inserted).toEqual({ Author: 5, Book: 5 });
    expect(logger.warnings).toEqual([]);
    expect(await Author.countDocuments()).toBe(5);
    expect(await Book.countDocuments()).toBe(5);
    await expectBooksLinked();
  });

  it("rolls back the transaction when seeding fails", async () => {
    const Strict = mongoose.model(
      "Strict",
      new Schema({ value: { type: String, validate: () => false } }),
    );
    await Strict.createCollection();
    await expect(
      seedDatabase(mongoose, {
        includeModels: ["Author", "Strict"],
        docsPerModel: 2,
        useTransactions: true,
        logger: collectingLogger(),
      }),
    ).rejects.toThrow(/Seeding failed/);
    expect(await Author.countDocuments()).toBe(0);
    mongoose.deleteModel("Strict");
  });

  it("does not re-insert documents written before a batch failure", async () => {
    const single: Record<string, any>[] = [];
    const adapter: SeedAdapter = {
      listModels: () => ["Author"],
      getModel: (name) => ({
        name,
        estimatedCount: async () => 0,
        randomId: async () => null,
        insertMany: async () => {
          throw new PartialInsertError("duplicate key", 2);
        },
        insertOne: async (doc) => {
          single.push(doc);
          return single.length;
        },
        drop: async () => {},
      }),
    };
    const summary = await seedDatabase(mongoose, {
      adapter,
      includeModels: ["Author"],
      docsPerModel: 5,
      logger: collectingLogger(),
    });
    expect(single).toHaveLength(3);
    expect(summary.inserted).toEqual({ Author: 5 });
  });

  it("maps Mongoose model names onto Prisma delegates and omits __v", async () => {
    const rows: Record<string, any>[] = [];
    const prisma = {
      $transaction: async (fn: any) => fn(prisma),
      author: {
        count: async () => 0,
        deleteMany: async () => {},
        createMany: async ({ data }: any) => {
          rows.push(...data);
          return { count: data.length };
        },
      },
    };
    const adapter = createPrismaAdapter(prisma, { models: [{ name: "author" }] });
    const summary = await seedDatabase(mongoose, {
      adapter,
      includeModels: ["Author"],
      docsPerModel: 2,
      logger: collectingLogger(),
    });
    expect(summary.inserted).toEqual({ Author: 2 });
    expect(rows).toHaveLength(2);
    rows.forEach((row) => expect(Object.keys(row).sort()).toEqual(["email", "name"]));
  });
});
