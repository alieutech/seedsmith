/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  roots: ["<rootDir>"],
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverage: false,
  verbose: false,
};
