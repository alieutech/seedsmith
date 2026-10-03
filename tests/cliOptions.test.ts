import { resolveCliOptions } from "../src/cliOptions";

describe("resolveCliOptions", () => {
  const fileConfig = {
    docsPerModel: 3,
    dropBeforeSeed: true,
    useTransactions: true,
    verbose: true,
    seed: 9,
    includeModels: ["User"],
  };

  it("keeps config file values when flags are absent", () => {
    const { uri, seedOptions } = resolveCliOptions(
      ["--uri", "mongodb://localhost/db"],
      fileConfig,
    );
    expect(uri).toBe("mongodb://localhost/db");
    expect(seedOptions).toMatchObject(fileConfig);
  });

  it("lets flags override the config file", () => {
    const { seedOptions } = resolveCliOptions(
      ["-u", "x", "-c", "7", "--seed", "42", "-i", "Post, Tag", "-e", "Log"],
      fileConfig,
    );
    expect(seedOptions.docsPerModel).toBe(7);
    expect(seedOptions.seed).toBe(42);
    expect(seedOptions.includeModels).toEqual(["Post", "Tag"]);
    expect(seedOptions.excludeModels).toEqual(["Log"]);
  });

  it("turns booleans on from flags when the config file has none", () => {
    const { seedOptions } = resolveCliOptions([
      "--drop",
      "--transactions",
      "--verbose",
    ]);
    expect(seedOptions.dropBeforeSeed).toBe(true);
    expect(seedOptions.useTransactions).toBe(true);
    expect(seedOptions.verbose).toBe(true);
  });

  it("leaves booleans unset without flags or config", () => {
    const { seedOptions, uri, help } = resolveCliOptions([]);
    expect(uri).toBeUndefined();
    expect(help).toBe(false);
    expect(seedOptions.dropBeforeSeed).toBeFalsy();
    expect(seedOptions.useTransactions).toBeFalsy();
  });

  it("rejects a non-integer or negative count and a non-integer seed", () => {
    expect(() => resolveCliOptions(["--count", "abc"])).toThrow(/--count/);
    expect(() => resolveCliOptions(["--count", "2.5"])).toThrow(/--count/);
    expect(() => resolveCliOptions(["--count", "-1"])).toThrow(/--count/);
    expect(() => resolveCliOptions(["--seed", "x"])).toThrow(/--seed/);
  });

  it("detects --help", () => {
    expect(resolveCliOptions(["-h"]).help).toBe(true);
  });
});
