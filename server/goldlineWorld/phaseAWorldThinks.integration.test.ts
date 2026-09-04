/**
 * The Phase A gate: a Tuesday sentence changes Wednesday, with no calendar
 * homework and no invented appointment.
 *
 * This drives the real Field Journal processing path — the same
 * `processFieldJournalEntry` the Driver save calls — rather than the pure
 * modules underneath it, because the thing being proven is that the whole
 * pipeline behaves, not that a parser parses.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  driverSalesJournals,
  goldlineWorldEvents,
  physicalEntities,
  physicalEntityAliases,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { normalizeSourceAddress } from "../geography/geographicTruthService";
import { processFieldJournalEntry } from "./fieldJournalProcessingService";
import { listFuturePressure } from "./futurePressureService";
import { listCityWorldEntities } from "./cityWorldService";
import { getFieldToday } from "../field/fieldTodayService";
import { projectObligations, presentObligations } from "../../shared/goldlineObligations";

const runDatabaseGate =
  process.env.DAYFORGE_RELEASE_DB === "1" && Boolean(process.env.DATABASE_URL);
vi.setConfig({ testTimeout: 60_000 });

const tenantId = `phasea-${randomUUID().slice(0, 8)}`;
const driverId = `driver-${randomUUID().slice(0, 8)}`;
const entityId = randomUUID();

/** Tuesday: the day the operator actually spoke. */
const TUESDAY = "2026-09-01";
const WEDNESDAY = "2026-09-02";
const FRIDAY = "2026-09-04";
const ADDRESS = "450 S Rossmore Ave, Los Angeles, CA";

const TUESDAY_TRANSCRIPT =
  "Stopped at the El Royale at 450 S Rossmore Ave. Sarah wasn't there. " +
  "Front desk said she should be back Wednesday. " +
  "I told them I'd email Sarah Wednesday morning before I come back.";

const CORRECTION_TRANSCRIPT =
  "Called the El Royale at 450 S Rossmore Ave again. " +
  "They said Sarah is actually out until Friday now.";

async function saveAndProcessJournal(transcript: string, journalDate: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const id = randomUUID();
  await db.insert(driverSalesJournals).values({
    id,
    tenantId,
    driverId,
    journalDate,
    clientRequestId: randomUUID(),
    // Persistence before processing: the operator's exact words are durable
    // before any provider is consulted.
    transcript,
    rawTranscript: transcript,
    processingStatus: "captured",
    insightsJson: {},
    createdAt: new Date(`${journalDate}T15:14:00.000Z`),
  } as never);
  await processFieldJournalEntry({ tenantId, journalEntryId: id });
  return id;
}

