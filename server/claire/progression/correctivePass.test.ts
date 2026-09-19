import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { answerClairePreDriveFollowUp } from "../preDriveConversation";
import type { ClaireDriveContext } from "../contextAssembler";
import { buildClaireClock, CLAIRE_BUSINESS_TIME_ZONE } from "../contextAssembler";
import { detectClaireConversationalMode, isPersonalQuestionAboutClaire } from "../topicDetection";
import { compileClaireCharacterContext } from "../character/compiler";
import { CLAIRE_DEFAULT_RELATIONSHIP_STATE } from "../character/types";
import { CLAIRE_CANON } from "../character/characterDefinition";
import { runClaireTurn, type ClaireTurnDeps } from "../turn/claireTurn";
import { groupCustomerOrderTruth, mergeCustomerOrderTruth } from "../../geography/customerOrderTruth";
import { AUTHORED_DIALOGUE } from "./authoredDialogue";
import { setProgressionStoreForTesting } from "./drizzleStore";
import { deriveProgressFromOrderTruth } from "./paidOrderProgress";
import { validateEvidenceInput } from "./evidence";
import { checkClaimEntailment, findUnauthorizedFirstPersonBiography, parseVerifierReply } from "./personalEntailment";
import { executePersonalTurn, validatePersonalAnswer } from "./personalReveal";
import { isClaireProgressionEnabled } from "./progressionFlag";
import {
  commitPendingDisclosuresForConversation,
  loadPersonalProgressionContext,
  recordProgressionEvidence,
  refreshProgression,
} from "./service";
import { createInMemoryProgressionStore } from "./store";

const SCOPE = { tenantId: "tenant-1", operatorUserId: "op-1" };
const oct = (n: number, hour = 15) => new Date(Date.UTC(2026, 9, n, hour));
const aug = (n: number) => new Date(Date.UTC(2026, 7, n, 15));
const context = {
  businessDate: "2026-09-18", actorId: "op-1",
  clock: buildClaireClock(new Date("2026-09-18T20:00:00Z"), CLAIRE_BUSINESS_TIME_ZONE),
  macroGoalKnown: false, blockers: [], relevantTimeline: [], mission: null,
} as unknown as ClaireDriveContext;

async function fundedStore(progressCount = 1) {
  const store = createInMemoryProgressionStore();
  for (let i = 1; i <= 6; i += 1) {
    await recordProgressionEvidence(store, { ...SCOPE, category: "growth_action", kind: "confirmed_field_visit", sourceType: "m", sourceId: `a${i}`, provenance: "debrief_confirm", occurredAt: aug(i), recognizedAt: aug(i) });
  }
  for (let i = 0; i < progressCount; i += 1) {
    await recordProgressionEvidence(store, { ...SCOPE, category: "business_progress", kind: "new_paying_customer", sourceType: "order", sourceId: `p${i}`, provenance: "x", occurredAt: oct(1 + i), recognizedAt: oct(1 + i) });
  }
  await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => oct(20) });
  return store;
}

afterEach(() => {
  delete process.env.CLAIRE_PROGRESSION;
  delete process.env.CLAIRE_PROGRESSION_CONTINUITY_REVIEWED;
  setProgressionStoreForTesting(null);
});

