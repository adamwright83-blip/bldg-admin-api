import { describe, expect, it, vi } from "vitest";
import {
  detectAddWorkIntent,
  detectConfirmation,
  handleVoiceCommitmentTurn,
  type PendingProposalState,
} from "./voiceCommitmentLoop";
import type { DayDirectorProposal } from "../../shared/dayDirector";

const zeelyUtterance =
  "I need to decide between Zeely dot A I and a competitor for AI generated Instagram ads for the pickup and delivery laundry service.";

const greystarStatement =
  "Three Greystar properties remain in the Colosseum mission.";

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

describe("detectAddWorkIntent — deterministic, never model-based", () => {
  it("triggers on the verbatim Zeely-versus-competitor decision request", () => {
    expect(detectAddWorkIntent(zeelyUtterance)).toBe(true);
  });

  it("does NOT trigger on an informational Greystar/Colosseum status statement (existing campaign context, not new work)", () => {
    expect(detectAddWorkIntent(greystarStatement)).toBe(false);
  });

  it("does not trigger on ordinary mission-brief conversation", () => {
    expect(detectAddWorkIntent("What do you think the objection is?")).toBe(false);
    expect(detectAddWorkIntent("Do you think the blocker is price?")).toBe(false);
  });
});

describe("detectConfirmation", () => {
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

describe("handleVoiceCommitmentTurn — the only mutation surface for a live call", () => {
  it("A — a proposal is generated from the verbatim Zeely comparison request, and nothing is persisted yet", async () => {
    const propose = vi.fn().mockResolvedValue(proposalFixture());
    const accept = vi.fn();
    const state: PendingProposalState = {};
    const result = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: zeelyUtterance, state },
      { propose, accept }
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
    expect(state.pendingProposal).toBe(proposal); // untouched, still pending
  });

  it("E — repeated Twilio webhook delivery of the same 'yes' is idempotent: the retry finds no pending proposal", async () => {
    const accept = vi.fn().mockResolvedValue({ id: "commitment-1" });
    const state: PendingProposalState = { pendingProposal: proposalFixture() };
    const first = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: "yes", state },
      { accept }
    );
    expect(first.kind).toBe("accepted");
    // Twilio redelivers the identical webhook — same conversation state object, same utterance.
    const retry = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: "yes", state },
      { accept }
    );
    expect(retry.kind).toBe("not_applicable"); // "yes" alone never triggers a fresh proposal
    expect(accept).toHaveBeenCalledTimes(1); // never called twice
  });

  it("F — existing Greystar/Colosseum work is not duplicated: an informational statement never proposes or accepts anything", async () => {
    const propose = vi.fn();
    const accept = vi.fn();
    const state: PendingProposalState = {};
    const result = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: greystarStatement, state },
      { propose, accept }
    );
    expect(result.kind).toBe("not_applicable");
    expect(propose).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
  });

  it("G — unrelated conversation cannot trigger a mutation", async () => {
    const propose = vi.fn();
    const accept = vi.fn();
    const state: PendingProposalState = {};
    const result = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: "What's my next stop?", state },
      { propose, accept }
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
});
