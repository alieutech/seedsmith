import type mongoose from "mongoose";
import { faker } from "@faker-js/faker";
import type { FieldDescriptor } from "./extractSchema";

// Resolves to null when the referenced model has no documents and cannot be seeded
export type RefResolver = (
  refModel: string
) => Promise<mongoose.Types.ObjectId | null>;

export interface GenerateOptions {
  /** Leave ref fields unset (used for stubs, to avoid infinite recursion) */
  skipRefs?: boolean;
  warn?: (message: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Loaded on demand so that Prisma-only projects do not need mongoose installed
function mongooseTypes(): typeof mongoose.Types {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("mongoose").Types;
}

function lastPathSegment(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1].toLowerCase();
}

export function setDeep(
  target: Record<string, any>,
  pathStr: string,
  value: any
) {
  const parts = pathStr.split(".");
  let cur: any = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (cur[key] == null || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}

function generateStringForName(name: string): string {
  switch (name) {
    case "email": {
      const e = faker.internet.email();
      const [local, domain] = e.split("@");
      const suffix = faker.string.alphanumeric(6).toLowerCase();
      return `${local}+${suffix}@${domain}`;
    }
    case "password":
      return faker.internet.password({ length: 12 });
    case "username":
      return faker.internet.username();
    case "name":
    case "fullname":
      return `${faker.person.firstName()} ${faker.person.lastName()}`;
    case "firstname":
    case "first_name":
      return faker.person.firstName();
    case "lastname":
    case "last_name":
      return faker.person.lastName();
    case "phone":
    case "phonenumber":
      return faker.phone.number();
    case "url":
      return faker.internet.url();
    case "avatar":
      return faker.image.avatar();
    case "title":
      return faker.lorem.sentence({ min: 2, max: 6 });
    case "description":
      return faker.lorem.paragraph();
    case "address":
      return faker.location.streetAddress();
    case "city":
      return faker.location.city();
    case "country":
      return faker.location.country();
    default:
      return faker.lorem.sentence();
  }
}

// Best-effort: faker only understands simple patterns, so the result is checked by the caller
function generateStringForPattern(pattern: RegExp): string | undefined {
  const source = pattern.source
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\\d/g, "[0-9]")
    .replace(/\\w/g, "[A-Za-z0-9_]")
    .replace(/\\s/g, " ");
  for (let i = 0; i < 5; i++) {
    try {
      const candidate = faker.helpers.fromRegExp(source);
      if (pattern.test(candidate)) return candidate;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function fitLength(value: string, minLength?: number, maxLength?: number) {
  let out = value;
  if (maxLength !== undefined && out.length > maxLength) {
    out = out.slice(0, maxLength);
  }
  if (minLength !== undefined && out.length < minLength) {
    out += faker.string.alpha(minLength - out.length);
  }
  return out;
}

function generateString(field: FieldDescriptor): string {
  const { minLength, maxLength } = field;
  // Drop the global/sticky flags so repeated test() calls are stateless
  const match = field.match
    ? new RegExp(field.match.source, field.match.flags.replace(/[gy]/g, ""))
    : undefined;

  let value = generateStringForName(lastPathSegment(field.path));
  if (match && !match.test(value)) {
    value = generateStringForPattern(match) ?? value;
  }

  const fitted = fitLength(value, minLength, maxLength);
  return match && match.test(value) && !match.test(fitted) ? value : fitted;
}

function generateNumber(field: FieldDescriptor): number {
  let lo = 0;
  let hi = 10000;
  let step: number | undefined;
  switch (lastPathSegment(field.path)) {
    case "price":
    case "amount":
    case "total":
    case "cost":
      [lo, hi, step] = [1, 1000, 0.01];
      break;
    case "age":
      [lo, hi] = [18, 80];
      break;
    case "rating":
      [lo, hi, step] = [0, 5, 0.1];
      break;
  }

  const min = typeof field.min === "number" ? field.min : undefined;
  const max = typeof field.max === "number" ? field.max : undefined;
  if (min !== undefined) lo = min;
  if (max !== undefined) hi = max;
  if (lo > hi) {
    // Only one bound was given and it falls outside the default range
    if (max === undefined) hi = lo + 1000;
    else lo = hi - 1000;
  }

  if (step === undefined && Math.ceil(lo) <= Math.floor(hi)) {
    return faker.number.int({ min: Math.ceil(lo), max: Math.floor(hi) });
  }
  try {
    return faker.number.float({ min: lo, max: hi, multipleOf: step ?? 0.01 });
  } catch {
    // Range is narrower than the step
    return faker.number.float({ min: lo, max: hi });
  }
}

function generateDate(field: FieldDescriptor): Date {
  const min = field.min instanceof Date ? field.min.getTime() : undefined;
  const max = field.max instanceof Date ? field.max.getTime() : undefined;
  if (min === undefined && max === undefined) return faker.date.recent();

  const now = Date.now();
  let to = max ?? Math.max(now, (min as number) + 30 * DAY_MS);
  if (max !== undefined && min === undefined) to = Math.min(now, max);
  const from = Math.max(min ?? to - 30 * DAY_MS, to - 30 * DAY_MS);
  return faker.date.between({ from, to });
}

async function generateOne(
  field: FieldDescriptor,
  resolveRef: RefResolver,
  opts: GenerateOptions
): Promise<any> {
  const { instance, enumValues, ref } = field;

  if (enumValues && enumValues.length) {
    return faker.helpers.arrayElement(enumValues);
  }

  switch (instance) {
    case "String":
      return generateString(field);
    case "Number":
    case "Double":
      return generateNumber(field);
    case "Int32":
      return Math.round(generateNumber(field));
    case "BigInt":
      return BigInt(Math.round(generateNumber(field)));
    case "Boolean":
      return faker.datatype.boolean();
    case "Date":
      return generateDate(field);
    case "ObjectID":
    case "ObjectId": {
      if (!ref) return new (mongooseTypes().ObjectId)();
      const id = await resolveRef(ref);
      // Required refs get a placeholder id so the document still validates
      return id ?? (field.required ? new (mongooseTypes().ObjectId)() : undefined);
    }
    case "Decimal128":
      return mongooseTypes().Decimal128.fromString(
        String(faker.number.float({ min: 0, max: 1000, multipleOf: 0.01 }))
      );
    case "Buffer":
      return Buffer.from(faker.string.alphanumeric(16));
    case "UUID":
      return faker.string.uuid();
    case "Mixed":
      return { note: faker.lorem.sentence(), tag: faker.word.noun() };
    case "Embedded":
      return buildDocument(field.fields ?? [], resolveRef, opts);
    case "Map": {
      const of: FieldDescriptor = field.of ?? {
        path: field.path,
        instance: "String",
      };
      const map: Record<string, any> = {};
      const size = faker.number.int({ min: 1, max: 3 });
      for (let i = 0; i < size; i++) {
        const key = faker.word.noun().replace(/[.$]/g, "");
        const val = await generateValue(of, resolveRef, opts);
        if (key && val !== undefined) map[key] = val;
      }
      return map;
    }
    default:
      opts.warn?.(
        `Unsupported type '${instance}' at '${field.path}'. Leaving it unset.`
      );
      return undefined;
  }
}

/**
 * Generates a value for a field. Returns undefined when the field should be left
 * unset (it has a schema default, or it is a ref that cannot be resolved).
 */
export async function generateValue(
  field: FieldDescriptor,
  resolveRef: RefResolver,
  opts: GenerateOptions = {}
): Promise<any> {
  // Let the ORM apply schema defaults itself
  if (field.defaultValue !== undefined) return undefined;
  if (opts.skipRefs && field.ref) return undefined;

  if (!field.isArray) return generateOne(field, resolveRef, opts);

  const item: FieldDescriptor = field.item ?? {
    path: field.path,
    instance: "String",
  };
  // Mongoose treats an empty array as missing for required fields
  const len = faker.number.int({ min: field.required ? 1 : 0, max: 3 });

  if (item.enumValues && item.enumValues.length) {
    const count = Math.min(Math.max(len, 1), item.enumValues.length);
    return faker.helpers.arrayElements(item.enumValues, count);
  }

  const arr: any[] = [];
  for (let i = 0; i < len; i++) {
    const val = await generateValue(item, resolveRef, opts);
    if (val !== undefined) arr.push(val);
  }
  return arr;
}

export async function buildDocument(
  fields: FieldDescriptor[],
  resolveRef: RefResolver,
  opts: GenerateOptions = {}
): Promise<Record<string, any>> {
  const doc: Record<string, any> = {};
  for (const field of fields) {
    // Skip _id so Mongo/Mongoose can generate a proper ObjectId
    if (field.path === "_id") continue;
    let val: any;
    try {
      val = await generateValue(field, resolveRef, opts);
    } catch (e: any) {
      throw new Error(
        `Failed to generate value for '${field.path}'. ${e?.message || e}`
      );
    }
    if (val !== undefined) setDeep(doc, field.path, val);
  }
  return doc;
}
