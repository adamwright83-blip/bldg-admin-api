import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRAIN_V2_PRODUCTION_AUTHORITY } from "../contracts";
import { admitBusinessEvidence } from "../businessMemory/adapter";
import type { EvidenceItem } from "../contracts/evidence";
import { assertGovernedDecision, ExecutiveGovernorError } from "../executive/governor";
import { decideTurn } from "../executive/decide";
import { mintActionGrant } from "../executive/grants";
import { EXECUTIVE_ACTION_GRANT_BRAND } from "../contracts/grants";
import { ActionGatewayError, executeGrantedAction } from "../actions/gateway";
import { assertRendererDidNotInventFacts, renderResponsePlan } from "../response/render";
import { perceiveTurn } from "../perception/perceive";
import { snapshotWorkingMemory } from "../workingMemory/snapshot";
import { runClaireBrainTurn } from "../shadow/runClaireBrainTurn";
import type { ExecutiveDecision } from "../contracts/executiveDecision";
import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { WorkingMemorySnapshot } from "../contracts/workingMemory";
import type { AttentionPlan } from "../contracts/attention";

const CTX = { conversationKey: "claire-call:test", tenantId: "default", operatorUserId: "adam-admin", surface: "voice" as const };

function emptyMemory(): WorkingMemorySnapshot {
  return snapshotWorkingMemory({}, CTX);
}

function sampleEvidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: "ev-1",
    type: "business_query",
    source: "businessQuery",
    provenance: { reader: "businessQuery" },
    observedAt: "2026-09-20T00:00:00.000Z",
    asOf: "2026-09-20T00:00:00.000Z",
    freshness: null,
    coverage: { complete: true, gaps: [] },
    authoritativeFor: ["current_business_truth"],
    payload: { amount: 1200 },
    operatorVisible: true,
    ...overrides,
  };
}