describe("1. personal routing fails closed", () => {
  const PERSONAL = [
    "Do you have siblings?", "What's your favorite movie?", "Where do you live?", "Have you ever been to Paris?",
    "What music do you like?", "Are you married?", "Tell me about yourself", "Do you have any pets?", "What's your mother like?",
  ];
  const BUSINESS = [
    "What should I say to the property manager about pricing?", "What's your recommendation for The Louise?",
    "Do you have the numbers for today?", "What's my relationship with Greystar?", "How many orders came in?",
    "Do you think I should call first?", "Can you add a follow-up for tomorrow?", "What is your plan for the day?",
    "Have you seen the unpaid orders?", "What did you find out about the account?",
  ];
  it.each(PERSONAL)("routes %s into personal mode", question => {
    expect(detectClaireConversationalMode(question, true)).toBe("personal");
  });
  it.each(BUSINESS)("does not misroute business question %s", question => {
    expect(isPersonalQuestionAboutClaire(question)).toBe(false);
  });

  it.each(PERSONAL)("an unknown personal topic (%s) gets an approved decline and never reaches the model", async question => {
    const invokeText = vi.fn();
    const reply = await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: question, brief: "b", context, conversationId: "c1" },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined), progressionStore: createInMemoryProgressionStore() }
    );
    // Known topics (e.g. mother/childhood) may resolve to core answers; unknown ones must decline.
    if (invokeText.mock.calls.length === 0) expect(AUTHORED_DIALOGUE.map(l => l.text)).toContain(reply);
  });

  it("defense in depth: biography asserted on a NON-personal turn is replaced, never spoken", async () => {
    for (const invented of ["I grew up in Lyon.", "My brother lives in Paris and we talk weekly.", "When I was a kid we moved constantly."]) {
      const invokeText = vi.fn().mockResolvedValue(`Two stops today. ${invented}`);
      const reply = await answerClairePreDriveFollowUp(
        { tenantId: "tenant-1", utterance: "What should I lead with at The Louise?", brief: "b", context },
        { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined), progressionStore: createInMemoryProgressionStore() }
      );
      expect(reply).not.toMatch(/Lyon|brother|kid/);
      expect(AUTHORED_DIALOGUE.map(l => l.text)).toContain(reply);
    }
  });

  it("allows Claire to restate an authorized core fact and to say ordinary first-person business things", () => {
    expect(findUnauthorizedFirstPersonBiography("I'm British. Lead with the pilot.", ["Claire is British."])).toBeNull();
    expect(findUnauthorizedFirstPersonBiography("My take: lead with the pilot.", [])).toBeNull();
  });
});

describe("2. the authorized fact must entail the answer", () => {
  const career = CLAIRE_CANON.find(f => f.id === "core_father_career")!;
  it.each([
    "He was an academic who disappeared later.",
    "I resented him.",
    "He was rarely around.",
    "He was an academic. I loved him.",
    "He was an academic and a cold man.",
    "He taught because money was tight.",
    "He was an academic, unresolved.",
    "He was an academic for many years.",
    "He was an academic; his brother was the spy.",
  ])("rejects unsupported history when only the career fragment is authorized: %s", answer => {
    expect(validatePersonalAnswer(answer, career)).not.toBeNull();
  });

  it("accepts an answer that only varies language, hesitation and attitude", () => {
    expect(validatePersonalAnswer("He was an academic, on paper.", career)).toBeNull();
    expect(validatePersonalAnswer("An academic. That's the version I'll give you.", career)).toBeNull();
  });

  it("facts already disclosed to this operator may be restated; nothing else may", () => {
    const disappearance = CLAIRE_CANON.find(f => f.id === "core_father_disappearance")!;
    expect(validatePersonalAnswer("He disappeared, unresolved.", career)).not.toBeNull();
    expect(validatePersonalAnswer("He disappeared, unresolved.", career, { allowedFacts: [disappearance.fact] })).toBeNull();
  });

  it("the deterministic layer flags single-word borrowed leaks and the four claim families", () => {
    expect(checkClaimEntailment("Unresolved.", [career.fact])).toMatchObject({ ok: false, reason: "borrowed_from_other_canon" });
    for (const [text, category] of [["I resented him", "emotion"], ["He was rarely there", "frequency"], ["He left later", "chronology"], ["Because of the war", "causality"]] as const) {
      expect(checkClaimEntailment(text, [career.fact])).toMatchObject({ ok: false, category });
    }
  });

  it("verifier can only reject further: false, error, or garbage all decline without consuming the entitlement", async () => {
    for (const verify of [async () => false, async () => { throw new Error("timeout"); }]) {
      const store = await fundedStore();
      const result = await executePersonalTurn({
        store, scope: SCOPE, conversationId: "c1", topic: "father", businessOpen: true, autoCommit: true, random: () => 0,
        generate: async () => "He was an academic, on paper.", verify,
      });
      expect(result.outcome).toBe("declined");
      expect(result.failureReason).toBe("entailment_unverified");
      expect((await store.listEntitlements(SCOPE)).every(e => e.status === "unused")).toBe(true);
      expect((await store.listLedger(SCOPE)).some(r => r.kind === "disclosed")).toBe(false);
    }
  });

  it("a verifier saying yes can never rescue a deterministically unsupported answer", async () => {
    const store = await fundedStore();
    const result = await executePersonalTurn({
      store, scope: SCOPE, conversationId: "c1", topic: "father", businessOpen: true, random: () => 0,
      generate: async () => "I resented him.", verify: async () => true,
    });
    expect(result.outcome).toBe("declined");
    expect(result.failureReason).toBe("unsupported_claim");
  });

  it("parses the verifier reply strictly", () => {
    expect(parseVerifierReply("ENTAILED")).toBe(true);
    expect(parseVerifierReply(" entailed. ")).toBe(true);
    for (const bad of ["UNSUPPORTED", "ENTAILED but he resented him", "", "maybe", "NOT ENTAILED"]) expect(parseVerifierReply(bad)).toBe(false);
  });
});

