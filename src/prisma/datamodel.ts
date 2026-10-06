import type { FieldDescriptor } from "../mongoose/extractSchema";

/** A field as described by Prisma's DMMF (`Prisma.dmmf.datamodel`). */
export interface PrismaField {
  name: string;
  kind: string; // scalar | object | enum | unsupported
  type: string;
  isList?: boolean;
  isRequired?: boolean;
  isUnique?: boolean;
  isId?: boolean;
  hasDefaultValue?: boolean;
  isGenerated?: boolean;
  isUpdatedAt?: boolean;
  relationFromFields?: readonly string[];
  relationToFields?: readonly string[];
  nativeType?: readonly [string, readonly any[]] | null;
}

export interface PrismaModel {
  name: string;
  fields: readonly PrismaField[];
  primaryKey?: { fields: readonly string[] } | null;
  uniqueFields?: readonly (readonly string[])[];
}

interface PrismaEnum {
  name?: string;
  values: readonly { name: string }[];
}

/**
 * Accepts `Prisma.dmmf.datamodel` (arrays) as well as the client's runtime
 * data model (records keyed by name).
 */
export interface PrismaDatamodel {
  models: readonly PrismaModel[] | Record<string, Omit<PrismaModel, "name">>;
  enums?: readonly PrismaEnum[] | Record<string, PrismaEnum>;
}

export interface PrismaRelation {
  target: string;
  from: string[]; // foreign key fields on this model
  to: string[]; // referenced fields on the target model
  required: boolean;
  unique: boolean; // one-to-one: each target row can be used once
}

export interface PrismaModelPlan {
  name: string;
  delegate: string; // property name on the Prisma client
  fieldNames: string[]; // every field in the model, generated or not
  // Id and unique fields the database fills in (autoincrement, uuid, ...)
  databaseKeys: { name: string; type: string }[];
  fields: FieldDescriptor[]; // fields SeedSmith generates values for
  relations: PrismaRelation[];
}

function normalize(datamodel: PrismaDatamodel) {
  const models: PrismaModel[] = Array.isArray(datamodel.models)
    ? [...datamodel.models]
    : Object.entries(datamodel.models).map(([name, model]) => ({
        ...model,
        name,
      }));

  const enums: Record<string, string[]> = {};
  const rawEnums = datamodel.enums ?? [];
  const enumEntries: [string | undefined, PrismaEnum][] = Array.isArray(rawEnums)
    ? rawEnums.map((e: PrismaEnum) => [e.name, e])
    : Object.entries(rawEnums);
  for (const [name, def] of enumEntries) {
    if (name) enums[name] = def.values.map((v) => v.name);
  }

  return { models, enums };
}

const SCALAR_INSTANCES: Record<string, string> = {
  String: "String",
  Int: "Int32",
  BigInt: "BigInt",
  Float: "Number",
  Decimal: "Number",
  Boolean: "Boolean",
  DateTime: "Date",
  Json: "Mixed",
  Bytes: "Buffer",
};

function describeField(
  field: PrismaField,
  enums: Record<string, string[]>,
): FieldDescriptor | undefined {
  let instance: string | undefined;
  let enumValues: string[] | undefined;

  if (field.kind === "enum") {
    instance = "String";
    enumValues = enums[field.type];
    if (!enumValues || !enumValues.length) return undefined;
  } else if (field.kind === "scalar") {
    instance = SCALAR_INSTANCES[field.type];
    const nativeType = field.nativeType?.[0];
    if (nativeType === "ObjectId") instance = "ObjectIdString";
    else if (nativeType === "Uuid") instance = "UUID";
    // Ids without a database default have to be unique on their own
    else if (field.isId && field.type === "String") instance = "UUID";
    else if (field.isId && instance) instance = "UniqueInt";
  }
  if (!instance) return undefined;

  const item: FieldDescriptor = { path: field.name, instance, enumValues };
  if (!field.isList) {
    return { ...item, required: Boolean(field.isRequired) };
  }
  return {
    path: field.name,
    instance: "Array",
    isArray: true,
    required: false,
    item,
  };
}

function sameFields(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((f) => b.includes(f));
}

export function planModels(
  datamodel: PrismaDatamodel,
  warn: (message: string) => void,
): PrismaModelPlan[] {
  const { models, enums } = normalize(datamodel);

  return models.map((model) => {
    const byName = new Map(model.fields.map((f) => [f.name, f]));

    const relations: PrismaRelation[] = [];
    const foreignKeys = new Set<string>();
    for (const field of model.fields) {
      const from = field.relationFromFields ?? [];
      if (field.kind !== "object" || !from.length) continue;
      from.forEach((f) => foreignKeys.add(f));
      const single = from.length === 1 ? byName.get(from[0]) : undefined;
      relations.push({
        target: field.type,
        from: [...from],
        to: [...(field.relationToFields ?? [])],
        required: from.every((f) => byName.get(f)?.isRequired),
        unique:
          Boolean(single?.isUnique || single?.isId) ||
          sameFields(model.primaryKey?.fields ?? [], from) ||
          (model.uniqueFields ?? []).some((u) => sameFields(u, from)),
      });
    }

    const fields: FieldDescriptor[] = [];
    for (const field of model.fields) {
      // Relation objects are set through their foreign keys
      if (field.kind === "object" || foreignKeys.has(field.name)) continue;
      // The database or Prisma fills these in
      if (field.hasDefaultValue || field.isUpdatedAt || field.isGenerated) {
        continue;
      }
      const desc = describeField(field, enums);
      if (desc) {
        fields.push(desc);
      } else if (field.isRequired) {
        warn(
          `Unsupported type '${field.type}' at '${model.name}.${field.name}'. Leaving it unset.`,
        );
      }
    }

    return {
      name: model.name,
      delegate: model.name.charAt(0).toLowerCase() + model.name.slice(1),
      fieldNames: model.fields.map((f) => f.name),
      databaseKeys: model.fields
        .filter(
          (f) =>
            f.kind === "scalar" &&
            f.hasDefaultValue &&
            (f.isId || f.isUnique) &&
            !foreignKeys.has(f.name),
        )
        .map((f) => ({ name: f.name, type: f.type })),
      fields,
      relations,
    };
  });
}

// Order models so that relation targets are seeded before the models that point at them
export function orderPlans(plans: PrismaModelPlan[]): PrismaModelPlan[] {
  const byName = new Map(plans.map((p) => [p.name, p]));
  const ordered: PrismaModelPlan[] = [];
  const seen = new Set<string>();
  const visit = (plan: PrismaModelPlan) => {
    if (seen.has(plan.name)) return;
    seen.add(plan.name);
    for (const rel of plan.relations) {
      const target = byName.get(rel.target);
      if (target) visit(target);
    }
    ordered.push(plan);
  };
  plans.forEach(visit);
  return ordered;
}
