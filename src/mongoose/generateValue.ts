import mongoose from "mongoose";
import { faker } from "@faker-js/faker";
import type { FieldDescriptor } from "./extractSchema";

export type RefResolver = (
  refModel: string
) => Promise<mongoose.Types.ObjectId>;

function lastPathSegment(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1].toLowerCase();
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
      return faker.internet.userName();
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

function generateNumberForName(name: string): number {
  switch (name) {
    case "price":
    case "amount":
    case "total":
    case "cost":
      return faker.number.float({ min: 1, max: 1000, multipleOf: 0.01 });
    case "age":
      return faker.number.int({ min: 18, max: 80 });
    case "rating":
      return faker.number.float({ min: 0, max: 5, multipleOf: 0.1 });
    default:
      return faker.number.int({ min: 0, max: 10000 });
  }
}

export async function generateValue(
  field: FieldDescriptor,
  resolveRef: RefResolver
): Promise<any> {
  const { instance, enumValues, defaultValue, ref, isArray, path } = field;

  if (defaultValue !== undefined) {
    return typeof defaultValue === "function" ? defaultValue() : defaultValue;
  }

  if (enumValues && enumValues.length) {
    const val = faker.helpers.arrayElement(enumValues);
    return isArray ? [val] : val;
  }

  const genOne = async () => {
    switch (instance) {
      case "String": {
        const name = lastPathSegment(path);
        return generateStringForName(name);
      }
      case "Number":
        return generateNumberForName(lastPathSegment(path));
      case "Boolean":
        return faker.datatype.boolean();
      case "Date":
        return faker.date.recent();
      case "ObjectID":
        return ref ? resolveRef(ref) : new mongoose.Types.ObjectId();
      case "Array":
        // For arrays, generation handled outside using isArray branch
        return [faker.lorem.word()];
      case "Decimal128":
        return mongoose.Types.Decimal128.fromString(
          String(faker.number.float({ min: 0, max: 1000, multipleOf: 0.01 }))
        );
      case "Buffer":
        return Buffer.from(faker.string.alphanumeric(16));
      case "Mixed":
        return { note: faker.lorem.sentence(), tag: faker.word.noun() };
      default:
        return faker.word.sample();
    }
  };

  if (isArray) {
    const len = faker.number.int({ min: 0, max: 3 });
    const arr: any[] = [];
    if (ref) {
      for (let i = 0; i < len; i++) arr.push(await resolveRef(ref));
      return arr;
    }
    for (let i = 0; i < len; i++) arr.push(await genOne());
    return arr;
  }

  return await genOne();
}
