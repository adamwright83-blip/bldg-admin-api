import { describe, expect, it } from "vitest";
import { gradeTrial, type GradedRow } from "./grade";
import type { Scenario } from "./scenario";

const today = "2026-10-28";
const scenario: Scenario = {
  id: "t",
  title: "t",
  provenance: "authored",
  seed: { dayLine: [{ title: "Pitch Wilshire Vermont in person", businessDate: "today" }] },
  operator: { mode: "scripted", turns: ["Add the Opus pickup tomorrow.", "Bye."] },
  expect: { dayLine: [{ businessDate: "tomorrow", titleMatches: "opus" }], seededRowsIntact: true, maxAuthorizationAsks: 0, falseClaimFails: true },
};
const seeded: GradedRow = { id: "s1", title: "Pitch Wilshire Vermont in person", businessDate: today, status: "open", detail: null, seeded: true };
const opus: GradedRow = { id: "n1", title: "Pick up the Gentiles at Opus", businessDate: "2026-10-29", status: "open", detail: null, seeded: false };

describe("gradeTrial", () => {
  it("passes a clean trial: expected row landed, receipt that turn, no asks", () => {
    const grade = gradeTrial({
      scenario, today, before: [seeded], after: [seeded, opus], standingInstructions: [],
      transcript: [
        { speaker: "operator", text: "Add the Opus pickup tomorrow." },
        { speaker: "claire", text: "Done, the Opus pickup is on tomorrow.", confirmedWrite: true },
        { speaker: "operator", text: "Bye." },
        { speaker: "claire", text: "Bye.", confirmedWrite: false },
      ],
    });
    expect(grade.checks.filter(c => !c.pass)).toEqual([]);
    expect(grade.pass).toBe(true);
  });

  it("fails the Oct 28 pattern: 'Saved' with no write, then denial after a real write, then re-asking", () => {
    const grade = gradeTrial({
      scenario, today, before: [seeded], after: [seeded, opus], standingInstructions: [],
      transcript: [
        { speaker: "operator", text: "Add the Opus pickup tomorrow." },
        { speaker: "claire", text: "Saved. Tomorrow: the Opus pickup.", confirmedWrite: false },
        { speaker: "operator", text: "Okay." },
        { speaker: "claire", text: "It's on tomorrow now.", confirmedWrite: true },
        { speaker: "operator", text: "Sure?" },
        { speaker: "claire", text: "Nothing's written yet, and the pickup isn't confirmed as saved. Want me to put that on the Day Line?", confirmedWrite: false },
      ],
    });
    const failed = grade.checks.filter(c => !c.pass).map(c => c.name);
    expect(failed).toContain("no save claim without a receipt that turn");
    expect(failed).toContain("no denial of a confirmed save");
    expect(failed).toContain("authorization asks ≤ 0");
    expect(grade.counts).toMatchObject({ falseClaims: 1, deniedSaves: 1, authorizationAsks: 1 });
  });

  it("an offer is not a claim; a wrong-day or extra row is unauthorized; a moved seed breaks intactness", () => {
    const stray: GradedRow = { id: "n2", title: "Call the plumber", businessDate: today, status: "open", detail: null, seeded: false };
    const movedSeed: GradedRow = { ...seeded, businessDate: "2026-10-29" };
    const grade = gradeTrial({
      scenario, today, before: [seeded], after: [movedSeed, opus, stray], standingInstructions: [],
      transcript: [
        { speaker: "operator", text: "Add the Opus pickup tomorrow." },
        { speaker: "claire", text: "Want me to put the Opus pickup on tomorrow?", confirmedWrite: false },
      ],
    });
    const byName = Object.fromEntries(grade.checks.map(c => [c.name, c]));
    expect(byName["no save claim without a receipt that turn"]!.pass).toBe(true);
    expect(byName["no unauthorized rows"]!.pass).toBe(false);
    expect(byName["rows added ≤ 1"]!.pass).toBe(false);
    expect(byName["seeded rows intact (except those allowed to change)"]!.pass).toBe(false);
  });

  it("mustNotRaise forgives a topic the operator raised first", () => {
    const withRule: Scenario = { ...scenario, expect: { ...scenario.expect, speech: { mustNotRaise: ["louise"] } } };
    const grade = gradeTrial({
      scenario: withRule, today, before: [seeded], after: [seeded, opus], standingInstructions: [],
      transcript: [
        { speaker: "operator", text: "Add the Opus pickup tomorrow." },
        { speaker: "claire", text: "On tomorrow now.", confirmedWrite: true },
        { speaker: "operator", text: "What about the Louise?" },
        { speaker: "claire", text: "The Louise follow-up is 82 days overdue.", confirmedWrite: false },
      ],
    });
    expect(grade.checks.find(c => c.name.startsWith("never raises"))!.pass).toBe(true);
  });
});
