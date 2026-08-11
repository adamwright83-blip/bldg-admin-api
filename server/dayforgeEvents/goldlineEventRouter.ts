/**
 * Client-facing Goldline gameplay event dispatch.
 *
 * Reuses the existing DayForge event pipeline (`writeDayforgeEvent`) rather
 * than inventing a second event store. The trust boundary documented on that
 * function — "actor, source and correlation values derived by trusted server
 * code, never values accepted directly from an API payload" — is preserved
 * here: the client may only choose a whitelisted event NAME and its coarse,
 * sanitized properties. Actor, tenant, source, and entity identity are always
 * derived from the authenticated request context, never from the payload.
 *
 * `sessionId` is the client's own correlation id (a UUID minted once per
 * Goldline mount and held for the life of that session). `eventId` is a
 * separate UUID the client mints per individual fire and reuses only when
 * retrying that exact event, so a network retry of one jump never
 * double-counts while two real jumps are never merged into one.
 */
import { z } from "zod";
import {
  adminProcedure,
  dayforgeMissionFieldProcedure,
  router,
} from "../_core/trpc";
import {
  GOLDLINE_CLIENT_EVENT_NAMES,
  sanitizeDayforgeProductEventProperties,
} from "@shared/dayforgeEvents";
import { writeDayforgeEvent } from "./dayforgeEventStore";
import { getGoldlineEffectivenessSummary } from "./goldlineEffectivenessQueries";

export const goldlineEventRouter = router({
  record: dayforgeMissionFieldProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        eventId: z.string().uuid(),
        eventName: z.enum(GOLDLINE_CLIENT_EVENT_NAMES),
        missionId: z.number().int().positive().nullish(),
        properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const sanitized = sanitizeDayforgeProductEventProperties(
        input.eventName,
        { sessionId: input.sessionId, ...input.properties }
      );
      await writeDayforgeEvent({
        tenantId: ctx.tenantId,
        actor: { type: "field", id: ctx.user.openId },
        entityType: input.missionId ? "commercial_mission" : "goldline_session",
        entityId: input.missionId ? String(input.missionId) : input.sessionId,
        eventName: input.eventName,
        source: "goldline_client",
        correlationId: input.sessionId,
        idempotencyKey: `goldline:${input.sessionId}:${input.eventName}:${input.eventId}`,
        productEvent: {
          name: input.eventName,
          properties: sanitized,
          missionId: input.missionId ?? null,
        },
      });
      return { ok: true };
    }),

  /** Compact admin effectiveness view. Admin-only, same as Sales Intel. */
  effectivenessSummary: adminProcedure
    .input(z.object({ windowDays: z.number().int().min(1).max(90).optional() }).optional())
    .query(({ ctx, input }) =>
      getGoldlineEffectivenessSummary({
        tenantId: ctx.tenantId,
        windowDays: input?.windowDays,
      })
    ),
});
