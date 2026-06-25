import { createHash } from "node:crypto";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { listRequestJobCardSourceRecords } from "../db";
import { buildCastingSprintBootstrapHandoff, type CastingSprintBootstrapHandoff } from "./castingSprintBootstrapBridgePolicy";
import {
  buildCastingSprintOutreachDraft,
  buildRealCandidateCreationPayload,
  validateRealVendorFacts,
  VENDOR_SOURCE_TYPES,
  type CandidateCreationPayload,
  type OutreachDraft,
} from "./castingSprintExecutionPolicy";
import { createProcurementPool } from "./migrations";
import { buildRequestJobCardPage, REQUEST_JOB_CARD_SOURCE_TYPES, type RequestJobCardSourceType } from "./requestJobCardReadModel";
import type { RequestJobCard } from "./requestJobCardPolicy";
import {
  AUTOMATION_MODES,
  buildContactAttempt,
  buildResponseTermsPacket,
  buildSimulatedReplyIntakePacket,
  CONTACT_CHANNELS,
  type ContactChannel,
  interpretVendorReply,
  runNoopContactAttempt,
  validateReplyIntakePacket,
  type ContactAttempt,
  type InterpretedReply,
  type NoopProviderResult,
  type ResponseTermsPacket,
  type VendorReplyIntakePacket,
} from "./vendorContactAttemptPolicy";
import { buildProviderReadiness, evaluateLiveSendGate, type ProviderReadiness } from "./vendorContactProviderRegistry";
import {
  buildAgentMailLabels,
  evaluateAgentMailLiveSendGate,
  inspectAgentMailReadiness,
  sendVendorEmailViaAgentMail,
  type AgentMailSendResult,
} from "./agentMailVendorEmailProvider";
import {
  computeIdempotencyKey,
  VendorContactAttemptStore,
  type DurableContactAttempt,
  type DurableDraft,
  type StatusHistoryEntry,
} from "./vendorContactAttemptStore";
import { buildCastingMission, type CastingMission } from "./vendorCastingSprintPolicy";

const SOURCE_KEY_PATTERN = /^(service_request|resident_coordinated_request|resident_agent_plan):(.+)$/;

function parseSourceKey(sourceKey: string): { sourceType: RequestJobCardSourceType; sourceId: string } | null {
  const match = SOURCE_KEY_PATTERN.exec(sourceKey.trim());
  if (!match) return null;
  const sourceType = match[1] as RequestJobCardSourceType;
  if (!REQUEST_JOB_CARD_SOURCE_TYPES.includes(sourceType)) return null;
  return { sourceType, sourceId: match[2] };
}

export type CastingMissionResult = {
  found: boolean;
  blockedReasons: string[];
  mission: CastingMission | null;
};

type ResolvedMission = CastingMissionResult & { jobCard: RequestJobCard | null };

async function resolveMission(input: { tenantId: string; sourceKey: string }): Promise<ResolvedMission> {
  const parsed = parseSourceKey(input.sourceKey);
  if (!parsed) {
    return { found: false, blockedReasons: ["source_key_format_invalid"], mission: null, jobCard: null };
  }
  const sources = await listRequestJobCardSourceRecords({
    tenantId: input.tenantId,
    sources: [parsed.sourceType],
    fetchCount: 1051,
  });
  const page = buildRequestJobCardPage({ sources, limit: 1051, offset: 0 });
  const sourceItem = page.items.find(item => `${item.sourceRecordType}:${item.sourceRecordId}` === input.sourceKey.trim());
  if (!sourceItem) {
    return { found: false, blockedReasons: ["source_job_card_not_found"], mission: null, jobCard: null };
  }
  const jobCard = sourceItem.jobCards.find(card => card.status === "job_card_ready_for_admin_review") ?? sourceItem.jobCards[0];
  if (!jobCard) {
    return { found: false, blockedReasons: ["no_job_card_derivable_from_source"], mission: null, jobCard: null };
  }
  if (jobCard.status !== "job_card_ready_for_admin_review") {
    return { found: true, blockedReasons: [`job_card_status_${jobCard.status}`], mission: null, jobCard };
  }
  const mission = buildCastingMission({ jobCard, sourceKey: input.sourceKey.trim() });
  return { found: true, blockedReasons: [], mission, jobCard };
}

