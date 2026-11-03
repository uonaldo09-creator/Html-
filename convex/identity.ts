import { ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export async function requireActiveUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("UNAUTHENTICATED");

  const user = await ctx.db
    .query("users")
    .withIndex("by_auth_subject", (query) => query.eq("authSubject", identity.subject))
    .unique();
  if (!user) throw new ConvexError("UNAUTHENTICATED");
  if (user.disabled) throw new ConvexError("ACCOUNT_DISABLED");

  const tokenVersion = (identity as unknown as Record<string, unknown>).tv;
  if (typeof tokenVersion !== "number" || tokenVersion !== (user.tokenVersion ?? 0)) {
    throw new ConvexError("TOKEN_REVOKED");
  }

  return user;
}
