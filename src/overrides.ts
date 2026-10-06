import { faker, type Faker } from "@faker-js/faker";
import { setDeep } from "./mongoose/generateValue";

export interface OverrideContext {
  /** Name of the model being seeded */
  model: string;
  /** Zero-based position of this document among those generated for the model in this run */
  index: number;
  /** The document generated so far, including overrides listed before this one */
  doc: Record<string, any>;
}

export type OverrideFunction = (
  faker: Faker,
  ctx: OverrideContext,
) => unknown | Promise<unknown>;

/** A fixed value, or a function that returns the value. Returning undefined leaves the field unset. */
export type FieldOverride =
  | OverrideFunction
  | string
  | number
  | boolean
  | bigint
  | null
  | object;

/** Per-model field overrides: `{ User: { role: "admin", email: (faker) => faker.internet.email() } }` */
export type SeedOverrides = Record<string, Record<string, FieldOverride>>;

export function validateOverrides(overrides: unknown): SeedOverrides | undefined {
  if (overrides === undefined || overrides === null) return undefined;
  const isRecord = (v: unknown) =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isRecord(overrides)) {
    throw new Error(
      "SeedSmith: `overrides` must be an object keyed by model name.",
    );
  }
  for (const [model, fields] of Object.entries(overrides as object)) {
    if (!isRecord(fields)) {
      throw new Error(
        `SeedSmith: \`overrides.${model}\` must be an object keyed by field name.`,
      );
    }
  }
  return overrides as SeedOverrides;
}

// Override keys that match no field path (a key may name a field, its parent, or a nested path)
export function unknownOverrideKeys(
  fieldPaths: string[],
  modelOverrides: Record<string, FieldOverride>,
): string[] {
  return Object.keys(modelOverrides).filter(
    (key) =>
      !fieldPaths.some(
        (path) =>
          path === key ||
          path.startsWith(`${key}.`) ||
          key.startsWith(`${path}.`),
      ),
  );
}

// True when the field is replaced by an override, so no value needs to be generated for it
export function isOverridden(
  path: string,
  modelOverrides?: Record<string, FieldOverride>,
): boolean {
  if (!modelOverrides) return false;
  return Object.keys(modelOverrides).some(
    (key) => key === path || path.startsWith(`${key}.`),
  );
}

export async function applyOverrides(
  doc: Record<string, any>,
  modelOverrides: Record<string, FieldOverride> | undefined,
  ctx: { model: string; index: number },
): Promise<void> {
  if (!modelOverrides) return;
  for (const [path, override] of Object.entries(modelOverrides)) {
    let value: unknown;
    try {
      value =
        typeof override === "function"
          ? await (override as OverrideFunction)(faker, { ...ctx, doc })
          : override;
    } catch (e: any) {
      throw new Error(
        `Override for '${ctx.model}.${path}' failed. ${e?.message || e}`,
      );
    }
    if (value !== undefined) setDeep(doc, path, value);
  }
}