function bodyHashFor(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

const PROVIDER_ADAPTER_BY_CHANNEL: Record<ContactChannel, string> = {
  email: "noop_email",
  sms_if_allowed: "noop_sms",
  call: "noop_voice",
  voicemail: "noop_voice",
  second_call_if_urgent: "noop_voice",
  website_form: "noop_website_form",
};

let lazyContactAttemptStore: VendorContactAttemptStore | null = null;

function resolveContactAttemptStore(injected?: VendorContactAttemptStore): VendorContactAttemptStore {
  if (injected) return injected;
  if (!lazyContactAttemptStore) {
    lazyContactAttemptStore = new VendorContactAttemptStore(createProcurementPool());
  }
  return lazyContactAttemptStore;
}

export type CastingSprintBootstrapHandoffResponse = {
  found: boolean;
  allowed: boolean;
  blockedReasons: string[];
  handoff: CastingSprintBootstrapHandoff | null;
};

const vendorFactsInput = z.object({
  businessName: z.string().max(191).default(""),
  phone: z.string().max(80).nullable().optional(),
  email: z.string().max(191).nullable().optional(),
  website: z.string().max(500).nullable().optional(),
  sourceType: z.enum(VENDOR_SOURCE_TYPES),
  sourceReference: z.string().max(500).default(""),
  serviceArea: z.string().max(500).default(""),
  qualificationNotes: z.string().max(2000).default(""),
  googleRating: z.number().min(0).max(5).nullable().optional(),
  googleReviewCount: z.number().int().nonnegative().nullable().optional(),
  yelpRating: z.number().min(0).max(5).nullable().optional(),
  yelpReviewCount: z.number().int().nonnegative().nullable().optional(),
  observedAt: z.string().max(40).nullable().optional(),
  negativeFlags: z.array(z.string().max(200)).nullable().optional(),
  sourceConfidenceNotes: z.string().max(2000).nullable().optional(),
});

export type GenerateOutreachDraftResponse =
  | { allowed: true; blockedReasons: []; draft: OutreachDraft; durableDraftId: string | null; bodyHash: string; persisted: boolean }
  | { allowed: false; blockedReasons: string[]; draft: null; durableDraftId: null; bodyHash: null; persisted: false };

export type CandidateCreationPayloadResponse =
  | { allowed: true; blockedReasons: []; payload: CandidateCreationPayload }
  | { allowed: false; blockedReasons: string[]; payload: null };

export type AuditFeedAttemptSummary = {
  attemptId: string;
  durableDraftId: string | null;
  sourceKey: string;
  candidateId: string | null;
  leadId: string | null;
  lane: string | null;
  channel: string;
  status: string;
  automationMode: string;
  providerAdapter: string | null;
  providerAttemptId: string | null;
  sendGateResultJson: unknown;
  statusHistory: StatusHistoryEntry[];
  latestReplySummary: unknown | null;
  latestTermsPacketSummary: unknown | null;
  liveProviderInvoked: boolean;
  outreachSentByHeld: boolean;
  providerResponded: boolean;
  providerAccepted: boolean;
  bookingConfirmed: boolean;
  paymentAuthorized: boolean;
  dispatched: boolean;
  createdAt: string;
  updatedAt: string;
};

function toAuditFeedSummary(attempt: DurableContactAttempt): AuditFeedAttemptSummary {
  return {
    attemptId: attempt.id,
    durableDraftId: attempt.outreachDraftId,
    sourceKey: attempt.sourceKey,
    candidateId: attempt.candidateId,
    leadId: attempt.leadId,
    lane: attempt.lane,
    channel: attempt.channel,
    status: attempt.status,
    automationMode: attempt.automationMode,
    providerAdapter: attempt.providerAdapter,
    providerAttemptId: attempt.providerAttemptId,
    sendGateResultJson: attempt.sendGateResultJson,
    statusHistory: attempt.statusHistoryJson,
    latestReplySummary: attempt.latestReplyJson,
    latestTermsPacketSummary: attempt.latestTermsPacketJson,
    liveProviderInvoked: attempt.liveProviderInvoked,
    outreachSentByHeld: attempt.outreachSentByHeld,
    providerResponded: attempt.providerResponded,
    providerAccepted: attempt.providerAccepted,
    bookingConfirmed: attempt.bookingConfirmed,
    paymentAuthorized: attempt.paymentAuthorized,
    dispatched: attempt.dispatched,
    createdAt: attempt.createdAt.toISOString(),
    updatedAt: attempt.updatedAt.toISOString(),
  };
}

export function createVendorCastingSprintRouter(injectedStore?: VendorContactAttemptStore) {
  return router({
  /**
   * Inspects provider configuration/flags only; never imports or calls a
   * live email/SMS/form SDK. liveSendingEnabled is always false in this
   * slice regardless of what env vars or flags are set.
   */
  providerReadiness: adminProcedure.query((): ProviderReadiness & { agentMail: ReturnType<typeof inspectAgentMailReadiness> } => ({
    ...buildProviderReadiness(),
    agentMail: inspectAgentMailReadiness(),
  })),

  mission: adminProcedure
    .input(z.object({ sourceKey: z.string().min(3).max(191) }))
    .query(async ({ ctx, input }): Promise<CastingMissionResult> => {
      const { found, blockedReasons, mission } = await resolveMission({ tenantId: ctx.tenantId, sourceKey: input.sourceKey });
      return { found, blockedReasons, mission };
    }),

  bootstrapHandoff: adminProcedure
    .input(z.object({ sourceKey: z.string().min(3).max(191), leadId: z.string().min(1).max(191).optional() }))
    .query(async ({ ctx, input }): Promise<CastingSprintBootstrapHandoffResponse> => {
      const result = await resolveMission({ tenantId: ctx.tenantId, sourceKey: input.sourceKey });
      if (!result.found || !result.mission) {
        return { found: result.found, allowed: false, blockedReasons: result.blockedReasons, handoff: null };
      }
      const handoffResult = buildCastingSprintBootstrapHandoff({ mission: result.mission, leadId: input.leadId });
      if (!handoffResult.allowed) {
        return { found: true, allowed: false, blockedReasons: handoffResult.reasons, handoff: null };
      }
      return { found: true, allowed: true, blockedReasons: [], handoff: handoffResult.handoff };
    }),

  generateOutreachDraft: adminProcedure
    .input(z.object({
      sourceKey: z.string().min(3).max(191),
      leadId: z.string().min(1).max(191),
      candidateId: z.string().min(1).max(191).nullable().optional(),
      channel: z.enum(CONTACT_CHANNELS).optional(),
      vendorFacts: vendorFactsInput,
    }))
    .mutation(async ({ ctx, input }): Promise<GenerateOutreachDraftResponse> => {
      const result = await resolveMission({ tenantId: ctx.tenantId, sourceKey: input.sourceKey });
      if (!result.found || !result.mission || !result.jobCard) {
        return { allowed: false, blockedReasons: result.blockedReasons.length ? result.blockedReasons : ["source_job_card_not_found"], draft: null, durableDraftId: null, bodyHash: null, persisted: false };
      }
      const lead = result.mission.lanes.flatMap(lane => lane.leads).find(item => item.id === input.leadId);
      if (!lead) {
        return { allowed: false, blockedReasons: ["lead_not_found_in_mission"], draft: null, durableDraftId: null, bodyHash: null, persisted: false };
      }
      const validation = validateRealVendorFacts(input.vendorFacts, lead);
      if (!validation.valid) {
        return { allowed: false, blockedReasons: validation.reasons, draft: null, durableDraftId: null, bodyHash: null, persisted: false };
      }
      const draft = buildCastingSprintOutreachDraft({ jobCard: result.jobCard, lead, vendorFacts: input.vendorFacts });
      if (!draft.safeToCopy) {
        return { allowed: false, blockedReasons: ["draft_failed_truth_lint"], draft: null, durableDraftId: null, bodyHash: null, persisted: false };
      }
      const bodyHash = bodyHashFor(draft.body);
      let durableDraftId: string | null = null;
      let persisted = false;
      try {
        const store = resolveContactAttemptStore(injectedStore);
        const durableDraft: DurableDraft = await store.createDraft({
          tenantId: ctx.tenantId,
          sourceKey: input.sourceKey,
          candidateId: input.candidateId ?? null,
          leadId: lead.id,
          lane: lead.lane,
          channel: input.channel ?? "email",
          subjectRendered: draft.subject,
          bodyRendered: draft.body,
          bodyHash,
          templateKey: draft.templateKey,
          founderEscalationPresent: draft.founderEscalationIncluded,
          forbiddenClaimsScanJson: { forbiddenClaimsDetected: draft.forbiddenClaimsDetected, blockingLintRules: draft.blockingLintRules },
          createdBy: ctx.user?.id != null ? String(ctx.user.id) : "admin",
        });
        durableDraftId = durableDraft.id;
        persisted = true;
      } catch {
        // HELD persisted the draft locally even if the durable write failed; the in-memory draft remains usable.
        durableDraftId = null;
        persisted = false;
      }
      return { allowed: true, blockedReasons: [], draft, durableDraftId, bodyHash, persisted };
    }),

  /**
   * Validates and builds a createCandidate-compatible payload only; it never
   * calls createCandidate itself, so this mutation alone never writes to
   * vendor_sourcing_candidates. The actual real-candidate write happens when
   * the admin UI separately calls firstRealProposalBootstrap.createCandidate
   * with this payload, as an explicit, distinct admin action.
   */
  candidateCreationPayload: adminProcedure
    .input(z.object({ sourceKey: z.string().min(3).max(191), leadId: z.string().min(1).max(191), vendorFacts: vendorFactsInput }))
    .mutation(async ({ ctx, input }): Promise<CandidateCreationPayloadResponse> => {
      const result = await resolveMission({ tenantId: ctx.tenantId, sourceKey: input.sourceKey });
      if (!result.found || !result.mission || !result.jobCard) {
        return { allowed: false, blockedReasons: result.blockedReasons.length ? result.blockedReasons : ["source_job_card_not_found"], payload: null };
      }
      const lead = result.mission.lanes.flatMap(lane => lane.leads).find(item => item.id === input.leadId);
      if (!lead) {
        return { allowed: false, blockedReasons: ["lead_not_found_in_mission"], payload: null };
      }
      const decision = buildRealCandidateCreationPayload({ jobCard: result.jobCard, lead, vendorFacts: input.vendorFacts, tenantId: ctx.tenantId });
      if (!decision.allowed) {
        return { allowed: false, blockedReasons: decision.reasons, payload: null };
      }
      return { allowed: true, blockedReasons: [], payload: decision.payload };
    }),

  /**
   * Builds a real-facts draft, then runs it through the no-op send gate and
   * a no-op provider adapter only. No adapter here makes a real network
   * call or invokes a live provider; liveProviderInvoked is always false.
   */
  runContactAttempt: adminProcedure
    .input(z.object({
      sourceKey: z.string().min(3).max(191),
      leadId: z.string().min(1).max(191),
      candidateId: z.string().min(1).max(191).nullable().optional(),
      durableDraftId: z.string().min(1).max(191).nullable().optional(),
      channel: z.enum(CONTACT_CHANNELS),
      automationMode: z.enum(AUTOMATION_MODES).default("noop_provider"),
      vendorFacts: vendorFactsInput,
    }))
    .mutation(async ({ ctx, input }): Promise<
      | {
          allowed: true; blockedReasons: []; attempt: ContactAttempt; providerResult: NoopProviderResult;
          durableAttemptId: string | null; durableDraftId: string | null; statusHistory: StatusHistoryEntry[];
          persisted: boolean; auditFeedSummary: AuditFeedAttemptSummary | null;
        }
      | {
          allowed: false; blockedReasons: string[]; attempt: ContactAttempt | null; providerResult: null;
          durableAttemptId: string | null; durableDraftId: string | null; statusHistory: StatusHistoryEntry[]; persisted: boolean; auditFeedSummary: AuditFeedAttemptSummary | null;
        }
    > => {
      const result = await resolveMission({ tenantId: ctx.tenantId, sourceKey: input.sourceKey });
      if (!result.found || !result.mission || !result.jobCard) {
        return { allowed: false, blockedReasons: result.blockedReasons.length ? result.blockedReasons : ["source_job_card_not_found"], attempt: null, providerResult: null, durableAttemptId: null, durableDraftId: null, statusHistory: [], persisted: false, auditFeedSummary: null };
      }
      const lead = result.mission.lanes.flatMap(lane => lane.leads).find(item => item.id === input.leadId);
      if (!lead) {
        return { allowed: false, blockedReasons: ["lead_not_found_in_mission"], attempt: null, providerResult: null, durableAttemptId: null, durableDraftId: null, statusHistory: [], persisted: false, auditFeedSummary: null };
      }
      const validation = validateRealVendorFacts(input.vendorFacts, lead);
      if (!validation.valid) {
        return { allowed: false, blockedReasons: validation.reasons, attempt: null, providerResult: null, durableAttemptId: null, durableDraftId: null, statusHistory: [], persisted: false, auditFeedSummary: null };
      }
      const draft = buildCastingSprintOutreachDraft({ jobCard: result.jobCard, lead, vendorFacts: input.vendorFacts });
      const recipientTarget = input.vendorFacts.phone || input.vendorFacts.email || input.vendorFacts.website || "";

      if (input.automationMode === "gated_provider_future") {
        const liveGate = evaluateLiveSendGate({
          sourceKey: input.sourceKey,
          category: result.mission.sourceJobCard.category,
          recipient: recipientTarget || null,
          durableDraftId: input.durableDraftId ?? null,
          durableAttemptId: null,
          idempotencyKey: null,
          sendGatePassed: draft.safeToCopy,
          founderEscalationPresent: draft.founderEscalationIncluded,
          forbiddenClaimsDetected: draft.forbiddenClaimsDetected,
        });
        const blockedAttempt = buildContactAttempt({
          sourceKey: input.sourceKey,
          candidateId: input.candidateId ?? null,
          leadId: lead.id,
          lane: lead.lane,
          channel: input.channel,
          draft,
          recipientTarget,
          automationMode: "gated_provider_future",
        });
        const finalBlockedAttempt = { ...blockedAttempt, status: "blocked" as const };
        const statusHistory: StatusHistoryEntry[] = [
          { status: "draft_ready", at: blockedAttempt.createdAt, actor: "HELD" },
          { status: "blocked", at: new Date().toISOString(), actor: "HELD" },
        ];
        let durableAttemptId: string | null = null;
        let durableDraftId: string | null = input.durableDraftId ?? null;
        let persisted = false;
        let auditFeedSummary: AuditFeedAttemptSummary | null = null;
        try {
          const store = resolveContactAttemptStore(injectedStore);
          const { attempt: durableAttempt } = await store.createOrReuseAttempt({
            tenantId: ctx.tenantId,
            outreachDraftId: durableDraftId,
            sourceKey: input.sourceKey,
            candidateId: input.candidateId ?? null,
            leadId: lead.id,
            lane: lead.lane,
            channel: input.channel,
            recipientSnapshot: recipientTarget,
            draftSubject: draft.subject,
            draftBodySnapshot: draft.body,
            draftBodyHash: bodyHashFor(draft.body),
            templateKey: draft.templateKey,
            founderEscalationPresent: draft.founderEscalationIncluded,
            forbiddenClaimsScanJson: { forbiddenClaimsDetected: draft.forbiddenClaimsDetected, blockingLintRules: draft.blockingLintRules },
            sendGateResultJson: liveGate,
            automationMode: "gated_provider_future",
            providerAdapter: PROVIDER_ADAPTER_BY_CHANNEL[input.channel],
            providerAttemptId: null,
            status: "blocked",
            statusHistoryJson: statusHistory,
            createdBy: ctx.user?.id != null ? String(ctx.user.id) : "admin",
          });
          durableAttemptId = durableAttempt.id;
          durableDraftId = durableAttempt.outreachDraftId;
          persisted = true;
          auditFeedSummary = toAuditFeedSummary(durableAttempt);
        } catch {
          durableAttemptId = null;
          persisted = false;
        }
        return {
          allowed: false,
          blockedReasons: liveGate.reasons,
          attempt: finalBlockedAttempt,
          providerResult: null,
          durableAttemptId,
          durableDraftId,
          statusHistory,
          persisted,
          auditFeedSummary,
        };
      }

      const builtAttempt = buildContactAttempt({
        sourceKey: input.sourceKey,
        candidateId: input.candidateId ?? null,
        leadId: lead.id,
        lane: lead.lane,
        channel: input.channel,
        draft,
        recipientTarget,
      });
      const { attempt: ranAttempt, providerResult, blockedReasons } = runNoopContactAttempt(builtAttempt);
      if (blockedReasons.length > 0 || !providerResult) {
        return { allowed: false, blockedReasons, attempt: ranAttempt, providerResult: null, durableAttemptId: null, durableDraftId: null, statusHistory: [], persisted: false, auditFeedSummary: null };
      }

      const sendGateResultJson = { allowed: blockedReasons.length === 0, reasons: blockedReasons };
      const createdAt = ranAttempt.createdAt;
      const statusHistory: StatusHistoryEntry[] = [
        { status: "draft_ready", at: createdAt, actor: "HELD" },
        { status: ranAttempt.status, at: new Date().toISOString(), actor: "HELD" },
      ];
      let durableAttemptId: string | null = null;
      let durableDraftId: string | null = input.durableDraftId ?? null;
      let persisted = false;
      let auditFeedSummary: AuditFeedAttemptSummary | null = null;
      try {
        const store = resolveContactAttemptStore(injectedStore);
        const { attempt: durableAttempt } = await store.createOrReuseAttempt({
          tenantId: ctx.tenantId,
          outreachDraftId: durableDraftId,
          sourceKey: input.sourceKey,
          candidateId: input.candidateId ?? null,
          leadId: lead.id,
          lane: lead.lane,
          channel: input.channel,
          recipientSnapshot: recipientTarget,
          draftSubject: draft.subject,
          draftBodySnapshot: draft.body,
          draftBodyHash: bodyHashFor(draft.body),
          templateKey: draft.templateKey,
          founderEscalationPresent: draft.founderEscalationIncluded,
          forbiddenClaimsScanJson: { forbiddenClaimsDetected: draft.forbiddenClaimsDetected, blockingLintRules: draft.blockingLintRules },
          sendGateResultJson,
          automationMode: "noop_provider",
          providerAdapter: PROVIDER_ADAPTER_BY_CHANNEL[input.channel],
          providerAttemptId: providerResult.attemptId,
          status: ranAttempt.status,
          statusHistoryJson: statusHistory,
          createdBy: ctx.user?.id != null ? String(ctx.user.id) : "admin",
        });
        durableAttemptId = durableAttempt.id;
        durableDraftId = durableAttempt.outreachDraftId;
        persisted = true;
        auditFeedSummary = toAuditFeedSummary(durableAttempt);
      } catch {
        durableAttemptId = null;
        persisted = false;
      }

      return { allowed: true, blockedReasons: [], attempt: ranAttempt, providerResult, durableAttemptId, durableDraftId, statusHistory, persisted, auditFeedSummary };
    }),

  /**
   * The only place in this router that can ever invoke a real outbound
   * provider. Every precondition is re-evaluated here (allowlists, canary
   * flag, env presence, send gate, founder escalation, forbidden claims,
   * recipient validity) and the admin must type the exact confirmation
   * phrase; if any check fails, AgentMail is never called. On success it
   * calls sendVendorEmailViaAgentMail() exactly once and persists the
   * outcome via recordLiveSendResult(), which never writes
   * provider_accepted/booking_confirmed/payment_authorized/dispatched.
   */
  runSupervisedAgentMailCanary: adminProcedure
    .input(z.object({
      sourceKey: z.string().min(3).max(191),
      durableDraftId: z.string().min(1).max(191),
      durableAttemptId: z.string().min(1).max(191).nullable().optional(),
      candidateId: z.string().min(1).max(191).nullable().optional(),
      leadId: z.string().min(1).max(191).nullable().optional(),
      channel: z.literal("email"),
      recipientEmail: z.string().min(3).max(320),
      adminConfirmationText: z.string().min(1).max(64),
    }))
    .mutation(async ({ ctx, input }): Promise<{
      allowed: boolean;
      blockedReasons: string[];
      durableAttemptId: string | null;
      sendResult: AgentMailSendResult | null;
      statusHistory: StatusHistoryEntry[];
      persisted: boolean;
    }> => {
      const result = await resolveMission({ tenantId: ctx.tenantId, sourceKey: input.sourceKey });
      if (!result.found || !result.mission || !result.jobCard) {
        return { allowed: false, blockedReasons: result.blockedReasons.length ? result.blockedReasons : ["source_job_card_not_found"], durableAttemptId: null, sendResult: null, statusHistory: [], persisted: false };
      }
      const store = resolveContactAttemptStore(injectedStore);
      const draft = await store.getDraftById(ctx.tenantId, input.durableDraftId);
      if (!draft) {
        return { allowed: false, blockedReasons: ["durable_draft_not_found"], durableAttemptId: null, sendResult: null, statusHistory: [], persisted: false };
      }

      const forbiddenClaimsDetected = (draft.forbiddenClaimsScanJson as { forbiddenClaimsDetected?: string[] } | null)?.forbiddenClaimsDetected ?? [];
      const sendGatePassed = draft.founderEscalationPresent && forbiddenClaimsDetected.length === 0;
      const category = result.mission.sourceJobCard.category;
      const idempotencyKey = computeIdempotencyKey({
        sourceKey: input.sourceKey,
        candidateId: input.candidateId ?? null,
        leadId: input.leadId ?? null,
        channel: "email",
        draftBodyHash: draft.bodyHash,
        automationMode: "gated_provider_future",
      });

      const liveGate = evaluateAgentMailLiveSendGate({
        sourceKey: input.sourceKey,
        category,
        recipientEmail: input.recipientEmail,
        durableDraftId: input.durableDraftId,
        durableAttemptId: input.durableAttemptId ?? null,
        idempotencyKey,
        sendGatePassed,
        founderEscalationPresent: draft.founderEscalationPresent,
        forbiddenClaimsDetected,
        adminConfirmationText: input.adminConfirmationText,
      });

      let attemptId: string | null = input.durableAttemptId ?? null;
      let statusHistory: StatusHistoryEntry[] = [];
      let persisted = false;

      let alreadySentForThisIdempotencyKey = false;

      if (!attemptId) {
        try {
          const { attempt, reused } = await store.createOrReuseAttempt({
            tenantId: ctx.tenantId,
            outreachDraftId: input.durableDraftId,
            sourceKey: input.sourceKey,
            candidateId: input.candidateId ?? null,
            leadId: input.leadId ?? null,
            lane: null,
            channel: "email",
            recipientSnapshot: input.recipientEmail,
            draftSubject: draft.subjectRendered,
            draftBodySnapshot: draft.bodyRendered,
            draftBodyHash: draft.bodyHash,
            templateKey: draft.templateKey,
            founderEscalationPresent: draft.founderEscalationPresent,
            forbiddenClaimsScanJson: draft.forbiddenClaimsScanJson,
            sendGateResultJson: liveGate,
            automationMode: "gated_provider_future",
            providerAdapter: "agentmail",
            providerAttemptId: null,
            status: "gate_passed",
            statusHistoryJson: [{ status: "draft_ready", at: draft.createdAt.toISOString(), actor: "HELD" }],
            createdBy: ctx.user?.id != null ? String(ctx.user.id) : "admin",
          });
          attemptId = attempt.id;
          statusHistory = attempt.statusHistoryJson;
          persisted = true;
          // Same idempotency key already produced a real send: never call AgentMail a second time.
          if (reused && attempt.outreachSentByHeld) alreadySentForThisIdempotencyKey = true;
        } catch {
          attemptId = null;
          persisted = false;
        }
      }

      if (alreadySentForThisIdempotencyKey) {
        return { allowed: false, blockedReasons: ["duplicate_idempotency_attempt_already_sent"], durableAttemptId: attemptId, sendResult: null, statusHistory, persisted };
      }

      if (!liveGate.allowed) {
        if (attemptId) {
          try {
            const updated = await store.recordLiveSendResult({
              tenantId: ctx.tenantId,
              attemptId,
              providerAdapter: "agentmail",
              providerAttemptId: null,
              liveProviderInvoked: false,
              outreachSentByHeld: false,
              nextStatus: "blocked",
              actor: "admin",
            });
            statusHistory = updated.statusHistoryJson;
            persisted = true;
          } catch {
            persisted = false;
          }
        }
        return { allowed: false, blockedReasons: liveGate.reasons, durableAttemptId: attemptId, sendResult: null, statusHistory, persisted };
      }

      const labels = buildAgentMailLabels({ sourceKey: input.sourceKey, category: category ?? "uncategorized" });
      const sendResult = await sendVendorEmailViaAgentMail({
        inboxId: process.env.AGENTMAIL_VENDOR_INBOX_ID ?? "",
        inboxEmail: process.env.AGENTMAIL_VENDOR_INBOX_EMAIL ?? "",
        recipientEmail: input.recipientEmail,
        subject: draft.subjectRendered ?? "Availability check",
        textBody: draft.bodyRendered,
        labels,
      });

      if (attemptId) {
        try {
          const updated = await store.recordLiveSendResult({
            tenantId: ctx.tenantId,
            attemptId,
            providerAdapter: "agentmail",
            providerAttemptId: sendResult.providerAttemptId,
            liveProviderInvoked: sendResult.liveProviderInvoked,
            outreachSentByHeld: sendResult.status === "sent",
            nextStatus: sendResult.status === "sent" ? "response_pending" : "blocked",
            actor: "admin",
          });
          statusHistory = updated.statusHistoryJson;
          persisted = true;
        } catch {
          persisted = false;
        }
      }

      return {
        allowed: sendResult.status === "sent",
        blockedReasons: sendResult.status === "sent" ? [] : [sendResult.errorReason ?? "agentmail_send_rejected"],
        durableAttemptId: attemptId,
        sendResult,
        statusHistory,
        persisted,
      };
    }),

  /**
   * Local/admin test intake only: simulates a future inbound webhook/email/
   * SMS/voice/form reply instead of requiring Adam to manually report what a
   * vendor said. inboundProvider is always noop_test. Performs no real
   * inbound channel listening and no production write.
   */
  simulateVendorReply: adminProcedure
    .input(z.object({
      sourceKey: z.string().min(3).max(191),
      attemptId: z.string().min(1).max(191),
      durableAttemptId: z.string().min(1).max(191).nullable().optional(),
      candidateId: z.string().min(1).max(191).nullable().optional(),
      channel: z.enum(CONTACT_CHANNELS),
      rawReplyText: z.string().min(3).max(5000),
      fromAddressOrPhone: z.string().max(191).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }): Promise<{
      allowed: boolean;
      blockedReasons: string[];
      packet: VendorReplyIntakePacket | null;
      interpretedReply: InterpretedReply | null;
      termsPacket: ResponseTermsPacket | null;
      durableAttemptId: string | null;
      updatedStatus: string | null;
      statusHistory: StatusHistoryEntry[];
      persisted: boolean;
    }> => {
      const packet = buildSimulatedReplyIntakePacket({
        attemptId: input.attemptId,
        candidateId: input.candidateId ?? null,
        sourceKey: input.sourceKey,
        channel: input.channel,
        rawReplyText: input.rawReplyText,
        fromAddressOrPhone: input.fromAddressOrPhone ?? null,
      });
      const validation = validateReplyIntakePacket(packet);
      if (!validation.valid) {
        return { allowed: false, blockedReasons: validation.reasons, packet: null, interpretedReply: null, termsPacket: null, durableAttemptId: null, updatedStatus: null, statusHistory: [], persisted: false };
      }
      const interpretedReply = interpretVendorReply({ packet });
      const termsResult = buildResponseTermsPacket({
        attemptId: input.attemptId,
        candidateId: input.candidateId ?? null,
        rawReplyText: input.rawReplyText,
      });
      const termsPacket = termsResult.allowed ? termsResult.packet : null;

      let durableAttemptId: string | null = null;
      let updatedStatus: string | null = null;
      let statusHistory: StatusHistoryEntry[] = [];
      let persisted = false;
      if (input.durableAttemptId) {
        try {
          const store = resolveContactAttemptStore(injectedStore);
          const nextStatus = interpretedReply.blocked ? "blocked" : "interpreted";
          const updated = await store.recordReplyAndTerms({
            tenantId: ctx.tenantId,
            attemptId: input.durableAttemptId,
            latestReplyJson: interpretedReply,
            latestTermsPacketJson: termsPacket,
            nextStatus,
            actor: "HELD",
          });
          durableAttemptId = updated.id;
          updatedStatus = updated.status;
          statusHistory = updated.statusHistoryJson;
          persisted = true;
        } catch {
          durableAttemptId = null;
          persisted = false;
        }
      }

      return {
        allowed: true,
        blockedReasons: [],
        packet,
        interpretedReply,
        termsPacket,
        durableAttemptId,
        updatedStatus,
        statusHistory,
        persisted,
      };
    }),

    /** Tenant-scoped, admin-only audit feed: a single durable attempt by id. */
    contactAttemptById: adminProcedure
      .input(z.object({ attemptId: z.string().min(1).max(191) }))
      .query(async ({ ctx, input }): Promise<AuditFeedAttemptSummary | null> => {
        const store = resolveContactAttemptStore(injectedStore);
        const attempt = await store.getAttemptById(ctx.tenantId, input.attemptId);
        return attempt ? toAuditFeedSummary(attempt) : null;
      }),

    /** Tenant-scoped, admin-only audit feed: every durable attempt for a sourceKey. */
    contactAttemptsBySourceKey: adminProcedure
      .input(z.object({ sourceKey: z.string().min(3).max(191), limit: z.number().int().min(1).max(250).default(50) }))
      .query(async ({ ctx, input }): Promise<AuditFeedAttemptSummary[]> => {
        const store = resolveContactAttemptStore(injectedStore);
        const attempts = await store.listAttemptsBySourceKey(ctx.tenantId, input.sourceKey, input.limit);
        return attempts.map(toAuditFeedSummary);
      }),

    /** Tenant-scoped, admin-only audit feed: every durable attempt for a candidateId. */
    contactAttemptsByCandidateId: adminProcedure
      .input(z.object({ candidateId: z.string().min(1).max(191), limit: z.number().int().min(1).max(250).default(50) }))
      .query(async ({ ctx, input }): Promise<AuditFeedAttemptSummary[]> => {
        const store = resolveContactAttemptStore(injectedStore);
        const attempts = await store.listAttemptsByCandidateId(ctx.tenantId, input.candidateId, input.limit);
        return attempts.map(toAuditFeedSummary);
      }),

    /** Tenant-scoped, admin-only audit feed: most recent durable attempts across all sources. */
    recentContactAttempts: adminProcedure
      .input(z.object({ limit: z.number().int().min(1).max(250).default(50), cursor: z.string().nullable().optional() }))
      .query(async ({ ctx, input }): Promise<{ attempts: AuditFeedAttemptSummary[]; nextCursor: string | null }> => {
        const store = resolveContactAttemptStore(injectedStore);
        const page = await store.listRecentAttempts({ tenantId: ctx.tenantId, limit: input.limit, cursor: input.cursor ?? null });
        return { attempts: page.attempts.map(toAuditFeedSummary), nextCursor: page.nextCursor };
      }),
  });
}

export const vendorCastingSprintRouter = createVendorCastingSprintRouter();
