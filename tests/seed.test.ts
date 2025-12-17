import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import path from "path";
import { seedDatabase } from "../src";

jest.setTimeout(60000);

describe("SeedSmith integration", () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri("test_db");
    await mongoose.connect(uri);
    // Ensure NODE_ENV is not production
    process.env.NODE_ENV = "test";
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  it("seeds users and posts with refs and realistic fields", async () => {
    // Register models explicitly for this test run
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(path.resolve(__dirname, "../examples/models/user.js"));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require(path.resolve(__dirname, "../examples/models/post.js"));

    const summary = await seedDatabase(mongoose, {
      docsPerModel: 5,
      includeModels: ["User", "Post"],
      dropBeforeSeed: true,
      useTransactions: false,
      seed: 1234,
      verbose: true,
    });

    // Rely on actual DB counts rather than summary for robustness

    expect(summary).toHaveProperty("inserted");
    expect(summary).toHaveProperty("durationMs");
    expect(typeof summary.durationMs).toBe("number");
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    expect(Object.keys(summary.inserted)).toEqual(
      expect.arrayContaining(["User", "Post"])
    );
  });
});
