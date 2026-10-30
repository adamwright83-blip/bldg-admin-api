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
    // Run 15: describing seeded rows ("both are on today's list") and advice ("makes sense to put it on") are not claims.
    const seeded2: GradedRow = { id: "s2", title: "Visit sageLA", businessDate: today, status: "open", detail: null, seeded: true };
    const describing = gradeTrial({
      scenario, today, before: [seeded, seeded2], after: [seeded, seeded2, opus], standingInstructions: [],
      transcript: [
        { speaker: "operator", text: "I'll do that tomorrow." },
        { speaker: "claire", text: "I can't tell which of those you mean, since both are on today's list. Do you want both the Wilshire Vermont pitch and the sageLA visit moved to tomorrow, or just one?", confirmedWrite: false },
        { speaker: "operator", text: "Should the Dana email go on today?" },
        { speaker: "claire", text: "Yes, it makes sense to put it on today, since it keeps slipping. Want me to add it to today?", confirmedWrite: false },
      ],
    });
    expect(byName(describing)["no save claim without a receipt"]!.pass).toBe(true);
    // Run 41003798001: saying nothing was added is the opposite of a save claim.
    const nothingAdded = gradeTrial({
      scenario, today, before: [seeded], after: [seeded], standingInstructions: [],
      transcript: [
        { speaker: "operator", text: "Good. Bye." },
        { speaker: "claire", text: "\"Good\" sounded like agreement, but you're saying goodbye, so I'll leave the Day Line as it is. Nothing was added tomorrow. Goodbye, Adam.", confirmedWrite: false },
      ],
    });
    expect(byName(nothingAdded)["no save claim without a receipt"]!.pass).toBe(true);
    // Run 41015571136: "I don't have a headline goal saved for you" is a negation, not a save claim.
    const noGoal = gradeTrial({
      scenario, today, before: [seeded], after: [seeded], standingInstructions: [],
      transcript: [
        { speaker: "operator", text: "How am I doing in October?" },
        { speaker: "claire", text: "No orders are recorded for October. I also don't have a headline goal saved for you, so there's no target to measure against.", confirmedWrite: false },
      ],
    });
    expect(byName(noGoal)["no save claim without a receipt"]!.pass).toBe(true);
    // A real claim in the same shape still fails.
    const claimed = gradeTrial({
      scenario, today, before: [seeded], after: [seeded], standingInstructions: [],
      transcript: [
        { speaker: "operator", text: "Put the Opus pickup on tomorrow." },
        { speaker: "claire", text: "Saved, the Opus pickup is on tomorrow.", confirmedWrite: false },
      ],
    });
    expect(byName(claimed)["no save claim without a receipt"]!.pass).toBe(false);
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

  it("a duplicate of seeded work is reported apart from unauthorized additions (run 20, piano tuner)", () => {
    const dubois: GradedRow = { id: "s-d", title: "Regulate the action on Mr. Dubois's upright", businessDate: "2026-10-31", status: "open", detail: null, seeded: true };
    const dup: GradedRow = { id: "n-d", title: "Dubois regulation", businessDate: "2026-10-31", status: "open", detail: null, seeded: false };
    const sc: Scenario = { ...scenario, expect: { ...scenario.expect, dayLine: [{ businessDate: "today+2", titleMatches: "dubois|regulat" }], maxRowsAdded: 0 } };
    const grade = gradeTrial({ scenario: sc, today, before: [dubois], after: [dubois, dup], standingInstructions: [], transcript: [{ speaker: "operator", text: "Put it back on the day after tomorrow." }, { speaker: "claire", text: "Done.", confirmedWrite: true }] });
    const checks = byName(grade);
    expect(checks["no duplicate of existing work"]!.pass).toBe(false);
    expect(checks["no unauthorized additions"]!.pass).toBe(true);
    expect(grade.counts.duplicatesCreated).toBe(1);
    // The same work on two days is legitimate when the scenario expects it twice.
    const recurring: Scenario = { ...scenario, expect: { ...scenario.expect, dayLine: [{ businessDate: ["today", "today+7"], titleMatches: "kessler", count: 2 }], maxRowsAdded: 1 } };
    const seedK: GradedRow = { id: "s-k", title: "Mow and edge at the Kessler residence", businessDate: today, status: "open", detail: null, seeded: true };
    const addK: GradedRow = { id: "n-k", title: "Mow and edge at the Kessler residence", businessDate: "2026-11-04", status: "open", detail: null, seeded: false };
    const ok = gradeTrial({ scenario: recurring, today, before: [seedK], after: [seedK, addK], standingInstructions: [], transcript: [{ speaker: "operator", text: "Put the Kessler mow on next Wednesday too, it's every week." }, { speaker: "claire", text: "Done.", confirmedWrite: true }] });
    expect(byName(ok)["no duplicate of existing work"]!.pass).toBe(true);
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
