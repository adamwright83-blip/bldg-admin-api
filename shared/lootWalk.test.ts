import { describe, expect, it } from "vitest";
import { EMPTY_FIELD_JOURNAL_EXTRACTION, groundFieldJournalExtraction, journalCanUseVisitContext, requestedJournalFollowUps, type FieldJournalExtraction } from "./fieldJournal";
import { resolveTemporalReference } from "./goldlineTemporal";
const evidence = (value: string, transcriptExcerpt = value) => ({ value, transcriptExcerpt, confidence: "high" as const, provenance: "operator_reported" as const });
const transcript = "Dana wants pricing by Friday. Two hundred units. She said email is best.";
const extraction = (): FieldJournalExtraction => ({ ...EMPTY_FIELD_JOURNAL_EXTRACTION,
  followUps: [{ entityClientKey: null, requestedAction: evidence("pricing", "Dana wants pricing by Friday."), explicitDateText: "Friday" }],
  facts: [{ kind: "unit_count", entityClientKey: null, evidence: evidence("Two hundred units") }, { kind: "preferred_channel", entityClientKey: null, evidence: evidence("email", "She said email is best.") }],
});
describe("Loot Walk truth", () => {
  it("keeps explicit counts, channel and the Friday request without inventing a person", () => {
    const result = groundFieldJournalExtraction(extraction(), transcript);
    expect(result.facts).toHaveLength(2);
    expect(result.entities).toEqual([]);
    const request = requestedJournalFollowUps(result, transcript)[0];
    expect(resolveTemporalReference(request.requestedAction.transcriptExcerpt!, "2026-09-08")?.startDate).toBe("2026-09-11");
  });
  it("rejects invented excitement and an unspoken quote", () => {
    const input = extraction();
    input.facts![0].evidence = evidence("high intent", transcript);
    input.facts![1].evidence = evidence("phone", "She prefers phone");
    expect(groundFieldJournalExtraction(input, transcript).facts).toEqual([]);
  });
  it("keeps ambiguous timing ambiguous and does not create unrequested work", () => {
    expect(resolveTemporalReference("follow up sometime", "2026-09-08")).toBeNull();
    expect(requestedJournalFollowUps(EMPTY_FIELD_JOURNAL_EXTRACTION, transcript)).toEqual([]);
    const input = extraction();
    input.followUps[0].requestedAction = evidence("Maybe send pricing Friday");
    expect(requestedJournalFollowUps(input, "Maybe send pricing Friday")).toEqual([]);
  });
  it("can use a worked building without fabricating human identity", () => {
    expect(journalCanUseVisitContext(extraction())).toBe(true);
  });
  it("does not attach another named building to the worked building", () => {
    const input = extraction();
    input.entities = [{ clientEntityKey: "other", kind: "existing_property", propertyName: evidence("Other building"), addressClue: null, neighborhood: null, websiteDomain: null, contactName: evidence("Dana"), contactTitle: null, email: null, phone: null, amenities: [], architecture: [] }];
    expect(journalCanUseVisitContext(input)).toBe(false);
  });
  it("replaying extraction is stable and cannot turn field activity into a response", () => {
    const input = extraction();
    input.actions = [{ entityClientKey: null, type: "visited", evidence: evidence("I visited"), occurredAtText: null }];
    const first = groundFieldJournalExtraction(input, "I visited");
    expect(groundFieldJournalExtraction(input, "I visited")).toEqual(first);
    expect(first.outcomes).toEqual([]);
  });
});
