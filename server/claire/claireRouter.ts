import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  approveCustomerRecoveryDraft,
  createCustomerRecoveryIntervention,
  getRecoveryInterventionDetail,
  listRecoveryInterventions,
  markCustomerRecoveryContacted,
  prepareCustomerRecoveryManualContact,
  runCustomerChurnScan,
} from "../churnRadar/customerChurnService";
import {
  legacyAdminRoleProcedure,
  legacyDayforgeChurnProcedure,
  legacyDayforgeClaireVoiceProcedure,
  legacyDayforgeMissionFieldProcedure,
  joystickClaireDeskFieldProcedure,
  joystickClaireDeskProcedure,
  router,
} from "../_core/trpc";
import { runWithLlmObservability } from "../_core/llmObservability";
import { claireOperatorScope } from "../platform/tenancy/tenantIdentity";
import type { CanonicalGoldlineAction } from "../../shared/goldlineActionContract";
import { assertDriverCanReadMission } from "../commercialMissions/commercialMissionAuthorization";
import { dayDirectorActorId } from "../planning/dayDirector/dayDirectorActor";
import { getCommercialMission } from "../commercialMissions/commercialMissionStore";
import {
  CLAIRE_ATTESTABLE_EVENT_TYPES,
  recordClaireAttestedEvent,
} from "./character/relationshipEmitters";
import { listClaireRelationshipEvents } from "./character/relationshipEvents";
import {
  getClaireRelationshipState,
  listClaireTierTransitions,
} from "./character/relationshipState";
import { resolveOperatorTimeZone } from "../agents/persistentOperator/operatorAppointmentPolicy";
import { assembleClaireDriveContext } from "./contextAssembler";
import {
  startClairePostStopCall,
  startClairePreDriveCall,
} from "./claireTwilio";
import { ENV } from "../_core/env";
import { claireModelAcceptsSampling, claireModelDefaultsToThinking, claireModelId } from "./claireModel";
import { previewClairePreDrive } from "./preDriveRuntime";
import { getClaireAnswerPathCoverage, listClaireAnswerPathDetail, summarizeClaireAnswerPaths } from "./character/generationLog";
import { arbitrateClaireRepair2 } from "./repair2SliceG";
import { countProgressionEvidence } from "./progression/evaluate";
import { summarizeDeclineTelemetry } from "./progression/declineTelemetry";
import { getProgressionStore } from "./progression/drizzleStore";
import { planPersonalTurn, personalExchangesUsed } from "./progression/personalController";
import { PROGRESSION_POLICY } from "./progression/policy";
import { loadPersonalProgressionContext } from "./progression/service";
import { syncProgressionForOperator } from "./progression/evidenceSources";
import { claireRepair2FlagName, isClaireRepair2Enabled } from "./repair2Flags";
import { setActiveMacroGoal } from "./macroGoalService";
import {
  assembleTomorrowCandidates,
  confirmWorkdayPlan,
  loadConfirmedWorkdayPlan,
  previewWorkdayLoop,
} from "./workdayPlanService";
import { loadClaireRookContactResidues } from "./rookContactResidueContext";
import { observationUtteranceForBrain, runClaireTurn, type ClaireTurnResult, type ClaireTurnState } from "./turn/claireTurn";
import { isClaireWorkLedgerEnabled } from "./workLedger/workLedgerPlanner";
import { runWorkLedgerTurn } from "./workLedger/workLedgerTurn";
import { observeShadowTurnDetached } from "./brain/shadow/observeShadowTurn";
import { readOnlyWorkingMemorySource } from "./brain/shadow/v1Snapshot";
import {
  brainV2CallControlResult,
  brainV2ExecutionFailureResult,
  executeGrantBoundLegacyAdapter,
  isClaireBrainV2LiveEnabled,
  runClaireBrainV2LiveTurn,
  shouldFallbackToClaireLegacy,
} from "./brain/live/runClaireBrainV2LiveTurn";
import {
  isClaireBrainV2PrimaryEnabled,
  productionClaireV2PrimaryDeps,
  runClaireV2PrimaryTurn,
  type ClaireV2Provenance,
} from "./brain/live/primaryTurn";
import { resolveClaireOperatorAuthority } from "./brain/live/operatorAuthority";
import { resolveLegacyDayforgeMembership } from "../saas/tenantAccess";
import { claireConversationStateStore } from "./turn/conversationStateStore";
import { acquireDeskTurnLock, saveDeskConversationState } from "./deskTurnState";
import { claireEncyclopediaFor } from "./turn/claireTurnWiring";
import {
  getClaireCallAnalysis,
  getClaireCallAudio,
  listClaireAnalysisInbox,
  markClaireAnalysisNotificationRead,
  markClaireCallAnalysisWrong,
  markClaireCallReviewed,
} from "./conversation/conversationQuery";
import {
  continueCapabilityEngineering,
  loadCapabilityGapForOperator,
} from "../goldline/engineering/capabilityEngineeringService";
import { GOLDLINE_CAPABILITY_REGISTRY } from "../../shared/goldlineCapabilities";

