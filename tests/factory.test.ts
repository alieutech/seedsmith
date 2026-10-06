import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createFactory } from "../src";

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

describe("createFactory", () => {
  let mongod: MongoMemoryServer;
  let Person: mongoose.Model<any>;
  let Story: mongoose.Model<any>;
  let Remark: mongoose.Model<any>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri("factory_db"));
    process.env.NODE_ENV = "test";

    Person = mongoose.model(
      "Person",
      new Schema({
        email: { type: String, required: true, unique: true },
        name: String,
        role: { type: String, enum: ["user", "admin"], default: "user" },
        manager: { type: Schema.Types.ObjectId, ref: "Person" },
      }),
    );
    Story = mongoose.model(
      "Story",
      new Schema({
        title: { type: String, required: true },
        author: { type: Schema.Types.ObjectId, ref: "Person", required: true },
      }),
    );
    Remark = mongoose.model(
      "Remark",
      new Schema({
        body: String,
        story: { type: Schema.Types.ObjectId, ref: "Story", required: true },
        author: { type: Schema.Types.ObjectId, ref: "Person" },
      }),
    );
    await Person.init();
  });

  beforeEach(async () => {
    await Promise.all([
      Person.deleteMany({}),
      Story.deleteMany({}),
      Remark.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  it("build returns an unsaved document and leaves the database alone", async () => {
    await Person.create({ email: "existing@example.com" });
    const factory = createFactory(mongoose, { logger: collectingLogger() });

    const story = await factory.build("Story", { title: "Draft" });

    expect(story).toBeInstanceOf(Story);
    expect(story.isNew).toBe(true);
    expect(story.title).toBe("Draft");
    // required ref: a placeholder id, not a lookup
    expect(story.author).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(await Person.exists({ _id: story.author })).toBeNull();
    expect(await Story.countDocuments()).toBe(0);
    await expect(story.validate()).resolves.toBeUndefined();
  });

  it("create saves the document and the chain of documents its refs need", async () => {
    const factory = createFactory(mongoose, { logger: collectingLogger() });

    const remark = await factory.create("Remark", { body: "Nice" });

    expect(remark.isNew).toBe(false);
    expect(remark.body).toBe("Nice");
    expect(await Remark.countDocuments()).toBe(1);
    expect(await Story.countDocuments()).toBe(1);
    expect(await Person.countDocuments()).toBe(1);

    const story = await Story.findById(remark.story).lean<any>();
    const person = await Person.findOne().lean<any>();
    expect(String(story.author)).toBe(String(person._id));
    expect(String(remark.author)).toBe(String(person._id));
    // a self reference does not recurse
    expect(person.manager).toBeUndefined();
  });

  it("uses a ref passed as an override instead of creating one", async () => {
    const factory = createFactory(mongoose, { logger: collectingLogger() });
    const admin = await factory.create("Person", { role: "admin" });

    const story = await factory.create("Story", { author: admin._id });

    expect(admin.role).toBe("admin");
    expect(String(story.author)).toBe(String(admin._id));
    expect(await Person.countDocuments()).toBe(1);
  });

  it("merges factory-level overrides with per-call ones, and counts per model", async () => {
    const factory = createFactory(mongoose, {
      logger: collectingLogger(),
      overrides: {
        Person: {
          role: "admin",
          name: (_faker, { index, model }) => `${model} ${index}`,
        },
      },
    });

    const people = await factory.createMany("Person", 3, { role: "user" });
    const built = await factory.build("Person");

    expect(people.map((p) => p.name)).toEqual(["Person 0", "Person 1", "Person 2"]);
    people.forEach((p) => expect(p.role).toBe("user"));
    expect(built.name).toBe("Person 3");
    expect(built.role).toBe("admin");
    expect(await Person.countDocuments()).toBe(3);
  });

  it("regenerates a document when a unique value collides", async () => {
    let calls = 0;
    const factory = createFactory(mongoose, { logger: collectingLogger() });
    const email = () => (++calls <= 2 ? "same@example.com" : `p${calls}@example.com`);

    const first = await factory.create("Person", { email });
    const second = await factory.create("Person", { email });

    expect(first.email).toBe("same@example.com");
    expect(second.email).toBe("p3@example.com");
  });

  it("reports unique values that never succeed", async () => {
    const factory = createFactory(mongoose, { logger: collectingLogger() });
    await factory.create("Person", { email: "taken@example.com" });
    await expect(
      factory.create("Person", { email: "taken@example.com" }),
    ).rejects.toThrow(/Failed to create 'Person'.*duplicate key/s);
  });

  it("warns about override keys that match no field, and rejects bad input", async () => {
    const logger = collectingLogger();
    const factory = createFactory(mongoose, { logger });

    await factory.build("Person", { emial: "typo@example.com" });
    expect(logger.warnings.join(" ")).toMatch(
      /Override 'Person\.emial' does not match a field/,
    );

    await expect(factory.create("Ghost")).rejects.toThrow(
      /Model 'Ghost' is not registered/,
    );
    await expect(factory.createMany("Person", -1)).rejects.toThrow(
      /non-negative integer/,
    );
    expect(() => createFactory(mongoose, { overrides: [] as any })).toThrow(
      /keyed by model name/,
    );
  });
});