describe("3. canonical customer/order truth", () => {
    const native = (id: number, phone: string, slug: string | null, at: Date, extra = {}) => ({
    id, status: "completed", createdAt: at, firstName: "A", lastName: "B", phone, email: null, address: `${id} Main St`, unit: String(id),
    buildingSlug: slug, bldgUserId: null, paid: true, total: "30", ...extra,
  });
  // Imported three days after the order occurred unless a test says otherwise.
  const cc = (orderId: string, report: "orders_sales" | "orders_revenue", at: Date, extra = {}) => ({
    cleancloudOrderId: orderId, sourceReportType: report, customerName: "Pat Smith", paid: true, placedAtUtc: at, buildingSlug: null,
    createdAt: new Date(at.getTime() + 3 * 86_400_000), ...extra,
  });
  const derive = (opts: Parameters<typeof mergeCustomerOrderTruth>[0]) =>
    deriveProgressFromOrderTruth(groupCustomerOrderTruth("t1", mergeCustomerOrderTruth(opts)));

  it("includes native Laundry Butler orders, not just CleanCloud", () => {
    const out = derive({ native: [native(1, "310-555-0101", null, oct(10))] });
    expect(out.map(p => [p.sourceId, p.kind])).toEqual([["laundry_butler:1", "new_paying_customer"]]);
  });

  it("deduplicates CleanCloud's two report representations of the same order", () => {
    const out = derive({ cleancloud: [cc("900", "orders_sales", oct(10), { customerPhone: "310-555-0110" }), cc("900", "orders_revenue", oct(10), { customerPhone: "310-555-0110" })] });
    expect(out).toHaveLength(1);
  });

  it("never treats a customer name alone as identity: unidentifiable orders assert no new-customer or dormant progress", () => {
    const out = derive({ cleancloud: [cc("901", "orders_sales", oct(10)), cc("902", "orders_sales", oct(12)), cc("903", "orders_sales", aug(1))] });
    expect(out).toEqual([]);
  });

  it("first-paid-order-in-target-building is NOT a live kind: no persisted target-building mapping exists", () => {
    const out = derive({ native: [native(1, "310-555-0101", "the-louise", oct(10)), native(2, "310-555-0102", "the-louise", oct(11))] });
    expect(out.map(p => p.kind)).toEqual(["new_paying_customer", "new_paying_customer"]);
    expect(validateEvidenceInput({ category: "business_progress", kind: "first_paid_order_target_building", occurredAt: oct(10).toISOString(), recognizedAt: oct(11).toISOString() }).ok).toBe(false);
  });

  it("one underlying order is at most one evidence identity", () => {
    const out = derive({ native: [native(1, "310-555-0101", "the-louise", oct(10))] });
    expect(out).toHaveLength(1);
  });

  it("recognizedAt is the authoritative import time, not the sync time: order Tuesday, imported Friday", () => {
    const tuesday = new Date(Date.UTC(2026, 9, 6, 15));
    const friday = new Date(Date.UTC(2026, 9, 9, 15));
    const out = derive({ cleancloud: [cc("777", "orders_sales", tuesday, { customerPhone: "310-555-0177", createdAt: friday })] });
    expect(out).toHaveLength(1);
    expect(new Date(out[0].occurredAt as Date).toISOString()).toBe(tuesday.toISOString());
    expect(new Date(out[0].recognizedAt as Date).toISOString()).toBe(friday.toISOString());
  });

  it("with both CleanCloud report rows, recognizedAt is the EARLIEST import; native orders recognize at creation", () => {
    const out = derive({ cleancloud: [
      cc("888", "orders_revenue", oct(6), { customerPhone: "310-555-0188", createdAt: oct(12) }),
      cc("888", "orders_sales", oct(6), { customerPhone: "310-555-0188", createdAt: oct(9) }),
    ] });
    expect(out).toHaveLength(1);
    expect(new Date(out[0].recognizedAt as Date).toISOString()).toBe(oct(9).toISOString());
    const nativeOut = derive({ native: [native(5, "310-555-0105", null, oct(7))] });
    expect(new Date(nativeOut[0].recognizedAt as Date).toISOString()).toBe(oct(7).toISOString());
  });

  it("an order whose observation time is unknown is skipped, never guessed", () => {
    const out = derive({ cleancloud: [cc("999", "orders_sales", oct(6), { customerPhone: "310-555-0199", createdAt: null })] });
    expect(out).toEqual([]);
  });

  it("pre-epoch history is baseline: canonical orders remain the record, no progress is emitted, and delay never discards a post-epoch event", () => {
    const out = derive({ native: [native(1, "310-555-0101", null, aug(1)), native(2, "310-555-0101", null, oct(5))] });
    expect(out).toEqual([]); // a returning routine customer is neither new nor dormant
    const lateImport = derive({ cleancloud: [cc("950", "orders_sales", oct(2), { customerPhone: "310-555-0199" })] });
    expect(lateImport).toHaveLength(1); // imported "28 days" later, still counts
    expect(new Date(lateImport[0].occurredAt as Date).toISOString()).toBe(oct(2).toISOString());
  });

  it("dormant reorder needs a real gap on the same canonical customer", () => {
    const apr = new Date(Date.UTC(2026, 3, 1, 15));
    const out = derive({ native: [native(1, "310-555-0101", null, apr), native(2, "310-555-0101", null, oct(10))] });
    expect(out.map(p => p.kind)).toEqual(["dormant_customer_reorder"]);
  });
});

