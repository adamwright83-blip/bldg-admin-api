import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { createProcurementPool } from "./migrations";
import { VendorOutreachDraftingStore } from "./vendorOutreachDraftingStore";
import { VendorProposalVersionStore } from "./vendorProposalVersionStore";
import { VendorReputationEvidenceStore } from "./vendorReputationEvidenceStore";
import { VendorResponseTermsStore } from "./vendorResponseTermsStore";
import { VendorSourcingScoringStore } from "./vendorSourcingScoringStore";
import { VendorSourcingStore } from "./vendorSourcingStore";

const SOURCE_TYPES = ["manual_operator_list", "public_business_directory", "permitted_public_fetch"] as const;
const CONFIDENCE = ["trusted", "medium", "low", "untrusted"] as const;
const RESPONSE_KIND = ["declined", "availability", "rate_info", "general"] as const;

const jsonObject = z.record(z.string(), z.unknown()).default({});
const dateInput = z.string().datetime();

const candidateInput = z.object({
  id: z.string().min(1).max(191).optional(),
  tenantId: z.string().min(1).max(191),
  buildingSlug: z.string().max(191).nullable().optional(),
  sourceType: z.enum(SOURCE_TYPES),
  sourceReference: z.string().min(3).max(500),
  category: z.string().min(2).max(191),
  businessName: z.string().min(2).max(191),
  phone: z.string().max(80).optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  serviceArea: z.string().min(2).max(500),
  qualificationNotes: z.string().min(10).max(2000),
});

const scoringInput = z.object({
  id: z.string().min(1).max(191).optional(),
  candidateId: z.string().min(1).max(191),
  tenantId: z.string().min(1).max(191),
  categoryMatch: z.boolean().nullable(),
  geographicCoverage: z.boolean().nullable(),
  hasPublicContact: z.boolean(),
  hasPricingSignal: z.boolean(),
  hasBookingMechanism: z.boolean(),
  reviewSignal: z.enum(["positive", "neutral", "negative", "unknown"]),
  categoryFitNotes: z.string().min(3).max(1000),
  geographyFitNotes: z.string().min(3).max(1000),
  contactabilityNotes: z.string().min(3).max(1000),
  reputationNotes: z.string().min(3).max(1000),
  operatorConfidenceNotes: z.string().min(10).max(2000),
});

const promoteInput = z.object({
  candidateId: z.string().min(1).max(191),
  tenantId: z.string().min(1).max(191),
});