/** Desk readback uses the configured operator zone. A UTC runner clock must not move tomorrow. */
export function confirmationTimeZone(
  operatorZone: string | null,
  requestedZone: string | undefined
): string | undefined {
  const zone = operatorZone?.trim();
  return zone ? zone : requestedZone;
}

const uuid = z.string().uuid();

const ATTESTATION_CONFIRMATION =
  "I witnessed this exactly as described and attest it happened" as const;

export async function assertClaireMissionAccess(input: {
  tenantId: string;
  missionId: number;
  userId: string;
  isAdmin: boolean;
}): Promise<void> {
  const mission = await getCommercialMission({
    tenantId: input.tenantId,
    missionId: input.missionId,
  });
  if (!mission) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Commercial mission not found",
    });
  }
  try {
    assertDriverCanReadMission({
      mission,
      userId: input.userId,
      isAdmin: input.isAdmin,
    });
  } catch (error) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: (error as Error).message,
    });
  }
}

function recoveryAction(
  detail: NonNullable<Awaited<ReturnType<typeof getRecoveryInterventionDetail>>>
): CanonicalGoldlineAction {
  const completed = detail.status === "recovered";
  const contacted = detail.status === "contacted";
  return {
    actionId: `recover:intervention:${detail.id}`,
    kind: "RECOVER",
    target: {
      type: "customer",
      id: detail.customer.customerKey,
      displayName: detail.customer.customerName,
    },
    reason: detail.customer.reasons.join(" · "),
    authority: contacted || completed ? "HUMAN_EXECUTION" : "APPROVAL_REQUIRED",
    status: completed
      ? "completed"
      : contacted
        ? "executing"
        : detail.status === "approved"
          ? "approved"
          : "proposed",
    sourceReferences: detail.customer.evidence.flatMap(item =>
      item.sourceIds.map(id => `${item.source}:${id}`)
    ),
    inputs: {
      interventionId: detail.id,
      draftId: detail.draft.id,
      draftStatus: detail.draft.status,
      permission: detail.permission.status,
      estimatedMonthlyImpactCents: detail.customer.estimatedMonthlyImpactCents,
    },
    result: completed
      ? {
          outcome: "recovered_order",
          sourceReferences: detail.recoveredOrderId
            ? [`orders:${detail.recoveredOrderId}`]
            : [],
        }
      : null,
  };
}

/** A desk conversation's working state survives restarts and deploys for a working day. */
const DESK_CONVERSATION_TTL_MS = 12 * 60 * 60 * 1000;

