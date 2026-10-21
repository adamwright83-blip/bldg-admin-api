import { describe, expect, it } from "vitest";
import { ENCOURAGEMENT_POLICY } from "../../../claire/progression/policy";
import { AUTHORED_DIALOGUE } from "../../../claire/progression/authoredDialogue";
import {
  buildStandingInstructionsView,
  captureStandingInstructions,
  detectStandingInstructions,
  evaluateReviewWindow,
  inMemoryStandingInstructionStore,
  parseTimeRange,
  STANDING_INSTRUCTION_SAVE_FAILED,
  type ReviewWindowPayload,
  type StandingInstructionStore,
} from "./index";
import {
  FIXTURE_CHIEF_OF_STAFF,
  FIXTURE_ENCOURAGEMENT,
  FIXTURE_SUNDAY_REVIEW,
} from "./productionFixtures";

const identity = async () => ({ ok: true as const, identity: { canonicalOperatorId: "adam-admin" } }) as never;
const base = { tenantId: "default", operatorUserId: "adam-admin", conversationId: "conv-1", turnId: "turn-1" };
const noObservation = async () => ({}) as never;

describe("detecting standing instructions", () => {
  it("hears 'encouragement on every call', named or pointing at Claire's last line", () => {
    for (const [utterance, prior] of [
      [FIXTURE_ENCOURAGEMENT.utterance, FIXTURE_ENCOURAGEMENT.priorClaireTurn],
      [FIXTURE_ENCOURAGEMENT.utteranceNamed, null],
    ] as const) {
      const [found] = detectStandingInstructions(utterance, { priorClaireTurn: prior });
      expect(found).toMatchObject({ kind: "encouragement_every_call", subjectKey: "encouragement", status: "active" });
      expect(found!.quote).toBe(utterance);
    }
  });

  it("'that' with no encouraging line before it is not a rule", () => {
    expect(detectStandingInstructions(FIXTURE_ENCOURAGEMENT.utterance, { priorClaireTurn: "The Louise follow-up is overdue." })).toEqual([]);
    expect(detectStandingInstructions(FIXTURE_ENCOURAGEMENT.utterance)).toEqual([]);
  });

  it("hears the Sunday 5 to 7 PM review window and resolves 'stuff like that' from Claire's last line", () => {
    const [found] = detectStandingInstructions(FIXTURE_SUNDAY_REVIEW.utterance, { priorClaireTurn: FIXTURE_SUNDAY_REVIEW.priorClaireTurn });
    expect(found).toMatchObject({ kind: "review_window", subjectKey: "review_window:overdue_followups" });
    expect(found!.payload).toEqual({ weekday: 0, startMinutes: 17 * 60, endMinutes: 19 * 60, topics: ["overdue_followups"] });
    expect(found!.text).toContain("Sunday between 5 PM and 7 PM");
  });

  it("a review window with no resolvable topic is not captured, because it could not be honoured", () => {
    expect(detectStandingInstructions(FIXTURE_SUNDAY_REVIEW.utterance, { priorClaireTurn: "Good morning." })).toEqual([]);
  });

  it("hears the chief-of-staff complaint as role feedback with the quote", () => {
    const [found] = detectStandingInstructions(FIXTURE_CHIEF_OF_STAFF.utterance);
    expect(found).toMatchObject({ kind: "role_feedback", subjectKey: "role_feedback:chief_of_staff", payload: { obligation: "open_with_goal_and_plan" } });
    expect(found!.quote).toBe(FIXTURE_CHIEF_OF_STAFF.utterance);
    expect(found!.text).toContain("open every call with the goal and the plan");
  });

  it("never turns reported speech or a hypothetical into a rule", () => {
    expect(detectStandingInstructions('He said "I want encouragement on every call."')).toEqual([]);
    expect(detectStandingInstructions("Would it make sense to add encouragement on every call?")).toEqual([]);
    expect(detectStandingInstructions("Imagine I wanted encouragement on every call.")).toEqual([]);
  });

  it("parses time ranges the way people say them", () => {
    expect(parseTimeRange("from 5 to 7 PM")).toEqual({ start: 1020, end: 1140 });
    expect(parseTimeRange("from 11 to 1 PM")).toEqual({ start: 660, end: 780 });
    expect(parseTimeRange("9:30 AM to 10 AM")).toEqual({ start: 570, end: 600 });
  });
});