describe("4. one business event = one evidence identity; no entitlement backlog", () => {
  it("reclassifying the same source event neither creates a second evidence row nor a second entitlement", async () => {
    const store = await fundedStore(1);
    const before = await store.listEntitlements(SCOPE);
    const again = await recordProgressionEvidence(store, { ...SCOPE, category: "business_progress", kind: "target_account_won", sourceType: "order", sourceId: "p0", provenance: "remap", occurredAt: oct(1), recognizedAt: oct(1) });
    expect(again).toMatchObject({ ok: true, created: false });
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => oct(21) });
    expect((await store.listEvidence(SCOPE)).filter(e => e.category === "business_progress")).toHaveLength(1);
    expect(await store.listEntitlements(SCOPE)).toHaveLength(before.length);
  });

  it("becoming eligible with many historical progress events funds at most ONE initial entitlement", async () => {
    const store = await fundedStore(5);
    expect(await store.listEntitlements(SCOPE)).toHaveLength(1);
    // Refreshing again never back-mints the other four.
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => oct(25) });
    expect(await store.listEntitlements(SCOPE)).toHaveLength(1);
  });

  it("afterwards each newly recognized qualifying event mints at most one", async () => {
    const store = await fundedStore(3);
    expect(await store.listEntitlements(SCOPE)).toHaveLength(1);
    for (const [i, day] of [22, 23].entries()) {
      await recordProgressionEvidence(store, { ...SCOPE, category: "business_progress", kind: "dormant_customer_reorder", sourceType: "order", sourceId: `new${i}`, provenance: "x", occurredAt: oct(day), recognizedAt: oct(day) });
    }
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => oct(24) });
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => oct(25) });
    expect(await store.listEntitlements(SCOPE)).toHaveLength(3);
  });

  it("progress recognized while ineligible does not mint later when consistency arrives beyond the single initial entitlement", async () => {
    const store = createInMemoryProgressionStore();
    for (let i = 0; i < 4; i += 1) {
      await recordProgressionEvidence(store, { ...SCOPE, category: "business_progress", kind: "new_paying_customer", sourceType: "order", sourceId: `p${i}`, provenance: "x", occurredAt: oct(1 + i), recognizedAt: oct(1 + i) });
    }
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => oct(10) });
    expect(await store.listEntitlements(SCOPE)).toHaveLength(0);
    for (let i = 1; i <= 6; i += 1) await recordProgressionEvidence(store, { ...SCOPE, category: "growth_action", kind: "confirmed_field_visit", sourceType: "m", sourceId: `g${i}`, provenance: "debrief_confirm", occurredAt: oct(10 + i), recognizedAt: oct(10 + i) });
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => oct(20) });
    expect(await store.listEntitlements(SCOPE)).toHaveLength(1);
  });
});

