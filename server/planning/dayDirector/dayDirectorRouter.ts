/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import { resolveMissionDirectorBusinessTimeZone } from "../missionDirector/missionDirectorRouter";
import { legacyDayforgeTenantMemberProcedure, router } from "../../_core/trpc";
import { requireCanonicalOperatorIdentityForUser } from "../../agents/persistentOperator/identity";
import { recordPersistentOperatorDiagnosticEvent } from "../../agents/persistentOperator/observability";
import {
  acceptProposalWithReceipt,
  completeDayDirectorCommitment,
  getDayDirectorState,
  proposeCommitment,
  setPromptState,
} from "./dayDirectorService";
import {
  answerMissionFollowUp,
  revokeMissionPresentation,
  syncMissionFollowUp,
} from "../../agents/daphne/missionFollowUp";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const proposal = z.object({
  promptKey: z.string().min(1).max(191),
  title: z.string().min(1).max(255),
  kind: z.enum(["growth", "prep", "operations"]),
  quantity: z.number().int().positive().nullable(),
  sourceText: z.string().min(1).max(2000),
  prerequisites: z.array(z.string().max(255)).max(3),
  question: z.string().max(500).nullable(),
  intelligence: z.enum(["anthropic", "manual_fallback"]),
});

async function dayDirectorIdentity(ctx: {
  tenantId: string;
  user: {
    id?: unknown;
    openId: string;
    role: "admin" | "driver" | "user";
  };
}, subsystem: string) {
  return requireCanonicalOperatorIdentityForUser({
    tenantId: ctx.tenantId,
    user: ctx.user,
    subsystem,
  });
}

export const dayDirectorRouter = router({
  state: legacyDayforgeTenantMemberProcedure
    .input(z.object({ businessDate: date }))
    .query(async ({ ctx, input }) => {
      const identity = await dayDirectorIdentity(ctx, "day_director.state");
      return getDayDirectorState({
        tenantId: identity.tenantId,
        actorId: identity.dayDirectorActorId,
        actorIds: identity.dayDirectorActorIds,
        canonicalOperatorId: identity.canonicalOperatorId,
        ...input,
      });
    }),
  /** Marks overdue open work as unresolved and returns Claire's one question. */
  missionFollowUp: legacyDayforgeTenantMemberProcedure
    .input(z.object({ today: date }))
    .mutation(async ({ ctx, input }) => {
      const identity = await dayDirectorIdentity(ctx, "day_director.mission_follow_up");
      // Overdue is judged by the tenant's business date, never the browser's.
      const tenantToday = formatInTimeZone(
        new Date(),
        await resolveMissionDirectorBusinessTimeZone(identity.tenantId),
        "yyyy-MM-dd"
      );
      return syncMissionFollowUp({
        tenantId: identity.tenantId,
        canonicalOperatorId: identity.canonicalOperatorId,
        operatorUserId: identity.canonicalOpenId,
        actorIds: identity.dayDirectorActorIds,
        today: input.today < tenantToday ? input.today : tenantToday,
      });
    }),
  answerMissionFollowUp: legacyDayforgeTenantMemberProcedure
    .input(z.object({ commitmentId: z.string().uuid(), answer: z.string().trim().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const identity = await dayDirectorIdentity(ctx, "day_director.mission_follow_up");
      return answerMissionFollowUp({
        tenantId: identity.tenantId,
        canonicalOperatorId: identity.canonicalOperatorId,
        operatorUserId: identity.canonicalOpenId,
        actorIds: identity.dayDirectorActorIds,
        ...input,
      });
    }),
  revokeMissionPresentation: legacyDayforgeTenantMemberProcedure
    .input(z.object({ missionType: z.string().trim().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const identity = await dayDirectorIdentity(ctx, "day_director.mission_follow_up");
      return {
        observationId: await revokeMissionPresentation({
          tenantId: identity.tenantId,
          canonicalOperatorId: identity.canonicalOperatorId,
          operatorUserId: identity.canonicalOpenId,
          actorIds: identity.dayDirectorActorIds,
          missionType: input.missionType,
        }),
      };
    }),
  propose: legacyDayforgeTenantMemberProcedure
    .input(z.object({ sourceText: z.string().trim().min(1).max(2000) }))
    .mutation(({ ctx, input }) =>
      proposeCommitment({ tenantId: ctx.tenantId, ...input })
    ),
  accept: legacyDayforgeTenantMemberProcedure
    .input(z.object({ businessDate: date, proposal }))
    .mutation(async ({ ctx, input }) => {
      const identity = await dayDirectorIdentity(ctx, "day_director.accept");
      const { stored, created } = await acceptProposalWithReceipt({
        tenantId: identity.tenantId,
        actorId: identity.dayDirectorActorId,
        actorIds: identity.dayDirectorActorIds,
        ...input,
        admission: {
          kind: "operator_instruction",
          channel: "authenticated_app",
          operatorActorId: identity.dayDirectorActorId,
          instructionRef: `day_director.accept:${identity.sourceOpenId}:${input.proposal.promptKey}`,
        },
      });
      if (stored && created) {
        await recordPersistentOperatorDiagnosticEvent({
          tenantId: identity.tenantId,
          canonicalOperatorId: identity.canonicalOperatorId,
          operatorUserId: identity.canonicalOpenId,
          subsystem: "day_director.accept",
          eventKind: "objective_created",
          objectiveId: stored.id,
        }).catch(() => undefined);
      }
      return stored;
    }),
  dismiss: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({ businessDate: date, promptKey: z.string().min(1).max(191) })
    )
    .mutation(async ({ ctx, input }) => {
      const identity = await dayDirectorIdentity(ctx, "day_director.dismiss");
      return setPromptState({
        tenantId: identity.tenantId,
        actorId: identity.dayDirectorActorId,
        state: "dismissed",
        ...input,
      });
    }),
  complete: legacyDayforgeTenantMemberProcedure
    .input(z.object({ commitmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const identity = await dayDirectorIdentity(ctx, "day_director.complete");
      const result = await completeDayDirectorCommitment({
        tenantId: identity.tenantId,
        actorId: identity.dayDirectorActorId,
        actorIds: identity.dayDirectorActorIds,
        commitmentId: input.commitmentId,
        admission: {
          kind: "operator_instruction",
          channel: "authenticated_app",
          operatorActorId: identity.dayDirectorActorId,
          instructionRef: `day_director.complete:${identity.sourceOpenId}:${input.commitmentId}`,
        },
      });
      if (!result.alreadyCompleted) {
        await recordPersistentOperatorDiagnosticEvent({
          tenantId: identity.tenantId,
          canonicalOperatorId: identity.canonicalOperatorId,
          operatorUserId: identity.canonicalOpenId,
          subsystem: "day_director.complete",
          eventKind: "objective_verified",
          objectiveId: input.commitmentId,
        }).catch(() => undefined);
      }
      return result;
    }),
});
