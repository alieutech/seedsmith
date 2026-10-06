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

describe("overrides", () => {
  let mongod: MongoMemoryServer;
  let Member: mongoose.Model<any>;
  let Team: mongoose.Model<any>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri("overrides_db"));
    process.env.NODE_ENV = "test";

    Team = mongoose.model("Team", new Schema({ name: String }));
    Member = mongoose.model(
      "Member",
      new Schema({
        email: { type: String, required: true, unique: true },
        handle: String,
        role: { type: String, enum: ["user", "admin"], default: "user" },
        sku: { type: String, match: /^[A-Z]{3}-\d{4}$/ },
        position: Number,
        nickname: String,
        team: { type: Schema.Types.ObjectId, ref: "Team", required: true },
        contact: { phone: String, city: String },
        shipping: new Schema({ city: String, zip: String }),
      }),
    );
    await Member.init();
  });

  beforeEach(async () => {
    await Member.deleteMany({});
    await Team.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  it("applies fixed values and functions, including over defaults and nested paths", async () => {
    const teamId = new mongoose.Types.ObjectId();
    const logger = collectingLogger();
    const summary = await seedDatabase(mongoose, {
      includeModels: ["Member"],
      docsPerModel: 6,
      seed: 21,
      logger,
      overrides: {
        Member: {
          role: "admin",
          sku: (faker) => faker.helpers.fromRegExp("[A-Z]{3}-[0-9]{4}"),
          position: (_faker, { index }) => index + 1,
          team: teamId,
          "contact.city": "Banjul",
          "shipping.zip": "00000",
          nickname: () => undefined,
          // listed last, so it can read the fields above
          handle: async (_faker, { doc, model }) =>
            `${model}-${doc.position}-${doc.role}`,
        },
      },
    });

    expect(summary.inserted).toEqual({ Member: 6 });
    // The overridden ref is used as-is: no stub team and no missing-target warning
    expect(await Team.countDocuments()).toBe(0);
    expect(logger.warnings).toEqual([]);

    const docs = (await Member.find().sort({ position: 1 }).lean()) as any[];
    expect(docs.map((d) => d.position)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const doc of docs) {
      expect(doc.role).toBe("admin");
      expect(doc.sku).toMatch(/^[A-Z]{3}-\d{4}$/);
      expect(String(doc.team)).toBe(String(teamId));
      expect(doc.contact.city).toBe("Banjul");
      expect(typeof doc.contact.phone).toBe("string"); // sibling still generated
      expect(doc.shipping.zip).toBe("00000");
      expect(typeof doc.shipping.city).toBe("string");
      expect(doc.nickname).toBeUndefined();
      expect(doc.handle).toBe(`Member-${doc.position}-admin`);
      expect(typeof doc.email).toBe("string"); // not overridden
    }
  });

  it("re-runs override functions when a unique value collides", async () => {
    let calls = 0;
    const summary = await seedDatabase(mongoose, {
      includeModels: ["Team", "Member"],
      docsPerModel: { Team: 1, Member: 3 },
      logger: collectingLogger(),
      overrides: {
        Member: {
          // the first two documents ask for the same address
          email: () => (++calls <= 2 ? "same@example.com" : `m${calls}@example.com`),
        },
      },
    });
    expect(summary.inserted.Member).toBe(3);
    const emails = (await Member.find().lean()).map((m: any) => m.email);
    expect(new Set(emails).size).toBe(3);
    expect(emails).toContain("same@example.com");
  });

  it("applies overrides to stub documents created for refs", async () => {
    await seedDatabase(mongoose, {
      includeModels: ["Member", "Team"],
      docsPerModel: { Member: 2, Team: 2 },
      logger: collectingLogger(),
      overrides: { Team: { name: "Core" } },
    });
    const teams = (await Team.find().lean()) as any[];
    expect(teams.length).toBeGreaterThan(0);
    teams.forEach((t) => expect(t.name).toBe("Core"));
  });

  it("warns about overrides that match nothing", async () => {
    const logger = collectingLogger();
    await seedDatabase(mongoose, {
      includeModels: ["Team"],
      docsPerModel: 1,
      logger,
      overrides: { Team: { nmae: "typo" }, Ghost: { a: 1 } },
    });
    expect(logger.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Override 'Team\.nmae' does not match a field/),
        expect.stringMatching(/Overrides for 'Ghost' ignored/),
      ]),
    );
  });

  it("reports which override failed", async () => {
    await expect(
      seedDatabase(mongoose, {
        includeModels: ["Team"],
        docsPerModel: 1,
        logger: collectingLogger(),
        overrides: {
          Team: {
            name: () => {
              throw new Error("boom");
            },
          },
        },
      }),
    ).rejects.toThrow(/Override for 'Team\.name' failed\. boom/);
  });

  it("rejects malformed overrides", async () => {
    await expect(
      seedDatabase(mongoose, { overrides: [] as any }),
    ).rejects.toThrow(/keyed by model name/);
    await expect(
      seedDatabase(mongoose, { overrides: { Team: "x" } as any }),
    ).rejects.toThrow(/overrides\.Team/);
  });

  it("passes overrides from seed.config.js through the CLI options", () => {
    const overrides = { Team: { name: "Core" } };
    const { seedOptions } = resolveCliOptions(["--uri", "x"], { overrides });
    expect(seedOptions.overrides).toBe(overrides);
  });
});
