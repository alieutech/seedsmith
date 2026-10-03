import type { Model } from "mongoose";

export interface FieldDescriptor {
  path: string;
  instance: string; // e.g., String, Number, Date, Boolean, ObjectId, Array, Embedded, Map
  enumValues?: any[];
  required?: boolean;
  unique?: boolean;
  defaultValue?: any;
  ref?: string; // model name for ObjectId refs (including array item refs)
  isArray?: boolean;
  min?: number | Date;
  max?: number | Date;
  minLength?: number;
  maxLength?: number;
  match?: RegExp;
  item?: FieldDescriptor; // element type for arrays
  fields?: FieldDescriptor[]; // sub-schema fields for embedded documents
  of?: FieldDescriptor; // value type for maps
}

export interface ModelDescriptor {
  name: string;
  fields: FieldDescriptor[];
}

// Validator options may be given as `value` or `[value, message]`
function unwrap(option: any): any {
  return Array.isArray(option) ? option[0] : option;
}

function normalizeEnum(option: any): any[] | undefined {
  if (!option) return undefined;
  const values = Array.isArray(option)
    ? option
    : Array.isArray(option.values)
      ? option.values
      : typeof option === "object"
        ? Object.values(option)
        : undefined;
  return values && values.length ? values : undefined;
}

function normalizeRef(ref: any): string | undefined {
  if (typeof ref === "string") return ref;
  if (ref && typeof ref.modelName === "string") return ref.modelName;
  return undefined;
}

function toBound(option: any): number | Date | undefined {
  const value = unwrap(option);
  if (typeof value === "number" || value instanceof Date) return value;
  return undefined;
}

function toLength(option: any): number | undefined {
  const value = unwrap(option);
  return typeof value === "number" ? value : undefined;
}

function describeType(path: string, schemaType: any): FieldDescriptor {
  const instance: string = schemaType.instance;
  const options = schemaType.options || {};
  const match = unwrap(options.match);

  const desc: FieldDescriptor = {
    path,
    instance,
    enumValues: normalizeEnum(options.enum),
    required: Boolean(options.required),
    unique: Boolean(options.unique),
    defaultValue: options.default,
    ref: normalizeRef(options.ref),
    isArray: instance === "Array",
    min: toBound(options.min),
    max: toBound(options.max),
    minLength: toLength(options.minlength ?? options.minLength),
    maxLength: toLength(options.maxlength ?? options.maxLength),
    match: match instanceof RegExp ? match : undefined,
  };

  if (instance === "Array") {
    if (schemaType.schema) {
      // Array of subdocuments
      desc.item = {
        path,
        instance: "Embedded",
        fields: extractFields(schemaType.schema),
      };
    } else {
      const inner = schemaType.embeddedSchemaType ?? schemaType.caster;
      if (inner && inner.instance) {
        desc.item = describeType(path, inner);
        desc.item.defaultValue = undefined;
        desc.item.enumValues = desc.item.enumValues ?? desc.enumValues;
        desc.ref = desc.ref ?? desc.item.ref;
      }
    }
  } else if (schemaType.schema) {
    // Single nested subdocument
    desc.fields = extractFields(schemaType.schema);
  } else if (instance === "Map") {
    const valueType = schemaType.$__schemaType ?? schemaType.embeddedSchemaType;
    if (valueType && valueType.instance) {
      desc.of = describeType(path, valueType);
      desc.of.defaultValue = undefined;
    }
  }

  return desc;
}

function extractFields(schema: any): FieldDescriptor[] {
  const versionKey = schema.options?.versionKey;
  const fields: FieldDescriptor[] = [];

  Object.keys(schema.paths).forEach((path) => {
    // Map values ("meta.$*") and nested array items ("grid.$") are described by their parent path
    if (path.includes("$*") || /\.\$(\.|$)/.test(path)) return;
    if (versionKey && path === versionKey) return;
    fields.push(describeType(path, schema.paths[path]));
  });

  return fields;
}

export function extractSchema(model: Model<any>): ModelDescriptor {
  return {
    name: (model as any).modelName,
    fields: extractFields((model as any).schema),
  };
}
