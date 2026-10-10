import { describe, expect, it } from "vitest";
import { previewDaphneOutcomeInformedPolicy } from "./learnedPolicy";
import type { DaphneInterventionRecord } from "./interventionLedger";
import type { DaphneOutcomeRecord } from "./outcomeLedger";

const time = "2026-10-07T12:00:00.000Z";
const options = ["brief", "ask"].map(key => ({
  key, burden: 0, relationshipRisk: 0, preferenceFit: 0,
  uncertainty: 0,
}));
const interventions: DaphneInterventionRecord[] = ["brief", "brief", "ask", "ask"].map((key, index) => ({
  id: `i${index}`, tenantId: "t", canonicalOperatorId: "o", agentId: "claire",
  decisionPointId: `d${index}`, contextKey: "morning",
  acceptableActions: ["brief", "ask"], chosenAction: key, selectionMode: "manual",
  selectionProbability: null, propensity: null, policyVersion: "v1",
  policyReceipt: null, interventionDefinitionVersion: null, proximalOutcomeWindowMinutes: 30,
  sourceObservationIds: [`obs${index}`], idempotencyKey: `i${index}`,
  createdAt: time,
}));
const outcomes = (values: number[]): DaphneOutcomeRecord[] => values.map((value, index) => ({
  id: `outcome${index}`, tenantId: "t", canonicalOperatorId: "o",
  interventionId: `i${index}`, outcomeClass: "proximal", measureKey: "started",
  value, evidenceClass: "system_record", verificationStatus: "verified",
  sourceReference: `receipt${index}`, windowStart: null, windowEnd: null,
  observedAt: "2026-10-07T12:05:00.000Z", idempotencyKey: `o${index}`,
  createdAt: time,
}));
const preview = (rows: DaphneOutcomeRecord[]) =>
  previewDaphneOutcomeInformedPolicy({
    contextKey: "morning", options, interventions, outcomes: rows, policyVersion: "v1",
  });

describe("Daphne outcome feedback to future policy decision", () => {
  it("abstains before all actions have comparable verified outcomes", () => {
    const result = preview(outcomes([1]));
    expect(result.status).toBe("insufficient_evidence");
    expect(result.action).toBe("no_intervention");
    if (result.status !== "insufficient_evidence") throw new Error("expected abstention");
    expect(result.missingActions).toEqual(["brief", "ask"]);
  });

  it("changes the future decision when verified linked outcomes change", () => {
    const first = preview(outcomes([1, 1, 0, 0]));
    const later = preview(outcomes([0, 0, 1, 1]));
    expect(first.status).toBe("evaluated");
    expect(later.status).toBe("evaluated");
    expect(first.action).toBe("brief");
    expect(later.action).toBe("ask");
    expect(later.epistemicStatus).toBe("association_only");
    if (later.status !== "evaluated") throw new Error("expected evaluated decision");
    expect(later.decision.receipt.scores.ask).toBeGreaterThan(later.decision.receipt.scores.brief);
    expect(later.evidenceRefs).toContain("outcome2");
    expect(later.sampleCounts).toEqual({ brief: 2, ask: 2 });
  });

  it("does not learn from rejected, disputed or unverified outcomes", () => {
    const rows = outcomes([1, 1, 0, 0]).map((row, index) =>
      index === 0 ? { ...row, verificationStatus: "disputed" as const } : row
    );
    expect(preview(rows)).toMatchObject({
      status: "insufficient_evidence", action: "no_intervention",
      sampleCounts: { brief: 1, ask: 2 },
    });
  });

  it("includes independently verified burden in later decision scores",()=>{
    const success=outcomes([1,1,1,1]);
    const burden=success.map((row,index)=>({...row,id:`burden${index}`,idempotencyKey:`burden${index}`,
      outcomeClass:"burden" as const,measureKey:"burden",value:index<2?1:0}));
    const result=preview([...success,...burden]);
    expect(result.status).toBe("evaluated");
    expect(result.action).toBe("ask");
    expect(result.evidenceRefs).toContain("burden2");
  });

  it("abstains when only one candidate has verified evidence", () => {
    const rows = outcomes([1, 1]);
    expect(preview(rows)).toMatchObject({
      status: "insufficient_evidence", action: "no_intervention",
      missingActions: ["ask"],
    });
  });

  it("keeps hard-blocked actions out of future decisions", () => {
    const result = previewDaphneOutcomeInformedPolicy({
      contextKey: "morning", interventions, outcomes: outcomes([1, 1, 0, 0]),
      policyVersion: "v1",
      options: [{ ...options[0], hardBlocked: true }, options[1]],
    });
    expect(result.status).toBe("evaluated");
    expect(result.action).toBe("ask");
  });
});
