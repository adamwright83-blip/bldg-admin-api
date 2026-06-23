import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createFirstRealProposalBootstrapRouter } from "./firstRealProposalBootstrapRouter";

function context(user: { id: number; role: "admin" | "user" } | null) {
  return { user, tenantId: "default", req: {}, res: {}, vendorSession: null } as never;
}

function stores() {
  return {
    sourcing: { createCandidate: vi.fn().mockResolvedValue("candidate-1") },
    scoring: {
      scoreCandidate: vi.fn().mockResolvedValue({ decision: { allowed: true }, workflowId: "workflow-1", gateKey: "gate-1" }),
      promoteAfterOperatorApproval: vi.fn().mockResolvedValue(true),
    },
    drafting: {
      createDraft: vi.fn().mockResolvedValue({ id: "draft-1", gateId: "gate-2", sendable: false }),
      recordConversationEvent: vi.fn().mockResolvedValue({ id: "event-1", agreementAccepted: false, providerAccepted: false }),
    },
    terms: { storeResponseTerms: vi.fn().mockResolvedValue({ decision: { allowed: true } }) },
    evidence: { createSnapshot: vi.fn().mockResolvedValue({ id: "evidence-1", evidenceStatus: "usable", decision: { status: "usable" } }) },
    proposals: { markReadyForResidentPresentation: vi.fn().mockResolvedValue({ ok: true, proposalId: "proposal-1", versionId: "version-1" }) },
  };
}

describe("first real proposal bootstrap router", () => {
  it("requires admin access before exposing the runbook", async () => {
    const router = createFirstRealProposalBootstrapRouter(stores());
    await expect(router.createCaller(context(null)).runbook()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(router.createCaller(context({ id: 1, role: "user" })).runbook()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const result = await router.createCaller(context({ id: 1, role: "admin" })).runbook();
    expect(result.existingCompletePath).toBe(false);
    expect(result.migrationNeeded).toBe(false);
  });

  it("keeps assembly checklist dry-run and blocks missing real inputs", async () => {
    const router = createFirstRealProposalBootstrapRouter(stores());
    const result = await router.createCaller(context({ id: 1, role: "admin" })).assemblyChecklist({
      evidenceSnapshotIds: [],
    });
    expect(result.stateMutated).toBe(false);
    expect(result.allowedToAssemble).toBe(false);
    expect(result.missing).toContain("real_job_card_source_required");
  });

  it("delegates candidate creation to VendorSourcingStore only", async () => {
    const injected = stores();
    const router = createFirstRealProposalBootstrapRouter(injected);
    const result = await router.createCaller(context({ id: 42, role: "admin" })).createCandidate({
      id: "candidate-1",
      tenantId: "default",
      sourceType: "manual_operator_list",
      sourceReference: "Adam verified by phone",
      category: "dog_grooming",
      businessName: "Real Groomer LLC",
      phone: "555-0100",
      serviceArea: "Century Park East",
      qualificationNotes: "Operator has real public contact and believes this vendor can support dog grooming.",
    });
    expect(result.stateMutated).toBe(true);
    expect(result.sentByHeld).toBe(false);
    expect(injected.sourcing.createCandidate).toHaveBeenCalledTimes(1);
    expect(injected.scoring.scoreCandidate).not.toHaveBeenCalled();
  });

  it("refuses operator facts that claim execution truth", async () => {
    const router = createFirstRealProposalBootstrapRouter(stores());
    await expect(router.createCaller(context({ id: 1, role: "admin" })).createCandidate({
      tenantId: "default",
      sourceType: "manual_operator_list",
      sourceReference: "operator note",
      category: "dog_grooming",
      businessName: "Fake Booked Groomer",
      serviceArea: "Century Park East",
      qualificationNotes: "The dog is booked already.",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("requires explicit final approval before resident-ready marking", async () => {
    const router = createFirstRealProposalBootstrapRouter(stores());
    await expect(router.createCaller(context({ id: 1, role: "admin" })).markReadyForResidentPresentation({
      proposalId: "proposal-1",
      explicitFinalApproval: "wrong",
    } as never)).rejects.toBeTruthy();
  });

  it("does not introduce forbidden execution integrations", () => {
    const source = readFileSync("server/procurement/firstRealProposalBootstrapRouter.ts", "utf8");
    expect(source).not.toMatch(/stripe|chargeCard|getStripe|createSetupIntent|confirmCard|paymentReconciliation|providerMessageId/i);
    expect(source).not.toMatch(/sendEmail|sendSms|twilio\.messages|createDispatch|markDispatched/i);
    expect(source).not.toMatch(/anthropic|openai|chat.completions|responses.create/i);
    expect(source).not.toMatch(/INSERT\s+INTO\s+(vendors|vendorProfiles|vendorServices)/i);
  });
});
