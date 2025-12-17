export function ensureNotProduction() {
  const env = String(
    (globalThis as any)?.process?.env?.NODE_ENV ?? ""
  ).toLowerCase();
  if (env === "production" || env === "prod") {
    throw new Error(
      "SeedSmith is disabled in production (NODE_ENV=production)."
    );
  }
}
