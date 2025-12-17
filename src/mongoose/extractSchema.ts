import type { Model } from "mongoose";

export interface FieldDescriptor {
  path: string;
  instance: string; // e.g., String, Number, Date, Boolean, ObjectID, Array
  enumValues?: any[];
  required?: boolean;
  defaultValue?: any;
  ref?: string; // model name for ObjectId refs (including array item refs)
  isArray?: boolean;
}

export interface ModelDescriptor {
  name: string;
  fields: FieldDescriptor[];
}

export function extractSchema(model: Model<any>): ModelDescriptor {
  const fields: FieldDescriptor[] = [];
  const schema = (model as any).schema;

  Object.keys(schema.paths).forEach((path) => {
    const schemaType: any = schema.paths[path];
    const instance: string = schemaType.instance;
    const options = schemaType.options || {};

    // Detect ref for arrays (via caster)
    const arrayRef = schemaType.caster?.options?.ref;

    const desc: FieldDescriptor = {
      path,
      instance,
      enumValues: options.enum,
      required: Boolean(options.required),
      defaultValue: options.default,
      ref: options.ref ?? arrayRef,
      isArray: instance === "Array",
    };

    fields.push(desc);
  });

  return { name: (model as any).modelName, fields };
}
