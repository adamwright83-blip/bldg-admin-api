import { describe, expect, it } from "vitest";
import { dedupeByEntityIdentity, MISSION_SOURCE_PRIORITY } from "./missionSource";

type Candidate = { id: string; sourceType: "field" | "recovery" | "scout"; name: string };

describe("dedupeByEntityIdentity", () => {
  it("keeps a single result when one entity is discovered by two sources", () => {
    const candidates: Candidate[] = [
      { id: "biz-1", sourceType: "scout", name: "Scout's copy" },
      { id: "biz-1", sourceType: "field", name: "Field's copy" },
    ];
    const result = dedupeByEntityIdentity(
      candidates,
      c => c.id,
      c => MISSION_SOURCE_PRIORITY[c.sourceType]
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Field's copy");
  });

  it("preserves distinct entities untouched", () => {
    const candidates: Candidate[] = [
      { id: "biz-1", sourceType: "field", name: "A" },
      { id: "biz-2", sourceType: "scout", name: "B" },
    ];
    const result = dedupeByEntityIdentity(
      candidates,
      c => c.id,
      c => MISSION_SOURCE_PRIORITY[c.sourceType]
    );
    expect(result).toHaveLength(2);
  });

  it("is stable — ties at the same priority keep first-seen order", () => {
    const candidates: Candidate[] = [
      { id: "biz-1", sourceType: "field", name: "first" },
      { id: "biz-1", sourceType: "field", name: "second" },
    ];
    const result = dedupeByEntityIdentity(
      candidates,
      c => c.id,
      c => MISSION_SOURCE_PRIORITY[c.sourceType]
    );
    expect(result[0].name).toBe("first");
  });

  it("returns an empty array for empty input", () => {
    expect(dedupeByEntityIdentity<Candidate>([], c => c.id, () => 0)).toEqual([]);
  });

  it("recovery outranks scout but loses to field", () => {
    const candidates: Candidate[] = [
      { id: "biz-1", sourceType: "scout", name: "scout" },
      { id: "biz-1", sourceType: "recovery", name: "recovery" },
    ];
    expect(
      dedupeByEntityIdentity(candidates, c => c.id, c => MISSION_SOURCE_PRIORITY[c.sourceType])[0]
        .name
    ).toBe("recovery");

    const candidates2: Candidate[] = [
      { id: "biz-1", sourceType: "recovery", name: "recovery" },
      { id: "biz-1", sourceType: "field", name: "field" },
    ];
    expect(
      dedupeByEntityIdentity(candidates2, c => c.id, c => MISSION_SOURCE_PRIORITY[c.sourceType])[0]
        .name
    ).toBe("field");
  });
});
