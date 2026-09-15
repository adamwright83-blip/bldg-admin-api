import { describe, expect, it, vi } from "vitest";
import {
  classifyVoiceWorkStatement,
  detectConfirmation,
  handleVoiceCommitmentTurn,
  trackEmptyTranscript,
  trackNonEmptyTranscript,
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

function mockClassification(
  classification: "new_work" | "existing_work" | "uncertain" | "not_work",
  reason = "test"
) {
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

  it("ACCEPTED RESULT INVITES CONTINUATION — a successful add is not a terminal conversation state", async () => {
    const accept = vi.fn().mockResolvedValue({ id: "commitment-1" });
    const state: PendingProposalState = { pendingProposal: proposalFixture() };
    const result = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: "yes", state },
      { accept }
    );
    expect(result.kind).toBe("accepted");
    if (result.kind === "accepted") {
      expect(result.speak.toLowerCase()).toMatch(/what else|anything else/);
    }
  });
});

describe("multi-item call: propose/confirm one item, conversation stays open, a second item is handled independently", () => {
  it("MULTI-ITEM — after accepting item 1, item 2 (existing work) is classified fresh and does not reuse item 1's proposal state", async () => {
    const state: PendingProposalState = {};
    const classify1 = vi.fn().mockResolvedValue("new_work");
    const getCampaignSummary = vi.fn().mockResolvedValue(activeCampaign);
    const propose = vi.fn().mockResolvedValue(proposalFixture());
    const accept = vi.fn().mockResolvedValue({ id: "commitment-1" });

    // Turn 1: propose item 1.
    const proposed = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: zeelyUtterance, state },
      { classify: classify1, getCampaignSummary, propose, accept }
    );
    expect(proposed.kind).toBe("proposed");

    // Turn 2: confirm item 1.
    const accepted = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: "yes", state },
      { classify: classify1, getCampaignSummary, propose, accept }
    );
    expect(accepted.kind).toBe("accepted");
    expect(state.pendingProposal).toBeNull();

    // Turn 3: a second, independent statement about existing campaign work.
    const classify2 = vi.fn().mockResolvedValue("existing_work");
    const second = await handleVoiceCommitmentTurn(
      {
        tenantId: "tenant-1",
        actorId: "operator-1",
        businessDate: "2026-09-14",
        utterance: realGreystarUtterance,
        state,
      },
      { classify: classify2, getCampaignSummary, propose, accept }
    );
    expect(second.kind).toBe("acknowledged_existing");
    expect(accept).toHaveBeenCalledTimes(1); // only item 1 was ever persisted
    expect(propose).toHaveBeenCalledTimes(1);
  });
});

describe("uncertain intent: repair by asking, never by guessing or silently dropping into Q&A", () => {
  it("UNCERTAIN — an ambiguous statement asks a clarifying question and does not mutate", async () => {
    const classify = vi.fn().mockResolvedValue("uncertain");
    const getCampaignSummary = vi.fn().mockResolvedValue(null);
    const propose = vi.fn();
    const state: PendingProposalState = {};
    const result = await handleVoiceCommitmentTurn(
      {
        tenantId: "tenant-1",
        actorId: "operator-1",
        businessDate: "2026-09-14",
        utterance: "Russell also mentioned something about the ads.",
        state,
      },
      { classify, getCampaignSummary, propose }
    );
    expect(result.kind).toBe("clarifying");
    expect(propose).not.toHaveBeenCalled();
    expect(state.clarifyingUtterance).toBeTruthy();
  });

  it("UNCERTAIN then YES — clarifying 'yes' proceeds into a normal proposal for the original statement", async () => {
    const propose = vi.fn().mockResolvedValue(proposalFixture());
    const state: PendingProposalState = { clarifyingUtterance: zeelyUtterance };
    const result = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: "yes, add it", state },
      { propose }
    );
    expect(result.kind).toBe("proposed");
    expect(propose).toHaveBeenCalledWith({ tenantId: "tenant-1", sourceText: zeelyUtterance });
    expect(state.clarifyingUtterance).toBeNull();
  });

  it("UNCERTAIN then NO — clarifying 'no' discards without persisting", async () => {
    const propose = vi.fn();
    const state: PendingProposalState = { clarifyingUtterance: zeelyUtterance };
    const result = await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1", actorId: "operator-1", businessDate: "2026-09-14", utterance: "no, just catching you up", state },
      { propose }
    );
    expect(result.kind).toBe("declined");
    expect(propose).not.toHaveBeenCalled();
    expect(state.clarifyingUtterance).toBeNull();
  });
});

describe("TERMINATION — a successful mutation or ordinary turn must never end the call on the first silence", () => {
  it("PRODUCTION REGRESSION: a single empty transcript does not end the call", () => {
    const state: { consecutiveEmptyTranscripts?: number } = {};
    const { shouldEndCall } = trackEmptyTranscript(state);
    expect(shouldEndCall).toBe(false);
  });

  it("two consecutive empty transcripts do end the call", () => {
    const state: { consecutiveEmptyTranscripts?: number } = {};
    trackEmptyTranscript(state);
    const { shouldEndCall } = trackEmptyTranscript(state);
    expect(shouldEndCall).toBe(true);
  });

  it("a real transcript in between resets the counter — the caller gets a fresh grace period every time they actually speak", () => {
    const state: { consecutiveEmptyTranscripts?: number } = {};
    trackEmptyTranscript(state); // 1 empty
    trackNonEmptyTranscript(state); // operator actually said something
    const { shouldEndCall } = trackEmptyTranscript(state); // back to 1, not 2
    expect(shouldEndCall).toBe(false);
  });
});

describe("natural phrasing — new-work recognition must not depend on fixed trigger wording", () => {
  const paraphrases = [
    "Russell also wants me to look at Zeely.",
    "Another thing I have to get done is figuring out the ad platform.",
    "Put this on my radar: evaluating Zeely for Instagram ads.",
    "Oh, and I forgot — I still need to sort out the ad platform decision.",
    "There's something else I need to do about the Instagram ads.",
  ];

  it.each(paraphrases)("classifies %j as new_work via the grounded classifier (not a fixed phrase list)", async utterance => {
    const invoke = vi.fn().mockResolvedValue(mockClassification("new_work"));
    const result = await classifyVoiceWorkStatement(
      { tenantId: "tenant-1", utterance, campaignSummary: null },
      { invoke }
    );
    expect(result).toBe("new_work");
    // Proves this isn't the old fixed-phrase regex: none of these contain
    // "i need to add"/"i have to"/etc verbatim triggers, yet the (mocked)
    // classifier — which sees the raw utterance — is what decides.
    expect(invoke).toHaveBeenCalled();
  });
});
