import { afterEach, describe, expect, it, vi } from "vitest";
import { answerClairePreDriveFollowUp } from "../preDriveConversation";
import type { ClaireDriveContext } from "../contextAssembler";
import { buildClaireClock, CLAIRE_BUSINESS_TIME_ZONE } from "../contextAssembler";
import { detectClaireConversationalMode, isPersonalQuestionAboutClaire } from "../topicDetection";
import { AUTHORED_DIALOGUE } from "./authoredDialogue";
import { syncProgressionForOperator } from "./evidenceSources";
import { findUnauthorizedFirstPersonBiography } from "./personalEntailment";
import { PROGRESSION_POLICY, PROGRESSION_POLICY_VERSION } from "./policy";
import { recordProgressionEvidence, refreshProgression } from "./service";
import { createInMemoryProgressionStore, compareEntitlementCursor } from "./store";
import { GROWTH_ACTION_KINDS, STRONG_PROGRESS_KINDS, validateEvidenceInput } from "./evidence";

const SCOPE = { tenantId: "tenant-1", operatorUserId: "op-1" };
const aug = (n: number) => new Date(Date.UTC(2026, 7, n, 15));
const oct = (n: number, h = 15) => new Date(Date.UTC(2026, 9, n, h));
const context = {
  businessDate: "2026-09-18", actorId: "op-1",
  clock: buildClaireClock(new Date("2026-09-18T20:00:00Z"), CLAIRE_BUSINESS_TIME_ZONE),
  macroGoalKnown: false, blockers: [], relevantTimeline: [], mission: null,
} as unknown as ClaireDriveContext;

async function consistent(store: ReturnType<typeof createInMemoryProgressionStore>) {
  for (let i = 1; i <= 6; i += 1) {
    await recordProgressionEvidence(store, { ...SCOPE, category: "growth_action", kind: "confirmed_field_visit", sourceType: "m", sourceId: `g${i}`, provenance: "debrief_confirm", occurredAt: aug(i), recognizedAt: aug(i) });
  }
}
const progress = (store: ReturnType<typeof createInMemoryProgressionStore>, id: string, recognized: Date) =>
  recordProgressionEvidence(store, { ...SCOPE, category: "business_progress", kind: "new_paying_customer", sourceType: "order", sourceId: id, provenance: "x", occurredAt: oct(1), recognizedAt: recognized });

afterEach(() => { delete process.env.CLAIRE_PROGRESSION; vi.unstubAllEnvs(); });

describe("1. failure-safe entitlement cursor", () => {
  it("entitlement insertion failure: the cursor does not pass the event, and a retry still mints it", async () => {
    let fail = true;
    const store = createInMemoryProgressionStore({ failEntitlementInsert: () => fail });
    await consistent(store);
    await progress(store, "p1", oct(1));
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => oct(20) });
    expect(await store.listEntitlements(SCOPE)).toHaveLength(0);
    expect((await store.getGrant(SCOPE))!.entitlementCursor).toBeNull();
    fail = false;
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => oct(21) });
    expect(await store.listEntitlements(SCOPE)).toHaveLength(1);
  });

  it("equal recognizedAt timestamps: neither event disappears, ordered by (recognizedAt, evidenceId)", async () => {
    const store = createInMemoryProgressionStore();
    await consistent(store);
    await progress(store, "seed", oct(1));
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => oct(10) }); // initial funding
    const sameInstant = oct(15);
    await progress(store, "a", sameInstant);
    await progress(store, "b", sameInstant);
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => oct(16) });
    expect(await store.listEntitlements(SCOPE)).toHaveLength(3);
    // The cursor itself is a total order even at identical timestamps.
    expect(compareEntitlementCursor("2026-10-15T15:00:00.000Z|9", "2026-10-15T15:00:00.000Z|10")).toBeLessThan(0);
    expect(compareEntitlementCursor("2026-10-15T15:00:00.000Z|abc", "2026-10-15T15:00:00.000Z|abd")).toBeLessThan(0);
  });

  it("partial multi-event failure: the successful mint is not duplicated and the failed one retries", async () => {
    let failId: string | null = null;
    const store = createInMemoryProgressionStore({ failEntitlementInsert: id => id === failId });
    await consistent(store);
    await progress(store, "seed", oct(1));
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => oct(10) });
    const evidence = await Promise.all(["e1", "e2", "e3"].map((id, i) => progress(store, id, oct(12 + i))));
    failId = (evidence[1] as { ok: true; evidence: { id: string } }).evidence.id; // e2 fails
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => oct(20) });
    expect(await store.listEntitlements(SCOPE)).toHaveLength(2); // seed + e1; e2 failed; e3 not yet attempted
    failId = null;
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => oct(21) });
    const all = await store.listEntitlements(SCOPE);
    expect(all).toHaveLength(4); // seed, e1, e2, e3 — no duplicates
    expect(new Set(all.map(e => e.evidenceId)).size).toBe(4);
  });
});

