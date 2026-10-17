import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: async () => null }));

const { proposalDecisionUnchanged } = await import("./strategicPreparation");

const now = new Date("2026-10-17T19:04:00Z");
const strategyItem = (diagnosisId: string) => ({
  id: `2026-10-19:${diagnosisId}:action-retention`,
  businessDate: "2026-10-19",
  title: "Win back three lapsed Silver Lake regulars",
  objective: "Three personal recovery messages sent",
  executionType: "challenge" as const,
  candidateId: `${diagnosisId}:action-retention`,
  missionType: "retention",
  planId: `strategic_diagnosis:${diagnosisId}`,
  planRevision: 0,
  evidenceRefs: [`strategic_diagnosis:${diagnosisId}`],
});
const rankedItem = {
  id: "2026-10-20:work-greystar",
  businessDate: "2026-10-20",
  title: "Pitch The Louise property manager",
  objective: "Meeting held",
  executionType: "mission" as const,
  candidateId: "work-greystar",
  missionType: "account_acquisition",
  planId: "plan-1",
  planRevision: 3,
  evidenceRefs: ["mission_director_plan:plan-1:revision:3"],
};
const open = {
  businessDate: "2026-10-17",
  expiresAt: "2026-10-18T07:02:00Z",
  items: [strategyItem("diag-a"), rankedItem],
  constraints: ["2026-10-20: Pickup run 9am [c1]"],
  uncertainty: ["Strategic quality review: sound. Financial impact is unproven."],
};
const next = (overrides: Partial<{ businessDate: string; items: any[]; constraints: string[]; limitations: string[] }> = {}) => ({
  businessDate: "2026-10-17",
  items: [strategyItem("diag-b"), { ...rankedItem, planRevision: 4, evidenceRefs: ["mission_director_plan:plan-1:revision:4"] }],
  constraints: ["2026-10-20: Pickup run 9am [c1]"],
  limitations: [] as string[],
  ...overrides,
});

describe("a re-prepared proposal keeps the open one while the decision is the same", () => {
  it("ignores the new diagnosis id and plan revision from an hourly re-diagnosis", () => {
    expect(proposalDecisionUnchanged(open, next(), now)).toBe(true);
  });

  it("replaces it when the work itself changes", () => {
    const changed = next({ items: [{ ...strategyItem("diag-b"), title: "Win back five lapsed regulars" }, rankedItem] });
    expect(proposalDecisionUnchanged(open, changed, now)).toBe(false);
    expect(proposalDecisionUnchanged(open, next({ items: [strategyItem("diag-b")] }), now)).toBe(false);
    const otherWork = { ...rankedItem, candidateId: "work-other" };
    expect(proposalDecisionUnchanged(open, next({ items: [strategyItem("diag-b"), otherWork] }), now)).toBe(false);
  });

  it("replaces it when timing, constraints or limitations change", () => {
    const timed = next({ items: [{ ...strategyItem("diag-b"), timeWindow: { window: "evening", reason: "you said evenings", sourceObservationId: "o1" } }, rankedItem] });
    expect(proposalDecisionUnchanged(open, timed, now)).toBe(false);
    expect(proposalDecisionUnchanged(open, next({ constraints: [] }), now)).toBe(false);
    expect(proposalDecisionUnchanged(open, next({ limitations: ["2026-10-21: no_plan"] }), now)).toBe(false);
  });

  it("replaces it on a new business day or once it has expired", () => {
    expect(proposalDecisionUnchanged(open, next({ businessDate: "2026-10-18" }), now)).toBe(false);
    expect(proposalDecisionUnchanged(open, next(), new Date("2026-10-18T07:03:00Z"))).toBe(false);
  });

  it("keeps it when its stored limitations still match", () => {
    const limited = { ...open, uncertainty: [...open.uncertainty, "2026-10-21: no_plan"] };
    expect(proposalDecisionUnchanged(limited, next({ limitations: ["2026-10-21: no_plan"] }), now)).toBe(true);
  });
});
