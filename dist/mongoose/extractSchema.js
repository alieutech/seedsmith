"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractSchema = extractSchema;
function extractSchema(model) {
    const fields = [];
    const schema = model.schema;
    Object.keys(schema.paths).forEach((path) => {
        var _a, _b, _c;
        const schemaType = schema.paths[path];
        const instance = schemaType.instance;
        const options = schemaType.options || {};
        // Detect ref for arrays (via caster)
        const arrayRef = (_b = (_a = schemaType.caster) === null || _a === void 0 ? void 0 : _a.options) === null || _b === void 0 ? void 0 : _b.ref;
        const desc = {
            path,
            instance,
            enumValues: options.enum,
            required: Boolean(options.required),
            defaultValue: options.default,
            ref: (_c = options.ref) !== null && _c !== void 0 ? _c : arrayRef,
            isArray: instance === "Array",
        };
        fields.push(desc);
    });
    return { name: model.modelName, fields };
}