export const claireRouter = router({
  setMacroGoal: legacyAdminRoleProcedure
    .input(
      z.object({
        operatorUserId: z.string().trim().min(1).max(128),
        objective: z.string().trim().min(1).max(512),
        metricKey: z.string().trim().min(1).max(64),
        targetValue: z.number().finite(),
        unit: z.string().trim().min(1).max(64),
        urgencyText: z.string().trim().min(1).max(191).nullable().optional(),
        targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        source: z.enum(["operator_attested", "admin"]),
        sourceNote: z.string().trim().min(1).max(512),
        /** Explicitly replaces this active goal, even on a different metric. Otherwise a new metric is an additional goal. */
        replacesGoalId: z.string().trim().min(1).max(36).nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => setActiveMacroGoal({ tenantId: ctx.tenantId, ...input })),

  previewPreDrive: joystickClaireDeskProcedure
    .input(
      z.object({
        timeZone: z.string().trim().min(1).max(100).optional(),
      })
    )
    .query(({ ctx, input }) => {
      const scope = claireOperatorScope({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
      });
      return previewClairePreDrive({
        tenantId: scope.tenantId,
        actorId: scope.operatorUserId,
        timeZone: input.timeZone,
        dayDirectorActorId: dayDirectorActorId(ctx),
      });
    }),

  previewWorkday: legacyDayforgeMissionFieldProcedure
    .input(
      z.object({
        timeZone: z.string().trim().min(1).max(100).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const context = await assembleClaireDriveContext({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        phase: "pre_drive",
        timeZone: input.timeZone,
      });
      const actorId = dayDirectorActorId(ctx);
      const workday = await previewWorkdayLoop({
        tenantId: ctx.tenantId,
        actorId,
        context,
      });
      return {
        session: workday.session,
        eveningSpeak: workday.eveningSpeak,
        morningSpeak: workday.morningSpeak,
        tomorrowDraft: workday.tomorrowDraft,
        deltas: workday.deltas,
        confirmedAt: workday.confirmed?.confirmedAt ?? null,
        writesBusinessTruth: false as const,
      };
    }),

  confirmTomorrow: joystickClaireDeskFieldProcedure
    .input(
      z.object({
        timeZone: z.string().trim().min(1).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const context = await assembleClaireDriveContext({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        phase: "pre_drive",
        timeZone: confirmationTimeZone(
          await resolveOperatorTimeZone(ctx.tenantId),
          input.timeZone
        ),
      });
      const target = {
        tenantId: ctx.tenantId,
        actorId: dayDirectorActorId(ctx),
        businessDate: context.clock?.tomorrowBusinessDate ?? context.businessDate,
      };
      const snapshot = await confirmWorkdayPlan({ ...target, items: assembleTomorrowCandidates(context) });
      // Separate read of exactly what was written, for this business date.
      const readback = await loadConfirmedWorkdayPlan(target);
      return {
        confirmedAt: snapshot.confirmedAt,
        itemCount: snapshot.items.length,
        businessDate: target.businessDate,
        verified: readback?.confirmedAt === snapshot.confirmedAt && readback.items.length === snapshot.items.length,
      };
    }),

  talk: joystickClaireDeskProcedure
    .input(
      z.object({
        utterance: z.string().trim().min(1).max(4000),
        timeZone: z.string().trim().min(1).max(100).optional(),
        conversationId: z.string().trim().min(8).max(64).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const scope = claireOperatorScope({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
      });
      const preview = await previewClairePreDrive({
        tenantId: scope.tenantId,
        actorId: scope.operatorUserId,
        timeZone: input.timeZone,
        dayDirectorActorId: dayDirectorActorId(ctx),
      });
      const context = await assembleClaireDriveContext({
        tenantId: scope.tenantId,
        actorId: scope.operatorUserId,
        phase: "pre_drive",
        timeZone: input.timeZone,
      });
      context.workday = preview.workday ?? undefined;
      const actorId = dayDirectorActorId(ctx);
      // Same Claire brain as the phone: one durable state per desk conversation.
      const key = `claire-desk:${scope.tenantId}:${actorId}:${input.conversationId ?? "desk"}`;
      const store = claireConversationStateStore();
      // One Desk turn at a time per conversation: overlapping turns each loaded the same
      // state and the later save silently overwrote the earlier turn's held work.
      const releaseDeskTurn = await acquireDeskTurnLock(key);
      try {
        const stored = await store.load<ClaireTurnState>(key);
        const state: ClaireTurnState =
          stored && stored.tenantId === scope.tenantId && stored.operatorUserId === scope.operatorUserId ? stored.state : {};
        const rookContactResidues = await loadClaireRookContactResidues({
          tenantId: scope.tenantId,
          operatorUserId: scope.operatorUserId,
        });
        const runLegacyAdapter = async () =>
          await runClaireTurn(
            {
              tenantId: scope.tenantId,
              operatorUserId: scope.operatorUserId,
              dayDirectorActorId: actorId,
              surface: "text",
              utterance: input.utterance,
              state,
              conversationKey: key,
              workLedgerHandledUpstream: true,
              brief: preview.brief,
              context,
              rookContactResidues,
            },
            {
              confirmPlan: () =>
                confirmWorkdayPlan({
                  tenantId: scope.tenantId,
                  actorId,
                  businessDate:
                    context.clock?.tomorrowBusinessDate ?? context.businessDate,
                  items: assembleTomorrowCandidates(context),
                }).then(() => undefined),
              encyclopedia: claireEncyclopediaFor({
                dayDirectorActorId: actorId,
              }),
            }
          );

        /**
         * Brain V2 PRIMARY: identity + verified membership in THIS tenant.
         * Tenant data authorization is unchanged — every reader runs as scope.tenantId.
         */
        const v2Authority = isClaireBrainV2PrimaryEnabled()
          ? await resolveClaireOperatorAuthority({
              tenantId: scope.tenantId,
              operatorUserId: scope.operatorUserId,
              membership: await resolveLegacyDayforgeMembership({
                tenantId: scope.tenantId,
                userOpenId: scope.operatorUserId,
                platformRole: ctx.user.role,
              }).catch(() => null),
            })
          : null;
        const v2Primary = v2Authority?.authorized ? v2Authority : null;
        const deskTimeZone =
          input.timeZone ?? (await resolveOperatorTimeZone(scope.tenantId).catch(() => null)) ?? "America/Los_Angeles";
        const { brainV2LiveHandled, result, brainV2 } = await runWithLlmObservability(
          {
            tenantId: scope.tenantId,
            operatorOpenId: scope.operatorUserId,
            conversationId: key,
            surface: "desktop",
          },
          async (): Promise<{ brainV2LiveHandled: boolean; result: ClaireTurnResult; brainV2?: ClaireV2Provenance }> => {
            if (v2Primary) {
              const primary = await runClaireV2PrimaryTurn(
                {
                  authority: v2Primary,
                  tenantId: scope.tenantId,
                  operatorUserId: scope.operatorUserId,
                  dayDirectorActorId: actorId,
                  surface: "text",
                  utterance: input.utterance,
                  state,
                  conversationKey: key,
                  conversationId: input.conversationId ?? "desk",
                  timeZone: deskTimeZone,
                  businessDate: context.businessDate ?? new Date().toISOString().slice(0, 10),
                  brief: preview.brief,
                  context,
                  rookContactResidues,
                },
                productionClaireV2PrimaryDeps({
                  tenantId: scope.tenantId,
                  operatorUserId: scope.operatorUserId,
                  dayDirectorActorId: actorId,
                  conversationKey: key,
                  timeZone: deskTimeZone,
                  surface: "text",
                })
              );
              console.info("[ClaireBrainV2Primary]", JSON.stringify({
                event: "claire_brain_v2_primary",
                surface: "desktop",
                conversationKey: key,
                ...primary.brainV2,
              }));
              return { brainV2LiveHandled: true, result: primary, brainV2: primary.brainV2 };
            }
            // Same work owner as the phone: the ledger claims work turns, and the
            // legacy Day Line writers stand down for the rest of this conversation.
            if (isClaireWorkLedgerEnabled()) {
              state.workLedgerOwnsDayLine = true;
              const ledger = await runWorkLedgerTurn({
                tenantId: scope.tenantId,
                operatorUserId: scope.operatorUserId,
                dayDirectorActorId: actorId,
                conversationKey: key,
                surface: "text",
                utterance: input.utterance,
                state,
                timeZone: input.timeZone ?? (await resolveOperatorTimeZone(scope.tenantId).catch(() => null)) ?? "America/Los_Angeles",
                sessionKind: "desk",
              });
              if (ledger.handled) return { brainV2LiveHandled: false, result: ledger.result };
              return { brainV2LiveHandled: false, result: await runLegacyAdapter() };
            }
            const liveV2 = await runClaireBrainV2LiveTurn({
              rawText: input.utterance,
              assembledText: input.utterance,
              state: readOnlyWorkingMemorySource(state),
              tenantId: scope.tenantId,
              operatorUserId: scope.operatorUserId,
              surface: "text",
              conversationKey: key,
              live: {
                tenantId: scope.tenantId,
                operatorUserId: scope.operatorUserId,
                conversationId: input.conversationId ?? "desk",
                dayDirectorActorId: actorId,
                timeZone: input.timeZone ?? "America/Los_Angeles",
                businessDate:
                  context.businessDate ?? new Date().toISOString().slice(0, 10),
                surface: "text",
                priorClaimReceipts: state.claimReceipts ?? [],
              },
              executeLegacyAdapter: async grant =>
                executeGrantBoundLegacyAdapter({
                  grant,
                  state,
                  tenantId: scope.tenantId,
                  operatorUserId: scope.operatorUserId,
                  dayDirectorActorId: actorId,
                  conversationKey: key,
                  timeZone: input.timeZone ?? "America/Los_Angeles",
                  surface: "text",
                }),
            });
            if (liveV2.active) {
              const turnResult = liveV2.adapterResult
                ? liveV2.adapterResult
                : liveV2.result.candidateEndCall
                  ? brainV2CallControlResult({
                      candidateSpeak: liveV2.result.candidateSpeak,
                      assembledUtterance: input.utterance,
                    })
                  : (() => {
                      throw new Error(
                        "Brain V2 live action returned without a grant-bound adapter result"
                      );
                    })();
              console.info("[ClaireBrainV2]", {
                event: "claire_brain_v2_live",
                surface: "desktop",
                conversationKey: key,
                actionClasses: liveV2.actionClasses,
                endCall: liveV2.result.candidateEndCall,
                adapterKind: liveV2.adapterResult?.kind ?? null,
                actionIdCount: liveV2.adapterResult?.actionIds?.length ?? 0,
                mutationReceiptCount: liveV2.adapterResult?.mutationReceipts?.length ?? 0,
                receiptBackedCommit: Boolean(liveV2.adapterResult?.receiptBackedCommit),
              });
              return {
                brainV2LiveHandled: true,
                result: turnResult,
              };
            }

            if (!shouldFallbackToClaireLegacy(liveV2)) {
              console.warn("[ClaireBrainV2]", {
                event: "claire_brain_v2_live_execution_failed",
                surface: "desktop",
                conversationKey: key,
                reason: liveV2.reason,
              });
              return {
                brainV2LiveHandled: true,
                result: brainV2ExecutionFailureResult({
                  assembledUtterance: input.utterance,
                  attempted: liveV2.attempted ?? "that",
                }),
              };
            }

            // Phone and desk share the same live conversation/work owner.
            return {
              brainV2LiveHandled: false,
              result: await runLegacyAdapter(),
            };
          }
        );
        await saveDeskConversationState(store, key, { tenantId: scope.tenantId, operatorUserId: scope.operatorUserId, surface: "text" }, state, stored?.version ?? null, DESK_CONVERSATION_TTL_MS);

        /**
         * Brain V2 shadow observation. V1's authoritative result already exists and is
         * saved above; this is a ONE-WAY emission with no return path. Fire-and-forget,
         * default-off behind CLAIRE_BRAIN_V2_SHADOW, cannot throw, and receives a frozen
         * copy of state rather than the live object. The reply below is V1's alone.
         */
        const observation = observationUtteranceForBrain(result);
        if (
          observation.observe &&
          !brainV2LiveHandled &&
          !isClaireBrainV2LiveEnabled({
            tenantId: scope.tenantId,
            operatorUserId: scope.operatorUserId,
          })
        ) {
          observeShadowTurnDetached({
            rawText: observation.assembledText,
            assembledText: observation.assembledText,
            completeness: observation.completeness,
            state: readOnlyWorkingMemorySource(state),
            tenantId: scope.tenantId,
            operatorUserId: scope.operatorUserId,
            surface: "text",
            conversationKey: key,
            // Read-only readers, constructed only when the flag is ON.
            live: {
              tenantId: scope.tenantId,
              operatorUserId: scope.operatorUserId,
              conversationId: input.conversationId ?? "desk",
              dayDirectorActorId: actorId,
              timeZone: input.timeZone ?? "America/Los_Angeles",
              businessDate: context.businessDate ?? new Date().toISOString().slice(0, 10),
              surface: "text",
              priorClaimReceipts: state.claimReceipts ?? [],
            },
            v1: {
              endedCall: false,
              // commitmentTurn is on the shared turn result, so desk can record work too.
              mutated: Boolean(result.commitmentTurn) || Boolean(result.actionIds?.length),
              spokeSomething: Boolean(result.speak),
            },
          });
        }

        return {
          reply: result.speak || preview.brief,
          salesArtifacts: result.salesArtifacts ?? [],
          brief: preview.brief,
          workday: preview.workday,
          relationshipDimensions: preview.relationshipDimensions,
          disclosureTier: preview.disclosureTier,
          // Stage 3B structural proof. This is bounded interaction metadata only;
          // it is never business truth or Action / Execution authority.
          operatorAdaptation: result.operatorAdaptation ?? null,
          brainV2LiveHandled,
          /** Proof of which Claire answered: present only when Brain V2 primary produced the reply. */
          brainV2: brainV2 ?? null,
          actionIds: result.actionIds ?? [],
          receiptBackedCommit: result.receiptBackedCommit,
        };
      } finally {
        releaseDeskTurn();
      }
    }),

  driveContext: legacyDayforgeMissionFieldProcedure
    .input(
      z.object({
        phase: z.enum(["pre_drive", "post_stop"]),
        missionId: z.number().int().positive().optional(),
        timeZone: z.string().trim().min(1).max(100).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (input.missionId != null) {
        await assertClaireMissionAccess({
          tenantId: ctx.tenantId,
          missionId: input.missionId,
          userId: ctx.user.openId,
          isAdmin: ctx.legacyDayforgeMembership.role !== "field",
        });
      }
      return assembleClaireDriveContext({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        phase: input.phase,
        missionId: input.missionId,
        timeZone: input.timeZone,
      });
    }),

  callBeforeDrive: legacyDayforgeClaireVoiceProcedure
    .input(
      z.object({
        timeZone: z.string().trim().min(1).max(100).optional(),
        missionId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.missionId != null) {
        await assertClaireMissionAccess({
          tenantId: ctx.tenantId,
          missionId: input.missionId,
          userId: ctx.user.openId,
          isAdmin: ctx.legacyDayforgeMembership.role !== "field",
        });
      }
      return startClairePreDriveCall({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        // Day Director's own commitments (and therefore the Driver dayline
        // that renders them) are keyed by dayDirectorActorId(ctx) — the
        // numeric user id, not the openId Claire otherwise uses. Any
        // commitment the voice loop creates must use this exact id or it
        // will never appear on Driver after the call.
        dayDirectorActorId: dayDirectorActorId(ctx),
        timeZone: input.timeZone,
        missionId: input.missionId,
      });
    }),

  callAfterStop: legacyDayforgeClaireVoiceProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        timeZone: z.string().trim().min(1).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const isAdmin = ctx.legacyDayforgeMembership.role !== "field";
      await assertClaireMissionAccess({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
        userId: ctx.user.openId,
        isAdmin,
      });
      return startClairePostStopCall({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        missionId: input.missionId,
        missionAccess: isAdmin ? "operator" : "field",
        timeZone: input.timeZone,
      });
    }),

  scanReactivation: legacyDayforgeChurnProcedure
    .input(z.object({ requestId: uuid }))
    .mutation(({ ctx, input }) =>
      runCustomerChurnScan({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        requestId: input.requestId,
      })
    ),

  prepareReactivation: legacyDayforgeChurnProcedure
    .input(z.object({ snapshotId: uuid, requestId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const detail = await createCustomerRecoveryIntervention({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        snapshotId: input.snapshotId,
        requestId: input.requestId,
      });
      if (!detail) throw new Error("Recovery intervention was not persisted");
      return { detail, action: recoveryAction(detail) };
    }),

  reactivationStatus: legacyDayforgeChurnProcedure
    .input(z.object({ interventionId: uuid }))
    .query(async ({ ctx, input }) => {
      const all = await listRecoveryInterventions(ctx.tenantId);
      const detail = all.find(item => item.id === input.interventionId) ?? null;
      if (!detail) return null;
      return { detail, action: recoveryAction(detail) };
    }),

  approveReactivation: legacyDayforgeChurnProcedure
    .input(
      z.object({
        interventionId: uuid,
        draftId: uuid,
        requestId: uuid,
        confirmation: z.literal(
          "I reviewed this exact message and approve it for this customer"
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const detail = await approveCustomerRecoveryDraft({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        interventionId: input.interventionId,
        draftId: input.draftId,
        requestId: input.requestId,
      });
      if (!detail) throw new Error("Recovery intervention not found");
      return { detail, action: recoveryAction(detail) };
    }),

  prepareManualReactivation: legacyDayforgeChurnProcedure
    .input(z.object({ interventionId: uuid, requestId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const detail = await getRecoveryInterventionDetail({
        tenantId: ctx.tenantId,
        interventionId: input.interventionId,
      });
      if (!detail) throw new Error("Recovery intervention not found");
      const prepared = await prepareCustomerRecoveryManualContact({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        interventionId: detail.id,
        draftId: detail.draft.id,
        contentHash: detail.draft.contentHash,
        requestId: input.requestId,
      });
      return {
        prepared,
        action: {
          ...recoveryAction(detail),
          authority: "HUMAN_EXECUTION" as const,
          status: "approved" as const,
        },
      };
    }),

  markReactivationContacted: legacyDayforgeChurnProcedure
    .input(
      z.object({
        interventionId: uuid,
        requestId: uuid,
        confirmation: z.literal(
          "I manually sent this exact approved message to this customer"
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const detail = await getRecoveryInterventionDetail({
        tenantId: ctx.tenantId,
        interventionId: input.interventionId,
      });
      if (!detail) throw new Error("Recovery intervention not found");
      const updated = await markCustomerRecoveryContacted({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        interventionId: detail.id,
        draftId: detail.draft.id,
        contentHash: detail.draft.contentHash,
        requestId: input.requestId,
      });
      if (!updated) throw new Error("Recovery intervention not found");
      return { detail: updated, action: recoveryAction(updated) };
    }),

  // ── Claire relationship state (Pass 1) ──────────────────────────
  // Read-only self-view: an operator can see their own standing with
  // Claire. Never exposes another operator's state.
  relationshipState: legacyDayforgeMissionFieldProcedure.query(({ ctx }) =>
    getClaireRelationshipState({
      tenantId: ctx.tenantId,
      operatorUserId: ctx.user.openId,
    })
  ),

  // Bounded, self-scoped shared-history view — never a full transcript
  // dump (Slice 4).
  relationshipHistory: legacyDayforgeMissionFieldProcedure
    .input(z.object({ limit: z.number().int().min(1).max(20).default(10) }))
    .query(({ ctx, input }) =>
      listClaireRelationshipEvents({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        limit: input.limit,
      })
    ),

  // Human-attested relationship events (Slice: "operator-confirmed"
  // evidence). Restricted to event types that cannot be truthfully
  // inferred from runtime telemetry alone (see relationshipEmitters.ts) —
  // operator_follow_through/shared_hard_win/shared_failure are written
  // automatically from confirmed business outcomes and are NOT accepted
  // here, so this surface can never be used to self-award them.
  // Requires an explicit confirmation literal, matching the debrief-confirm
  // pattern used elsewhere for consequential, human-attested writes.
  recordRelationshipObservation: legacyDayforgeMissionFieldProcedure
    .input(
      z.object({
        eventType: z.enum(CLAIRE_ATTESTABLE_EVENT_TYPES),
        summary: z.string().trim().min(1).max(512),
        relatedEntityType: z.string().trim().min(1).max(64).optional(),
        relatedEntityId: z.string().trim().min(1).max(64).optional(),
        confirmation: z.literal(ATTESTATION_CONFIRMATION),
      })
    )
    .mutation(({ ctx, input }) =>
      recordClaireAttestedEvent({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        eventType: input.eventType as (typeof CLAIRE_ATTESTABLE_EVENT_TYPES)[number],
        summary: input.summary,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
        attestedByUserId: ctx.user.openId,
      })
    ),

  // Admin-only audit trail: which tier transitions happened for a given
  // operator, with reasons and supporting event ids (Slice 7).
  relationshipTierTransitions: legacyAdminRoleProcedure
    .input(z.object({ operatorUserId: z.string().trim().min(1) }))
    .query(({ ctx, input }) =>
      listClaireTierTransitions({
        tenantId: ctx.tenantId,
        operatorUserId: input.operatorUserId,
      })
    ),

  analysisInbox: legacyDayforgeMissionFieldProcedure.query(({ ctx }) =>
    listClaireAnalysisInbox({
      tenantId: ctx.tenantId,
      operatorUserId: ctx.user.openId,
    })
  ),

  markAnalysisNotificationRead: legacyDayforgeMissionFieldProcedure
    .input(z.object({ id: uuid }))
    .mutation(({ ctx, input }) =>
      markClaireAnalysisNotificationRead({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        id: input.id,
      })
    ),

  callAnalysis: legacyDayforgeMissionFieldProcedure
    .input(
      z
        .object({
          sessionId: uuid.optional(),
          callSid: z.string().trim().min(1).max(64).optional(),
        })
        .refine(input => Boolean(input.sessionId || input.callSid), {
          message: "sessionId or callSid is required",
        })
    )
    .query(({ ctx, input }) =>
      getClaireCallAnalysis({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        isAdmin: ctx.user.role === "admin" || ctx.legacyDayforgeMembership.role !== "field",
        sessionId: input.sessionId,
        callSid: input.callSid,
      })
    ),

  callAudio: legacyDayforgeMissionFieldProcedure
    .input(z.object({ sessionId: uuid }))
    .query(({ ctx, input }) =>
      getClaireCallAudio({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        isAdmin: ctx.user.role === "admin" || ctx.legacyDayforgeMembership.role !== "field",
        sessionId: input.sessionId,
      })
    ),

  markCallReviewed: legacyDayforgeMissionFieldProcedure
    .input(z.object({ sessionId: uuid }))
    .mutation(({ ctx, input }) =>
      markClaireCallReviewed({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        isAdmin: ctx.user.role === "admin" || ctx.legacyDayforgeMembership.role !== "field",
        sessionId: input.sessionId,
      })
    ),

  markCallAnalysisWrong: legacyDayforgeMissionFieldProcedure
    .input(
      z.object({
        sessionId: uuid,
        note: z.string().trim().min(1).max(1000),
      })
    )
    .mutation(({ ctx, input }) =>
      markClaireCallAnalysisWrong({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        isAdmin: ctx.user.role === "admin" || ctx.legacyDayforgeMembership.role !== "field",
        sessionId: input.sessionId,
        note: input.note,
      })
    ),

  capabilities: legacyDayforgeMissionFieldProcedure.query(() => GOLDLINE_CAPABILITY_REGISTRY),

  capabilityGap: joystickClaireDeskFieldProcedure
    .input(z.object({ id: uuid }))
    .query(({ ctx, input }) =>
      loadCapabilityGapForOperator({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        id: input.id,
        isAdmin: ctx.user.role === "admin",
      })
    ),

  /**
   * Claire Intelligence Repair Part 2, Slice A: the routing audit's live
   * numbers — which answer path produced each turn, what share never reached
   * the repaired conversational path, and which model production actually
   * requests. Admin-only, read-only, and empty until the slice's flag is on
   * for this tenant.
   */
  /**
   * Earned Rapport + Guarded Disclosure: admin/debug ONLY. Never surfaced in the
   * operator-facing game UI. Read-only; answers "why is this operator at this
   * rung, what evidence backs it, and would this topic be answered right now".
   */
  progressionDebug: legacyAdminRoleProcedure
    .input(
      z.object({
        operatorUserId: z.string().min(1),
        topic: z.string().optional(),
        conversationId: z.string().optional(),
        syncPaidOrders: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const store = getProgressionStore();
      const scope = { tenantId: ctx.tenantId, operatorUserId: input.operatorUserId };
      if (input.syncPaidOrders) await syncProgressionForOperator(scope, { force: true });
      const conversationId = input.conversationId ?? "admin_debug";
      const [evidence, personal, tenantLedger] = await Promise.all([
        store.listEvidence(scope),
        loadPersonalProgressionContext(store, scope, conversationId),
        store.listTenantLedger({ tenantId: ctx.tenantId }),
      ]);
      const entitlements = await store.listEntitlements(scope);
      const plan = input.topic ? planPersonalTurn({ topic: input.topic, context: personal }) : null;
      return {
        simulation: false,
        policyVersion: PROGRESSION_POLICY.version,
        grant: personal.grant,
        counts: countProgressionEvidence(evidence, new Date()),
        evidence: evidence.map(item => ({
          id: item.id, category: item.category, kind: item.kind, strength: item.strength,
          sourceType: item.sourceType, sourceId: item.sourceId, provenance: item.provenance,
          occurredAt: item.occurredAt, recognizedAt: item.recognizedAt,
        })),
        entitlements: {
          unused: entitlements.filter(row => row.status === "unused"),
          reserved: entitlements.filter(row => row.status === "reserved"),
          consumed: entitlements.filter(row => row.status === "consumed"),
        },
        disclosedFragmentIds: personal.disclosedFragmentIds,
        priorRefusedTopics: personal.priorRefusedTopics,
        currentCall: {
          conversationId,
          personalExchangesUsed: personalExchangesUsed(personal),
          budget: PROGRESSION_POLICY.personalExchangeBudget[personal.grant.personalRung],
          threadClosed: personal.conversationLedger.some(row => row.kind === "thread_closed"),
        },
        topicDecision: plan
          ? plan.kind === "answer"
            ? { topic: input.topic, decision: "allowed", basis: plan.basis, fragmentId: plan.fragment.id }
            : { topic: input.topic, decision: "denied", reason: plan.reason, eligibleFragmentId: plan.eligibleFragmentId }
          : null,
        ledgerTail: (await store.listLedger(scope)).slice(-100),
        declineTelemetry: summarizeDeclineTelemetry(tenantLedger),
      };
    }),

  routingAudit: legacyAdminRoleProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(90).default(30),
        limit: z.number().int().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const [distribution, recent, coverage] = await Promise.all([
        summarizeClaireAnswerPaths({ tenantId: ctx.tenantId, days: input.days }),
        listClaireAnswerPathDetail({ tenantId: ctx.tenantId, days: input.days, limit: input.limit }),
        getClaireAnswerPathCoverage({ tenantId: ctx.tenantId, days: input.days }),
      ]);
      const totalTurns = distribution.reduce((sum, row) => sum + row.turns, 0);
      const share = (predicate: (row: (typeof distribution)[number]) => boolean) => {
        const turns = distribution.filter(predicate).reduce((sum, row) => sum + row.turns, 0);
        return { turns, share: totalTurns ? turns / totalTurns : 0 };
      };
      const reachedFollowUpModel = share(row => row.answerPath === "follow_up_model");
      const rendererProse = share(row => row.rendererProse === true);
      const fallbacks = share(row => row.answerPath === "fallback");
      return {
        telemetryEnabled: isClaireRepair2Enabled("a_routing_telemetry", ctx.tenantId),
        flag: claireRepair2FlagName("a_routing_telemetry"),
        windowDays: input.days,
        totalTurns,
        coverage,
        distribution,
        recent,
        rendererProse,
        reachedFollowUpModel,
        neverReachedFollowUpModel: share(row => row.answerPath !== "follow_up_model"),
        fallbacks,
        sliceG: arbitrateClaireRepair2({
          observedSpanDays: coverage.spanDays,
          telemetryEnabled: isClaireRepair2Enabled("a_routing_telemetry", ctx.tenantId),
          totalTurns,
          reachedFollowUpModelShare: reachedFollowUpModel.share,
          rendererProseShare: rendererProse.share,
          fallbackShare: fallbacks.share,
        }),
        model: {
          // Read from the running process, so this reports production's own
          // configuration rather than what a config file says it should be.
          anthropicModelClaireSet: Boolean(process.env.ANTHROPIC_MODEL_CLAIRE?.trim()),
          anthropicModelSet: Boolean(process.env.ANTHROPIC_MODEL?.trim()),
          effectiveModel: claireModelId(),
          // Slice B: current-generation models reject temperature/top_p with
          // a 400. False here means Claire's calls send no temperature.
          acceptsSampling: claireModelAcceptsSampling(claireModelId()),
          // Slice B (corrective pass): true means this model runs extended
          // thinking on by default, and Claire is explicitly disabling it to
          // hold today's no-thinking baseline steady across a model switch.
          thinkingDisabledToMatchBaseline: claireModelDefaultsToThinking(claireModelId()),
        },
        writesBusinessTruth: false as const,
      };
    }),

  continueCapabilityEngineering: joystickClaireDeskFieldProcedure
    .input(
      z.object({
        id: uuid,
        approve: z.boolean(),
      })
    )
    .mutation(({ ctx, input }) =>
      continueCapabilityEngineering({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        gapId: input.id,
        approve: input.approve,
      })
    ),
});