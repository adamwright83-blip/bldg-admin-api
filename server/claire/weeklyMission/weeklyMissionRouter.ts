import { awaitingOpeningLine, nextLastSeenMark, signupOpeningLine, sinceLastVisitLine } from "../../../shared/firstTenMinutesKnowledge";
import { cachedAwaitingReplies, readAwaitingReplies, refreshAwaitingRepliesInBackground } from "../../firstTenMinutes/knowledge/awaitingReplies";
import { isClaireWorkLedgerEnabled } from "../workLedger/workLedgerPlanner";
import { runWorkLedgerTurn, workLedgerPromptSection } from "../workLedger/workLedgerTurn";
import type { ClaireTurnState } from "../turn/claireTurn";
import {
  isClaireBrainV2PrimaryEnabled,
  productionClaireV2PrimaryDeps,
  runClaireV2PrimaryTurn,
  type ClaireV2PrimaryState,
} from "../brain/live/primaryTurn";
import { resolveClaireOperatorAuthority } from "../brain/live/operatorAuthority";
import { assembleClaireDriveContext } from "../contextAssembler";
/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  legacyDayforgeTenantMemberProcedure,
  legacyDayforgeTenantOperatorProcedure,
  router,
} from "../../_core/trpc";
import { remainingWeekHorizon } from "../../../shared/weeklyMissionReadiness";
import { requireCanonicalOperatorIdentityForUser } from "../../agents/persistentOperator/identity";
import { buildDeskMission } from "../desk/deskMission";
import { buildShowrunnerBriefing } from "../showrunner/showrunnerBriefing";
import { runShowrunnerTurn, type ShowrunnerCallState } from "../showrunner/showrunnerTurn";
import { claireConversationStateStore } from "../turn/conversationStateStore";
import { transcribeAudio } from "../../_core/voiceTranscription";
import { CLAIRE_XAI_TTS_PATH, isClaireXaiTtsEnabled, issueClaireXaiSpeechToken } from "../xaiTts";
import { recordPersistentOperatorDiagnosticEvent } from "../../agents/persistentOperator/observability";
import {
  grantStrategicCallAuthorization,
  revokeStrategicCallAuthorization,
  readStrategicCallConsent,
} from "../../agents/persistentOperator/strategicCallAuthorization";
import {
  ensureDailyClaireAppointments,
  grantDailyClaireCall,
  readDailyClaireCallStatus,
  revokeDailyClaireCall,
} from "../../agents/persistentOperator/dailyCallAuthorization";
import {
  configureTenantStrategyVertical,
  resolveTenantVerticalKey,
} from "../../strategy/marketContext";
import { randomUUID } from "node:crypto";
import { prepareStrategicProposal } from "../../strategy/strategicPreparation";
import {
  latestStrategicProposal,
  strategicResponses,
} from "../../strategy/strategicStore";
import {
  respondToStrategicProposal,
  reviseStrategicProposal,
  readVerifiedStrategicApprovalItemIds,
} from "../../strategy/strategicApproval";
import { createDefaultOperatorAppointmentStore, resolveOperatorTimeZone } from "../../agents/persistentOperator/operatorAppointmentPolicy";
import { formatInTimeZone } from "date-fns-tz";
import { actionableDates, proposalItemExecutionWindow, strategicPlanningHorizon, targetWeekHorizon } from "../../../shared/weeklyMissionReadiness";
import { loadDailyCommandWithWeeklyIntent } from "./dailyCommandIntent";
import {
  adjustWeeklyMission,
  beginWeeklyMission,
  declineWeeklyMission,
  loadWeeklyMissionPicture,
  replyWeeklyMission,
  type WeeklyDriverScope,
} from "./driver";

const timeZone = z.string().trim().min(1).max(80);

function assertTimeZone(zone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown time zone" });
  }
}

async function scope(
  ctx: {
    tenantId: string;
    user: {
      openId: string;
      id?: unknown;
      role: "admin" | "driver" | "user";
    };
  },
  zone: string
): Promise<WeeklyDriverScope> {
  assertTimeZone(zone);
  const identity = await requireCanonicalOperatorIdentityForUser({
    tenantId: ctx.tenantId,
    user: ctx.user,
    subsystem: "weekly_mission",
  });
  return {
    tenantId: identity.tenantId,
    operatorId: identity.weeklyOperatorId,
    operatorIdentities: identity.aliases.map(alias => ({
      operatorId: alias.openId,
      dayDirectorActorId: String(alias.userId),
    })),
    dayDirectorActorId: identity.dayDirectorActorId,
    dayDirectorActorIds: identity.dayDirectorActorIds,
    timeZone: zone,
  };
}

