import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { seedDatabase } from "../src";
import { resolveCliOptions } from "../src/cliOptions";

jest.setTimeout(60000);

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

describe("dry run", () => {
  let Writer: mongoose.Model<any>;
  let Article: mongoose.Model<any>;

  beforeAll(() => {
    process.env.NODE_ENV = "test";
    // Article is registered first on purpose
    Article = mongoose.model(
      "Article",
      new Schema({
        title: { type: String, required: true },
        status: { type: String, default: "draft" },
        labels: { type: Map, of: String },
        writer: { type: Schema.Types.ObjectId, ref: "Writer", required: true },
        reviewer: { type: Schema.Types.ObjectId, ref: "Outsider" },
      }),
    );
    Writer = mongoose.model(
      "Writer",
      new Schema({ email: { type: String, required: true, unique: true } }),
    );
    mongoose.model("Outsider", new Schema({ name: String }));
  });

  describe("without a database connection", () => {
    it("generates linked, validated documents from the schemas alone", async () => {
      expect(mongoose.connection.readyState).toBe(0);
      const logger = collectingLogger();
      const summary = await seedDatabase(mongoose, {
        includeModels: ["Article", "Writer"],
        docsPerModel: 4,
        dropBeforeSeed: true,
        useTransactions: true,
        dryRun: true,
        seed: 9,
        logger,
        overrides: { Article: { title: (_faker, { index }) => `Article ${index}` } },
      });

      expect(summary.dryRun).toBe(true);
      expect(summary.inserted).toEqual({ Writer: 0, Article: 0 });
      expect(summary.generated).toEqual({ Writer: 4, Article: 4 });

      const writers = summary.samples!.Writer;
      const articles = summary.samples!.Article;
      const writerIds = writers.map((w) => String(w._id));
      expect(new Set(writerIds).size).toBe(4);
      articles.forEach((a, i) => {
        expect(a.title).toBe(`Article ${i}`);
        expect(a.status).toBe("draft"); // schema default applied, as on save
        expect(writerIds).toContain(String(a.writer));
        expect(a.reviewer).toBeUndefined(); // target outside the run, not looked up
        expect(a.labels).not.toBeInstanceOf(Map);
      });
      expect(logger.warnings.join(" ")).toMatch(/Ref target 'Outsider'/);
    });

    it("reports a document that would fail validation", async () => {
      mongoose.model(
        "Picky",
        new Schema({ value: { type: String, validate: () => false } }),
      );
      await expect(
        seedDatabase(mongoose, {
          includeModels: ["Picky"],
          docsPerModel: 1,
          dryRun: true,
          logger: collectingLogger(),
        }),
      ).rejects.toThrow(/'Picky' would fail validation/);
    });
  });

  describe("with a database connection", () => {
    let mongod: MongoMemoryServer;

    beforeAll(async () => {
      mongod = await MongoMemoryServer.create();
      await mongoose.connect(mongod.getUri("dry_db"));
    });

    afterAll(async () => {
      await mongoose.disconnect();
      await mongod.stop();
    });

    it("writes nothing, keeps existing data, and links to existing documents", async () => {
      const existing = await mongoose.model("Outsider").create({ name: "kept" });
      await Writer.create({ email: "kept@example.com" });

      const summary = await seedDatabase(mongoose, {
        includeModels: ["Writer", "Article"],
        docsPerModel: 3,
        dropBeforeSeed: true,
        dryRun: true,
        logger: collectingLogger(),
      });

      expect(summary.generated).toEqual({ Writer: 3, Article: 3 });
      // nothing dropped, nothing inserted
      expect(await Writer.countDocuments()).toBe(1);
      expect(await Article.countDocuments()).toBe(0);
      summary.samples!.Article.forEach((a) =>
        expect(String(a.reviewer)).toBe(String(existing._id)),
      );
    });
  });

  it("is switched on by --dry-run or the config file", () => {
    expect(resolveCliOptions(["--dry-run"]).seedOptions.dryRun).toBe(true);
    expect(resolveCliOptions([], { dryRun: true }).seedOptions.dryRun).toBe(true);
    expect(resolveCliOptions(["--uri", "x"]).seedOptions.dryRun).toBeFalsy();
  });
});
