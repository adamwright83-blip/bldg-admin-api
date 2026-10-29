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
const byName = (grade: ReturnType<typeof gradeTrial>) => Object.fromEntries(grade.checks.map(c => [c.name, c]));

describe("gradeTrial", () => {
  it("passes a clean trial: expected row landed, receipt that turn, no asks, question answered", () => {
    const grade = gradeTrial({
      scenario, today, before: [seeded], after: [seeded, opus], standingInstructions: [],
      transcript: [
        { speaker: "operator", text: "Add the Opus pickup tomorrow." },
        { speaker: "claire", text: "Done, the Opus pickup is on tomorrow.", confirmedWrite: true },
        { speaker: "operator", text: "What can you actually do? Bye." },
        { speaker: "claire", text: "I can read and change your Day Line and read your numbers. Bye, Adam.", confirmedWrite: false },
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
    expect(failed).toContain("no save claim without a receipt");
    expect(failed).toContain("no denial of a confirmed save");
    expect(failed).toContain("authorization asks ≤ 0");
    expect(grade.counts).toMatchObject({ falseClaims: 1, deniedSaves: 1, authorizationAsks: 1 });
  });

  it("the Oct 28 simulated-trial miss: a capabilities question bundled with a goodbye, answered 'Goodnight, Adam.'", () => {
    const grade = gradeTrial({
      scenario, today, before: [seeded], after: [seeded, opus], standingInstructions: [],
      transcript: [
        { speaker: "operator", text: "Add the Opus pickup tomorrow." },
        { speaker: "claire", text: "Done, the Opus pickup is on tomorrow.", confirmedWrite: true },
        { speaker: "operator", text: "Nah, that's it. Hey, before I go, what can you actually do for me? Like what are you good for?" },
        { speaker: "claire", text: "Goodnight, Adam.", confirmedWrite: false },
      ],
    });
    const check = byName(grade)["every operator question gets an answer, not just a sign-off"]!;
    expect(check.pass).toBe(false);
    expect(check.evidence).toMatch(/what can you actually do/);
    expect(grade.pass).toBe(false);
    expect(grade.counts.unansweredQuestions).toBe(1);
  });

  it("offers, conditionals and later summaries of real writes are not false claims", () => {
    const grade = gradeTrial({
      scenario, today, before: [seeded], after: [seeded, opus], standingInstructions: [],
      transcript: [
        { speaker: "operator", text: "What should I do tomorrow?" },
        { speaker: "claire", text: "Tell me what you'd add and I'll put it on tomorrow.", confirmedWrite: false },
        { speaker: "operator", text: "Put the Opus pickup on tomorrow. And the lobby glass sometime soon-ish." },
        { speaker: "claire", text: "\"Sometime soon-ish\" isn't a day I can put it on. The Opus pickup is on tomorrow.", confirmedWrite: true },
        { speaker: "operator", text: "Okay bye." },
        { speaker: "claire", text: "Goodnight. Everything is on your Day Line.", confirmedWrite: false },
      ],
    });
    expect(byName(grade)["no save claim without a receipt"]!.pass).toBe(true);
    // Run 8 false positives: a conditional with a curly apostrophe, and "tell me which … and I’ll put it on".
    const conditional = gradeTrial({
      scenario, today, before: [seeded], after: [seeded, opus], standingInstructions: [],
      transcript: [
        { speaker: "operator", text: "Should that go on today?" },
        { speaker: "claire", text: "Yes, I’d put it on today, since it keeps slipping. Want me to add it to today?", confirmedWrite: false },
        { speaker: "operator", text: "I'll do that tomorrow." },
        { speaker: "claire", text: "Tomorrow is still empty. Tell me which one you want, sageLA, Wilshire Vermont, or both, and I’ll put it on tomorrow.", confirmedWrite: false },
      ],
    });
    expect(byName(conditional)["no save claim without a receipt"]!.pass).toBe(true);
  });

  it("seeded-row mutations are counted by kind and fail intactness; additions are counted separately", () => {
    const stray: GradedRow = { id: "n2", title: "Call the plumber", businessDate: today, status: "open", detail: null, seeded: false };
    const removedSeed: GradedRow = { ...seeded, status: "cancelled" };
    const grade = gradeTrial({
      scenario, today, before: [seeded], after: [removedSeed, opus, stray], standingInstructions: [],
      transcript: [
        { speaker: "operator", text: "Add the Opus pickup tomorrow." },
        { speaker: "claire", text: "Want me to put the Opus pickup on tomorrow?", confirmedWrite: false },
      ],
    });
    const checks = byName(grade);
    expect(checks["no save claim without a receipt"]!.pass).toBe(true);
    expect(checks["no unauthorized additions"]!.pass).toBe(false);
    expect(checks["rows added ≤ 1"]!.pass).toBe(false);
    expect(checks["seeded rows untouched (except those allowed to change)"]!.pass).toBe(false);
    expect(checks["seeded rows untouched (except those allowed to change)"]!.evidence).toMatch(/removed: "Pitch Wilshire Vermont/);
    expect(grade.counts).toMatchObject({ rowsAdded: 2, unauthorizedRows: 1, seededRemoved: 1, seededMoved: 0, seededCompleted: 0 });
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
