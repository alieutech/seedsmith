/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  roots: ["<rootDir>"],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
    // @faker-js/faker ships ES modules only; compile it to CommonJS for Jest
    "^.+\\.js$": [
      "ts-jest",
      {
        tsconfig: { allowJs: true, module: "commonjs", target: "es2022" },
        diagnostics: false,
      },
    ],
  },
  transformIgnorePatterns: ["/node_modules/(?!@faker-js/faker/)"],
  collectCoverage: false,
  verbose: false,
};
