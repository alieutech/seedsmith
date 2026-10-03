import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { seedDatabase } from "../src";

jest.setTimeout(60000);

const { Schema } = mongoose;
const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe("schema type support", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri("types_db"));
    process.env.NODE_ENV = "test";
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  async function seed(name: string, count = 15) {
    const summary = await seedDatabase(mongoose, {
      includeModels: [name],
      docsPerModel: count,
      seed: 7,
      logger: silent,
    });
    expect(summary.inserted[name]).toBe(count);
    const docs = await mongoose.model(name).find().lean();
    expect(docs).toHaveLength(count);
    return docs as any[];
  }

  it("fills typed arrays with values of the item type", async () => {
    mongoose.model(
      "Arrays",
      new Schema({
        scores: { type: [Number], required: true },
        days: [Date],
        flags: [Boolean],
        grid: [[Number]],
        roles: [{ type: String, enum: ["admin", "editor", "viewer"] }],
      }),
    );
    const docs = await seed("Arrays");
    for (const doc of docs) {
      expect(doc.scores.length).toBeGreaterThan(0);
      doc.scores.forEach((n: any) => expect(typeof n).toBe("number"));
      doc.days.forEach((d: any) => expect(d).toBeInstanceOf(Date));
      doc.flags.forEach((b: any) => expect(typeof b).toBe("boolean"));
      doc.grid.flat().forEach((n: any) => expect(typeof n).toBe("number"));
      doc.roles.forEach((r: any) =>
        expect(["admin", "editor", "viewer"]).toContain(r),
      );
    }
    expect(docs.some((d) => d.days.length > 0)).toBe(true);
  });

  it("fills nested subdocuments, subdocument arrays and plain nested paths", async () => {
    const itemSchema = new Schema({
      sku: { type: String, required: true },
      qty: { type: Number, required: true },
    });
    mongoose.model(
      "Orders",
      new Schema({
        shipping: {
          type: new Schema({ city: { type: String, required: true } }),
          required: true,
        },
        items: { type: [itemSchema], required: true },
        contact: { phone: String, address: { country: String } },
      }),
    );
    const docs = await seed("Orders");
    for (const doc of docs) {
      expect(typeof doc.shipping.city).toBe("string");
      expect(doc.items.length).toBeGreaterThan(0);
      for (const item of doc.items) {
        expect(typeof item.sku).toBe("string");
        expect(typeof item.qty).toBe("number");
      }
      expect(typeof doc.contact.phone).toBe("string");
      expect(typeof doc.contact.address.country).toBe("string");
    }
  });

  it("fills maps", async () => {
    mongoose.model(
      "Maps",
      new Schema({
        labels: { type: Map, of: String },
        counters: { type: Map, of: Number },
      }),
    );
    const docs = await seed("Maps");
    for (const doc of docs) {
      const labels = Object.values(doc.labels);
      expect(labels.length).toBeGreaterThan(0);
      labels.forEach((v) => expect(typeof v).toBe("string"));
      Object.values(doc.counters).forEach((v) =>
        expect(typeof v).toBe("number"),
      );
    }
  });

  it("respects min, max, length and match validators", async () => {
    const from = new Date("2020-01-01");
    const to = new Date("2020-12-31");
    mongoose.model(
      "Limits",
      new Schema({
        level: { type: Number, min: 200, max: 210 },
        age: { type: Number, min: [90, "too young"] },
        ratio: { type: Number, min: 0.2, max: 0.8 },
        code: { type: String, minlength: 120 },
        short: { type: String, maxlength: 5 },
        zip: { type: String, match: /^\d{5}$/ },
        when: { type: Date, min: from, max: to },
      }),
    );
    const docs = await seed("Limits");
    for (const doc of docs) {
      expect(doc.level).toBeGreaterThanOrEqual(200);
      expect(doc.level).toBeLessThanOrEqual(210);
      expect(doc.age).toBeGreaterThanOrEqual(90);
      expect(doc.ratio).toBeGreaterThanOrEqual(0.2);
      expect(doc.ratio).toBeLessThanOrEqual(0.8);
      expect(doc.code.length).toBeGreaterThanOrEqual(120);
      expect(doc.short.length).toBeLessThanOrEqual(5);
      expect(doc.zip).toMatch(/^\d{5}$/);
      expect(doc.when.getTime()).toBeGreaterThanOrEqual(from.getTime());
      expect(doc.when.getTime()).toBeLessThanOrEqual(to.getTime());
    }
  });

  it("lets Mongoose apply schema defaults and the version key", async () => {
    mongoose.model(
      "Defaults",
      new Schema({
        status: { type: String, default: "draft" },
        views: { type: Number, default: 0 },
        title: String,
      }),
    );
    const docs = await seed("Defaults", 5);
    for (const doc of docs) {
      expect(doc.status).toBe("draft");
      expect(doc.views).toBe(0);
      expect(doc.__v).toBe(0);
    }
  });

  it("rejects an invalid docsPerModel", async () => {
    await expect(
      seedDatabase(mongoose, {
        includeModels: ["Defaults"],
        docsPerModel: NaN,
        logger: silent,
      }),
    ).rejects.toThrow(/non-negative integer/);
  });
});
