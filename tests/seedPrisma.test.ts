import { createPrismaFactory, seedPrisma, type PrismaDatamodel } from "../src";

const silent = { info() {}, warn() {}, error() {}, debug() {} };

// Shaped like `Prisma.dmmf.datamodel` for:
//   User (1) -- (0..1) Profile, User (1) -- (n) Post, optional self relation User.manager
const datamodel: PrismaDatamodel = {
  enums: [{ name: "Role", values: [{ name: "USER" }, { name: "ADMIN" }] }],
  models: [
    {
      name: "Post",
      fields: [
        { name: "id", kind: "scalar", type: "Int", isId: true, isRequired: true, hasDefaultValue: true },
        { name: "title", kind: "scalar", type: "String", isRequired: true },
        { name: "price", kind: "scalar", type: "Float" },
        { name: "tags", kind: "scalar", type: "String", isList: true, isRequired: true },
        { name: "authorId", kind: "scalar", type: "Int", isRequired: true },
        { name: "author", kind: "object", type: "User", isRequired: true, relationFromFields: ["authorId"], relationToFields: ["id"] },
      ],
    },
    {
      name: "Profile",
      fields: [
        { name: "id", kind: "scalar", type: "String", isId: true, isRequired: true },
        { name: "bio", kind: "scalar", type: "String", isRequired: true },
        { name: "userId", kind: "scalar", type: "Int", isRequired: true, isUnique: true },
        { name: "user", kind: "object", type: "User", isRequired: true, relationFromFields: ["userId"], relationToFields: ["id"] },
      ],
    },
    {
      name: "User",
      fields: [
        { name: "id", kind: "scalar", type: "Int", isId: true, isRequired: true, hasDefaultValue: true },
        { name: "email", kind: "scalar", type: "String", isRequired: true, isUnique: true },
        { name: "role", kind: "enum", type: "Role", isRequired: true },
        { name: "isActive", kind: "scalar", type: "Boolean", isRequired: true },
        { name: "createdAt", kind: "scalar", type: "DateTime", isRequired: true, hasDefaultValue: true },
        { name: "updatedAt", kind: "scalar", type: "DateTime", isRequired: true, isUpdatedAt: true },
        { name: "managerId", kind: "scalar", type: "Int" },
        { name: "manager", kind: "object", type: "User", relationFromFields: ["managerId"], relationToFields: ["id"] },
        { name: "posts", kind: "object", type: "Post", isList: true, relationFromFields: [], relationToFields: [] },
        { name: "profile", kind: "object", type: "Profile", relationFromFields: [], relationToFields: [] },
      ],
    },
  ],
};

// Minimal in-memory stand-in for a Prisma client
function fakeClient(unique: Record<string, string[]>) {
  const tables: Record<string, any[]> = { user: [], post: [], profile: [] };
  const log: string[] = [];
  const client: any = { tables, log };
  for (const name of Object.keys(tables)) {
    client[name] = {
      findMany: async ({ take }: any = {}) => tables[name].slice(0, take),
      deleteMany: async () => {
        log.push(`deleteMany:${name}`);
        tables[name].length = 0;
      },
      create: async ({ data }: any) => {
        for (const field of unique[name] ?? []) {
          if (tables[name].some((row) => row[field] === data[field])) {
            throw Object.assign(new Error("Unique constraint failed"), {
              code: "P2002",
            });
          }
        }
        const row = { id: tables[name].length + 1, ...data };
        tables[name].push(row);
        return row;
      },
    };
  }
  client.$transaction = async (fn: any) => {
    log.push("transaction");
    return fn(client);
  };
  return client;
}