describe("2. flag OFF reproduces the pre-#180 routing and disclosure path", () => {
  it("the broad personal classifier only applies when ON", () => {
    for (const question of ["Do you have siblings?", "What was your first job?", "Where do you live?"]) {
      expect(detectClaireConversationalMode(question, false)).toBe("operational");
      expect(detectClaireConversationalMode(question, true)).toBe("personal");
    }
  });

  it("the legacy broad relationship regex is preserved when OFF and narrowed only when ON", () => {
    expect(detectClaireConversationalMode("What's my relationship with Greystar?", false)).toBe("personal"); // legacy quirk, preserved
    expect(detectClaireConversationalMode("What's my relationship with Greystar?", true)).toBe("operational");
  });

  it("with the flag OFF an unknown personal question reaches the general model path exactly as before, unguarded", async () => {
    process.env.CLAIRE_PROGRESSION = "some-other-tenant"; // tenant-1 not listed => OFF
    const invokeText = vi.fn().mockResolvedValue("I have two sisters.");
    const reply = await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "Do you have siblings?", brief: "b", context },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    expect(invokeText).toHaveBeenCalledTimes(1);
    expect(reply).toBe("I have two sisters."); // legacy behavior: no controller, no biography guard, no verifier
  });
});

describe("3. Claire's general model can never create Claire history", () => {
  const PERSONAL = ["What happened to you in 2014?", "Have you ever broken a bone?", "What was your first job?", "What's the worst thing that's ever happened to you?", "Have you ever been arrested?"];
  it.each(PERSONAL)("routes into the guarded controller and declines without the model: %s", async question => {
    expect(detectClaireConversationalMode(question, true)).toBe("personal");
    const invokeText = vi.fn();
    const reply = await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: question, brief: "b", context, conversationId: "c" },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined), progressionStore: createInMemoryProgressionStore() }
    );
    expect(invokeText).not.toHaveBeenCalled();
    expect(AUTHORED_DIALOGUE.map(l => l.text)).toContain(reply);
  });

  it.each(["I broke my arm once.", "My first job was in a museum.", "Years ago I worked in a bakery.", "I nearly died in 2011."])(
    "a newly invented autobiographical statement is never spoken on a business turn: %s",
    async invented => {
      const reply = await answerClairePreDriveFollowUp(
        { tenantId: "tenant-1", utterance: "What should I lead with at The Louise?", brief: "b", context },
        { invokeText: vi.fn().mockResolvedValue(`Lead with the pilot. ${invented}`), recordGeneration: vi.fn().mockResolvedValue(undefined), progressionStore: createInMemoryProgressionStore() }
      );
      expect(reply).not.toMatch(/broke|museum|bakery|died/);
      expect(AUTHORED_DIALOGUE.map(l => l.text)).toContain(reply);
    }
  );

  it("normal business questions and Claire's business first-person statements are not degraded", () => {
    for (const q of ["What's your first recommendation for The Louise?", "What was your analysis of the Louise numbers?", "What can you do in Goldline?", "Have the numbers changed since 2026 started?", "What's your plan for tomorrow?", "Can you build a report of last week's orders?"]) {
      expect([q, isPersonalQuestionAboutClaire(q)]).toEqual([q, false]);
    }
    for (const t of ["My first recommendation is to lead with the pilot.", "I'd start with the pilot once you have the quote.", "I looked at the numbers and The Louise is the priority.", "I was thinking we lead with the quote in 2026.", "I can draft that follow-up."]) {
      expect([t, findUnauthorizedFirstPersonBiography(t, [])]).toEqual([t, null]);
    }
  });
});

