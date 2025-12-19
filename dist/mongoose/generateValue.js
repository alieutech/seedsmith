"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateValue = generateValue;
const mongoose_1 = __importDefault(require("mongoose"));
const faker_1 = require("@faker-js/faker");
function lastPathSegment(path) {
    const parts = path.split(".");
    return parts[parts.length - 1].toLowerCase();
}
function generateStringForName(name) {
    switch (name) {
        case "email": {
            const e = faker_1.faker.internet.email();
            const [local, domain] = e.split("@");
            const suffix = faker_1.faker.string.alphanumeric(6).toLowerCase();
            return `${local}+${suffix}@${domain}`;
        }
        case "password":
            return faker_1.faker.internet.password({ length: 12 });
        case "username":
            return faker_1.faker.internet.userName();
        case "name":
        case "fullname":
            return `${faker_1.faker.person.firstName()} ${faker_1.faker.person.lastName()}`;
        case "firstname":
        case "first_name":
            return faker_1.faker.person.firstName();
        case "lastname":
        case "last_name":
            return faker_1.faker.person.lastName();
        case "phone":
        case "phonenumber":
            return faker_1.faker.phone.number();
        case "url":
            return faker_1.faker.internet.url();
        case "avatar":
            return faker_1.faker.image.avatar();
        case "title":
            return faker_1.faker.lorem.sentence({ min: 2, max: 6 });
        case "description":
            return faker_1.faker.lorem.paragraph();
        case "address":
            return faker_1.faker.location.streetAddress();
        case "city":
            return faker_1.faker.location.city();
        case "country":
            return faker_1.faker.location.country();
        default:
            return faker_1.faker.lorem.sentence();
    }
}
function generateNumberForName(name) {
    switch (name) {
        case "price":
        case "amount":
        case "total":
        case "cost":
            return faker_1.faker.number.float({ min: 1, max: 1000, multipleOf: 0.01 });
        case "age":
            return faker_1.faker.number.int({ min: 18, max: 80 });
        case "rating":
            return faker_1.faker.number.float({ min: 0, max: 5, multipleOf: 0.1 });
        default:
            return faker_1.faker.number.int({ min: 0, max: 10000 });
    }
}
async function generateValue(field, resolveRef) {
    const { instance, enumValues, defaultValue, ref, isArray, path } = field;
    if (defaultValue !== undefined) {
        return typeof defaultValue === "function" ? defaultValue() : defaultValue;
    }
    if (enumValues && enumValues.length) {
        const val = faker_1.faker.helpers.arrayElement(enumValues);
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
                return faker_1.faker.datatype.boolean();
            case "Date":
                return faker_1.faker.date.recent();
            case "ObjectID":
            case "ObjectId":
                return ref ? resolveRef(ref) : new mongoose_1.default.Types.ObjectId();
            case "Array":
                // Handled by isArray branch below; default to a primitive element
                return faker_1.faker.lorem.word();
            case "Decimal128":
                return mongoose_1.default.Types.Decimal128.fromString(String(faker_1.faker.number.float({ min: 0, max: 1000, multipleOf: 0.01 })));
            case "Buffer":
                return Buffer.from(faker_1.faker.string.alphanumeric(16));
            case "Mixed":
                return { note: faker_1.faker.lorem.sentence(), tag: faker_1.faker.word.noun() };
            default:
                return faker_1.faker.word.sample();
        }
    };
    if (isArray) {
        const len = faker_1.faker.number.int({ min: 0, max: 3 });
        const arr = [];
        if (ref) {
            for (let i = 0; i < len; i++)
                arr.push(await resolveRef(ref));
            return arr;
        }
        for (let i = 0; i < len; i++)
            arr.push(await genOne());
        return arr;
    }
    return await genOne();
}
