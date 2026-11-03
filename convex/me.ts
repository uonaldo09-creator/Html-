import { query } from "./_generated/server";
import { requireActiveUser } from "./identity";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveUser(ctx);
    return {
      legacyId: user.legacyId,
      email: user.email,
      name: user.name ?? null,
      role: user.role,
      emailVerified: user.emailVerified,
    };
  },
});