describe("5. only truthful effort/progress sources are live", () => {
  it("unsupported kinds are rejected outright, and text can create none of them", () => {
    for (const kind of ["committed_sales_call_done", "approved_outreach_sent", "door_hangers_done", "returned_after_no", "other_committed_field_action"]) {
      expect(validateEvidenceInput({ category: "growth_action", kind, occurredAt: oct(1).toISOString(), recognizedAt: oct(1).toISOString() }).ok).toBe(false);
    }
    for (const kind of ["first_paid_order_target_building", "attributable_new_revenue", "next_meeting_scheduled", "property_approval_recorded", "deal_stage_advanced"]) {
      expect(validateEvidenceInput({ category: "business_progress", kind, occurredAt: oct(1).toISOString(), recognizedAt: oct(1).toISOString() }).ok).toBe(false);
    }
    expect([...GROWTH_ACTION_KINDS]).toEqual(["confirmed_field_visit", "follow_up_done"]);
    expect([...STRONG_PROGRESS_KINDS]).toEqual(["target_account_won", "new_paying_customer", "dormant_customer_reorder"]);
  });

  it("completed commercial follow-ups become effort evidence; sync is idempotent", async () => {
    const store = createInMemoryProgressionStore();
    const loadFollowUps = async () => [{ id: "fu-1", completedAt: aug(3) }, { id: "fu-2", completedAt: aug(4) }];
    for (let i = 0; i < 2; i += 1) {
      await syncProgressionForOperator(SCOPE, { store, force: true, loadTruth: async () => [], loadFollowUps, now: () => oct(10) });
    }
    const evidence = (await store.listEvidence(SCOPE)).filter(e => e.category === "growth_action");
    expect(evidence.map(e => [e.kind, e.sourceId])).toEqual([["follow_up_done", "fu-1"], ["follow_up_done", "fu-2"]]);
    expect(evidence.every(e => e.provenance === "commercial_follow_up_completed")).toBe(true);
  });

  it("one failing source (order truth) does not hide the other (follow-ups)", async () => {
    const store = createInMemoryProgressionStore();
    await syncProgressionForOperator(SCOPE, {
      store, force: true, now: () => oct(10),
      loadTruth: async () => { throw new Error("db down"); },
      loadFollowUps: async () => [{ id: "fu-9", completedAt: aug(5) }],
    });
    expect((await store.listEvidence(SCOPE)).map(e => e.sourceId)).toEqual(["fu-9"]);
  });

  it("no environment variable stands in for target-building truth", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./evidenceSources.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/TARGET_BUILDINGS/);
  });
});

describe("6. the flag cannot turn itself on in a deployed process", () => {
  it("an unset or unknown NODE_ENV behaves like production; only test/development default on", async () => {
    const { isClaireProgressionEnabled } = await import("./progressionFlag");
    for (const env of ["", "staging", "production"]) {
      vi.stubEnv("NODE_ENV", env);
      expect(isClaireProgressionEnabled("goldline")).toBe(false);
    }
    vi.stubEnv("NODE_ENV", "development");
    expect(isClaireProgressionEnabled("goldline")).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(isClaireProgressionEnabled("goldline")).toBe(false);
  });
});

describe("7. policy version", () => {
  it("was bumped for the changed semantics", () => {
    expect(PROGRESSION_POLICY_VERSION).toBe("rapport-disclosure-2026-09-19.2");
    expect(PROGRESSION_POLICY.version).toBe(PROGRESSION_POLICY_VERSION);
  });
});
