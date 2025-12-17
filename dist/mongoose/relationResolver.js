"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeRefResolver = makeRefResolver;
function makeRefResolver(ctx) {
    return async (refModel) => {
        const existing = await ctx.fetchRandomId(refModel);
        if (existing)
            return existing;
        return await ctx.createStub(refModel);
    };
}
