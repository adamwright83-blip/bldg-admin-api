import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Business knowledge on real MySQL (drizzle/0163). Local disposable database only. */
const url = process.env.DATABASE_URL ?? "";
const allowed = (() => {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.pathname === "/first_ten_test";
  } catch {
    return false;
  }
})();
process.env.JWT_SECRET ||= "first-ten-integration-secret-000000000000";

const now = new Date("2026-10-31T16:00:00Z");
const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const all = () => ({ covered: () => true });

describe.skipIf(!allowed)("business knowledge on MySQL", () => {
  let db: mysql.Connection;
  beforeAll(async () => {
    db = await mysql.createConnection(url);
  }, 60_000);
  afterAll(async () => {
    await db?.end();
  });

  const scope = () => ({ journeyId: randomUUID(), tenantId: null as string | null });

  it("ingestion is idempotent: the same entity, evidence and event twice is one row each", async () => {
    const store = await import("./store");
    const s = scope();
    const a = await store.upsertEntity(s, { kind: "company", name: "Rinse Farm LLC" });
    const b = await store.upsertEntity(s, { kind: "company", name: "rinse farm" });
    expect(a).toBe(b);
    const e1 = await store.recordEvidence(s, null, { provider: "gmail", sourceRef: "m1", label: "You, to A", excerpt: "Your Rinse Farm pickup", occurredAt: at("2026-10-01") });
    const e2 = await store.recordEvidence(s, null, { provider: "gmail", sourceRef: "m1", label: "You, to A", excerpt: "Your Rinse Farm pickup", occurredAt: at("2026-10-01") });
    expect(e1).toBe(e2);
    for (let i = 0; i < 2; i += 1) {
      await store.recordTimelineEvent(s, null, { entityId: a, kind: "operations", signal: "owner_action", summary: "pickup", occurredAt: at("2026-10-01"), evidenceId: e1, basis: "direct" });
    }
    expect(await store.timeline(s)).toHaveLength(1);
    const [[count]] = (await db.query("SELECT COUNT(*) AS n FROM business_knowledge_evidence WHERE journey_id = ?", [s.journeyId])) as any;
    expect(Number(count.n)).toBe(1);
  });

  it("evidence excerpts are short and redacted before they are stored", async () => {
    const store = await import("./store");
    const s = scope();
    const id = await store.recordEvidence(s, null, { provider: "gmail", sourceRef: "bank", label: "Bank", excerpt: `Account number 004512339871 ${"x".repeat(900)}` });
    const [row] = await store.evidenceByIds(s, [id]);
    expect(row.excerpt).not.toContain("004512339871");
    expect(row.excerpt.length).toBeLessThanOrEqual(300);
  });

  it("corrections are versioned: superseded, never overwritten; an inference never replaces the person's answer", async () => {
    const store = await import("./store");
    const s = scope();
    const web = await store.upsertEntity(s, { kind: "project", name: "Website design for salons" });
    const first = await store.assertClaim(s, { subjectEntityId: web, predicate: "status", value: "dormant", basis: "inferred", confidence: 60, rationale: "quiet since April", evidenceIds: ["e1"], createdBy: "reconciler" });
    expect(first.outcome).toBe("created");
    const again = await store.assertClaim(s, { subjectEntityId: web, predicate: "status", value: "dormant", basis: "inferred", confidence: 61, rationale: "quiet since April", evidenceIds: ["e1", "e2"], createdBy: "reconciler" });
    expect(again.outcome).toBe("unchanged");
    const user = await store.assertClaim(s, { subjectEntityId: web, predicate: "status", value: "historical", basis: "user_corrected", detail: "I don't do websites any more", confidence: 100, rationale: "You said so.", evidenceIds: [], createdBy: "user" });
    expect(user.outcome).toBe("superseded");
    const inferredLater = await store.assertClaim(s, { subjectEntityId: web, predicate: "status", value: "active", basis: "inferred", confidence: 60, rationale: "a new proposal", evidenceIds: ["e3"], createdBy: "reconciler" });
    expect(inferredLater.outcome).toBe("conflict");
    const history = await store.assertionHistory(s, store.claimKeyOf("status", web, null));
    expect(history.map(row => [row.version, row.value, row.state])).toEqual([
      [1, "dormant", "superseded"],
      [2, "historical", "current"],
      [2, "active", "conflict"],
    ]);
    expect(history[0].supersededById).toBe(history[1].id);
    // the person settles the conflict: their new answer supersedes, and the conflict is no longer open
    await store.assertClaim(s, { subjectEntityId: web, predicate: "status", value: "active", basis: "user_corrected", detail: "One last client", confidence: 100, rationale: "You said so.", evidenceIds: [], createdBy: "user" });
    const live = await store.liveAssertions(s, { subjectEntityId: web });
    expect(live.map(row => [row.value, row.state, row.basis])).toEqual([["active", "current", "user_corrected"]]);
  });

  it("only the person can make two names one legal entity, and nothing ever authorises a financial merge", async () => {
    const store = await import("./store");
    const s = scope();
    const farm = await store.upsertEntity(s, { kind: "company", name: "Rinse Farm" });
    const valet = await store.upsertEntity(s, { kind: "brand", name: "Rinse Valet" });
    await expect(
      store.assertClaim(s, { subjectEntityId: valet, predicate: "relationship", objectEntityId: farm, value: "same_legal_entity", basis: "inferred", confidence: 90, rationale: "names", evidenceIds: [], createdBy: "investigator" })
    ).rejects.toThrow(/Only the person/);
    await store.assertClaim(s, { subjectEntityId: valet, predicate: "relationship", objectEntityId: farm, value: "same_legal_entity", basis: "user_confirmed", confidence: 100, rationale: "You said so.", evidenceIds: [], createdBy: "user" });
    const [[row]] = (await db.query("SELECT authorizes_financial_merge AS m FROM business_knowledge_assertions WHERE journey_id = ?", [s.journeyId])) as any;
    expect(Number(row.m)).toBe(0);
    // one claim whichever way round it is put
    expect(store.claimKeyOf("relationship", farm, valet)).toBe(store.claimKeyOf("relationship", valet, farm));
  });

  it("isolation: another journey or another tenant never sees a row", async () => {
    const store = await import("./store");
    const mine = scope();
    const other = scope();
    const id = await store.upsertEntity(mine, { kind: "company", name: "Mine Ltd" });
    expect(await store.entities(other)).toEqual([]);
    expect(await store.entityById(other, id)).toBeNull();
    await store.bindKnowledgeTenant(mine.journeyId, "tenant-a");
    expect((await store.entities({ journeyId: mine.journeyId, tenantId: "tenant-a" })).map(row => row.name)).toEqual(["Mine Ltd"]);
    expect(await store.entities({ journeyId: mine.journeyId, tenantId: "tenant-b" })).toEqual([]);
    // once bound, the tenantless scope no longer reads it either
    expect(await store.entities(mine)).toEqual([]);
  });

  it("questions are asked once; reopened only when newer conflicting evidence changes the fingerprint", async () => {
    const store = await import("./store");
    const s = scope();
    const input = { topicKey: "relationship:a:b", kind: "relationship" as const, entityIds: ["a", "b"], question: "Are these the same?", why: "both recent", priority: 90, evidenceFingerprint: "f1" };
    const first = await store.proposeQuestion(s, input);
    expect(first.status).toBe("created");
    expect((await store.proposeQuestion(s, input)).status).toBe("exists");
    await store.updateQuestion(s, first.id, { status: "resolved", answerText: "Two names, one team" });
    expect((await store.proposeQuestion(s, input, { reopen: true })).status).toBe("exists");
    expect((await store.proposeQuestion(s, { ...input, evidenceFingerprint: "f2" })).status).toBe("exists");
    expect((await store.proposeQuestion(s, { ...input, evidenceFingerprint: "f2" }, { reopen: true })).status).toBe("reopened");
    expect((await store.questions(s))[0].answerText).toBe("Two names, one team");
  });

  it("one investigation at a time", async () => {
    const store = await import("./store");
    const s = scope();
    const run = await store.startRun(s, { kind: "full", trigger: "test", budget: { steps: 5 }, model: null });
    expect(run).toBeTruthy();
    expect(await store.startRun(s, { kind: "full", trigger: "test", budget: {}, model: null })).toBeNull();
    await store.finishRun(s, run!, { status: "complete", used: {}, coverage: [], research: [], notes: [], watermarkAt: now });
    expect(await store.startRun(s, { kind: "incremental", trigger: "test", budget: {}, model: null })).toBeTruthy();
  });

  it("chronology through reconciliation: active business, prelaunch product, dormant freelancing, collaborator across sources", async () => {
    const store = await import("./store");
    const { reconcileStatuses, reconcileCollaborators } = await import("./reconcile");
    const { readBusinessUnderstanding } = await import("./understanding");
    const s = scope();
    const operator = await store.upsertEntity(s, { kind: "operator", name: "Sam Rivera", email: "sam@rinsefarm.example" });
    const farm = await store.upsertEntity(s, { kind: "company", name: "Rinse Farm" });
    const pivot = await store.upsertEntity(s, { kind: "product", name: "PIVOT" });
    const web = await store.upsertEntity(s, { kind: "project", name: "Website design for salons" });
    const dmitri = await store.upsertEntity(s, { kind: "person", name: "Dmitri Okafor", email: "dmitri@example.net" });
    const customer = await store.upsertEntity(s, { kind: "person", name: "Customer A", email: "a@example.com" });
    const ev = (provider: "gmail" | "docs" | "sheets" | "calendar", ref: string, iso: string) =>
      store.recordEvidence(s, null, { provider, sourceRef: ref, label: ref, excerpt: ref, occurredAt: at(iso) });
    for (const [i, iso] of ["2026-09-01", "2026-10-01", "2026-10-20"].entries()) {
      await store.recordTimelineEvent(s, null, { entityId: farm, kind: "operations", signal: "owner_action", summary: "pickup", occurredAt: at(iso), evidenceId: await ev("gmail", `farm${i}`, iso), basis: "direct" });
    }
    await store.recordTimelineEvent(s, null, { entityId: pivot, kind: "planning", signal: "owner_action", summary: "roadmap", occurredAt: at("2026-10-28"), evidenceId: await ev("docs", "roadmap", "2026-10-28"), basis: "direct" });
    await store.recordTimelineEvent(s, null, { entityId: pivot, kind: "status_statement", signal: "mention", statedStatus: "prelaunch", summary: "Status: prelaunch", occurredAt: at("2026-10-28"), evidenceId: await ev("docs", "roadmap-status", "2026-10-28"), basis: "direct" });
    await store.recordTimelineEvent(s, null, { entityId: web, kind: "proposal", signal: "owner_action", summary: "website proposal", occurredAt: at("2026-04-19"), evidenceId: await ev("gmail", "salon", "2026-04-19"), basis: "direct" });
    await store.recordTimelineEvent(s, null, { entityId: web, kind: "document", signal: "metadata", summary: "template modified", occurredAt: at("2026-10-29"), evidenceId: await ev("docs", "template", "2026-10-29"), basis: "direct" });
    // the collaborator: a little mail, a document, a spreadsheet, a calendar series
    await store.recordTimelineEvent(s, null, { entityId: dmitri, relatedEntityId: farm, kind: "correspondence", signal: "owner_action", summary: "routes", occurredAt: at("2026-09-02"), evidenceId: await ev("gmail", "d1", "2026-09-02"), basis: "direct" });
    await store.recordTimelineEvent(s, null, { entityId: dmitri, relatedEntityId: farm, kind: "document", signal: "mention", summary: "Operations lead", occurredAt: at("2026-10-22"), evidenceId: await ev("docs", "manual", "2026-10-22"), basis: "direct" });
    await store.recordTimelineEvent(s, null, { entityId: dmitri, kind: "meeting", signal: "counterpart_action", summary: "Ops sync", occurredAt: at("2026-10-12"), evidenceId: await ev("calendar", "sync", "2026-10-12"), basis: "direct" });
    // the customer: lots of mail only
    for (let i = 0; i < 6; i += 1) {
      await store.recordTimelineEvent(s, null, { entityId: customer, kind: "correspondence", signal: "owner_action", summary: "pickup", occurredAt: at(`2026-10-0${i + 1}`), evidenceId: await ev("gmail", `c${i}`, `2026-10-0${i + 1}`), basis: "direct" });
    }

    const decisions = await reconcileStatuses(s, { coverage: all, now });
    const status = (id: string) => decisions.find(item => item.entityId === id)!.decision.status;
    expect(status(farm)).toBe("active");
    expect(status(pivot)).toBe("prelaunch");
    expect(status(web)).toBe("dormant");
    const operatorRow = (await store.entityById(s, operator))!;
    const chosen = await reconcileCollaborators(s, operatorRow, now);
    expect(chosen.map(item => item.name)).toEqual(["Dmitri Okafor"]);

    const understanding = await readBusinessUnderstanding(s);
    expect(understanding.current.map(item => item.name)).toEqual(["Rinse Farm"]);
    expect(understanding.prelaunch.map(item => item.name)).toEqual(["PIVOT"]);
    expect(understanding.dormant.map(item => item.name)).toEqual(["Website design for salons"]);
    expect(understanding.people.map(item => item.name)).toEqual(["Dmitri Okafor"]);
    expect(understanding.people[0].sources.length).toBeGreaterThan(0);

    // reconciling again changes nothing
    await reconcileStatuses(s, { coverage: all, now });
    const [[versions]] = (await db.query("SELECT COUNT(*) AS n FROM business_knowledge_assertions WHERE journey_id = ?", [s.journeyId])) as any;
    expect(Number(versions.n)).toBe(4);
  });

  it("forgetting a scope removes every business-knowledge row for it and nothing else", async () => {
    const store = await import("./store");
    const a = scope();
    const b = scope();
    await store.upsertEntity(a, { kind: "company", name: "A" });
    await store.upsertEntity(b, { kind: "company", name: "B" });
    await store.forgetKnowledge(a);
    expect(await store.entities(a)).toEqual([]);
    expect((await store.entities(b)).map(row => row.name)).toEqual(["B"]);
  });
});
