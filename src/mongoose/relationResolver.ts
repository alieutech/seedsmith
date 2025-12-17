import mongoose from "mongoose";

export interface ResolveContext {
  models: Record<string, mongoose.Model<any>>;
  fetchRandomId: (modelName: string) => Promise<mongoose.Types.ObjectId | null>;
  createStub: (modelName: string) => Promise<mongoose.Types.ObjectId>;
}

export function makeRefResolver(ctx: ResolveContext) {
  return async (refModel: string): Promise<mongoose.Types.ObjectId> => {
    const existing = await ctx.fetchRandomId(refModel);
    if (existing) return existing;
    return await ctx.createStub(refModel);
  };
}
