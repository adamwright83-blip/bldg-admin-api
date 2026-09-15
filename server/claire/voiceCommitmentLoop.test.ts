import { describe, expect, it, vi } from "vitest";
import {
  classifyVoiceWorkStatement,
  detectConfirmation,
  handleVoiceCommitmentTurn,
  type PendingProposalState,
} from "./voiceCommitmentLoop";
import type { DayDirectorProposal } from "../../shared/dayDirector";
import type { ClaireCampaignSummary } from "./campaignAwareness";

const zeelyUtterance =
  "I need to evaluate Zeely dot A I for Instagram ads to grow our customer count.";

const realGreystarUtterance =
  "And then I have to go to three additional grey star properties, to pitch the general managers and that is part of the Gold Line. Coliseum Kingdom challenge in order to";

function proposalFixture(overrides: Partial<DayDirectorProposal> = {}): DayDirectorProposal {
  return {
    promptKey: "commitment:abc123",
    title: "Decide between Zeely and a competitor for Instagram ads",
    kind: "growth",
    quantity: null,
    sourceText: zeelyUtterance,
    prerequisites: [],
    question: null,
    intelligence: "manual_fallback",
    ...overrides,
  };
}

function mockClassification(classification: "new_work" | "existing_work" | "not_work", reason = "test") {
  return {
    choices: [{ message: { content: JSON.stringify({ classification, reason }) } }],
  };
}

const activeCampaign: ClaireCampaignSummary = { active: true, completedCount: 7, remainingCount: 3 };

describe("detectConfirmation — the actual mutation gate, still pure regex", () => {
  it("recognizes a clear yes", () => {
    expect(detectConfirmation("yes, go ahead")).toBe("yes");
    expect(detectConfirmation("Yeah do it")).toBe("yes");
  });
  it("recognizes a clear no", () => {
    expect(detectConfirmation("no, never mind")).toBe("no");
    expect(detectConfirmation("don't add that")).toBe("no");
  });
  it("treats anything else as ambiguous", () => {
    expect(detectConfirmation("what do you mean")).toBe("ambiguous");
    expect(detectConfirmation("maybe, I'm not sure")).toBe("ambiguous");
  });
});

