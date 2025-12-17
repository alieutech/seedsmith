import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  roots: ["<rootDir>"],
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverage: false,
  verbose: false,
};

export default config;
