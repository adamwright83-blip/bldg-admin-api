import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * What the first ten minutes learned, carried into the paid workspace, on real MySQL: the tenant's own journey only,
 * every fact with its receipt, the person's corrections winning, dismissed findings gone, and the first message's
 * state as the send ledger and reply detection actually have it. Local disposable database only.
 */
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

describe.skipIf(!allowed)("signup knowledge in the paid workspace, on MySQL", () => {
  let db: mysql.Connection;
  const tenant = `df_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const otherTenant = `df_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  let journeyId = "";

  beforeAll(async () => {
    db = await mysql.createConnection(url);
    await import("../journeys");
  }, 60_000);
  afterAll(async () => {
    if (journeyId) {
      await db.query("DELETE FROM gmail_inbound_messages WHERE conversation_ref = ?", [`first_ten:${journeyId}`]);
      await db.query("DELETE FROM gmail_sends WHERE send_key = ?", [`first_ten:${journeyId}`]);
    }
    await db?.end();
  });

  async function provisionedExample() {
    const { startJourney } = await import("../journeys");
    const { runReading } = await import("../understanding/run");
    const { readingDepsFor } = await import("../understanding/deps");
    const { claimReading } = await import("../understanding/store");
    const { journeyById, setJourneyStage } = await import("../store");
    const started = (await startJourney({ requestId: randomUUID(), kind: "example" })).journey;
    const runId = randomUUID();
    await claimReading(started.id, runId, { again: false });
    await runReading(started.id, runId, await readingDepsFor(started));
    await setJourneyStage(started.id, "chapter");
    // Nina's corpus, as if it were her own journey and her checkout had provisioned the workspace
    await db.query("UPDATE first_ten_journeys SET kind = 'own', tenant_id = ? WHERE id = ?", [tenant, started.id]);
    return (await journeyById(started.id))!;
  }

  it("carries the facts with their receipts, the person's corrections, and where the first message stands", async () => {
    const journey = await provisionedExample();
    journeyId = journey.id;
    const { readTenantOnboardingKnowledge } = await import("./tenantKnowledge");
    const { signupKnowledgeForBriefing, signupOpeningLine } = await import("../../../shared/firstTenMinutesKnowledge");

    // a workspace that isn't hers sees nothing of it
    expect(await readTenantOnboardingKnowledge(otherTenant)).toBeNull();
    expect(await readTenantOnboardingKnowledge("")).toBeNull();

    const first = (await readTenantOnboardingKnowledge(tenant))!;
    expect(first.journeyId).toBe(journey.id);
    expect(first.business).toBeTruthy();
    expect(first.facts.length).toBeGreaterThan(5);
    for (const fact of first.facts) {
      expect(fact.id).toBeTruthy();
      expect(fact.statement.trim()).not.toBe("");
      expect(fact.sources.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(fact.learnedAt))).toBe(false);
    }
    // the opportunity the first chapter was about: Elena's own request
    expect(first.opportunity).toMatchObject({ person: { address: "elena@larkspurhotel.example" } });
    expect(first.facts.some(fact => fact.id === first.opportunity!.factId)).toBe(true);
    expect(first.message).toBeNull();

    // the person reacts: one rule changed in their words, one finding dismissed
    const rule = first.facts.find(fact => fact.kind === "rule")!;
    const dismissed = first.facts.find(fact => fact.kind === "habit")!;
    await db.query("UPDATE first_ten_findings SET status = 'changed', correction_text = ? WHERE id = ?", ["Sundays only for weddings.", rule.id]);
    await db.query("UPDATE first_ten_findings SET status = 'dismissed' WHERE id = ?", [dismissed.id]);

    // she prepares the message at the table
    const { recordChapterStep, prepareDraft } = await import("../chapter/chapter");
    await recordChapterStep(journey, "revealed");
    for (const step of ["glove", "shake", "quill", "dip"] as const) await recordChapterStep(journey, step);
    await recordChapterStep(journey, "letter_written");
    await prepareDraft(journey, new Date("2026-10-29T17:00:00Z"));

    const reacted = (await readTenantOnboardingKnowledge(tenant))!;
    expect(reacted.facts.find(fact => fact.id === rule.id)).toMatchObject({ status: "changed", statement: "Sundays only for weddings.", correction: "Sundays only for weddings." });
    expect(reacted.facts.some(fact => fact.id === dismissed.id)).toBe(false);
    expect(reacted.message).toMatchObject({ to: { address: "elena@larkspurhotel.example" }, subject: "Re: Friday flowers?", status: "prepared", sentAt: null, reply: { state: "not_sent" } });
    const zone = "America/Los_Angeles";
    const now = new Date("2026-11-02T17:00:00Z");
    expect(signupOpeningLine(signupKnowledgeForBriefing(reacted, zone), zone, now)).toBe("Your note to Elena Ruiz is still waiting at the table.");

    // it leaves, and Google answers with its id
    const { gmailSendLedger } = await import("../../integrations/gmail/gmailSendLedger");
    const sentAt = new Date("2026-10-30T16:00:00Z");
    await gmailSendLedger.claim({
      key: `first_ten:${journey.id}`,
      actor: "first_ten_onboarding",
      accountEmail: "nina@wildrootflowers.example",
      recipient: "elena@larkspurhotel.example",
      subject: "Re: Friday flowers?",
      digest: "d".repeat(64),
      approvedBy: `first_ten_journey:${journey.id}`,
      approvedAt: sentAt,
      rfc822MessageId: `<${journey.id}@joystick.test>`,
      status: "sending",
      gmailMessageId: null,
      gmailThreadId: null,
      attempts: 1,
      lastAttemptAt: sentAt,
      sentAt: null,
      failure: null,
    });
    await gmailSendLedger.settle(`first_ten:${journey.id}`, { status: "sent", gmailMessageId: "g-out", gmailThreadId: "th-elena", sentAt, failure: null });
    await db.query("UPDATE first_ten_drafts SET status = 'verified_sent', verified_sent_at = ?, verified_message_id = 'g-out' WHERE journey_id = ?", [sentAt, journey.id]);

    const sent = (await readTenantOnboardingKnowledge(tenant))!;
    expect(sent.message).toMatchObject({ status: "verified_sent", verified: true, sentAt: sentAt.toISOString(), gmailThreadId: "th-elena", reply: { state: "none_seen" } });
    expect(signupOpeningLine(signupKnowledgeForBriefing(sent, zone), zone, now)).toBe("Your note to Elena Ruiz went on Friday 30 October; I haven't seen a reply.");

    // reply detection records her answer in that thread
    const receivedAt = new Date("2026-11-01T18:30:00Z");
    await db.query(
      `INSERT INTO gmail_inbound_messages (mailbox_key, gmail_message_id, tenant_id, gmail_thread_id, kind, from_address, subject, snippet, received_at, conversation_kind, conversation_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`${tenant}:nina@wildrootflowers.example`, "g-in", tenant, "th-elena", "human_reply", "elena@larkspurhotel.example", "Re: Friday flowers?", "Yes please, from next Friday", receivedAt, "gmail_send", `first_ten:${journey.id}`]
    );
    const replied = (await readTenantOnboardingKnowledge(tenant))!;
    expect(replied.message?.reply).toEqual({ state: "replied", at: receivedAt.toISOString() });
    const briefing = signupKnowledgeForBriefing(replied, zone)!;
    expect(signupOpeningLine(briefing, zone, now)).toBe("Elena Ruiz replied on Sunday 1 November to your note about “Re: Friday flowers?”.");
    // the briefing Claire is handed: the person's own reactions first, every fact with its receipt
    expect(briefing.facts[0].status).not.toBe("proposed");
    expect(briefing.facts.every(fact => fact.id && fact.learnedAt)).toBe(true);
    expect(briefing.readFrom.length).toBeGreaterThanOrEqual(0);
  });
  it("carries the portrait the person kept, in their own words, without the lines they removed", async () => {
    const portraitTenant = `df_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const { startJourney } = await import("../journeys");
    const { runReading } = await import("../understanding/run");
    const { readingDepsFor } = await import("../understanding/deps");
    const { claimReading } = await import("../understanding/store");
    const { journeyById, setJourneyStage } = await import("../store");
    const { preparePortrait, changePortraitLine, keepPortraitFor, portraitView } = await import("../portrait/portrait");
    const { readTenantOnboardingKnowledge } = await import("./tenantKnowledge");
    // Nina's example writes its portrait without a model; then it is hers, provisioned
    const journey = (await startJourney({ requestId: randomUUID(), kind: "example" })).journey;
    const runId = randomUUID();
    await claimReading(journey.id, runId, { again: false });
    await runReading(journey.id, runId, await readingDepsFor(journey));
    await setJourneyStage(journey.id, "crew");
    await (await preparePortrait((await journeyById(journey.id))!)).started;
    const written = (await portraitView(journey.id))!;
    expect(written.status).toBe("ready");
    const removed = written.paragraphs[0][0].text;
    await changePortraitLine(journey, "p2.s1", "Jules builds the big pieces. I do the rest.");
    await changePortraitLine(journey, "p1.s1", null);
    await db.query("UPDATE first_ten_journeys SET kind = 'own', tenant_id = ? WHERE id = ?", [portraitTenant, journey.id]);

    const ready = (await readTenantOnboardingKnowledge(portraitTenant))!;
    expect(ready.portrait?.kept).toBe(false);
    expect(ready.portrait!.lines.map(line => line.text)).toContain("Jules builds the big pieces. I do the rest.");

    expect((await keepPortraitFor((await journeyById(journey.id))!)).status).toBe("kept");
    const kept = (await readTenantOnboardingKnowledge(portraitTenant))!;
    expect(kept.portrait).not.toBeNull();
    expect(kept.portrait!.kept).toBe(true);
    const texts = kept.portrait!.lines.map(line => line.text);
    expect(texts).toContain("Jules builds the big pieces. I do the rest.");
    expect(texts).not.toContain("Jules handles the installations.");
    expect(texts).not.toContain(removed);
    expect(kept.portrait!.lines).toHaveLength(written.paragraphs.flat().length + (written.closing ? 1 : 0) - 1);
  });
});