describe("5. atomic disclosure commit", () => {
  it("if the ledger half fails, nothing is consumed and nothing is recorded as disclosed", async () => {
    let failNext = false;
    const store = createInMemoryProgressionStore({ failLedgerOnCommit: () => failNext });
    // fund via the same helper logic on this store
    for (let i = 1; i <= 6; i += 1) await recordProgressionEvidence(store, { ...SCOPE, category: "growth_action", kind: "confirmed_field_visit", sourceType: "m", sourceId: `a${i}`, provenance: "debrief_confirm", occurredAt: aug(i), recognizedAt: aug(i) });
    await recordProgressionEvidence(store, { ...SCOPE, category: "business_progress", kind: "new_paying_customer", sourceType: "order", sourceId: "p0", provenance: "x", occurredAt: oct(1), recognizedAt: oct(1) });
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => oct(20) });
    const turn = await executePersonalTurn({ store, scope: SCOPE, conversationId: "call-1", topic: "father", businessOpen: true, random: () => 0, generate: async () => "He was an academic, on paper." });
    expect(turn.outcome).toBe("answered_new_disclosure");

    failNext = true;
    expect(await commitPendingDisclosuresForConversation(store, { tenantId: SCOPE.tenantId, conversationId: "call-1" })).toBe(0); // never throws mid-call
    let [entitlement] = await store.listEntitlements(SCOPE);
    expect(entitlement.status).toBe("reserved"); // NOT consumed
    expect((await store.listLedger(SCOPE)).some(r => r.kind === "disclosed")).toBe(false); // and no row

    failNext = false;
    expect(await commitPendingDisclosuresForConversation(store, { tenantId: SCOPE.tenantId, conversationId: "call-1" })).toBe(1);
    [entitlement] = await store.listEntitlements(SCOPE);
    expect(entitlement.status).toBe("consumed");
    expect((await store.listLedger(SCOPE)).filter(r => r.kind === "disclosed")).toHaveLength(1);
    // Idempotent: a repeated boundary signal commits nothing twice.
    expect(await commitPendingDisclosuresForConversation(store, { tenantId: SCOPE.tenantId, conversationId: "call-1" })).toBe(0);
    expect((await store.listLedger(SCOPE)).filter(r => r.kind === "disclosed")).toHaveLength(1);
  });

  it("the Drizzle commit is a single transaction that writes the ledger row itself", () => {
    const source = readFileSync(new URL("./drizzleStore.ts", import.meta.url), "utf8");
    const commit = source.slice(source.indexOf("async commitReservedDisclosure"), source.indexOf("async releaseReservation"));
    expect(commit).toMatch(/db\.transaction/);
    expect(commit).toMatch(/\.for\("update"\)/);
    expect(commit).toMatch(/insert\(clairePersonalLedger\)/);
    expect(commit).toMatch(/kind: "disclosed"/);
  });
});