describe.runIf(runDatabaseGate)("Phase A — a Tuesday sentence changes Wednesday", () => {
  let journalId = "";

  beforeAll(async () => {
    const db = await getDb();
    if (!db) return;
    // A building Goldline already knows, so identity resolution is exercised
    // rather than mocked.
    await db.insert(physicalEntities).values({
      id: entityId,
      tenantId,
      kind: "building",
      displayName: "The El Royale",
      identityStatus: "confirmed",
    });
    await db.insert(physicalEntityAliases).values({
      id: randomUUID(),
      tenantId,
      physicalEntityId: entityId,
      aliasType: "normalized_address",
      aliasValue: ADDRESS,
      normalizedAliasValue: normalizeSourceAddress(ADDRESS),
      evidenceReference: "phase-a-fixture",
    });
    journalId = await saveAndProcessJournal(TUESDAY_TRANSCRIPT, TUESDAY);
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    await db.delete(goldlineWorldEvents).where(eq(goldlineWorldEvents.tenantId, tenantId));
    await db.delete(driverSalesJournals).where(eq(driverSalesJournals.tenantId, tenantId));
    await db.delete(physicalEntityAliases).where(eq(physicalEntityAliases.tenantId, tenantId));
    await db.delete(physicalEntities).where(eq(physicalEntities.tenantId, tenantId));
  });

  it("1. keeps the operator's exact words durable", async () => {
    const db = await getDb();
    const [row] = await db!
      .select()
      .from(driverSalesJournals)
      .where(and(eq(driverSalesJournals.tenantId, tenantId), eq(driverSalesJournals.id, journalId)));
    expect(row!.rawTranscript).toBe(TUESDAY_TRANSCRIPT);
    expect(["processed", "fallback"]).toContain(row!.processingStatus);
  });

  it("2. separates the report from the promise, through the real pipeline", async () => {
    const db = await getDb();
    const events = await db!
      .select()
      .from(goldlineWorldEvents)
      .where(eq(goldlineWorldEvents.tenantId, tenantId));

    const commitments = events.filter(e => e.eventType === "field_commitment_made");
    const signals = events.filter(e => e.eventType === "field_temporal_signal");

    // Exactly one promise: the email. Not the front desk's report.
    expect(commitments).toHaveLength(1);
    expect(String((commitments[0]!.metadataJson as any).statement)).toMatch(/email/i);
    // And the reason to go back survives separately.
    expect(signals.length).toBeGreaterThanOrEqual(1);
    expect(
      signals.some(s => /back Wednesday/i.test(String((s.metadataJson as any).statement)))
    ).toBe(true);
  });

  it("3. binds both to the same building Goldline already knew", async () => {
    const db = await getDb();
    const events = await db!
      .select()
      .from(goldlineWorldEvents)
      .where(eq(goldlineWorldEvents.tenantId, tenantId));
    const relevant = events.filter(e =>
      ["field_commitment_made", "field_temporal_signal"].includes(e.eventType)
    );
    expect(relevant.length).toBeGreaterThan(0);
    for (const event of relevant) expect(event.physicalEntityId).toBe(entityId);
  });

  it("4. never records an appointment", async () => {
    const db = await getDb();
    const events = await db!
      .select()
      .from(goldlineWorldEvents)
      .where(eq(goldlineWorldEvents.tenantId, tenantId));
    for (const event of events) {
      const meta = event.metadataJson as Record<string, unknown>;
      if ("impliesAppointment" in meta) expect(meta.impliesAppointment).toBe(false);
      // Wednesday morning stays a daypart. It never becomes a clock time.
      if ("duePrecision" in meta) expect(meta.duePrecision).not.toBe("time");
    }
  });

  it("5. holds Wednesday quietly on Tuesday", async () => {
    const pressure = await listFuturePressure({ tenantId, date: TUESDAY });
    expect(pressure.items).toHaveLength(0);
  });

  it("6. brings back the promise and the reason on Wednesday", async () => {
    const pressure = await listFuturePressure({ tenantId, date: WEDNESDAY });
    expect(pressure.items.some(item => item.isObligation)).toBe(true);
    expect(pressure.items.some(item => !item.isObligation)).toBe(true);
    // The promise leads.
    expect(pressure.items[0]!.isObligation).toBe(true);
  });

  it("7. explains why each thing is there, in the operator's own words", async () => {
    const pressure = await listFuturePressure({ tenantId, date: WEDNESDAY });
    for (const item of pressure.items) {
      expect(item.reason.length).toBeGreaterThan(10);
      expect(item.reason).not.toMatch(/physicalEntityId|metadataJson|undefined/);
      expect(item.sourceEvidenceReference).toContain("driver_sales_journals:");
    }
    expect(pressure.items.map(i => i.reason).join(" ")).toMatch(/email|Wednesday/i);
  });

  it("8. shows the promise as a restraint on the building itself", async () => {
    const entities = await listCityWorldEntities({ tenantId, today: WEDNESDAY });
    const building = entities.find(entity => entity.id === entityId);
    expect(building?.obligations).toBeTruthy();
    expect(building!.obligations!.count).toBe(1);
    expect(building!.obligations!.tension).toBe("taut");
    expect(building!.obligations!.explanation).toMatch(/promise/i);
  });

  it("9. survives being read again and again", async () => {
    // Looking does not discharge a promise, however many times you look.
    for (let pass = 0; pass < 3; pass += 1) {
      const entities = await listCityWorldEntities({ tenantId, today: WEDNESDAY });
      expect(entities.find(e => e.id === entityId)!.obligations!.count).toBe(1);
    }
  });

  it("10. survives reprocessing the same journal without doubling", async () => {
    await processFieldJournalEntry({ tenantId, journalEntryId: journalId }).catch(() => undefined);
    const db = await getDb();
    const events = await db!
      .select()
      .from(goldlineWorldEvents)
      .where(
        and(
          eq(goldlineWorldEvents.tenantId, tenantId),
          eq(goldlineWorldEvents.eventType, "field_commitment_made")
        )
      );
    expect(events).toHaveLength(1);
  });

  it("11. reaches the Driver's actual day through Day Forge", async () => {
    /*
      The gate is not "a projection exists" — it is that Wednesday's real board
      carries the promise and the reason, each with the sentence that put it
      there. This calls the same getFieldToday the Driver calls.
    */
    const today = await getFieldToday({
      tenantId,
      userId: driverId,
      includeAllAssignees: true,
      now: new Date(`${WEDNESDAY}T17:00:00.000Z`),
      timeZone: "UTC",
    });

    const promise = today.timeline.find(item => item.kind === "field_commitment");
    const signal = today.timeline.find(item => item.kind === "reported_opportunity");

    expect(promise).toBeTruthy();
    expect(promise!.physicalEntityId).toBe(entityId);
    expect(promise!.whySurfaced).toMatch(/email|Wednesday/i);
    expect(promise!.urgency).toBe("urgent");

    expect(signal).toBeTruthy();
    expect(signal!.physicalEntityId).toBe(entityId);
    // A reported possibility is never urgent and never an appointment.
    expect(signal!.urgency).toBe("flexible");
    expect(signal!.whySurfaced).toMatch(/Reported on site/i);

    // Both point back into the same building in the world.
    for (const item of [promise!, signal!]) {
      expect(item.actions[0]!.href).toContain(entityId);
    }
  });

  it("12. recompiles the future when reality moves, without rewriting history", async () => {
    await saveAndProcessJournal(CORRECTION_TRANSCRIPT, TUESDAY);

    // Friday now carries the reason to go.
    const friday = await listFuturePressure({ tenantId, date: FRIDAY });
    expect(
      friday.items.some(item => !item.isObligation && /Friday/i.test(item.reason))
    ).toBe(true);

    // Tuesday's original sentence is still exactly what was said.
    const db = await getDb();
    const [original] = await db!
      .select()
      .from(driverSalesJournals)
      .where(and(eq(driverSalesJournals.tenantId, tenantId), eq(driverSalesJournals.id, journalId)));
    expect(original!.rawTranscript).toBe(TUESDAY_TRANSCRIPT);

    const events = await db!
      .select()
      .from(goldlineWorldEvents)
      .where(eq(goldlineWorldEvents.tenantId, tenantId));
    expect(
      events.some(e => /back Wednesday/i.test(String((e.metadataJson as any).statement ?? "")))
    ).toBe(true);
  });

  it("13. keeps the promise even though the reason to visit moved", async () => {
    // Sarah moving to Friday does not release the operator from emailing her.
    const friday = await listFuturePressure({ tenantId, date: FRIDAY });
    const promises = friday.items.filter(item => item.isObligation);
    expect(promises).toHaveLength(1);
    expect(promises[0]!.weight).toBe("insistent");

    const db = await getDb();
    const events = await db!
      .select()
      .from(goldlineWorldEvents)
      .where(eq(goldlineWorldEvents.tenantId, tenantId));
    const obligations = projectObligations(
      events.map(row => ({
        id: row.id,
        tenantId: row.tenantId,
        physicalEntityId: row.physicalEntityId,
        eventType: row.eventType,
        classification: row.classification,
        actorType: row.actorType,
        actorId: row.actorId,
        occurredAt: row.occurredAt.toISOString(),
        observedAt: null,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        sourceEvidenceReference: row.sourceEvidenceReference,
        provenanceClass: row.provenanceClass,
        verificationClass: row.verificationClass,
        confidence: row.confidence,
        idempotencyKey: row.idempotencyKey,
        correlationId: row.correlationId,
        metadata: (row.metadataJson ?? {}) as Record<string, unknown>,
      }))
    );
    expect(presentObligations(entityId, obligations, FRIDAY)!.tension).toBe("overdue");
  });
});
