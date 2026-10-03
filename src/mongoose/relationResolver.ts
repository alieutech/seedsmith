import type mongoose from "mongoose";

export interface ResolveContext {
  models: Record<string, mongoose.Model<any>>;
  fetchRandomId: (modelName: string) => Promise<mongoose.Types.ObjectId | null>;
  // Returns null when the model is not part of this seeding run
  createStub: (modelName: string) => Promise<mongoose.Types.ObjectId | null>;
}

export function makeRefResolver(ctx: ResolveContext) {
  return async (refModel: string): Promise<mongoose.Types.ObjectId | null> => {
    const existing = await ctx.fetchRandomId(refModel);
    if (existing) return existing;
    return await ctx.createStub(refModel);
  };
}