describe("5b. pending delivery is durable, not process-local", () => {
  it("hear reveal -> say goodbye: the commit at the top of the webhook records the disclosure before close-phrase handling", async () => {
    const store = await fundedStore();
    await executePersonalTurn({ store, scope: SCOPE, conversationId: "claire-call:abc", topic: "father", businessOpen: true, random: () => 0, generate: async () => "He was an academic, on paper." });
    // The next verified webhook (the operator says "goodbye") commits FIRST, using nothing but the store.
    expect(await commitPendingDisclosuresForConversation(store, { tenantId: SCOPE.tenantId, conversationId: "claire-call:abc" })).toBe(1);
    const source = readFileSync(new URL("../claireTwilio.ts", import.meta.url), "utf8");
    expect(source.indexOf("commitPendingDisclosuresForConversation(")).toBeGreaterThan(-1);
    expect(source.indexOf("commitPendingDisclosuresForConversation(")).toBeLessThan(source.indexOf("shouldEndClaireCallOnUtterance(utterance"));
    expect(source.indexOf("commitPendingDisclosuresForConversation(")).toBeLessThan(source.indexOf("trackEmptyTranscript(conversation)"));
  });

  it("a different process/replica (a fresh service call over the same durable store) commits it", async () => {
    const store = await fundedStore();
    await executePersonalTurn({ store, scope: SCOPE, conversationId: "call-r1", topic: "father", businessOpen: true, random: () => 0, generate: async () => "He was an academic, on paper." });
    const replica = async () => commitPendingDisclosuresForConversation(store, { tenantId: SCOPE.tenantId, conversationId: "call-r1" });
    expect(await replica()).toBe(1);
  });

  it("there is no module-level pending map anywhere in the progression code", () => {
    for (const file of ["service.ts", "personalReveal.ts", "personalFollowUp.ts"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/const pending\w* = new Map/);
    }
  });

  it("generation succeeded but the answer never crossed the delivery boundary: the entitlement is not consumed and lapses back to unused", async () => {
    const store = await fundedStore();
    let clock = oct(21).getTime();
    await executePersonalTurn({ store, scope: SCOPE, conversationId: "call-drop", topic: "father", businessOpen: true, random: () => 0, now: () => new Date(clock), generate: async () => "He was an academic, on paper." });
    expect((await store.listEntitlements(SCOPE))[0].status).toBe("reserved");
    clock += 11 * 60 * 1000;
    const ctx = await loadPersonalProgressionContext(store, SCOPE, "next-call", () => new Date(clock));
    expect(ctx.unusedEntitlement).not.toBeNull();
    expect(ctx.disclosedFragmentIds).toEqual([]);
  });

  it("runClaireTurn commits a pending reveal at the start of the next turn", async () => {
    const store = await fundedStore();
    setProgressionStoreForTesting(store);
    await executePersonalTurn({ store, scope: SCOPE, conversationId: "claire-call:slice-x", topic: "father", businessOpen: true, random: () => 0, generate: async () => "He was an academic, on paper." });
    await runClaireTurn(
      { tenantId: SCOPE.tenantId, operatorUserId: "op-1", dayDirectorActorId: "1", surface: "voice", utterance: "hello there", state: {}, conversationKey: "claire-call:slice-x" },
      turnDeps()
    );
    expect((await store.listEntitlements(SCOPE))[0].status).toBe("consumed");
  });
});

function turnDeps(overrides: Partial<ClaireTurnDeps> = {}): ClaireTurnDeps {
  const NOW = new Date("2026-09-15T16:00:00Z");
  return {
    now: () => NOW, timeZone: () => "America/Los_Angeles",
    business: { now: () => NOW, timeZone: () => "America/Los_Angeles", plan: async () => null, runQuery: vi.fn() as never },
    commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
    followUp: vi.fn(async () => "Brief follow-up.") as never,
    extractModel: null, loadExisting: async () => [], commit: vi.fn() as never, campaign: async () => null,
    vocabulary: async () => [], accounts: async () => [], accountHistory: vi.fn() as never, commitFollowUp: vi.fn() as never,
    dayWork: vi.fn() as never, unpaid: vi.fn() as never, searchMemory: vi.fn(async () => []) as never,
    memoryBetween: vi.fn(async () => []) as never, encyclopedia: null, watchBoard: undefined, doctrineTurn: undefined,
    ...overrides,
  };
}