describe("classifyVoiceWorkStatement — authoritative, not phrase-matching", () => {
  it("classifies genuinely new work as new_work using the model, grounded in real campaign state", async () => {
    const invoke = vi.fn().mockResolvedValue(mockClassification("new_work"));
    const result = await classifyVoiceWorkStatement(
      { tenantId: "tenant-1", utterance: zeelyUtterance, campaignSummary: activeCampaign },
      { invoke }
    );
    expect(result).toBe("new_work");
    const prompt = invoke.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/3 real stops remaining/);
  });

  it("PRODUCTION REGRESSION — the exact Greystar utterance that wrongly created a duplicate commitment now classifies as existing_work when campaign state confirms open work", async () => {
    const invoke = vi.fn().mockResolvedValue(mockClassification("existing_work"));
    const result = await classifyVoiceWorkStatement(
      { tenantId: "tenant-1", utterance: realGreystarUtterance, campaignSummary: activeCampaign },
      { invoke }
    );
    expect(result).toBe("existing_work");
  });

  it("fails closed to not_work when the classifier errors — never mutates on a failure", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("provider down"));
    const result = await classifyVoiceWorkStatement(
      { tenantId: "tenant-1", utterance: zeelyUtterance, campaignSummary: null },
      { invoke }
    );
    expect(result).toBe("not_work");
  });

  it("fails closed to not_work on malformed model output", async () => {
    const invoke = vi.fn().mockResolvedValue({ choices: [{ message: { content: "not json" } }] });
    const result = await classifyVoiceWorkStatement(
      { tenantId: "tenant-1", utterance: zeelyUtterance, campaignSummary: null },
      { invoke }
    );
    expect(result).toBe("not_work");
  });

  it("the clear fast-path phrasing never even calls the model", async () => {
    const invoke = vi.fn();
    const result = await classifyVoiceWorkStatement(
      { tenantId: "tenant-1", utterance: "please add a task to call the vendor", campaignSummary: null },
      { invoke }
    );
    expect(result).toBe("new_work");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("handleVoiceCommitmentTurn — the only mutation surface for a live call", () => {
  it("A — new work is classified, proposed, and nothing is persisted yet", async () => {
    const classify = vi.fn().mockResolvedValue("new_work");
    const getCampaignSummary = vi.fn().mockResolvedValue(null);
    const propose = vi.fn().mockResolvedValue(proposalFixture());
    const accept = vi.fn();
    const state: PendingProposalState = {};
    const result = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: zeelyUtterance, state },
      { classify, getCampaignSummary, propose, accept }
    );
    expect(result.kind).toBe("proposed");
    expect(propose).toHaveBeenCalledWith({ tenantId: "tenant-1", sourceText: zeelyUtterance });
    expect(accept).not.toHaveBeenCalled();
    expect(state.pendingProposal).toBeTruthy();
  });

  it("B — explicit yes persists exactly one commitment", async () => {
    const accept = vi.fn().mockResolvedValue({ id: "commitment-1" });
    const state: PendingProposalState = { pendingProposal: proposalFixture() };
    const result = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: "yes, add it", state },
      { accept }
    );
    expect(result.kind).toBe("accepted");
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      actorId: "operator-1",
      businessDate: "2026-09-14",
      proposal: expect.objectContaining({ promptKey: "commitment:abc123" }),
    });
    expect(state.pendingProposal).toBeNull();
  });

  it("C — no discards the pending proposal without persisting", async () => {
    const accept = vi.fn();
    const state: PendingProposalState = { pendingProposal: proposalFixture() };
    const result = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: "no, don't add that", state },
      { accept }
    );
    expect(result.kind).toBe("declined");
    expect(accept).not.toHaveBeenCalled();
    expect(state.pendingProposal).toBeNull();
  });

  it("D — an ambiguous reply re-asks and does not persist", async () => {
    const accept = vi.fn();
    const proposal = proposalFixture();
    const state: PendingProposalState = { pendingProposal: proposal };
    const result = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: "hmm, what do you mean", state },
      { accept }
    );
    expect(result.kind).toBe("reask");
    expect(accept).not.toHaveBeenCalled();
    expect(state.pendingProposal).toBe(proposal);
  });

  it("E — repeated Twilio webhook delivery of the same 'yes' is idempotent: the retry finds no pending proposal", async () => {
    const accept = vi.fn().mockResolvedValue({ id: "commitment-1" });
    const classify = vi.fn().mockResolvedValue("not_work");
    const getCampaignSummary = vi.fn().mockResolvedValue(null);
    const state: PendingProposalState = { pendingProposal: proposalFixture() };
    const first = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: "yes", state },
      { accept, classify, getCampaignSummary }
    );
    expect(first.kind).toBe("accepted");
    const retry = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: "yes", state },
      { accept, classify, getCampaignSummary }
    );
    expect(retry.kind).toBe("not_applicable"); // classified not_work; nothing pending
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it("F — PRODUCTION REGRESSION: existing Colosseum work (real utterance) is acknowledged, never proposed or persisted", async () => {
    const classify = vi.fn().mockResolvedValue("existing_work");
    const getCampaignSummary = vi.fn().mockResolvedValue(activeCampaign);
    const propose = vi.fn();
    const accept = vi.fn();
    const state: PendingProposalState = {};
    const result = await handleVoiceCommitmentTurn(
      {
        tenantId: "tenant-1",
        actorId: "operator-1",
        businessDate: "2026-09-14",
        utterance: realGreystarUtterance,
        state,
      },
      { classify, getCampaignSummary, propose, accept }
    );
    expect(result.kind).toBe("acknowledged_existing");
    expect(propose).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
    expect(state.pendingProposal).toBeUndefined();
  });

  it("G — unrelated conversation (not_work) cannot trigger a mutation", async () => {
    const classify = vi.fn().mockResolvedValue("not_work");
    const getCampaignSummary = vi.fn().mockResolvedValue(null);
    const propose = vi.fn();
    const accept = vi.fn();
    const state: PendingProposalState = {};
    const result = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: "What's my next stop?", state },
      { classify, getCampaignSummary, propose, accept }
    );
    expect(result.kind).toBe("not_applicable");
    expect(propose).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
  });

  it("H — authorization stays bound to the caller-supplied tenant/operator identity, never inferred from the utterance", async () => {
    const accept = vi.fn().mockResolvedValue({ id: "commitment-1" });
    const state: PendingProposalState = { pendingProposal: proposalFixture() };
    await handleVoiceCommitmentTurn(
      { tenantId: "tenant-from-token", actorId: "operator-from-token", businessDate: "2026-09-14", utterance: "yes", state },
      { accept }
    );
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-from-token", actorId: "operator-from-token" })
    );
  });

  it("HARD TRUTH RULE — a failed acceptProposal never produces an 'accepted'/saved result; the caller must not speak success", async () => {
    const accept = vi.fn().mockRejectedValue(new Error("Database not available"));
    const state: PendingProposalState = { pendingProposal: proposalFixture() };
    await expect(
      handleVoiceCommitmentTurn(
        { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: "yes", state },
        { accept }
      )
    ).rejects.toThrow("Database not available");
    expect(state.pendingProposal).toBeNull();
  });

  it("I — new-work classification calls the real campaign summary lookup so it can ground the decision", async () => {
    const classify = vi.fn().mockResolvedValue("new_work");
    const getCampaignSummary = vi.fn().mockResolvedValue(activeCampaign);
    const propose = vi.fn().mockResolvedValue(proposalFixture());
    const state: PendingProposalState = {};
    await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: zeelyUtterance, state },
      { classify, getCampaignSummary, propose }
    );
    expect(getCampaignSummary).toHaveBeenCalledWith({ tenantId: "tenant-1", actorId: "operator-1" });
    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", utterance: zeelyUtterance, campaignSummary: activeCampaign })
    );
  });
});
