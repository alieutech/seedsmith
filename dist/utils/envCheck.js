"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureNotProduction = ensureNotProduction;
function ensureNotProduction() {
    var _a, _b, _c;
    const env = String((_c = (_b = (_a = globalThis === null || globalThis === void 0 ? void 0 : globalThis.process) === null || _a === void 0 ? void 0 : _a.env) === null || _b === void 0 ? void 0 : _b.NODE_ENV) !== null && _c !== void 0 ? _c : "").toLowerCase();
    if (env === "production" || env === "prod") {
        throw new Error("SeedSmith is disabled in production (NODE_ENV=production).");
    }
}
