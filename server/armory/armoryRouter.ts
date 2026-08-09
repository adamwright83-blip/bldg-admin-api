import { z } from "zod";
import { dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { getArmory } from "./armoryService";

export const armoryRouter = router({
  get: dayforgeTenantMemberProcedure.input(z.object({ accountType: z.string().trim().min(1).max(96).optional() }).default({})).query(({ ctx, input }) => getArmory({ ...input, tenantId: ctx.tenantId, userId: ctx.user.openId })),
});
