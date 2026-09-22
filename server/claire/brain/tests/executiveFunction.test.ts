/**
 * Executive task switching, mission intent, and the production-call regression.
 * Hermetic: no database, no network, no live transcript lookup.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRAIN_V2_PRODUCTION_AUTHORITY } from "../contracts";
import { decideTurn } from "../executive/decide";
import { DURABLE_WRITE_CLAIM } from "../response/cognitiveAcknowledgement";
import { assembleThought, emptyFragmentState } from "../perception/completeness";
import { perceiveTurn } from "../perception/perceive";
import { classifyWorkFrame } from "../perception/workFrame";
import { runClaireBrainTurn } from "../shadow/runClaireBrainTurn";
import { emptyShadowMemory, updateShadowMemory, type ShadowMemory } from "../shadow/shadowMemory";
import { snapshotWorkingMemory, type WorkingMemorySource } from "../workingMemory/snapshot";
import {
  EXECUTIVE_CALL_TURNS,
  STALE_PENDING_TITLE,
} from "./fixtures/executiveCallSequence";

const CTX = {
  conversationKey: "claire-call:executive",
  tenantId: "default",
  operatorUserId: "adam-admin",
  surface: "voice" as const,
};

const GENERIC_FILES = [
  "contracts/perceivedTurn.ts",
  "contracts/control.ts",
  "contracts/grants.ts",
  "contracts/workingMemory.ts",
  "contracts/responsePlan.ts",
  "contracts/executiveDecision.ts",
  "perception/workFrame.ts",
  "perception/perceive.ts",
  "perception/completeness.ts",
  "executive/workingMemoryGate.ts",
  "executive/attention.ts",
  "executive/decide.ts",
  "executive/inhibition.ts",
  "executive/grants.ts",
  "executive/dayLineAuthority.ts",
  "executive/strategicFrame.ts",
  "executive/pendingBinding.ts",
  "executive/callControl.ts",
  "shadow/shadowMemory.ts",
  "response/cognitiveAcknowledgement.ts",
];

function memory(source: WorkingMemorySource = {}) {
  return snapshotWorkingMemory(source, CTX);
}

function pending(title = "Call Dana Tuesday"): WorkingMemorySource {
  return { pendingProposal: { title } };
}

async function brain(
  rawText: string,
  source: WorkingMemorySource = {},
  completeness: "complete" | "incomplete" | "forced_flush" = "complete"
) {
  return runClaireBrainTurn({ rawText, completeness, state: source, ...CTX });
}

function slot(result: Awaited<ReturnType<typeof brain>>, name: string) {
  return result.decision.control.workingMemoryGates.find(gate => gate.slot === name);
}

function ack(result: Awaited<ReturnType<typeof brain>>, kind: string) {
  return result.decision.responsePlan.segments.find(
    segment => segment.type === "CognitiveAcknowledgementSegment" && segment.kind === kind
  );
}

describe("task switching", () => {
  it("a pending proposal plus an unrelated work topic switches and suppresses the pending item", async () => {
    const result = await brain("I have to publish the brochure today.", pending(STALE_PENDING_TITLE));
    expect(result.decision.control.change).toBe("task_switch");
    expect(slot(result, "pending_proposal")?.input).toBe("dormant");
    expect(slot(result, "pending_proposal")?.output).toBe("suppress");
    expect(result.decision.attention.pendingDisposition).not.toBe("reject");
    expect(result.decision.actionGrants).toEqual([]);
    expect(result.candidateSpeak).not.toMatch(/Ryan|say yes or no|should I add/i);
    expect(result.decision.inhibitedCandidates.some(item => item.kind === "pending_as_intent")).toBe(true);
  });

  it("dormant pending work stays in memory and is not cleared, rejected, or committed", async () => {
    const source = pending(STALE_PENDING_TITLE);
    const snapshot = memory(source);
    const result = await brain("I have to publish the brochure today.", source);
    expect(snapshot.pendingProposal?.hints).toContain(STALE_PENDING_TITLE);
    expect(slot(result, "pending_proposal")?.input).toBe("dormant");
    expect(slot(result, "pending_proposal")?.input).not.toBe("clear");
    expect(result.decision.actionGrants.some(grant => grant.actionClass === "commit_day_line")).toBe(false);
    expect(result.decision.actionGrants.some(grant => grant.actionClass === "cancel_pending")).toBe(false);
  });
});

describe("pending binding", () => {
  it("bare yes confirms and bare no rejects", async () => {
    const yes = await brain("Yes.", pending());
    expect(yes.decision.attention.pendingDisposition).toBe("confirm");
    const no = await brain("No.", pending());
    expect(no.decision.attention.pendingDisposition).toBe("reject");
    expect(slot(no, "pending_proposal")?.input).toBe("clear");
  });

  it("No, Wednesday revises pending", async () => {
    const result = await brain("No, Wednesday.", pending());
    expect(result.decision.attention.pendingDisposition).toBe("revise");
    expect(result.decision.control.change).not.toBe("task_switch");
  });

  it("a leading no plus a mission or a demand to listen does not reject pending", async () => {
    const mission = await brain(
      "No. I'm telling you that today I have a mission that I need you to be aware of.",
      pending(STALE_PENDING_TITLE)
    );
    expect(mission.decision.attention.pendingDisposition).not.toBe("reject");
    expect(mission.decision.perceivedTurn.attentionRepair).toBe("none");
    expect(mission.decision.control.change).toBe("task_switch");
    expect(slot(mission, "pending_proposal")?.input).toBe("dormant");
    expect(mission.decision.control.activeTaskSets.some(task => task.kind === "strategic_work")).toBe(true);

    const listen = await brain("No. Listen to me.", pending(STALE_PENDING_TITLE));
    expect(listen.decision.attention.pendingDisposition).not.toBe("reject");
    expect(listen.decision.perceivedTurn.attentionRepair).toBe("attention_repair");
    expect(slot(listen, "pending_proposal")?.input).toBe("dormant");
  });

  it("that's not what I'm talking about does not bind the stale item", async () => {
    const result = await brain(
      "That's not what I'm talking about. I have to publish the ad.",
      pending(STALE_PENDING_TITLE)
    );
    expect(result.decision.attention.pendingDisposition).not.toBe("reject");
    expect(result.decision.attention.pendingDisposition).not.toBe("revise");
    expect(result.decision.attention.pendingDisposition).not.toBe("confirm");
    expect(result.decision.control.change).toBe("task_switch");
    expect(slot(result, "pending_proposal")?.output).toBe("suppress");
  });
});

describe("attention repair", () => {
  it("listen to me is not a claim challenge, a correctness challenge, or verification", async () => {
    const listen = await brain("Listen to me.", {
      claimReceipts: [{ id: "r1", claireTurnOrdinal: 1, claimType: "revenue", recheck: { kind: "business_query" } }],
    });
    expect(listen.decision.perceivedTurn.attentionRepair).toBe("attention_repair");
    expect(listen.decision.perceivedTurn.businessIntent).not.toBe("correctness_challenge");
    expect(listen.decision.control.change).not.toBe("prior_claim_challenge");
    expect(listen.decision.attention.priorClaim).toBe("none");
    expect(listen.decision.control.needsVerification).toBe(false);
    expect(listen.decision.retrievals.some(request => request.kind === "prior_claim_recheck")).toBe(false);
    expect(listen.decision.actionGrants).toEqual([]);
    expect(listen.decision.inhibitedCandidates.some(item => item.kind === "attention_repair_as_claim_challenge")).toBe(
      true
    );

    const no = await brain("No. Listen to me.");
    expect(no.decision.perceivedTurn.businessIntent).not.toBe("correctness_challenge");
    expect(no.decision.control.change).not.toBe("prior_claim_challenge");
    expect(no.decision.actionGrants).toEqual([]);

    const mission = await brain("You're not listening; I'm talking about today's mission.");
    expect(mission.decision.perceivedTurn.attentionRepair).not.toBe("none");
    expect(mission.decision.control.activeTaskSets.some(task => task.kind === "strategic_work")).toBe(true);
    expect(mission.decision.attention.priorClaim).toBe("none");
  });

  it("repair variants do not become verification or grants", async () => {
    for (const rawText of ["Listen, different thing.", "I'm changing subjects.", "I'm not answering that, I'm talking about something else."]) {
      const result = await brain(rawText);
      expect(result.decision.perceivedTurn.attentionRepair).not.toBe("none");
      expect(result.decision.attention.priorClaim).toBe("none");
      expect(result.decision.actionGrants).toEqual([]);
      expect(result.decision.control.needsVerification).toBe(false);
    }
  });
});

describe("operator intent", () => {
  it("posting an ad is the operator's intention and is not an unverifiable external fact", async () => {
    const result = await brain("I have to post the Meta ad today.");
    expect(result.decision.perceivedTurn.operatorIntentAttested).toBe(true);
    expect(result.decision.attention.priorClaim).toBe("none");
    expect(result.decision.control.needsVerification).toBe(false);
    expect(result.decision.actionGrants).toEqual([]);
    expect(result.candidateSpeak).not.toMatch(/unverif/i);
    expect(result.decision.conclusions.some(item => item.kind === "operator_intent_attested")).toBe(true);
    expect(result.decision.responsePlan.segments.some(segment => segment.type === "BusinessFactSegment")).toBe(false);
  });

  it("an embedded debt does not erase the intention to go, and is not spoken as fact", async () => {
    const result = await brain("I have to go there because they owe me $10,000");
    expect(result.decision.perceivedTurn.operatorIntentAttested).toBe(true);
    expect(result.decision.perceivedTurn.embeddedExternalFact).toBe(true);
    expect(result.decision.callControl.endCall).toBe(false);
    expect(result.decision.conclusions.some(item => item.kind === "operator_intent_attested")).toBe(true);
    expect(result.decision.conclusions.some(item => item.kind === "external_fact_unverified")).toBe(true);
    expect(result.decision.responsePlan.segments.some(segment => segment.type === "BusinessFactSegment")).toBe(false);
    expect(result.candidateSpeak).not.toMatch(/10,000|10000/);
    expect(result.decision.inhibitedCandidates.some(item => item.kind === "operator_intent_as_external_fact")).toBe(
      true
    );
    expect(result.decision.control.needsVerification).toBe(false);
  });
});

describe("mission and strategic work", () => {
  it("a mission declaration opens a strategic frame and does not mint a day line", async () => {
    const result = await brain("My mission today is to publish the Meta ad.");
    expect(result.decision.control.activeTaskSets.some(task => task.kind === "strategic_work")).toBe(true);
    expect(result.decision.workingMemoryUpdate?.activeWorkFrame?.status).toBe("content_held");
    expect(result.decision.workingMemoryUpdate?.activeWorkFrame?.durability).toBe("cognitive_only");
    expect(result.decision.workingMemoryUpdate?.activeWorkFrame?.kind).toBe("publish");
    expect(JSON.stringify(result.decision.workingMemoryUpdate?.activeWorkFrame)).not.toMatch(/Meta|meta ad/);
    expect(result.decision.actionGrants).toEqual([]);
    expect(result.decision.responsePlan.segments.some(segment => segment.type === "ActionProposalSegment")).toBe(false);
    expect(ack(result, "strategic_content_understood")).toBeTruthy();
    expect(result.candidateSpeak).not.toMatch(DURABLE_WRITE_CLAIM);
    expect(result.decision.inhibitedCandidates.some(item => item.kind === "mission_as_generic_day_line")).toBe(true);
  });

  it("considered-as-mission is not generic day line semantics", async () => {
    const result = await brain("I want the Meta ad considered my mission today.");
    expect(result.decision.perceivedTurn.workDeclarationKind).toBe("strategic_work");
    expect(result.decision.actionGrants).toEqual([]);
    expect(result.decision.workingMemoryUpdate?.activeWorkFrame?.kind).toBe("unspecified");
    expect(JSON.stringify(result.decision.workingMemoryUpdate?.activeWorkFrame)).not.toMatch(/Meta/);
  });

  it("an incomplete mission frame does not invent content, and the next declaration may supply it", async () => {
    const opened = await brain("I have a mission today I need you to know about.");
    expect(opened.decision.workingMemoryUpdate?.activeWorkFrame?.status).toBe("unresolved");
    expect(opened.decision.workingMemoryUpdate?.activeWorkFrame?.kind).toBeNull();
    expect(opened.decision.actionGrants).toEqual([]);
    expect(ack(opened, "awaiting_strategic_content")).toBeTruthy();

    const shadow = updateShadowMemory(emptyShadowMemory(), opened.decision, 1);
    const filled = await brain("I have to publish the Meta ad.", { activeWorkFrame: shadow.activeWorkFrame });
    expect(filled.decision.workingMemoryUpdate?.activeWorkFrame?.status).toBe("content_held");
    expect(filled.decision.workingMemoryUpdate?.activeWorkFrame?.kind).toBe("publish");
    expect(JSON.stringify(filled.decision.workingMemoryUpdate?.activeWorkFrame)).not.toMatch(/Meta/);
    expect(filled.decision.actionGrants).toEqual([]);
  });

  it("context narration and heading home do not mint a day line", async () => {
    const home = await brain("I'm heading home.");
    expect(home.decision.perceivedTurn.workDeclarationKind).toBe("context_narration");
    expect(home.decision.actionGrants).toEqual([]);
    expect(home.decision.responsePlan.segments.some(segment => segment.type === "ActionProposalSegment")).toBe(false);

    const narrated = await brain("I need you to know I'm working on the ad today.");
    expect(narrated.decision.perceivedTurn.workDeclarationKind).toBe("context_narration");
    expect(narrated.decision.actionGrants).toEqual([]);
  });

  it("an explicit day line request still proposes, and a mission write is not invented", async () => {
    const line = await brain("Put publishing the ad on my Day Line.");
    expect(line.decision.perceivedTurn.workDeclarationKind).toBe("explicit_day_line");
    expect(line.decision.actionGrants.map(grant => grant.actionClass)).toEqual(["propose_day_line"]);
    expect(line.decision.actionGrants[0]?.constraints).toEqual({ mutationAllowed: false, shadowOnly: true });

    const mission = await brain("Make publishing the ad today's mission.");
    expect(mission.decision.perceivedTurn.explicitMissionWriteRequest).toBe(true);
    expect(mission.decision.actionGrants).toEqual([]);
    expect(mission.decision.conclusions.some(item => item.kind === "mission_write_unavailable")).toBe(true);
    expect(mission.decision.responsePlan.segments.some(segment => segment.type === "ActionProposalSegment")).toBe(false);
    expect(mission.candidateSpeak).not.toMatch(DURABLE_WRITE_CLAIM);

    const pointing = await brain("Make that today's mission.");
    expect(pointing.decision.actionGrants).toEqual([]);
    expect(pointing.decision.conclusions.some(item => item.kind === "mission_write_unavailable")).toBe(true);
  });

  it("understanding today's mission does not touch other planning authorities", async () => {
    const result = await brain("My mission today is to publish the Meta ad.");
    const segment = ack(result, "strategic_content_understood");
    expect(segment && segment.type === "CognitiveAcknowledgementSegment" && segment.durableWrite).toBe(false);
    if (segment && segment.type === "CognitiveAcknowledgementSegment") {
      expect(segment.collisionsAvoided).toEqual([
        "weekly_intent",
        "daily_command",
        "mission_director",
        "day_line_commit",
        "narrator",
        "mission_completion",
      ]);
    }
    expect(result.decision.actionGrants).toEqual([]);
    expect(result.decision.responsePlan.segments.some(item => item.type === "NarrativeRevealSegment")).toBe(false);
    expect(result.decision.responsePlan.segments.some(item => item.type === "ActionConfirmationSegment")).toBe(false);
    expect(result.decision.conclusions.some(item => /completed|locked|primary/i.test(item.detail))).toBe(false);
    expect(result.productionAuthority).toBe(false);
  });

  it("a mission frame does not overwrite unrelated business truth", async () => {
    const source: WorkingMemorySource = {
      claimReceipts: [{ id: "r1", claireTurnOrdinal: 4, claimType: "revenue", recheck: { kind: "business_query" } }],
      focusEntities: [{ mentioned: "Dana", contactName: "Dana", accountId: 77, accountName: "The Louise" }],
    };
    const before = memory(source);
    const result = await brain("My mission today is to publish the Meta ad.", source);
    const after = memory(source);
    expect(after.priorClaims).toEqual(before.priorClaims);
    expect(after.focusEntities).toEqual(before.focusEntities);
    expect(result.decision.evidence.filter(item => item.authoritativeFor.includes("current_business_truth"))).toEqual([]);
    expect(result.decision.workingMemoryUpdate?.activeWorkFrame?.durability).toBe("cognitive_only");
  });

  it("structural mission variants stay cognitive", async () => {
    const variants = [
      "I need you to know I have a mission today.",
      "My main thing today is the launch.",
      "This is today's mission.",
      "That's today's objective.",
      "I'm going to focus on the launch.",
    ];
    for (const rawText of variants) {
      const result = await brain(rawText);
      expect(result.decision.perceivedTurn.workDeclarationKind).toBe("strategic_work");
      expect(result.decision.actionGrants).toEqual([]);
      expect(result.decision.workingMemoryUpdate?.activeWorkFrame?.durability).toBe("cognitive_only");
    }
  });
});

describe("completeness and split thoughts", () => {
  it("an open desire is held, and the mission continuation completes it without the pending item intervening", async () => {
    const first = assembleThought({ incoming: "I want this Meta ad", state: emptyFragmentState() });
    expect(first.completeness).toBe("incomplete");
    const held = await brain(first.assembledText, pending(STALE_PENDING_TITLE), "incomplete");
    expect(held.decision.actionGrants).toEqual([]);
    expect(held.decision.perceivedTurn.openFragment).toBe(true);
    expect(held.decision.workingMemoryUpdate?.activeWorkFrame).toBeUndefined();
    expect(slot(held, "pending_proposal")?.input).toBe("dormant");
    expect(slot(held, "pending_proposal")?.output).toBe("suppress");
    expect(held.candidateSpeak).not.toMatch(/Ryan|Day Line|yes or no/i);

    const second = assembleThought({ incoming: "considered as my mission today.", state: first.state });
    expect(second.completeness).toBe("complete");
    expect(second.assembledText).toBe("I want this Meta ad considered as my mission today.");
    const done = await brain(second.assembledText, pending(STALE_PENDING_TITLE), "complete");
    expect(done.decision.perceivedTurn.workDeclarationKind).toBe("strategic_work");
    expect(done.decision.workingMemoryUpdate?.activeWorkFrame?.kind).toBe("unspecified");
    expect(JSON.stringify(done.decision.workingMemoryUpdate?.activeWorkFrame)).not.toMatch(/Meta/);
    expect(done.decision.actionGrants).toEqual([]);
    expect(slot(done, "pending_proposal")?.input).toBe("dormant");
    expect(slot(done, "pending_proposal")?.output).toBe("suppress");
    expect(done.candidateSpeak).not.toMatch(/Ryan|should I add|say yes or no/i);
    expect(done.candidateSpeak).not.toMatch(DURABLE_WRITE_CLAIM);
  });
});

describe("prior-claim verification stays specific", () => {
  const receipts: WorkingMemorySource = {
    claimReceipts: [{ id: "r1", claireTurnOrdinal: 2, claimType: "revenue", recheck: { kind: "business_query" } }],
  };

  it("are you sure and where did that number come from still challenge", async () => {
    const sure = await brain("Are you sure?", receipts);
    expect(sure.decision.attention.priorClaim).toBe("correctness");
    expect(sure.decision.control.change).toBe("prior_claim_challenge");
    const where = await brain("Where did that number come from?", receipts);
    expect(where.decision.attention.priorClaim).toBe("provenance");
  });

  it("intention, listening, and a subject change do not", async () => {
    for (const rawText of ["I have to post an ad.", "Listen to me.", "That's not what I'm saying."]) {
      const result = await brain(rawText, receipts);
      expect(result.decision.attention.priorClaim).toBe("none");
      expect(result.decision.control.change).not.toBe("prior_claim_challenge");
      expect(result.decision.control.needsVerification).toBe(false);
    }
  });
});

describe("multi-turn strategic memory", () => {
  it("the frame survives, stale pending stays dormant, and an explicit return reactivates it", async () => {
    let shadow: ShadowMemory = emptyShadowMemory();
    const stale = pending(STALE_PENDING_TITLE);
    const step = async (rawText: string) => {
      const result = await brain(rawText, {
        ...stale,
        activeWorkFrame: shadow.activeWorkFrame,
        orderedQuery: shadow.orderedQuery,
        focusEntities: shadow.focusEntities,
        unresolvedReferences: shadow.unresolvedReferences,
      });
      if (result.decision.perceivedTurn.completeness !== "incomplete") {
        shadow = updateShadowMemory(shadow, result.decision, 1);
      }
      return result;
    };

    const opened = await step("I have a mission today.");
    expect(opened.decision.workingMemoryUpdate?.activeWorkFrame?.status).toBe("unresolved");
    expect(slot(opened, "pending_proposal")?.input).toBe("dormant");

    const filled = await step("I have to publish the Meta ad.");
    expect(filled.decision.workingMemoryUpdate?.activeWorkFrame?.kind).toBe("publish");
    expect(slot(filled, "pending_proposal")?.output).toBe("suppress");
    expect(filled.decision.actionGrants).toEqual([]);

    const plan = await step("What do I still have to do today?");
    expect(shadow.activeWorkFrame?.kind).toBe("publish");
    expect(plan.decision.control.activeTaskSets.some(task => task.kind === "strategic_work")).toBe(false);
    expect(plan.decision.control.activeTaskSets.some(task => task.kind === "business_query" || task.kind === "broad_planning")).toBe(true);
    expect(slot(plan, "strategic_frame")?.input).toBe("dormant");
    expect(slot(plan, "strategic_frame")?.output).toBe("suppress");
    expect(ack(plan, "strategic_content_understood")).toBeUndefined();
    expect(ack(plan, "awaiting_strategic_content")).toBeUndefined();
    expect(plan.decision.actionGrants.some(grant => grant.actionClass === "commit_day_line")).toBe(false);

    const missionAgain = await step("What about the mission?");
    expect(missionAgain.decision.control.activeTaskSets.some(task => task.kind === "strategic_work")).toBe(true);
    expect(slot(missionAgain, "strategic_frame")?.output).toBe("allow");
    expect(missionAgain.decision.workingMemoryUpdate?.activeWorkFrame?.kind).toBe("publish");

    const back = await step("What about the Ryan stop?");
    expect(slot(back, "pending_proposal")?.output).toBe("allow");
    expect(back.decision.attention.pendingDisposition).not.toBe("confirm");
    expect(back.decision.attention.pendingDisposition).not.toBe("reject");
    expect(back.decision.actionGrants).toEqual([]);
    expect(shadow.activeWorkFrame?.kind).toBe("publish");
    expect(JSON.stringify(shadow.activeWorkFrame)).not.toMatch(/Meta/);
  });
});

describe("classifier and authority boundaries", () => {
  it("the work-frame kind is not an authority object and cannot mint a grant", () => {
    const grants = readFileSync(path.join(process.cwd(), "server/claire/brain/executive/grants.ts"), "utf8");
    const contract = readFileSync(path.join(process.cwd(), "server/claire/brain/contracts/grants.ts"), "utf8");
    const classifier = readFileSync(path.join(process.cwd(), "server/claire/brain/perception/workFrame.ts"), "utf8");
    expect(grants).not.toMatch(/workDeclarationKind|classifyWorkFrame|propose_daily_mission/);
    expect(contract).not.toMatch(/propose_daily_mission/);
    expect(classifier).not.toMatch(/mintActionGrant/);
    expect(grants).toMatch(/function mintActionGrant/);
  });

  it("unknown and failed classification hold, and do not mutate a mission frame", async () => {
    expect(classifyWorkFrame("mission").status).toBe("unknown");
    const dana = perceiveTurn({ rawText: "I need to call Dana Tuesday.", completeness: "complete" });
    const unknown = await decideTurn({ ...dana, classifierStatus: "unknown" }, memory());
    expect(unknown.actionGrants).toEqual([]);
    expect(unknown.conclusions.some(item => item.kind === "classification_hold")).toBe(true);
    expect(unknown.responsePlan.segments.some(segment => segment.type === "ActionProposalSegment")).toBe(false);

    const failedTurn = perceiveTurn(
      { rawText: "Make publishing the ad today's mission.", completeness: "complete" },
      {
        classifyWorkFrame() {
          throw new Error("classifier down");
        },
      }
    );
    expect(failedTurn.classifierStatus).toBe("failed");
    const existing = memory({
      activeWorkFrame: {
        durability: "cognitive_only",
        status: "content_held",
        kind: "publish",
        sourceTraceRef: "trace:claire-call:executive#1",
        openedAtMs: 1,
      },
    });
    const failed = await decideTurn(failedTurn, existing);
    expect(failed.actionGrants).toEqual([]);
    expect(failed.workingMemoryUpdate?.activeWorkFrame).toBeUndefined();
    expect(existing.activeWorkFrame?.kind).toBe("publish");
  });

  it("model text cannot mint a grant, and only the executive mint site brands one", async () => {
    const result = await runClaireBrainTurn({
      rawText: "My mission today is to publish the Meta ad.",
      ...CTX,
      executive: {
        retrieve: async () => [],
        ctx: {
          timeZone: "America/Los_Angeles",
          today: "2026-09-22",
          surface: "voice",
          recommend: async () => "Locked. I added it to the Day Line and made it today's mission.",
        },
      },
    });
    expect(result.decision.actionGrants).toEqual([]);
    expect(result.candidateSpeak).not.toMatch(DURABLE_WRITE_CLAIM);
    expect(result.productionAuthority).toBe(false);
    expect(BRAIN_V2_PRODUCTION_AUTHORITY).toBe(false);
  });

  it("production authority stays false and every grant is shadow-only", async () => {
    const result = await brain("I need to call Dana Tuesday.");
    expect(result.productionAuthority).toBe(false);
    expect(result.decision.productionAuthority).toBe(false);
    expect(result.mutations).toEqual([]);
    expect(result.decision.actionGrants.length).toBeGreaterThan(0);
    for (const grant of result.decision.actionGrants) {
      expect(grant.constraints.mutationAllowed).toBe(false);
      expect(grant.constraints.shadowOnly).toBe(true);
    }
  });

  it("generic cognition does not name the fixture's people or campaigns", () => {
    for (const file of GENERIC_FILES) {
      const source = readFileSync(path.join(process.cwd(), "server/claire/brain", file), "utf8");
      expect(source).not.toMatch(/\bRyan\b/);
      expect(source).not.toMatch(/\bMeta\b/);
    }
  });
});

describe("review tightenings", () => {
  it("an unrelated sales turn output-gates a remembered mission", async () => {
    const opened = await brain("My mission today is to publish the campaign.");
    expect(opened.decision.workingMemoryUpdate?.activeWorkFrame?.kind).toBe("publish");
    const shadow = updateShadowMemory(emptyShadowMemory(), opened.decision, 1);
    const sales = await brain("What were my last five sales?", { activeWorkFrame: shadow.activeWorkFrame });
    expect(sales.decision.control.activeTaskSets.some(task => task.kind === "strategic_work")).toBe(false);
    expect(sales.decision.control.activeTaskSets.some(task => task.kind === "business_query")).toBe(true);
    expect(slot(sales, "strategic_frame")?.input).toBe("dormant");
    expect(slot(sales, "strategic_frame")?.output).toBe("suppress");
    expect(ack(sales, "strategic_content_understood")).toBeUndefined();
    expect(ack(sales, "awaiting_strategic_content")).toBeUndefined();
    expect(sales.candidateSpeak).not.toMatch(/mission/i);
    const kept = updateShadowMemory(shadow, sales.decision, 2);
    expect(kept.activeWorkFrame?.kind).toBe("publish");
    expect(kept.activeWorkFrame?.status).toBe("content_held");
    expect(JSON.stringify(kept.activeWorkFrame)).not.toMatch(/campaign/);
  });

  it("ordinary Dana work stays a day-line candidate and does not erase the mission", async () => {
    const opened = await brain("My mission today is to publish the campaign.");
    const shadow = updateShadowMemory(emptyShadowMemory(), opened.decision, 1);
    const dana = await brain("I also need to call Dana Tuesday.", { activeWorkFrame: shadow.activeWorkFrame });
    expect(dana.decision.perceivedTurn.workDeclarationKind).toBe("ordinary_work");
    expect(dana.decision.actionGrants.map(grant => grant.actionClass)).toEqual(["propose_day_line"]);
    expect(dana.decision.actionGrants[0]?.constraints).toEqual({ mutationAllowed: false, shadowOnly: true });
    expect(dana.decision.control.activeTaskSets.some(task => task.kind === "strategic_work")).toBe(false);
    expect(slot(dana, "strategic_frame")?.input).toBe("dormant");
    expect(dana.decision.workingMemoryUpdate?.activeWorkFrame).toBeUndefined();
    const kept = updateShadowMemory(shadow, dana.decision, 2);
    expect(kept.activeWorkFrame).toEqual(shadow.activeWorkFrame);
  });

  it("explicit goodbye ends the call and destination movement does not", async () => {
    for (const rawText of ["Bye.", "Talk later.", "Hang up.", "End the call.", "I have to go.", "I have to go, they owe me $10,000. Bye.", "I need to run. Talk later."]) {
      const result = await brain(rawText);
      expect(result.decision.callControl.endCall).toBe(true);
      expect(result.decision.perceivedTurn.callControl).toBe("end");
    }
    for (const rawText of [
      "I have to go there because they owe me $10,000.",
      "I have to go back to Century Park East.",
      "I gotta go over there and pick it up.",
      "I need to go to Koreatown.",
    ]) {
      const result = await brain(rawText);
      expect(result.decision.callControl.endCall).toBe(false);
      expect(result.decision.perceivedTurn.callControl).toBe("continue");
    }
  });

  it("introducing a mission is not attention repair, and don't-add survives listen", async () => {
    const intro = await brain("I'm telling you that today I have a mission.");
    expect(intro.decision.perceivedTurn.attentionRepair).toBe("none");
    expect(intro.decision.perceivedTurn.workDeclarationKind).toBe("strategic_work");

    const aware = await brain("I need you to know the delivery is late.");
    expect(aware.decision.perceivedTurn.attentionRepair).toBe("none");

    const both = await brain("No, don't add that. Listen to me — I'm talking about something else.", pending());
    expect(both.decision.perceivedTurn.attentionRepair).not.toBe("none");
    expect(both.decision.perceivedTurn.refusal).toBe(true);
    expect(both.decision.attention.pendingDisposition).toBe("reject");
    expect(slot(both, "pending_proposal")?.input).toBe("clear");
  });

  it("text me that is an external capability and not a day line grant", async () => {
    const result = await brain("Text me that.");
    expect(result.decision.perceivedTurn.externalCapability).toBe("operator_artifact_sms");
    expect(result.decision.perceivedTurn.workDeclarationKind).not.toBe("ordinary_work");
    expect(result.decision.actionGrants).toEqual([]);
    expect(result.decision.conclusions.some(item => item.kind === "external_capability_unowned")).toBe(true);
    expect(result.candidateSpeak).not.toMatch(/sent it/i);
  });
});

describe("day line is not a generic action sink", () => {
  async function classes(rawText: string) {
    const result = await brain(rawText);
    return {
      grants: result.decision.actionGrants.map(grant => grant.actionClass),
      conclusions: result.decision.conclusions.map(item => item.kind),
      capability: result.decision.perceivedTurn.externalCapability,
      kind: result.decision.perceivedTurn.workDeclarationKind,
    };
  }

  it("an explicit day line request still proposes", async () => {
    const result = await classes("Put calling Dana on my Day Line.");
    expect(result.kind).toBe("explicit_day_line");
    expect(result.grants).toEqual(["propose_day_line"]);
  });

  it("a first-person ordinary plan still proposes", async () => {
    const result = await classes("I need to call Dana Tuesday.");
    expect(result.kind).toBe("ordinary_work");
    expect(result.grants).toEqual(["propose_day_line"]);
  });

  it("imperatives aimed at Claire do not propose a day line", async () => {
    for (const rawText of ["Call Dana.", "Email Dana.", "Text Dana.", "Message Dana.", "Open the route."]) {
      const result = await classes(rawText);
      expect(result.grants).toEqual([]);
      expect(result.grants).not.toContain("propose_day_line");
    }
    const scheduled = await classes("Schedule the pickup.");
    expect(scheduled.kind).toBe("explicit_action");
    expect(scheduled.grants).toEqual([]);
    expect(scheduled.conclusions).toContain("action_unsupported");
  });

  it("text me that stays on the operator-artifact seam", async () => {
    for (const rawText of ["Text me that.", "Send that to me.", "Send that to my phone."]) {
      const result = await classes(rawText);
      expect(result.capability).toBe("operator_artifact_sms");
      expect(result.grants).toEqual([]);
      expect(result.conclusions).toContain("external_capability_unowned");
      expect(result.conclusions).not.toContain("action_unsupported");
    }
  });

  it("make that today's mission does not fall through to a day line", async () => {
    const result = await classes("Make that today's mission.");
    expect(result.grants).toEqual([]);
    expect(result.conclusions).toContain("mission_write_unavailable");
    expect(result.conclusions).not.toContain("propose_day_line");
  });
});

describe("movement and work do not hang up", () => {
  const ends = [
    "I have to go.",
    "I gotta go.",
    "Talk later.",
    "Bye.",
    "I need to run.",
    "I have to go, they owe me $10,000. Bye.",
    "I have to go pick up the order. Bye.",
    "I have to go home, talk later.",
    "Hang up.",
    "End the call.",
    "I have to go now.",
    "I gotta go soon.",
    "I have to go for now.",
    "I have to go home. Bye.",
    "I have to go pick up the order. Talk later.",
  ];
  const continues = [
    "I have to go there because they owe me $10,000.",
    "I have to go back to Century Park East.",
    "I gotta go over there and pick it up.",
    "I need to go to Koreatown.",
    "I have to go home.",
    "I gotta go pick up the order.",
    "I have to go deliver the towels.",
    "I need to go meet Dana.",
    "I have to go grab the laundry.",
  ];

  it("bare departure and explicit goodbye end the call", async () => {
    for (const rawText of ends) {
      const result = await brain(rawText);
      expect(result.decision.perceivedTurn.callControl).toBe("end");
      expect(result.decision.callControl.endCall).toBe(true);
    }
  });

  it("go plus a destination or work complement continues", async () => {
    for (const rawText of continues) {
      const result = await brain(rawText);
      expect(result.decision.perceivedTurn.callControl).toBe("continue");
      expect(result.decision.callControl.endCall).toBe(false);
    }
  });
});

describe("strategic source trace", () => {
  it("stores a synthetic trace and no operator speech", async () => {
    const utterance = "My mission today is to publish the campaign.";
    const opened = await brain(utterance);
    const frame = opened.decision.workingMemoryUpdate?.activeWorkFrame;
    expect(frame).toMatchObject({
      durability: "cognitive_only",
      status: "content_held",
      kind: "publish",
    });
    expect(frame?.sourceTraceRef).toMatch(/^trace:claire-call:executive#\d+$/);
    expect(JSON.stringify(frame)).not.toContain(utterance);
    expect(JSON.stringify(frame)).not.toMatch(/campaign/);
    expect(frame && "sourceTurnRef" in frame).toBe(false);
  });

  it("does not describe the trace as a ledger turn that retrieves the utterance", () => {
    const files = [
      "server/claire/brain/executive/strategicFrame.ts",
      "server/claire/brain/contracts/workingMemory.ts",
      "docs/claire-brain-v2.md",
      "docs/claire-brain-v2-handoff.md",
      "server/claire/brain/STATUS.md",
    ];
    for (const file of files) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/sourceTurnRef/);
      expect(source).not.toMatch(/back to the conversation turn/i);
      expect(source).not.toMatch(/ledger owns the words/i);
      expect(source).not.toMatch(/authoritative conversation turn/i);
    }
    const contract = readFileSync(
      path.join(process.cwd(), "server/claire/brain/contracts/workingMemory.ts"),
      "utf8"
    );
    expect(contract).toMatch(/sourceTraceRef/);
    expect(contract).toMatch(/synthetic/i);
    expect(contract).toMatch(/not a conversation-ledger turn id/i);
  });
});

describe("production call regression", () => {
  it("follows the sanitized call from logistics through the Meta-ad mission without resurrecting the stale stop", async () => {
    const stale = pending(STALE_PENDING_TITLE);
    let shadow = emptyShadowMemory();
    const step = async (
      rawText: string,
      completeness: "complete" | "incomplete" | "forced_flush" = "complete"
    ) => {
      const result = await brain(
        rawText,
        {
          ...stale,
          activeWorkFrame: shadow.activeWorkFrame,
          focusEntities: shadow.focusEntities,
          unresolvedReferences: shadow.unresolvedReferences,
          orderedQuery: shadow.orderedQuery,
        },
        completeness
      );
      if (completeness !== "incomplete") shadow = updateShadowMemory(shadow, result.decision, 1);
      return result;
    };

    const dropOff = await step(EXECUTIVE_CALL_TURNS.dropOff);
    expect(dropOff.decision.perceivedTurn.workDeclarationKind).not.toBe("strategic_work");
    expect(dropOff.decision.attention.priorClaim).toBe("none");

    const ryan = await step(EXECUTIVE_CALL_TURNS.ryanStop);
    expect(ryan.decision.perceivedTurn.operatorIntentAttested).toBe(true);

    const fragment = assembleThought({
      incoming: EXECUTIVE_CALL_TURNS.metaFragment,
      state: emptyFragmentState(),
    });
    expect(fragment.completeness).toBe("incomplete");
    const held = await step(fragment.assembledText, "incomplete");
    expect(held.decision.actionGrants).toEqual([]);
    expect(slot(held, "pending_proposal")?.output).toBe("suppress");
    expect(held.candidateSpeak).not.toMatch(/Ryan|yes or no|unverif/i);

    const joined = assembleThought({
      incoming: EXECUTIVE_CALL_TURNS.missionContinuation,
      state: fragment.state,
    });
    expect(joined.completeness).toBe("complete");
    expect(joined.assembledText.toLowerCase()).toContain("considered as my mission today");
    const declared = await step(joined.assembledText);
    expect(declared.decision.control.change).toBe("task_switch");
    expect(slot(declared, "pending_proposal")?.input).toBe("dormant");
    expect(slot(declared, "pending_proposal")?.output).toBe("suppress");
    expect(declared.decision.control.activeTaskSets.some(task => task.kind === "strategic_work")).toBe(true);
    expect(declared.decision.workingMemoryUpdate?.activeWorkFrame?.kind).toBe("publish");
    expect(JSON.stringify(declared.decision.workingMemoryUpdate?.activeWorkFrame)).not.toMatch(/meta/i);
    expect(declared.decision.attention.priorClaim).toBe("none");
    expect(declared.decision.actionGrants).toEqual([]);
    expect(declared.candidateSpeak).not.toMatch(/Ryan|should I add|say yes or no|unverif/i);
    expect(declared.candidateSpeak).not.toMatch(DURABLE_WRITE_CLAIM);

    const repair = await step(EXECUTIVE_CALL_TURNS.missionRepair);
    expect(repair.decision.attention.pendingDisposition).not.toBe("reject");
    expect(repair.decision.perceivedTurn.attentionRepair).toBe("none");
    expect(repair.decision.control.activeTaskSets.some(task => task.kind === "strategic_work")).toBe(true);
    expect(repair.decision.attention.priorClaim).toBe("none");
    expect(slot(repair, "pending_proposal")?.output).toBe("suppress");

    const listen = await step(EXECUTIVE_CALL_TURNS.listen);
    expect(listen.decision.perceivedTurn.attentionRepair).toBe("attention_repair");
    expect(listen.decision.control.change).not.toBe("prior_claim_challenge");
    expect(listen.decision.perceivedTurn.businessIntent).not.toBe("correctness_challenge");
    expect(listen.decision.control.needsVerification).toBe(false);
    expect(shadow.activeWorkFrame).not.toBeNull();

    const posted = await step(EXECUTIVE_CALL_TURNS.postAd);
    expect(posted.decision.perceivedTurn.operatorIntentAttested).toBe(true);
    expect(posted.decision.workingMemoryUpdate?.activeWorkFrame?.kind).toBe("publish");
    expect(JSON.stringify(posted.decision.workingMemoryUpdate?.activeWorkFrame)).not.toMatch(/meta|instagram/i);
    expect(posted.decision.control.change).toBe("task_switch");
    expect(slot(posted, "pending_proposal")?.input).toBe("dormant");
    expect(slot(posted, "pending_proposal")?.output).toBe("suppress");
    expect(posted.decision.control.activeTaskSets.some(task => task.kind === "strategic_work")).toBe(true);
    expect(posted.decision.attention.priorClaim).toBe("none");
    expect(posted.decision.control.needsVerification).toBe(false);
    expect(posted.decision.retrievals.some(request => request.kind === "prior_claim_recheck")).toBe(false);
    expect(posted.decision.actionGrants).toEqual([]);
    expect(posted.candidateSpeak).not.toMatch(/Ryan|should I add|say yes or no|unverif/i);
    expect(posted.candidateSpeak).not.toMatch(DURABLE_WRITE_CLAIM);
    expect(posted.decision.responsePlan.segments.some(segment => segment.type === "ActionProposalSegment")).toBe(false);
    expect(posted.comparison.verificationInvoked).toBe(false);
    expect(posted.comparison.productionAuthority).toBe(false);
    expect(JSON.stringify(posted.comparison)).not.toContain(EXECUTIVE_CALL_TURNS.postAd);
  });
});