describe("capture: saved only after a fresh read back", () => {
  it("persists, reads back, and speaks the readback", async () => {
    const store = inMemoryStandingInstructionStore();
    const result = await captureStandingInstructions(
      { ...base, utterance: FIXTURE_SUNDAY_REVIEW.utterance, priorClaireTurn: FIXTURE_SUNDAY_REVIEW.priorClaireTurn },
      { resolveIdentity: identity, store, recordObservation: noObservation }
    );
    expect(result).toMatchObject({ status: "persisted", readbackVerified: true });
    expect(result.speech).toBe("That's a standing rule now, saved: overdue follow-ups wait for Sunday between 5 PM and 7 PM.");
    expect(result.speech).not.toMatch(/I'll|I will/);
    expect((await store.listActive({ tenantId: "default", canonicalOperatorId: "adam-admin" }))).toHaveLength(1);
  });

  it("a role complaint is acknowledged only once the row is saved", async () => {
    const store = inMemoryStandingInstructionStore();
    const result = await captureStandingInstructions(
      { ...base, utterance: FIXTURE_CHIEF_OF_STAFF.utterance },
      { resolveIdentity: identity, store, recordObservation: noObservation }
    );
    expect(result.status).toBe("persisted");
    expect(result.speech).toContain("that's on me");
    expect(result.records[0]).toMatchObject({ kind: "role_feedback", quote: FIXTURE_CHIEF_OF_STAFF.utterance });
  });

  it("a failed write never says the rule is saved", async () => {
    const failing: StandingInstructionStore = {
      ...inMemoryStandingInstructionStore(),
      append: async () => {
        throw new Error("db down");
      },
    };
    const result = await captureStandingInstructions(
      { ...base, utterance: FIXTURE_ENCOURAGEMENT.utteranceNamed },
      { resolveIdentity: identity, store: failing, recordObservation: noObservation }
    );
    expect(result).toMatchObject({ status: "persistence_failed", readbackVerified: false, speech: STANDING_INSTRUCTION_SAVE_FAILED });
    expect(result.speech).not.toMatch(/saved/i);
  });

  it("a write that does not survive the read back is not acknowledged", async () => {
    const inner = inMemoryStandingInstructionStore();
    const lossy: StandingInstructionStore = { ...inner, listActive: async () => [], listAll: async () => [] };
    const result = await captureStandingInstructions(
      { ...base, utterance: FIXTURE_ENCOURAGEMENT.utteranceNamed },
      { resolveIdentity: identity, store: lossy, recordObservation: noObservation }
    );
    expect(result).toMatchObject({ status: "readback_failed", readbackVerified: false });
    expect(result.speech).toBe(STANDING_INSTRUCTION_SAVE_FAILED);
  });

  it("an unresolved identity saves nothing and promises nothing", async () => {
    const result = await captureStandingInstructions(
      { ...base, utterance: FIXTURE_ENCOURAGEMENT.utteranceNamed },
      { resolveIdentity: (async () => ({ ok: false })) as never, store: inMemoryStandingInstructionStore(), recordObservation: noObservation }
    );
    expect(result.status).toBe("identity_unresolved");
    expect(result.speech).toBe(STANDING_INSTRUCTION_SAVE_FAILED);
  });

  it("a replayed turn is idempotent, and a later statement is a new version", async () => {
    const store = inMemoryStandingInstructionStore();
    const run = (turnId: string, utterance = FIXTURE_ENCOURAGEMENT.utteranceNamed) =>
      captureStandingInstructions({ ...base, turnId, utterance }, { resolveIdentity: identity, store, recordObservation: noObservation });
    await run("t1");
    await run("t1");
    expect(store.rows).toHaveLength(1);
    await run("t2");
    expect(store.rows.map(row => row.version)).toEqual([1, 2]);
    expect(await store.listActive({ tenantId: "default", canonicalOperatorId: "adam-admin" })).toHaveLength(1);
    await run("t3", "Stop the encouragement, no more pep talks.");
    expect(await store.listActive({ tenantId: "default", canonicalOperatorId: "adam-admin" })).toHaveLength(0);
  });

  it("rules are scoped to the operator who stated them", async () => {
    const store = inMemoryStandingInstructionStore();
    await captureStandingInstructions({ ...base, utterance: FIXTURE_ENCOURAGEMENT.utteranceNamed }, { resolveIdentity: identity, store, recordObservation: noObservation });
    expect(await store.listActive({ tenantId: "default", canonicalOperatorId: "someone-else" })).toEqual([]);
    expect(await store.listActive({ tenantId: "other-tenant", canonicalOperatorId: "adam-admin" })).toEqual([]);
  });
});

describe("OPERATOR STANDING INSTRUCTIONS prompt section", () => {
  async function adamsRules() {
    const store = inMemoryStandingInstructionStore();
    const cap = (turnId: string, utterance: string, priorClaireTurn?: string) =>
      captureStandingInstructions({ ...base, turnId, utterance, priorClaireTurn }, { resolveIdentity: identity, store, recordObservation: noObservation });
    await cap("a", FIXTURE_ENCOURAGEMENT.utterance, FIXTURE_ENCOURAGEMENT.priorClaireTurn);
    await cap("b", FIXTURE_SUNDAY_REVIEW.utterance, FIXTURE_SUNDAY_REVIEW.priorClaireTurn);
    await cap("c", FIXTURE_CHIEF_OF_STAFF.utterance);
    return store.listActive({ tenantId: "default", canonicalOperatorId: "adam-admin" });
  }
  const tz = "America/Los_Angeles";

  it("carries all three real instructions into the next call, and holds the review off a Monday evening", async () => {
    const view = buildStandingInstructionsView(await adamsRules(), { now: new Date("2026-10-20T01:00:00Z"), timeZone: tz }); // Mon 6 PM PT
    expect(view.section).toContain("OPERATOR STANDING INSTRUCTIONS");
    expect(view.section).toContain("ENCOURAGEMENT");
    expect(view.section).toContain("HOLD");
    expect(view.section).toContain("overdue follow-ups");
    expect(view.section).toContain("open this call with the goal and the plan");
    expect(view.heldTopics).toEqual(["overdue_followups"]);
    expect(view.askNowTopics).toEqual([]);
  });

  it("opens the window on Sunday between 5 and 7 PM and closes it outside", async () => {
    const rules = await adamsRules();
    const sundayInside = buildStandingInstructionsView(rules, { now: new Date("2026-10-19T00:30:00Z"), timeZone: tz }); // Sun 5:30 PM PT
    expect(sundayInside.askNowTopics).toEqual(["overdue_followups"]);
    expect(sundayInside.heldTopics).toEqual([]);
    expect(sundayInside.section).toContain("REVIEW WINDOW OPEN NOW");
    const sundayMorning = buildStandingInstructionsView(rules, { now: new Date("2026-10-18T17:00:00Z"), timeZone: tz }); // Sun 10 AM PT
    expect(sundayMorning.heldTopics).toEqual(["overdue_followups"]);
    const payload: ReviewWindowPayload = { weekday: 0, startMinutes: 1020, endMinutes: 1140, topics: ["overdue_followups"] };
    expect(evaluateReviewWindow(payload, new Date("2026-10-19T02:00:00Z"), tz)).toBe("outside"); // Sun 7 PM PT, end exclusive
  });

  it("no rules, no section", () => {
    expect(buildStandingInstructionsView([], { now: new Date(), timeZone: tz }).section).toBeNull();
  });
});

describe("encouragement policy", () => {
  it("is one grounded sentence, never an authored refusal line", async () => {
    expect(ENCOURAGEMENT_POLICY.sentencesPerCall).toBe(1);
    expect(ENCOURAGEMENT_POLICY.usesAuthoredDialogueLines).toBe(false);
    const rules = [
      {
        id: "i", tenantId: "t", canonicalOperatorId: "o", operatorUserId: "u", kind: "encouragement_every_call" as const,
        subjectKey: "encouragement", version: 1, status: "active" as const, text: "x", quote: "q", payload: null,
        sourceConversationKey: "c", sourceTurnId: "t", createdAt: "2026-10-19T00:00:00.000Z",
      },
    ];
    const { section } = buildStandingInstructionsView(rules, { now: new Date(), timeZone: "America/Los_Angeles", rapportBand: 2 });
    expect(section).toContain("exactly one sentence that ties the operator's next move to the goal");
    expect(section).toContain("Fifty is attainable if you count buildings.");
    expect(section).toContain("never reuse a refusal or closing line");
    for (const line of AUTHORED_DIALOGUE) expect(section).not.toContain(line.text);
  });
});