const draftInput = z.object({
  id: z.string().min(1).max(191).optional(),
  candidateId: z.string().min(1).max(191),
  tenantId: z.string().min(1).max(191),
  scoreId: z.string().min(1).max(191).nullable().optional(),
  templateKey: z.string().min(1).max(191).default("vendor_availability_request_v0"),
  templateVersion: z.string().min(1).max(64),
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

const manualResponseInput = z.object({
  id: z.string().min(1).max(191).optional(),
  candidateId: z.string().min(1).max(191),
  tenantId: z.string().min(1).max(191),
  outreachDraftId: z.string().min(1).max(191),
  responseKind: z.enum(RESPONSE_KIND),
  channel: z.enum(["email", "sms", "dm", "manual", "phone", "other"]),
  occurredAt: dateInput,
  exactVendorStatement: z.string().min(10).max(5000),
  available: z.boolean(),
  quotedAmount: z.number().nonnegative().nullable(),
  quotedCurrency: z.string().length(3).default("USD"),
  rateUnit: z.string().min(1).max(100).nullable(),
  availabilityWindows: z.array(z.object({
    start: dateInput,
    end: dateInput,
  })).default([]),
  constraints: jsonObject,
  requirements: z.string().max(2000).optional(),
  upfrontPaymentRequired: z.boolean().default(false),
  inquiryOnlyNotBooking: z.literal(true),
});

const responseTermsInput = z.object({
  id: z.string().min(1).max(191).optional(),
  outreachEventId: z.string().min(1).max(191),
});

const evidenceInput = z.object({
  id: z.string().min(1).max(191).optional(),
  candidateId: z.string().min(1).max(191),
  sourceType: z.enum(SOURCE_TYPES),
  sourceKey: z.string().min(2).max(191),
  sourceUrl: z.string().url().nullable().optional(),
  rating: z.number().min(0).max(5).nullable(),
  reviewCount: z.number().int().nonnegative().nullable(),
  sourceConfidence: z.enum(CONFIDENCE),
  sourceApproved: z.boolean(),
  observedAt: dateInput,
  expiresAt: dateInput,
  evidencePayload: jsonObject,
  complianceSnapshot: jsonObject,
});

const markReadyInput = z.object({
  proposalId: z.string().min(1).max(191),
  explicitFinalApproval: z.literal("MARK_READY_FOR_RESIDENT_PRESENTATION"),
});

const assembleChecklistInput = z.object({
  candidateId: z.string().min(1).max(191).optional(),
  responseTermsId: z.string().min(1).max(191).optional(),
  evidenceSnapshotIds: z.array(z.string().min(1).max(191)).default([]),
  jobCardSourceType: z.enum(["service_request", "resident_coordinated_request", "resident_agent_plan"]).optional(),
  jobCardSourceId: z.string().min(1).max(191).optional(),
});

export type FirstRealProposalBootstrapRunbook = {
  existingCompletePath: false;
  migrationNeeded: false;
  productionWriteNeededLater: true;
  dryRunOnlyByDefault: true;
  steps: Array<{ key: string; label: string; writes: string[]; forbidden: string[] }>;
  blockers: string[];
};

type BootstrapStores = {
  sourcing: Pick<VendorSourcingStore, "createCandidate">;
  scoring: Pick<VendorSourcingScoringStore, "scoreCandidate" | "promoteAfterOperatorApproval">;
  drafting: Pick<VendorOutreachDraftingStore, "createDraft" | "recordConversationEvent">;
  terms: Pick<VendorResponseTermsStore, "storeResponseTerms">;
  evidence: Pick<VendorReputationEvidenceStore, "createSnapshot">;
  proposals: Pick<VendorProposalVersionStore, "markReadyForResidentPresentation">;
};

let lazyStores: BootstrapStores | null = null;

function resolveStores(injected?: Partial<BootstrapStores>): BootstrapStores {
  if (injected) {
    return {
      sourcing: injected.sourcing!,
      scoring: injected.scoring!,
      drafting: injected.drafting!,
      terms: injected.terms!,
      evidence: injected.evidence!,
      proposals: injected.proposals!,
    };
  }
  if (!lazyStores) {
    const pool = createProcurementPool();
    lazyStores = {
      sourcing: new VendorSourcingStore(pool),
      scoring: new VendorSourcingScoringStore(pool),
      drafting: new VendorOutreachDraftingStore(pool),
      terms: new VendorResponseTermsStore(pool),
      evidence: new VendorReputationEvidenceStore(pool),
      proposals: new VendorProposalVersionStore(pool),
    };
  }
  return lazyStores;
}

function id(prefix: string, value?: string): string {
  return value?.trim() || `${prefix}_${randomUUID()}`;
}

function actor(user: { id?: unknown }): string {
  return user.id != null ? String(user.id) : "admin";
}

function runbook(): FirstRealProposalBootstrapRunbook {
  return {
    existingCompletePath: false,
    migrationNeeded: false,
    productionWriteNeededLater: true,
    dryRunOnlyByDefault: true,
    blockers: [
      "A real existing request/job card is required; this tool must not fabricate resident demand.",
      "Manual vendor outreach must happen outside HELD before response terms are recorded.",
      "Resident-ready marking requires the exact final approval phrase and an existing ready_for_admin_review proposal.",
    ],
    steps: [
      { key: "candidate", label: "Create real vendor sourcing candidate", writes: ["vendor_sourcing_candidates"], forbidden: ["legacy vendors", "vendorProfiles", "vendorServices"] },
      { key: "score", label: "Score and route to operator review", writes: ["vendor_sourcing_candidate_scores", "procurement_operator_gates", "procurement_workflows"], forbidden: ["outreach send", "booking"] },
      { key: "promote", label: "Promote only after existing operator approval gate", writes: ["vendor_sourcing_candidates", "procurement_workflows"], forbidden: ["proposal creation"] },
      { key: "draft", label: "Create internal outreach draft", writes: ["vendor_outreach_drafts", "procurement_operator_gates"], forbidden: ["send", "provider message id"] },
      { key: "manual_response", label: "Record manually obtained vendor response", writes: ["vendor_outreach_conversation_events"], forbidden: ["delivery tracking", "provider acceptance"] },
      { key: "terms", label: "Store interpreted response terms", writes: ["vendor_response_terms"], forbidden: ["booked", "paid", "dispatched"] },
      { key: "evidence", label: "Attach approved reputation evidence snapshot", writes: ["vendor_reputation_evidence_snapshots"], forbidden: ["fake reviews", "scraping"] },
      { key: "proposal", label: "Assemble proposal through existing assembler/store once real request, terms, and evidence exist", writes: ["vendor_proposals", "vendor_proposal_versions", "vendor_proposal_version_evidence"], forbidden: ["raw SQL", "resident consent"] },
      { key: "resident_ready", label: "Mark ready for resident presentation after final approval", writes: ["vendor_proposals"], forbidden: ["consent", "booking confirmation"] },
    ],
  };
}

function validateNoAutomatedForbiddenBehavior(text: string): void {
  const forbidden = /\b(booked|provider[_ ]message[_ ]id|delivery[_ ]status|dispatch(?:ed)?|captur(?:e|ed)|paid|accepted|sent[_ ]by[_ ]held)\b/i;
  if (forbidden.test(text)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Forbidden execution or truth claim detected in operator-provided facts" });
  }
}

export function createFirstRealProposalBootstrapRouter(injected?: Partial<BootstrapStores>) {
  return router({
    runbook: adminProcedure.query(() => runbook()),
    assemblyChecklist: adminProcedure.input(assembleChecklistInput).query(({ input }) => {
      const missing = [
        !input.candidateId ? "candidate_id_required" : null,
        !input.responseTermsId ? "response_terms_id_required" : null,
        input.evidenceSnapshotIds.length === 0 ? "evidence_snapshot_id_required" : null,
        !input.jobCardSourceType || !input.jobCardSourceId ? "real_job_card_source_required" : null,
      ].filter((item): item is string => item !== null);
      return {
        allowedToAssemble: missing.length === 0,
        missing,
        nextAction: missing.length
          ? "Resolve every missing real input before proposal assembly."
          : "Use the existing VendorProposalAssembler + VendorProposalVersionStore path; do not raw-insert proposal rows.",
        dryRun: true,
        stateMutated: false,
      };
    }),
    createCandidate: adminProcedure.input(candidateInput).mutation(async ({ ctx, input }) => {
      validateNoAutomatedForbiddenBehavior(`${input.businessName}\n${input.qualificationNotes}`);
      const stores = resolveStores(injected);
      const candidateId = id("candidate", input.id);
      await stores.sourcing.createCandidate({
        id: candidateId,
        tenantId: input.tenantId,
        buildingSlug: input.buildingSlug ?? null,
        sourceType: input.sourceType,
        sourceReference: input.sourceReference,
        category: input.category,
        businessName: input.businessName,
        contact: { phone: input.phone ?? null, email: input.email ?? null, website: input.website ?? null },
        publicProfile: { serviceArea: input.serviceArea },
        evidence: { qualificationNotes: input.qualificationNotes, sourceReference: input.sourceReference },
        createdBy: actor(ctx.user),
      });
      return { candidateId, stateMutated: true, sentByHeld: false, booked: false, paid: false, dispatched: false };
    }),
    scoreCandidate: adminProcedure.input(scoringInput).mutation(async ({ ctx, input }) => {
      const stores = resolveStores(injected);
      const scoreId = id("score", input.id);
      const result = await stores.scoring.scoreCandidate({
        id: scoreId,
        candidateId: input.candidateId,
        tenantId: input.tenantId,
        createdBy: actor(ctx.user),
        signals: {
          categoryMatch: input.categoryMatch,
          geographicCoverage: input.geographicCoverage,
          hasPublicContact: input.hasPublicContact,
          hasPricingSignal: input.hasPricingSignal,
          hasBookingMechanism: input.hasBookingMechanism,
          reviewSignal: input.reviewSignal,
        },
        evidence: {
          categoryFitNotes: input.categoryFitNotes,
          geographyFitNotes: input.geographyFitNotes,
          contactabilityNotes: input.contactabilityNotes,
          reputationNotes: input.reputationNotes,
          operatorConfidenceNotes: input.operatorConfidenceNotes,
        },
      });
      return { scoreId, ...result, stateMutated: true, sentByHeld: false };
    }),
    promoteCandidate: adminProcedure.input(promoteInput).mutation(async ({ input }) => {
      const stores = resolveStores(injected);
      await stores.scoring.promoteAfterOperatorApproval(input);
      return { promoted: true, stateMutated: true, sentByHeld: false };
    }),
    createOutreachDraft: adminProcedure.input(draftInput).mutation(async ({ ctx, input }) => {
      const stores = resolveStores(injected);
      const draftId = id("draft", input.id);
      const result = await stores.drafting.createDraft({
        id: draftId,
        candidateId: input.candidateId,
        tenantId: input.tenantId,
        scoreId: input.scoreId ?? null,
        templateKey: input.templateKey,
        templateVersion: input.templateVersion,
        variables: input.variables,
        createdBy: actor(ctx.user),
      });
      return { ...result, draftId, stateMutated: true, sendable: false, sentByHeld: false };
    }),
    recordManualVendorResponse: adminProcedure.input(manualResponseInput).mutation(async ({ ctx, input }) => {
      validateNoAutomatedForbiddenBehavior(`${input.exactVendorStatement}\n${JSON.stringify(input.constraints)}`);
      const stores = resolveStores(injected);
      const eventId = id("event", input.id);
      await stores.drafting.recordConversationEvent({
        id: eventId,
        candidateId: input.candidateId,
        tenantId: input.tenantId,
        outreachDraftId: input.outreachDraftId,
        direction: "inbound",
        channel: input.channel,
        occurredAt: new Date(input.occurredAt),
        summary: input.exactVendorStatement,
        rawPayload: {
          responseKind: input.responseKind,
          available: input.available,
          quotedAmount: input.quotedAmount,
          quotedCurrency: input.quotedCurrency,
          rateUnit: input.rateUnit,
          availabilityWindows: input.availabilityWindows,
          constraints: input.constraints,
          requirements: input.requirements ?? null,
          upfrontPaymentRequired: input.upfrontPaymentRequired,
          inquiryOnlyNotBooking: input.inquiryOnlyNotBooking,
          sentByHeld: false,
        },
        evidence: { operatorRecordedManualResponse: true, exactVendorStatement: input.exactVendorStatement },
        createdBy: actor(ctx.user),
      });
      return { eventId, stateMutated: true, sentByHeld: false, booked: false, accepted: false };
    }),
    storeResponseTerms: adminProcedure.input(responseTermsInput).mutation(async ({ input }) => {
      const stores = resolveStores(injected);
      const termsId = id("terms", input.id);
      const result = await stores.terms.storeResponseTerms({ id: termsId, outreachEventId: input.outreachEventId });
      return { termsId, ...result, stateMutated: true, booked: false, paid: false, dispatched: false };
    }),
    createReputationEvidence: adminProcedure.input(evidenceInput).mutation(async ({ ctx, input }) => {
      const stores = resolveStores(injected);
      const evidenceId = id("evidence", input.id);
      const result = await stores.evidence.createSnapshot({
        id: evidenceId,
        candidateId: input.candidateId,
        sourceType: input.sourceType,
        sourceKey: input.sourceKey,
        sourceUrl: input.sourceUrl ?? null,
        rating: input.rating,
        reviewCount: input.reviewCount,
        sourceConfidence: input.sourceConfidence,
        sourceApproved: input.sourceApproved,
        observedAt: new Date(input.observedAt),
        expiresAt: new Date(input.expiresAt),
        evidencePayload: input.evidencePayload,
        complianceSnapshot: input.complianceSnapshot as never,
        recordedBy: actor(ctx.user),
      });
      return { evidenceId, ...result, stateMutated: true, fakeReviewCreated: false };
    }),
    markReadyForResidentPresentation: adminProcedure.input(markReadyInput).mutation(async ({ input }) => {
      const stores = resolveStores(injected);
      const result = await stores.proposals.markReadyForResidentPresentation({ proposalId: input.proposalId });
      return { ...result, stateMutated: result.ok, consentCreated: false, booked: false, paid: false, dispatched: false };
    }),
  });
}

export const firstRealProposalBootstrapRouter = createFirstRealProposalBootstrapRouter();