export const weeklyMissionRouter = router({
  configureStrategicIndustry: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ verticalKey: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
        subsystem: "strategy.industry_configuration",
      });
      return configureTenantStrategyVertical({
        identity,
        verticalKey: input.verticalKey,
      });
    }),
  strategicCallConsent: legacyDayforgeTenantOperatorProcedure.query(
    async ({ ctx }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
        subsystem: "strategy.consent_status",
      });
      return readStrategicCallConsent(identity);
    }
  ),
  grantStrategicCalls: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        weekdays: z.array(z.number().int().min(1).max(5)).min(1).max(5),
        localStart: z.string().regex(/^\d{2}:\d{2}$/),
        localEnd: z.string().regex(/^\d{2}:\d{2}$/),
        timeZone: z.string().min(1),
        dailyLimit: z.number().int().min(1).max(3),
        consent: z.literal(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
        subsystem: "strategy.consent_grant",
      });
      return grantStrategicCallAuthorization({
        ...input,
        identity,
        sourceReference: `authenticated_app:${randomUUID()}`,
      });
    }),
  revokeStrategicCalls: legacyDayforgeTenantOperatorProcedure.mutation(
    async ({ ctx }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
        subsystem: "strategy.consent_revoke",
      });
      return revokeStrategicCallAuthorization(identity);
    }
  ),
  /** Morning readiness and evening debrief: separate grants, read together for settings. */
  dailyCallStatus: legacyDayforgeTenantOperatorProcedure.query(async ({ ctx }) => {
    const identity = await requireCanonicalOperatorIdentityForUser({
      tenantId: ctx.tenantId,
      user: ctx.user,
      subsystem: "claire.daily_call_status",
    });
    return readDailyClaireCallStatus(identity);
  }),
  grantDailyCalls: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        purpose: z.enum(["morning_readiness", "evening_debrief"]),
        weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
        localStart: z.string().regex(/^\d{2}:\d{2}$/),
        localEnd: z.string().regex(/^\d{2}:\d{2}$/),
        timeZone: z.string().min(1),
        consent: z.literal(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
        subsystem: "claire.daily_call_grant",
      });
      const grant = await grantDailyClaireCall({
        identity,
        purpose: input.purpose,
        weekdays: input.weekdays,
        localStart: input.localStart,
        localEnd: input.localEnd,
        timeZone: input.timeZone,
        sourceReference: `authenticated_app:${randomUUID()}`,
      });
      // Seed today's appointment now when today's window is still open; later days seed on their own day.
      await ensureDailyClaireAppointments({ store: createDefaultOperatorAppointmentStore(), tenantId: identity.tenantId }).catch(() => null);
      const status = await readDailyClaireCallStatus(identity);
      return { grant, status: status[input.purpose] as { enabled: boolean; nextWindow: Date | null; nextScheduled: Date | null } };
    }),
  revokeDailyCalls: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ purpose: z.enum(["morning_readiness", "evening_debrief"]) }))
    .mutation(async ({ ctx, input }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
        subsystem: "claire.daily_call_revoke",
      });
      return revokeDailyClaireCall(identity, input.purpose);
    }),
  deskMission: legacyDayforgeTenantOperatorProcedure.query(async ({ ctx }) => {
    const identity = await requireCanonicalOperatorIdentityForUser({ tenantId: ctx.tenantId, user: ctx.user, subsystem: "claire.desk_mission" });
    const zone = await resolveOperatorTimeZone(ctx.tenantId);
    if (!zone) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configure the business timezone before planning" });
    return buildDeskMission({ identity, timeZone: zone });
  }),
  /** OPEN COMMS: an in-app conversation with the same Claire runtime as the daily calls. No phone. */
  deskComms: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        sessionId: z.string().trim().min(8).max(64),
        utterance: z.string().trim().max(1500).optional(),
        /** A recorded operator turn (data:audio/...;base64), transcribed server-side. */
        audioDataUrl: z.string().max(8_000_000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({ tenantId: ctx.tenantId, user: ctx.user, subsystem: "claire.desk_comms" });
      const zone = await resolveOperatorTimeZone(ctx.tenantId);
      if (!zone) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configure the business timezone before planning" });
      const key = `claire-desk-comms:${identity.tenantId}:${identity.canonicalOperatorId}:${input.sessionId}`;
      const owner = { tenantId: identity.tenantId, operatorUserId: identity.canonicalOpenId, surface: "voice" as const };
      type Session = {
        ledgerState?: ClaireTurnState;
        showrunner: ShowrunnerCallState;
        history: Array<{ speaker: string; text: string }>;
        /** Brain V2 primary conversation state (history, receipts, V2 working memory, pending work). */
        v2State?: ClaireV2PrimaryState;
      };
      const store = claireConversationStateStore();
      const stored = await store.load<Session>(key);
      const now = new Date();
      let session = stored && stored.tenantId === owner.tenantId && stored.operatorUserId === owner.operatorUserId ? stored.state : null;
      if (!session) {
        const briefing = await buildShowrunnerBriefing({ identity, purpose: "desk_planning", timeZone: zone, now });
        session = {
          history: [],
          showrunner: {
            purpose: "desk_planning",
            tenantId: identity.tenantId,
            canonicalOperatorId: identity.canonicalOperatorId,
            operatorUserId: identity.canonicalOpenId,
            dayDirectorActorId: identity.dayDirectorActorId,
            dayDirectorActorIds: identity.dayDirectorActorIds,
            timeZone: zone,
            businessDate: formatInTimeZone(now, zone, "yyyy-MM-dd"),
            briefing,
            captured: { missionUpdates: [], developments: [], readinessNeeds: [] },
            replan: null,
            turns: 0,
          },
        };
      }
      // Who the owner is waiting on, from their own Gmail: refreshed from the short cache every turn; the opening (no
      // utterance yet) may wait briefly for a first read, and goes on without it rather than keep the operator waiting.
      // Later in the conversation an expired list is read again in the background; the next turn has it.
      const opening = !input.utterance?.trim() && !input.audioDataUrl;
      const cachedAwaiting = cachedAwaitingReplies(identity.tenantId);
      if (!cachedAwaiting && !opening) refreshAwaitingRepliesInBackground(identity.tenantId);
      const awaiting =
        cachedAwaiting ??
        (opening
          ? await Promise.race([readAwaitingReplies(identity.tenantId), new Promise<null>(resolve => setTimeout(() => resolve(null), 4000))]).catch(() => null)
          : null);
      if (awaiting) session.showrunner.briefing.awaitingReplies = awaiting;
      // Claire's own voice (the same xAI voice as her calls) when configured; otherwise the client says so.
      const voiced = <T extends { speak: string }>(r: T) => ({
        ...r,
        speechUrl: isClaireXaiTtsEnabled() ? `${CLAIRE_XAI_TTS_PATH}?token=${encodeURIComponent(issueClaireXaiSpeechToken(r.speak))}&format=web` : null,
      });
      let utterance = input.utterance?.trim();
      if (!utterance && input.audioDataUrl) {
        const match = input.audioDataUrl.match(/^data:(audio\/[a-zA-Z0-9.+-]+)(?:;codecs=[a-zA-Z0-9.,-]+)?;base64,([\s\S]+)$/);
        if (!match) throw new TRPCError({ code: "BAD_REQUEST", message: "Audio recording format is invalid" });
        // Transcribed in memory; the recording itself is not stored.
        const heard = await transcribeAudio({
          audio: { data: Buffer.from(match[2]!, "base64"), mimeType: match[1]! },
          language: "en",
          prompt: "An operator talking to Claire, their chief of staff, about a laundry business: customers, missions, times, the Day Line.",
        });
        if ("error" in heard) console.warn("[Claire desk comms] transcription failed", heard.code, heard.details ?? heard.error);
        utterance = "error" in heard ? "" : heard.text.trim();
        if (!utterance)
          return voiced({ speak: "Sorry, I didn't catch that. Could you say it again?", heard: null, saved: [] as string[], awaitingApproval: null, end: false, transcriptionFailed: true });
      }
      if (!utterance) {
        const b = session.showrunner.briefing;
        // what changed while they were away: who wrote back since their last visit to the desk (kept 60 days). The
        // mark moves only as far as mail actually read: to this opening's Gmail read (its checkedAt, which may be a
        // cached read from minutes ago), and not at all when Gmail wasn't read, so no reply falls between two visits
        const seenKey = `claire-desk-last-seen:${identity.tenantId}:${identity.canonicalOperatorId}`;
        const seen = await store.load<{ at: number }>(seenKey).catch(() => null);
        const lastSeen = seen && seen.tenantId === owner.tenantId ? new Date(seen.state.at) : null;
        const mark = nextLastSeenMark(awaiting, lastSeen);
        if (mark !== null) await store.save(seenKey, owner, { at: mark }, 60 * 86_400_000).catch(() => undefined);
        const open = [...b.today, ...b.tomorrow].filter(i => i.status === "open");
        const pending = b.pendingDecision?.items ?? [];
        const speak = [
          "Claire here.",
          open.length ? `On your Day Line: ${open.slice(0, 3).map(i => `${i.title}${i.window ? ` (${i.window})` : ""}`).join(", ")}.` : "Nothing is on your Day Line for today or tomorrow.",
          pending.length ? `${pending.length === 1 ? "One prepared mission needs" : `${pending.length} prepared missions need`} your OK: ${pending.slice(0, 2).map(i => i.title).join("; ")}.` : "",
          // where the first message from signup stands (First Ten Minutes), when there is one
          signupOpeningLine(b.signupKnowledge ?? null, session.showrunner.timeZone, now) ?? "",
          sinceLastVisitLine(b.awaitingReplies, lastSeen) ?? "",
          awaitingOpeningLine(b.awaitingReplies) ?? "",
          "What do you need?",
        ].filter(Boolean).join(" ");
        if (!session.history.length) session.history.push({ speaker: "claire", text: speak });
        await store.save(key, owner, session, 2 * 3600_000);
        return voiced({ speak, heard: null, saved: [] as string[], awaitingApproval: null, end: false, transcriptionFailed: false });
      }
      /**
       * Brain V2 PRIMARY on OPEN COMMS. The newest Claire decides every turn; the
       * desk-planning conductor runs only for turns V2 routes to the planning
       * agenda. Identity + verified membership in this tenant; rollback is
       * CLAIRE_BRAIN_V2_PRIMARY=0.
       */
      const v2Authority = isClaireBrainV2PrimaryEnabled()
        ? await resolveClaireOperatorAuthority({
            tenantId: ctx.tenantId,
            operatorUserId: ctx.user.openId,
            membership: ctx.legacyDayforgeMembership,
          })
        : null;
      if (v2Authority?.authorized) {
        const v2State: ClaireV2PrimaryState = session.v2State ?? {
          history: session.history.map((turn, index) => ({
            speaker: turn.speaker === "operator" ? ("operator" as const) : ("claire" as const),
            text: turn.text,
            at: now.getTime() - session!.history.length + index,
            delivery: "confirmed_heard" as const,
          })),
        };
        v2State.showrunner = session.showrunner;
        const context = await assembleClaireDriveContext({
          tenantId: ctx.tenantId,
          actorId: ctx.user.openId,
          phase: "pre_drive",
          timeZone: zone,
        }).catch(() => null);
        const primary = await runClaireV2PrimaryTurn(
          {
            authority: v2Authority,
            tenantId: ctx.tenantId,
            operatorUserId: ctx.user.openId,
            dayDirectorActorId: identity.dayDirectorActorId,
            surface: "voice",
            utterance,
            state: v2State,
            conversationKey: key,
            conversationId: input.sessionId,
            timeZone: zone,
            businessDate: session.showrunner.businessDate,
            brief: null,
            context,
            sourceEventId: `desk_comms:${input.sessionId}:${(v2State.claireTurnCount ?? 0) + 1}`,
            // A recorded or typed Desk turn is already a complete thought.
            allowFragmentWait: false,
          },
          productionClaireV2PrimaryDeps({
            tenantId: ctx.tenantId,
            operatorUserId: ctx.user.openId,
            dayDirectorActorId: identity.dayDirectorActorId,
            conversationKey: key,
            timeZone: zone,
            surface: "voice",
          })
        );
        console.info("[ClaireBrainV2Primary]", JSON.stringify({
          event: "claire_brain_v2_primary",
          surface: "desk_comms",
          conversationKey: key,
          ...primary.brainV2,
        }));
        const updatedShowrunner = v2State.showrunner ?? session.showrunner;
        delete v2State.showrunner;
        session = {
          ledgerState: session.ledgerState,
          showrunner: updatedShowrunner,
          history: (v2State.history ?? []).map(({ speaker, text }) => ({ speaker, text })).slice(-30),
          v2State,
        };
        await store.save(key, owner, session, 2 * 3600_000);
        const replan = updatedShowrunner.replan;
        return {
          ...voiced({
            speak: primary.speak || "Go on.",
            heard: utterance,
            saved: primary.actionIds?.length ? [primary.speak] : ([] as string[]),
            awaitingApproval: replan && !replan.approved ? { summary: replan.summary } : null,
            end: Boolean(primary.endCall),
            transcriptionFailed: false,
          }),
          brainV2: primary.brainV2,
        };
      }
      const ledgerEnabled = isClaireWorkLedgerEnabled();
      if (ledgerEnabled) {
        const ledgerState = session.ledgerState ??= {};
        ledgerState.workLedgerOwnsDayLine = true;
        const history = session.history;
        ledgerState.history = history.map((turn, index) => ({
          speaker: turn.speaker === "operator" ? "operator" as const : "claire" as const,
          text: turn.text, at: now.getTime() - history.length + index,
        }));
        const ledger = await runWorkLedgerTurn({
          tenantId: identity.tenantId, operatorUserId: identity.canonicalOpenId,
          dayDirectorActorId: identity.dayDirectorActorId, conversationKey: key,
          surface: "text", utterance, state: ledgerState, timeZone: zone, sessionKind: "desk_planning",
          sourceEventId: `desk_comms:${input.sessionId}:${session.showrunner.turns + 1}`,
        });
        if (ledger.handled) {
          session.showrunner.turns += 1;
          session.history = (ledgerState.history ?? []).map(({ speaker, text }) => ({ speaker, text }));
          await store.save(key, owner, session, 2 * 3600_000);
          return voiced({ speak: ledger.result.speak, heard: utterance,
            saved: ledger.result.actionIds?.length ? [ledger.result.speak] : [], awaitingApproval: null,
            end: Boolean(ledger.result.endCall), transcriptionFailed: false });
        }
      }
      const turn = await runShowrunnerTurn({
        state: session.showrunner,
        ...(ledgerEnabled ? { workLedger: { section: workLedgerPromptSection(session.ledgerState!, session.showrunner.businessDate) } } : {}),
        history: session.history,
        utterance,
        sourceEventId: `desk_comms:${input.sessionId}:${session.showrunner.turns + 1}`,
        conversationKey: key,
      });
      session = {
        ledgerState: session.ledgerState,
        showrunner: turn.state,
        history: [...session.history, { speaker: "operator", text: utterance }, { speaker: "claire", text: turn.speak }].slice(-30),
      };
      await store.save(key, owner, session, 2 * 3600_000);
      const replan = turn.state.replan;
      return voiced({
        speak: turn.speak,
        heard: utterance,
        saved: turn.saved ?? [],
        awaitingApproval: replan && !replan.approved ? { summary: replan.summary } : null,
        end: turn.end,
        transcriptionFailed: false,
      });
    }),
  preparedProposal: legacyDayforgeTenantOperatorProcedure.query(
    async ({ ctx }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
        subsystem: "strategy.app_proposal",
      });
      const zone = await resolveOperatorTimeZone(ctx.tenantId);
      if (!zone)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Configure the business timezone before planning",
        });
      const now = new Date();
      const date = formatInTimeZone(now, zone, "yyyy-MM-dd");
      // Read the week the preparer actually prepared: after Friday's window closes (not only
      // on weekends) that is next week.
      const localTime = formatInTimeZone(now, zone, "HH:mm");
      const start = strategicPlanningHorizon({ businessDate: date, localTime }).weekStart;
      const proposal = await latestStrategicProposal(identity, start);
      const responses = proposal
        ? await strategicResponses(identity, proposal.id)
        : [];
      const approvedItemIds = proposal
        ? await readVerifiedStrategicApprovalItemIds(identity, proposal)
        : [];
      // Unapproved work whose time has passed is shown for rescheduling, never approval.
      const clock = { businessDate: date, localTime };
      const expiredItemIds = proposal
        ? proposal.items.filter(i => !approvedItemIds.includes(i.id) && proposalItemExecutionWindow(i, clock) === "expired").map(i => i.id)
        : [];
      const rescheduleDates = proposal
        ? actionableDates(targetWeekHorizon({ businessDate: date, localTime, weekStart: proposal.weekStart })).filter(d => d >= proposal.businessDate)
        : [];
      return {
        proposal,
        approvedItemIds,
        expiredItemIds,
        rescheduleDates,
        verticalKey: await resolveTenantVerticalKey(ctx.tenantId),
        responses,
        stale: proposal
          ? Date.parse(proposal.expiresAt) <= now.getTime()
          : false,
      };
    }
  ),
  refreshPreparedProposal: legacyDayforgeTenantOperatorProcedure.mutation(
    async ({ ctx }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
        subsystem: "strategy.app_prepare",
      });
      const zone = await resolveOperatorTimeZone(ctx.tenantId);
      if (!zone)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Configure the business timezone",
        });
      return prepareStrategicProposal({ identity, timeZone: zone });
    }
  ),
  respondToPreparedProposal: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        proposalId: z.string().min(1),
        revision: z.string().length(64),
        action: z.enum(["approve", "reject", "defer"]),
        itemIds: z.array(z.string()).optional(),
        note: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
        subsystem: "strategy.app_approval",
      });
      return respondToStrategicProposal({
        ...input,
        identity,
        source: "authenticated_app",
      });
    }),
  revisePreparedProposal: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        proposalId: z.string().min(1),
        revision: z.string().length(64),
        itemId: z.string().min(1),
        title: z.string().trim().min(1).max(255),
        /** Reschedule: the item's new day, within the proposal's remaining week. */
        businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
        subsystem: "strategy.app_revision",
      });
      return reviseStrategicProposal({ ...input, identity });
    }),
  dailyReadiness: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        timeZone,
      })
    )
    .query(async ({ ctx, input }) => {
      assertTimeZone(input.timeZone);
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
        subsystem: "weekly_mission.readiness",
      });
      const horizon = remainingWeekHorizon({
        businessDate: input.businessDate,
        localTime: "12:00",
      });
      const command = await loadDailyCommandWithWeeklyIntent({
        tenantId: identity.tenantId,
        actorId: identity.weeklyOperatorId,
        operatorUserId: identity.weeklyOperatorId,
        operatorUserIds: identity.aliases.map(alias => alias.openId),
        dayDirectorActorId: identity.dayDirectorActorId,
        dayDirectorActorIds: identity.dayDirectorActorIds,
        businessDate: input.businessDate,
        timeZone: input.timeZone,
        weekStart: horizon.weekStart,
      });
      const readiness = command.weeklyIntentReadiness ?? [];
      await recordPersistentOperatorDiagnosticEvent({
        tenantId: identity.tenantId,
        canonicalOperatorId: identity.canonicalOperatorId,
        operatorUserId: identity.canonicalOpenId,
        subsystem: "weekly_mission.readiness",
        eventKind: "selection_attempt",
        reason: readiness.length === 0 ? "legitimate_no_work" : null,
      }).catch(() => undefined);
      return readiness;
    }),
  picture: legacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .query(async ({ ctx, input }) =>
      loadWeeklyMissionPicture(await scope(ctx, input.timeZone))
    ),
  begin: legacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .mutation(async ({ ctx, input }) =>
      beginWeeklyMission(await scope(ctx, input.timeZone))
    ),
  decline: legacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .mutation(async ({ ctx, input }) =>
      declineWeeklyMission(await scope(ctx, input.timeZone))
    ),
  adjust: legacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .mutation(async ({ ctx, input }) =>
      adjustWeeklyMission(await scope(ctx, input.timeZone))
    ),
  reply: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        timeZone,
        utterance: z.string().trim().min(1).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) =>
      replyWeeklyMission(await scope(ctx, input.timeZone), input.utterance)
    ),
});
