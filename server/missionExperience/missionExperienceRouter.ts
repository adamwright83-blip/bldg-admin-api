import { z } from "zod";
import { weekStartMonday } from "../../shared/weeklyMissionReadiness";
import { dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { dayDirectorActorId } from "../dayDirector/dayDirectorActor";
import { loadDailyCommand } from "../claire/dailyCommandContract";
import { applyWeeklyIntentToCommand } from "../claire/weeklyMission/dailyCommandIntent";
import { latestWeeklyIntent } from "../claire/weeklyMission/intentStore";
import { getLatestPlan } from "../missionDirector/missionDirectorService";
import { createDrizzleMissionExperienceStore } from "./drizzleMissionExperienceStore";
import { readAuthoritativeSelection } from "./readAuthoritativeSelection";
import { openMissionExperience, resolveMissionExperience } from "./resolveMissionExperience";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const entrance = z.enum(["DAY_LINE", "OVERWORLD"]);

/**
 * Reads today's already-selected work and opens the same experience instance.
 * Does not compute a Mission Director plan and does not write a locked week.
 */
export const missionExperienceRouter = router({
  current: dayforgeTenantMemberProcedure
    .input(z.object({ businessDate: date }))
    .query(async ({ ctx, input }) => {
      try {
        const store = await createDrizzleMissionExperienceStore();
        if (!store) return { instance: null, replacement: null, reason: "NO_PERSISTENCE" as const };
        const operatorId = dayDirectorActorId(ctx);
        const loaded = await loadDailyCommand({
          tenantId: ctx.tenantId,
          actorId: operatorId,
          dayDirectorActorId: operatorId,
          operatorUserId: operatorId,
          businessDate: input.businessDate,
        });
        const intent = await latestWeeklyIntent({
          tenantId: ctx.tenantId,
          operatorId,
          weekStart: weekStartMonday(input.businessDate),
        });
        const pictured = applyWeeklyIntentToCommand(loaded, intent?.days ?? null);
        const plan = await getLatestPlan({
          tenantId: ctx.tenantId,
          operatorId,
          businessDate: input.businessDate,
        });
        const selection = readAuthoritativeSelection({
          businessDate: input.businessDate,
          intentDay: intent?.days.find(day => day.businessDate === input.businessDate) ?? null,
          commandPrimary: pictured.primary
            ? { id: pictured.primary.id, title: pictured.primary.title }
            : null,
          weeklyIntentOverride: pictured.weeklyIntentOverride
            ? { commandPrimaryId: pictured.weeklyIntentOverride.commandPrimaryId }
            : null,
          plan: plan ? { id: plan.id, outcome: plan.outcome } : null,
        });
        if (!selection.original) {
          return { instance: null, replacement: null, reason: "NO_AUTHORITATIVE_IDENTITY" as const };
        }
        const resolved = await resolveMissionExperience({
          tenantId: ctx.tenantId,
          operatorId,
          businessDate: input.businessDate,
          selectedWorkRef: selection.original,
          unreadiness: selection.unreadiness,
          store,
        });
        if (!resolved.ok) return { instance: null, replacement: null, reason: resolved.reason };
        return { instance: resolved.instance, replacement: resolved.replacement, reason: null };
      } catch {
        return { instance: null, replacement: null, reason: "UNAVAILABLE" as const };
      }
    }),
  open: dayforgeTenantMemberProcedure
    .input(z.object({ instanceId: z.string().min(1).max(64), entrance }))
    .mutation(async ({ input }) => {
      const store = await createDrizzleMissionExperienceStore();
      if (!store) return { instance: null };
      const instance = await openMissionExperience({
        instanceId: input.instanceId,
        entrance: input.entrance,
        store,
      });
      return { instance };
    }),
});
