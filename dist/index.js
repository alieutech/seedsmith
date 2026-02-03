"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaAdapter = exports.createPrismaAdapter = exports.MongooseAdapter = exports.createMongooseAdapter = exports.seedDatabase = void 0;
var seed_1 = require("./seed");
Object.defineProperty(exports, "seedDatabase", { enumerable: true, get: function () { return seed_1.seedDatabase; } });
// Mongoose adapter (default)
var mongooseAdapter_1 = require("./adapters/mongooseAdapter");
Object.defineProperty(exports, "createMongooseAdapter", { enumerable: true, get: function () { return mongooseAdapter_1.createMongooseAdapter; } });
Object.defineProperty(exports, "MongooseAdapter", { enumerable: true, get: function () { return mongooseAdapter_1.MongooseAdapter; } });
// Prisma adapter
var prismaAdapter_1 = require("./adapters/prismaAdapter");
Object.defineProperty(exports, "createPrismaAdapter", { enumerable: true, get: function () { return prismaAdapter_1.createPrismaAdapter; } });
Object.defineProperty(exports, "PrismaAdapter", { enumerable: true, get: function () { return prismaAdapter_1.PrismaAdapter; } });