describe("Brain V2 production isolation", () => {
  it("has no production authority flag", () => {
    expect(BRAIN_V2_PRODUCTION_AUTHORITY).toBe(false);
  });

  /**
   * Stage C deliberately adds one guarded production entrypoint. Transport may import
   * that orchestrator plus the permanent one-way shadow observer/snapshot boundary,
   * but it still may not reach Executive internals or mint grants itself.
   */
  it("Twilio and the desk router import only the guarded live orchestrator plus shadow boundary", () => {
    const twilio = readFileSync(path.join(process.cwd(), "server/claire/claireTwilio.ts"), "utf8");
    const router = readFileSync(path.join(process.cwd(), "server/claire/claireRouter.ts"), "utf8");

    for (const source of [twilio, router]) {
      const brainImports = source.match(/from "\.\/brain\/[^"]+"/g) ?? [];
      expect(brainImports.sort()).toEqual([
        'from "./brain/live/runClaireBrainV2LiveTurn"',
        'from "./brain/shadow/observeShadowTurn"',
        'from "./brain/shadow/v1Snapshot"',
      ]);
      expect(source).not.toMatch(/from "\.\/brain\/executive\//);
      expect(source).not.toMatch(/from "\.\/brain\/contracts\/grants"/);
      expect(source).not.toMatch(/mintActionGrant|assertGovernedDecision/);
    }
  });

  it("no production file outside the transport surfaces imports the brain at all", () => {
    const offenders = execSync(
      "grep -rln 'claire/brain\\|\\./brain/' server client --include=*.ts --include=*.tsx || true",
      { encoding: "utf8" }
    )
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .filter(line => !line.startsWith("server/claire/brain/"))
      .filter(line => line !== "server/claire/claireTwilio.ts" && line !== "server/claire/claireRouter.ts");
    expect(offenders).toEqual([]);
  });

  it("runClaireBrainTurn never returns mutations or live authority", async () => {
    const result = await runClaireBrainTurn({
      rawText: "I need to call Dana Tuesday.",
      ...CTX,
    });
    expect(result.productionAuthority).toBe(false);
    expect(result.mutations).toEqual([]);
    expect(result.decision.productionAuthority).toBe(false);
    expect(result.decision.actionGrants.every(grant => grant.constraints.shadowOnly && !grant.constraints.mutationAllowed)).toBe(true);
  });
});

describe("authority bypasses fail", () => {
  it("action gateway rejects an unbranded grant-shaped object", async () => {
    const fake = {
      actionClass: "commit_day_line",
      scope: {},
      authorityBasis: "current_turn_explicit_request",
      sourceTurnAssembledText: "add it",
      expiresAtMs: Date.now() + 1000,
      constraints: { mutationAllowed: true, shadowOnly: false },
    };
    await expect(executeGrantedAction(fake)).rejects.toBeInstanceOf(ActionGatewayError);
  });

  it("a branded live grant still cannot mutate without an injected production executor", async () => {
    const grant = mintActionGrant({
      actionClass: "commit_day_line",
      scope: {},
      authorityBasis: "current_turn_explicit_request",
      sourceTurnAssembledText: "add it",
      expiresAtMs: Date.now() + 1000,
      constraints: { mutationAllowed: true, shadowOnly: false },
    });
    await expect(executeGrantedAction(grant)).rejects.toThrow(
      /requires an injected production executor/
    );
  });

  it("governor rejects a grant object missing the brand", () => {
    const perceived = perceiveTurn({ rawText: "Add a follow-up.", completeness: "complete" });
    const attention: AttentionPlan = {
      lanes: ["action"],
      retrieve: ["workingMemory"],
      doNotRetrieve: [],
      boardEligible: false,
      pendingDisposition: "none",
      priorClaim: "none",
      continueOrderedQuery: false,
      rationale: [],
    };
    const fakeGrant = {
      actionClass: "propose_day_line",
      scope: {},
      authorityBasis: "current_turn_explicit_request",
      sourceTurnAssembledText: "Add a follow-up.",
      expiresAtMs: Date.now() + 1000,
      constraints: { mutationAllowed: false, shadowOnly: true },
    } as ExecutiveDecision["actionGrants"][number];
    const segments = [{ type: "ActionProposalSegment" as const, text: "Want me to add that?", grant: fakeGrant }];
    const decision = {
      perceivedTurn: perceived,
      attention,
      retrievals: [],
      evidence: [],
      conclusions: [],
      inhibitedCandidates: [],
      responsePlan: { perceivedTurn: perceived, attention, segments },
      responseSegments: segments,
      actionGrants: [fakeGrant],
      callControl: { endCall: false as const },
      productionAuthority: false as const,
    };
    expect(() => assertGovernedDecision(decision)).toThrow(ExecutiveGovernorError);
    expect(fakeGrant[EXECUTIVE_ACTION_GRANT_BRAND]).toBeUndefined();
  });

  it("call-end without an executive grant fails the governor", () => {
    const perceived = perceiveTurn({ rawText: "I gotta go.", completeness: "complete" });
    const attention: AttentionPlan = {
      lanes: ["call_control"],
      retrieve: ["workingMemory"],
      doNotRetrieve: [],
      boardEligible: false,
      pendingDisposition: "none",
      priorClaim: "none",
      continueOrderedQuery: false,
      rationale: [],
    };
    const segments = [{ type: "CallControlSegment" as const, text: "Go.", endCall: true, grant: null }];
    const decision = {
      perceivedTurn: perceived,
      attention,
      retrievals: [],
      evidence: [],
      conclusions: [],
      inhibitedCandidates: [],
      responsePlan: { perceivedTurn: perceived, attention, segments },
      responseSegments: segments,
      actionGrants: [],
      callControl: { endCall: true as const, grant: null as never },
      productionAuthority: false as const,
    };
    expect(() => assertGovernedDecision(decision)).toThrow(/CallControlGrant/);
  });

  it("episodic memory cannot be admitted as current business truth", () => {
    const perceived = perceiveTurn({ rawText: "What happened with Dana?", completeness: "complete" });
    const attention: AttentionPlan = {
      lanes: ["business"],
      retrieve: ["workingMemory", "businessMemory"],
      doNotRetrieve: [],
      boardEligible: false,
      pendingDisposition: "none",
      priorClaim: "none",
      continueOrderedQuery: false,
      rationale: [],
    };
    const evidence = [
      sampleEvidence({
        id: "hist-1",
        type: "conversation_turn",
        authoritativeFor: ["current_business_truth"],
        payload: { said: "Dana paid last week" },
      }),
    ];
    const segments = [{ type: "BusinessFactSegment" as const, text: "Dana paid last week.", evidence: [{ evidenceId: "hist-1" }], origin: "authoritative_reader" as const }];
    const decision = {
      perceivedTurn: perceived,
      attention,
      retrievals: [],
      evidence,
      conclusions: [],
      inhibitedCandidates: [],
      responsePlan: { perceivedTurn: perceived, attention, segments },
      responseSegments: segments,
      actionGrants: [],
      callControl: { endCall: false as const },
      productionAuthority: false as const,
    };
    expect(() => assertGovernedDecision(decision)).toThrow(/episodic memory cannot be current business truth/);
  });

  it("stale receipt is not enough for a correctness challenge", () => {
    const perceived = perceiveTurn({ rawText: "Are you sure?", completeness: "complete" });
    const attention: AttentionPlan = {
      lanes: ["business"],
      retrieve: ["workingMemory", "businessMemory"],
      doNotRetrieve: [],
      boardEligible: false,
      pendingDisposition: "none",
      priorClaim: "correctness",
      continueOrderedQuery: false,
      rationale: [],
    };
    const evidence = [sampleEvidence({ id: "receipt-1", type: "claim_receipt", authoritativeFor: ["provenance_receipt", "current_business_truth"] })];
    const segments = [
      {
        type: "BusinessFactSegment" as const,
        text: "Still $1,200.",
        evidence: [{ evidenceId: "receipt-1" }],
        origin: "authoritative_reader" as const,
        recheck: {
          receiptId: "receipt-1",
          resolution: "receipt_only" as const,
          outcome: "grounded_as_stated" as const,
          evidenceIds: ["receipt-1"],
        },
      },
    ];
    const decision = {
      perceivedTurn: perceived,
      attention,
      retrievals: [],
      evidence,
      conclusions: [],
      inhibitedCandidates: [],
      responsePlan: { perceivedTurn: perceived, attention, segments },
      responseSegments: segments,
      actionGrants: [],
      callControl: { endCall: false as const },
      productionAuthority: false as const,
    };
    expect(() => assertGovernedDecision(decision)).toThrow(/fresh reread/);
  });

  it("renderer cannot add an unsupported fact", () => {
    const perceived = perceiveTurn({ rawText: "Hi.", completeness: "complete" });
    const attention: AttentionPlan = {
      lanes: ["conversation"],
      retrieve: ["workingMemory"],
      doNotRetrieve: [],
      boardEligible: false,
      pendingDisposition: "none",
      priorClaim: "none",
      continueOrderedQuery: false,
      rationale: [],
    };
    const plan = {
      perceivedTurn: perceived,
      attention,
      segments: [{ type: "ConversationalSegment" as const, text: "Morning." }],
    };
    expect(renderResponsePlan(plan).speak).toBe("Morning.");
    expect(() => assertRendererDidNotInventFacts(plan, "Morning. Revenue was $4,000.")).toThrow(/not in the ResponsePlan/);
  });

  it("synthetic evidence cannot enter the operator bundle", () => {
    const admitted = admitBusinessEvidence([
      sampleEvidence({
        id: "syn-1",
        operatorVisible: true,
        provenance: { reader: "accountKnowledge", providerName: "production-verifier" },
        payload: { name: "Acme", providerName: "production-verifier" },
      }),
      sampleEvidence({
        id: "fix-1",
        operatorVisible: true,
        payload: { fixture: true, name: "Real Sounding Cafe" },
      }),
      sampleEvidence({
        id: "ok-1",
        payload: { name: "The Louise", accountType: "hotel" },
      }),
    ]);
    expect(admitted.map(item => item.id)).toEqual(["ok-1"]);
  });

  it("display names are not provenance — CODEX in a title does not hide a real row", () => {
    const admitted = admitBusinessEvidence([
      sampleEvidence({
        id: "named",
        payload: { name: "CODEX E2E SAFE TO ARCHIVE", accountType: "hotel" },
      }),
    ]);
    expect(admitted.map(item => item.id)).toEqual(["named"]);
  });

  it("narrative withholding a business answer fails the governor", () => {
    const perceived: PerceivedTurn = {
      ...perceiveTurn({ rawText: "How are sales, and do you have siblings?", completeness: "complete" }),
      personalProbe: true,
      hasBusinessQuestion: true,
    };
    const attention: AttentionPlan = {
      lanes: ["business", "personal"],
      retrieve: ["workingMemory", "businessMemory", "selfMemory"],
      doNotRetrieve: [],
      boardEligible: false,
      pendingDisposition: "none",
      priorClaim: "none",
      continueOrderedQuery: false,
      rationale: [],
    };
    const segments = [{ type: "ConversationalSegment" as const, text: "I would rather not talk about the numbers." }];
    const decision = {
      perceivedTurn: perceived,
      attention,
      retrievals: [],
      evidence: [],
      conclusions: [],
      inhibitedCandidates: [{ kind: "narrative_withholds_business" as const, detail: "rapport" }],
      responsePlan: { perceivedTurn: perceived, attention, segments },
      responseSegments: segments,
      actionGrants: [],
      callControl: { endCall: false as const },
      productionAuthority: false as const,
    };
    expect(() => assertGovernedDecision(decision)).toThrow(/must not withhold a business answer/);
  });
});

describe("perception and attention", () => {
  it("does not treat Dana Tuesday as a single name", async () => {
    const perceived = perceiveTurn({ rawText: "What should I do about Dana Tuesday?", completeness: "complete" });
    expect(perceived.temporalReferences).toContain("tuesday");
    expect(perceived.entities.some(entity => /tuesday/i.test(entity.raw) && entity.kind !== "temporal")).toBe(false);
    expect(perceived.entities.some(entity => entity.raw.toLowerCase() === "dana")).toBe(true);
    expect(perceived.businessIntent).toBe("judgment_question");
    expect(perceived.mayProposeWorkHint).toBe(false);
    const attention = (await decideTurn(perceived, emptyMemory())).attention;
    expect(attention.boardEligible).toBe(false);
    expect(attention.retrieve).not.toContain("goals");
  });

  it("operator work commitment may propose but not mutate", async () => {
    const result = await runClaireBrainTurn({ rawText: "I need to call Dana Tuesday.", ...CTX });
    expect(result.decision.actionGrants.some(grant => grant.actionClass === "propose_day_line")).toBe(true);
    expect(result.mutations).toEqual([]);
    expect(result.productionAuthority).toBe(false);
  });

  it("I'm good is an acknowledgement, not a hangup", async () => {
    const result = await runClaireBrainTurn({ rawText: "I'm good.", ...CTX });
    expect(result.decision.perceivedTurn.acknowledgement).toBe(true);
    expect(result.decision.callControl.endCall).toBe(false);
    expect(result.candidateEndCall).toBe(false);
  });

  it("I gotta go is executive call-end in the candidate only", async () => {
    const result = await runClaireBrainTurn({ rawText: "I gotta go.", ...CTX });
    expect(result.decision.callControl.endCall).toBe(true);
    expect(result.candidateEndCall).toBe(true);
    expect(result.productionAuthority).toBe(false);
  });

  it("last five sales carries cardinality 5 and is not work", () => {
    const perceived = perceiveTurn({ rawText: "What were my last five sales?", completeness: "complete" });
    expect(perceived.cardinality).toBe(5);
    expect(perceived.listRequest).toBe(true);
    expect(perceived.mayProposeWorkHint).toBe(false);
    expect(perceived.ordering).toBe("last");
  });

  it("pending No rejects; Forget that plus a query supersedes", async () => {
    const memory = snapshotWorkingMemory({ pendingBriefing: { parsed: { items: [1] }, createdAt: 1 } }, CTX);
    const no = await decideTurn(perceiveTurn({ rawText: "No.", completeness: "complete" }), memory);
    expect(no.attention.pendingDisposition).toBe("reject");
    expect(no.productionAuthority).toBe(false);

    const next = await decideTurn(
      perceiveTurn({ rawText: "Forget that. What were my last five sales?", completeness: "complete" }),
      memory
    );
    expect(next.attention.pendingDisposition).toBe("supersede");
    expect(next.attention.lanes).toContain("business");
  });

  it("No, Wednesday revises pending rather than starting a new interpretation", async () => {
    const memory = snapshotWorkingMemory({ pendingBriefing: { parsed: { items: [1] }, createdAt: 1 } }, CTX);
    const decision = await decideTurn(perceiveTurn({ rawText: "No, Wednesday.", completeness: "complete" }), memory);
    expect(decision.attention.pendingDisposition).toBe("revise");
  });

  it("a hanging pending does not reinterpret an unrelated greeting", async () => {
    const memory = snapshotWorkingMemory({ pendingBriefing: { parsed: { items: [1] }, createdAt: 1 } }, CTX);
    const decision = await decideTurn(perceiveTurn({ rawText: "Good morning.", completeness: "complete" }), memory);
    expect(decision.attention.pendingDisposition).not.toBe("confirm");
    expect(["none", "supersede"]).toContain(decision.attention.pendingDisposition);
  });
});