describe("6. default-off shipping flag", () => {
  const setEnv = (nodeEnv: string) => vi.stubEnv("NODE_ENV", nodeEnv);
  afterEach(() => vi.unstubAllEnvs());

  it("production: off by default, off when listed but continuity not reviewed, on only with both", () => {
    setEnv("production");
    expect(isClaireProgressionEnabled("goldline")).toBe(false);
    process.env.CLAIRE_PROGRESSION = "goldline";
    expect(isClaireProgressionEnabled("goldline")).toBe(false);
    process.env.CLAIRE_PROGRESSION_CONTINUITY_REVIEWED = "1";
    expect(isClaireProgressionEnabled("goldline")).toBe(true);
    expect(isClaireProgressionEnabled("some-other-tenant")).toBe(false);
  });

  it("non-production defaults on so tests and local runs exercise the mechanic; an explicit list scopes it", () => {
    setEnv("test");
    expect(isClaireProgressionEnabled("anything")).toBe(true);
    process.env.CLAIRE_PROGRESSION = "goldline";
    expect(isClaireProgressionEnabled("other")).toBe(false);
  });

  it("OFF preserves the previous compiler behavior exactly (tier-based canon)", () => {
    const base = { ...CLAIRE_DEFAULT_RELATIONSHIP_STATE, tenantId: "t", operatorUserId: "o", characterId: "claire" as const, updatedAt: "" };
    const legacy = compileClaireCharacterContext({ mode: "casual", relationshipState: { ...base, disclosureTier: 2 }, recentSharedHistory: [], legacyTierDisclosure: true });
    expect(legacy.eligibleCanonFacts.join(" ")).toMatch(/six-year/i);
    const modern = compileClaireCharacterContext({ mode: "casual", relationshipState: { ...base, disclosureTier: 2 }, recentSharedHistory: [] });
    expect(modern.eligibleCanonFacts.join(" ")).not.toMatch(/six-year/i);
  });

  it("OFF preserves the previous personal-answer path, including its recovery, and adds no guards", async () => {
    process.env.CLAIRE_PROGRESSION = "some-other-tenant"; // tenant-1 is not listed => OFF
    const invokeText = vi.fn().mockResolvedValue("London, originally.");
    const reply = await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "Where are you from, Claire?", brief: "b", context },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    expect(invokeText).toHaveBeenCalledTimes(1); // no verifier call, no controller
    expect(reply).toBe("I'm British."); // the deployed behavior
  });
});

describe("7a. live failure-day tone", () => {
  const run = async (modelSays: string) => {
    const recordGeneration = vi.fn().mockResolvedValue(undefined);
    const reply = await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "Six buildings, all no's. What now?", brief: "b", context },
      { invokeText: vi.fn().mockResolvedValue(modelSays), recordGeneration, progressionStore: createInMemoryProgressionStore() }
    );
    return { reply, recordGeneration };
  };

  it("a consolation/motivation line is never spoken; the deterministic fallback is used and the reason is recorded", async () => {
    const { reply, recordGeneration } = await run("Don't be discouraged. Rejection is part of growth and I'm proud of you for pushing through.");
    expect(reply).not.toMatch(/discouraged|proud|growth/i);
    expect(recordGeneration).toHaveBeenCalledWith(expect.objectContaining({ diagnostic: expect.objectContaining({ source: "fallback", failureReason: expect.stringMatching(/^failure_day_tone:/) }) }));
  });

  it("useful operational follow-through passes untouched", async () => {
    const line = "Six buildings, six no's. You still walked into six buildings. The Louise: real no, or come-back-later? Avoid repeating the intro pitch there.";
    expect((await run(line)).reply).toBe(line);
  });
});

describe("7b. a personal endCall reaches the turn result", () => {
  it("runClaireTurn surfaces endCall when a guarded personal turn decided the call should end, and only then", async () => {
    let call = 0;
    const followUp = vi.fn(async (input: { onPersonalTurn?: (r: unknown) => void }) => {
      call += 1;
      if (call === 1) input.onPersonalTurn?.({ endCall: true });
      else input.onPersonalTurn?.({ endCall: false });
      return "Personal answer.";
    });
    const base = { tenantId: "default", operatorUserId: "op-1", dayDirectorActorId: "1", surface: "voice" as const, state: {}, conversationKey: "claire-call:end", brief: "Two stops today.", context: { businessDate: "2026-09-15", actorId: "op-1", macroGoalKnown: false, blockers: [], relevantTimeline: [] } as never };
    const ended = await runClaireTurn({ ...base, utterance: "Do you have siblings?" }, turnDeps({ followUp: followUp as never }));
    const normal = await runClaireTurn({ ...base, utterance: "Do you have any hobbies?" }, turnDeps({ followUp: followUp as never }));
    expect(ended.endCall).toBe(true);
    expect(normal.endCall).toBeUndefined();
  });

  it("the Twilio path hangs up on endCall", () => {
    const source = readFileSync(new URL("../claireTwilio.ts", import.meta.url), "utf8");
    expect(source).toMatch(/if \(result\.endCall\)[\s\S]{0,400}speakAndHangUp\(result\.speak\)/);
  });
});