describe("seedPrisma", () => {
  beforeAll(() => {
    process.env.NODE_ENV = "test";
  });

  it("seeds from the Prisma datamodel with valid foreign keys", async () => {
    const prisma = fakeClient({ user: ["email"], profile: ["id", "userId"] });
    const summary = await seedPrisma(prisma, {
      datamodel,
      docsPerModel: 6,
      seed: 11,
      logger: silent,
    });

    expect(summary.inserted).toEqual({ User: 6, Post: 6, Profile: 6 });
    const { user, post, profile } = prisma.tables;
    const userIds = user.map((u: any) => u.id);

    for (const u of user) {
      expect(Object.keys(u).sort()).toEqual(
        expect.arrayContaining(["email", "id", "isActive", "role"]),
      );
      // defaults and @updatedAt are left to Prisma
      expect(u).not.toHaveProperty("createdAt");
      expect(u).not.toHaveProperty("updatedAt");
      expect(["USER", "ADMIN"]).toContain(u.role);
      expect(typeof u.isActive).toBe("boolean");
      if (u.managerId !== undefined) expect(userIds).toContain(u.managerId);
    }
    for (const p of post) {
      expect(userIds).toContain(p.authorId);
      expect(typeof p.title).toBe("string");
      expect(Array.isArray(p.tags)).toBe(true);
      expect(p).not.toHaveProperty("author");
    }
    // one-to-one: every profile gets a different user
    expect(new Set(profile.map((p: any) => p.userId)).size).toBe(6);
    profile.forEach((p: any) => expect(typeof p.id).toBe("string"));
  });

  it("creates the rows a required relation needs when the target is short", async () => {
    const prisma = fakeClient({ user: ["email"], profile: ["id", "userId"] });
    const summary = await seedPrisma(prisma, {
      datamodel,
      docsPerModel: { User: 2, Profile: 4, Post: 0 },
      logger: silent,
    });
    expect(summary.inserted).toEqual({ User: 4, Post: 0, Profile: 4 });
    expect(prisma.tables.user).toHaveLength(4);
    expect(new Set(prisma.tables.profile.map((p: any) => p.userId)).size).toBe(4);
  });

  it("fails clearly when a required target is empty and outside the run", async () => {
    const prisma = fakeClient({});
    await expect(
      seedPrisma(prisma, {
        datamodel,
        includeModels: ["Post"],
        docsPerModel: 1,
        logger: silent,
      }),
    ).rejects.toThrow(/'Post' requires a 'User' row/);
  });

  it("clears dependents first and can run inside a transaction", async () => {
    const prisma = fakeClient({ user: ["email"], profile: ["id", "userId"] });
    await seedPrisma(prisma, {
      datamodel,
      docsPerModel: 2,
      dropBeforeSeed: true,
      useTransactions: true,
      logger: silent,
    });
    expect(prisma.log[0]).toBe("transaction");
    const deletes = prisma.log.filter((l: string) => l.startsWith("deleteMany"));
    expect(deletes.indexOf("deleteMany:user")).toBe(2);
  });

  it("stops with a warning when unique values run out", async () => {
    const warnings: string[] = [];
    const prisma = fakeClient({ user: ["role"] });
    const summary = await seedPrisma(prisma, {
      datamodel,
      includeModels: ["User"],
      docsPerModel: 10,
      seed: 5,
      logger: { ...silent, warn: (m: string) => void warnings.push(m) },
    });
    expect(summary.inserted.User).toBeLessThanOrEqual(2);
    expect(warnings.join(" ")).toMatch(/Stopped seeding 'User'/);
  });

  it("applies overrides, and an overridden foreign key decides the relation", async () => {
    const warnings: string[] = [];
    const prisma = fakeClient({ user: ["email"] });
    await seedPrisma(prisma, {
      datamodel,
      includeModels: ["User"],
      docsPerModel: 3,
      logger: silent,
    });
    const summary = await seedPrisma(prisma, {
      datamodel,
      includeModels: ["User", "Post"],
      docsPerModel: { User: 2, Post: 4 },
      logger: { ...silent, warn: (m: string) => void warnings.push(m) },
      overrides: {
        User: {
          role: "ADMIN",
          email: (_faker, { index }) => `admin${index}@example.com`,
          managerId: 1,
        },
        Post: {
          authorId: 2,
          title: (faker, { index }) => `${index}: ${faker.lorem.word()}`,
          nope: 1,
        },
        Ghost: { a: 1 },
      },
    });

    expect(summary.inserted).toEqual({ User: 2, Post: 4 });
    const added = prisma.tables.user.slice(3);
    expect(added.map((u: any) => u.email)).toEqual([
      "admin0@example.com",
      "admin1@example.com",
    ]);
    added.forEach((u: any) => {
      expect(u.role).toBe("ADMIN");
      expect(u.managerId).toBe(1);
    });
    prisma.tables.post.forEach((p: any, i: number) => {
      expect(p.authorId).toBe(2);
      expect(p.title.startsWith(`${i}: `)).toBe(true);
    });
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Override 'Post\.nope' does not match a field/),
        expect.stringMatching(/Overrides for 'Ghost' ignored/),
      ]),
    );
  });

  it("dry run writes nothing and shows rows with placeholder keys", async () => {
    const prisma = fakeClient({ user: ["email"], profile: ["id", "userId"] });
    await seedPrisma(prisma, {
      datamodel,
      includeModels: ["User"],
      docsPerModel: 2,
      logger: silent,
    });

    const summary = await seedPrisma(prisma, {
      datamodel,
      docsPerModel: 3,
      dryRun: true,
      useTransactions: true,
      logger: silent,
    });

    expect(summary.dryRun).toBe(true);
    expect(summary.inserted).toEqual({ User: 0, Post: 0, Profile: 0 });
    expect(summary.generated).toEqual({ User: 3, Post: 3, Profile: 3 });
    // the database is untouched
    expect(prisma.tables.user).toHaveLength(2);
    expect(prisma.tables.post).toHaveLength(0);
    expect(prisma.log).not.toContain("transaction");

    // generated keys continue after the existing rows
    expect(summary.samples!.User.map((u) => u.id)).toEqual([3, 4, 5]);
    summary.samples!.Post.forEach((p) => {
      expect([1, 2, 3, 4, 5]).toContain(p.authorId);
      expect(typeof p.id).toBe("number");
    });
    expect(new Set(summary.samples!.Profile.map((p) => p.userId)).size).toBe(3);

    // with dropBeforeSeed, the seeded tables count as empty
    const fresh = await seedPrisma(prisma, {
      datamodel,
      includeModels: ["User"],
      docsPerModel: 2,
      dropBeforeSeed: true,
      dryRun: true,
      logger: silent,
    });
    expect(fresh.samples!.User.map((u) => u.id)).toEqual([1, 2]);
    expect(prisma.tables.user).toHaveLength(2);
    expect(prisma.log).not.toContain("deleteMany:user");
  });

  it("explains how to supply the datamodel when it is missing", async () => {
    await expect(seedPrisma(fakeClient({}), {})).rejects.toThrow(
      /Prisma\.dmmf\.datamodel/,
    );
  });
});

