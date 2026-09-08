import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_FIELD_JOURNAL_EXTRACTION } from "../../shared/fieldJournal";
const mocks = vi.hoisted(() => ({ events: new Map<string, any>(), append: vi.fn(), lookup: vi.fn() }));
vi.mock("../db", () => ({ getDb: async () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) }) }));
vi.mock("./worldEventStore", () => ({ appendGoldlineWorldEvent: mocks.append }));
vi.mock("./entityLookup", () => ({ findPhysicalEntityIdByAddress: mocks.lookup }));
import { recordFieldCommitments } from "./fieldCommitmentService";
import { recordJournalActionsOnMatchedEntities } from "./journalWorldActionService";
const quote = "Dana wants pricing by Friday.";
const evidence = { value: "pricing", transcriptExcerpt: quote, provenance: "operator_reported" as const, confidence: "high" as const };
const input = () => ({ tenantId: "test", journalEntryId: "journal", actorId: "operator", transcript: quote,
  extraction: { ...EMPTY_FIELD_JOURNAL_EXTRACTION, followUps: [{ entityClientKey: null, requestedAction: evidence, explicitDateText: "Friday" }] },
  anchorDate: "2026-09-08", capturedAt: "2026-09-08T18:00:00Z", contextPhysicalEntityId: "worked-building" });
beforeEach(() => {
  mocks.events.clear(); mocks.append.mockReset(); mocks.lookup.mockReset();
  mocks.lookup.mockResolvedValue(null);
  mocks.append.mockImplementation(async value => {
    const existing = mocks.events.get(value.idempotencyKey);
    if (existing) return existing;
    const event = { ...value, id: `event-${mocks.events.size}` };
    mocks.events.set(value.idempotencyKey, event); return event;
  });
});
describe("Loot Walk existing world-event integration", () => {
  it("persists a quoted Friday request at the worked building, replaying only once", async () => {
    await recordFieldCommitments(input()); await recordFieldCommitments(input());
    const requests = [...mocks.events.values()].filter(event => event.eventType === "field_commitment_made");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ physicalEntityId: "worked-building", classification: "evidence", metadata: { dueDate: "2026-09-11", impliesAppointment: false, impliesOperatorPromise: false, statement: quote } });
  });
  it("keeps an undated request undated", async () => {
    const value = input(); value.transcript = "Please send pricing sometime.";
    value.extraction.followUps[0].requestedAction = { ...evidence, transcriptExcerpt: value.transcript };
    await recordFieldCommitments(value);
    expect([...mocks.events.values()].find(event => event.eventType === "field_commitment_made")?.metadata.dueDate).toBeNull();
  });
  it("uses real visit context without a contact write or a response outcome", async () => {
    const value = input();
    await recordJournalActionsOnMatchedEntities({ ...value, extraction: { ...EMPTY_FIELD_JOURNAL_EXTRACTION, actions: [{ entityClientKey: null, type: "visited", evidence, occurredAtText: null }] } });
    expect([...mocks.events.values()][0]).toMatchObject({ eventType: "visited", physicalEntityId: "worked-building", classification: "action", metadata: { doesNotImplyOutcome: true } });
  });
});