describe("createPrismaFactory", () => {
  beforeAll(() => {
    process.env.NODE_ENV = "test";
  });

  const unique = { user: ["email"], profile: ["id", "userId"] };

  it("create inserts the row and the rows its required relations need", async () => {
    const prisma = fakeClient(unique);
    const factory = createPrismaFactory(prisma, { datamodel, logger: silent });

    const post = await factory.create("Post", { title: "Hello" });

    expect(post.title).toBe("Hello");
    expect(typeof post.id).toBe("number");
    expect(prisma.tables.user).toHaveLength(1);
    expect(post.authorId).toBe(prisma.tables.user[0].id);
    expect(prisma.tables.post).toEqual([post]);
  });

  it("uses a foreign key passed as an override instead of creating a row", async () => {
    const prisma = fakeClient(unique);
    const factory = createPrismaFactory(prisma, { datamodel, logger: silent });
    const admin = await factory.create("User", { role: "ADMIN" });

    const post = await factory.create("Post", { authorId: admin.id });

    expect(admin.role).toBe("ADMIN");
    expect(post.authorId).toBe(admin.id);
    expect(prisma.tables.user).toHaveLength(1);
  });

  it("build writes nothing and leaves a relation with no target unset", async () => {
    const prisma = fakeClient(unique);
    const factory = createPrismaFactory(prisma, { datamodel, logger: silent });

    const orphan = await factory.build("Post");
    expect(typeof orphan.title).toBe("string");
    expect(orphan.authorId).toBeUndefined();
    expect(prisma.tables.user).toHaveLength(0);
    expect(prisma.tables.post).toHaveLength(0);

    const user = await factory.create("User");
    const linked = await factory.build("Post");
    expect(linked.authorId).toBe(user.id);
    expect(prisma.tables.post).toHaveLength(0);
  });

  it("does not point at rows that were deleted between calls", async () => {
    const prisma = fakeClient(unique);
    const factory = createPrismaFactory(prisma, { datamodel, logger: silent });
    await factory.create("Post");
    prisma.tables.user.length = 0;
    prisma.tables.post.length = 0;

    const post = await factory.create("Post");

    expect(prisma.tables.user).toHaveLength(1);
    expect(post.authorId).toBe(prisma.tables.user[0].id);
  });

  it("merges factory-level overrides with per-call ones, and counts per model", async () => {
    const warnings: string[] = [];
    const prisma = fakeClient(unique);
    const factory = createPrismaFactory(prisma, {
      datamodel,
      logger: { ...silent, warn: (m: string) => void warnings.push(m) },
      overrides: {
        User: {
          role: "ADMIN",
          email: (_faker, { index }) => `user${index}@example.com`,
        },
      },
    });

    const users = await factory.createMany("User", 3, { role: "USER", nope: 1 });

    expect(users.map((u) => u.email)).toEqual([
      "user0@example.com",
      "user1@example.com",
      "user2@example.com",
    ]);
    users.forEach((u) => expect(u.role).toBe("USER"));
    expect((await factory.build("User")).role).toBe("ADMIN");
    expect(warnings.join(" ")).toMatch(/Override 'User\.nope' does not match/);
  });

  it("rejects unknown models, exhausted unique values and a missing datamodel", async () => {
    const prisma = fakeClient(unique);
    const factory = createPrismaFactory(prisma, { datamodel, logger: silent });

    await expect(factory.create("Ghost")).rejects.toThrow(
      /Model 'Ghost' not found in the Prisma schema/,
    );
    await factory.create("User", { email: "taken@example.com" });
    await expect(
      factory.create("User", { email: "taken@example.com" }),
    ).rejects.toThrow(/Failed to create 'User'.*unique constraints/);
    expect(() => createPrismaFactory(fakeClient({}), {})).toThrow(
      /Prisma\.dmmf\.datamodel/,
    );
  });
});
