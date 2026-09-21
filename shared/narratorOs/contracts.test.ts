import { describe, expect, it } from "vitest";
import {
  AUTHORED_BEAT_DEFAULTS,
  CANON_STATUSES,
  CLAIRE_DISCLOSURE_POLICY_IDS,
  PERMANENTLY_PRIVATE_CLAIRE_DISCLOSURE_POLICY_IDS,
  DRAMATURGY_OUTCOMES,
  DRAMATURGY_REASON_CODES,
  ELIGIBILITY_OUTCOMES,
  KNOWLEDGE_PLANES,
  OpenCanonHasNoRuntimeValueError,
  asNarrativeBeatId,
  InvalidNarrativeBeatIdError,
  knowledgePlanesAreDistinct,
  openValueMustBeNull,
  type AuthoredBeat,
  type AuthoredFact,
  type OccurrenceDisclosureAxes,
} from "./contracts";

describe("Narrator OS slice A — domain contracts", () => {
  it("keeps LOCKED, WORKING, and OPEN distinct", () => {
    expect(CANON_STATUSES).toEqual(["LOCKED", "WORKING", "OPEN"]);
    expect(new Set(CANON_STATUSES).size).toBe(3);
  });

  it("forbids a runtime value on OPEN canon", () => {
    const open: AuthoredFact = {
      factId: "chemist_name",
      kind: "EVENT_FACT",
      canonStatus: "OPEN",
      value: null,
      authoredSourceRef: "GOLDLINE_CANON.md§8",
    };
    expect(() => openValueMustBeNull(open)).not.toThrow();
    expect(() => openValueMustBeNull({ ...open, value: "invented" })).toThrow(
      OpenCanonHasNoRuntimeValueError
    );
  });

  it("rejects unknown or empty beat ids", () => {
    expect(asNarrativeBeatId("C-08")).toBe("C-08");
    expect(() => asNarrativeBeatId("")).toThrow(InvalidNarrativeBeatIdError);
    expect(() => asNarrativeBeatId("  C-08")).toThrow(
      InvalidNarrativeBeatIdError
    );
  });

  it("defaults mayFireOffscreen, defaultSurface, and playerVisibility to false", () => {
    expect(AUTHORED_BEAT_DEFAULTS.mayFireOffscreen).toBe(false);
    expect(AUTHORED_BEAT_DEFAULTS.defaultSurface).toBe(false);
    expect(AUTHORED_BEAT_DEFAULTS.playerVisibility).toBe(false);
    expect(AUTHORED_BEAT_DEFAULTS.eligibilityDefinition).toBe("INCOMPLETE");
  });

  it("treats an empty offscreen catalog as valid", () => {
    const offscreenCatalog: AuthoredBeat[] = [];
    expect(offscreenCatalog.filter(b => b.mayFireOffscreen)).toEqual([]);
  });

  it("keeps occurrence independent of disclosure axes", () => {
    const axes: OccurrenceDisclosureAxes = {
      occurred: true,
      playerCanSee: false,
      claireKnows: false,
      claireMayDisclose: false,
      authoredReactionExists: false,
    };
    expect(axes.occurred).toBe(true);
    expect(axes.playerCanSee).toBe(false);
    expect(axes.claireMayDisclose).toBe(false);
  });

  it("keeps knowledge planes distinct — no generic revealed boolean", () => {
    expect(KNOWLEDGE_PLANES).toEqual(["PLAYER", "CLAIRE", "CHEMIST", "OTHER"]);
    expect(knowledgePlanesAreDistinct("PLAYER", "CLAIRE")).toBe(true);
    expect(knowledgePlanesAreDistinct("CHEMIST", "CHEMIST")).toBe(false);
  });

  it("treats NO_ELIGIBLE as a successful outcome, not a failure state", () => {
    expect(ELIGIBILITY_OUTCOMES).toContain("NO_ELIGIBLE");
    const successfulSilence = {
      outcome: "NO_ELIGIBLE" as const,
      eligibleBeatIds: [] as const,
      withheldBeatIds: [] as const,
      mutated: false,
    };
    expect(successfulSilence.outcome).toBe("NO_ELIGIBLE");
    expect(successfulSilence.mutated).toBe(false);
  });

  it("keeps dramaturgy outcomes downstream of eligibility", () => {
    expect(DRAMATURGY_OUTCOMES).toEqual([
      "SILENCE_NO_ELIGIBLE",
      "SELECT",
      "SILENCE_WITHHELD",
      "AMBIGUOUS_REQUIRES_AUTHORED_RULE",
    ]);
    expect(DRAMATURGY_REASON_CODES).toContain(
      "multiple_surfaceable_no_authored_tie_break"
    );
    for (const outcome of DRAMATURGY_OUTCOMES) {
      expect(ELIGIBILITY_OUTCOMES).not.toContain(outcome);
    }
  });

  it("does not encode taste as an ELIGIBLE_WITHHELD input", () => {
    expect(ELIGIBILITY_OUTCOMES).toContain("ELIGIBLE_WITHHELD");
    const withheldRequiresAuthoredMetadata: Pick<
      AuthoredBeat,
      "defaultSurface"
    > = {
      defaultSurface: false,
    };
    expect(withheldRequiresAuthoredMetadata.defaultSurface).toBe(false);
    expect("taste" in withheldRequiresAuthoredMetadata).toBe(false);
    expect("feelsEarly" in ({} as AuthoredBeat)).toBe(false);
  });

  it("keeps Claire disclosure policy ids out of the beat contract", () => {
    expect(CLAIRE_DISCLOSURE_POLICY_IDS).toEqual([
      "CL-CORE",
      "CL-T1",
      "CL-T2",
      "CL-T3",
      "CL-WARM-1",
      "CL-PRIV-ADAPTED-FATHER-LAST-EXCHANGE",
      "CL-PRIV-EX-LAST-EXCHANGE",
    ]);
    expect(PERMANENTLY_PRIVATE_CLAIRE_DISCLOSURE_POLICY_IDS).toEqual([
      "CL-PRIV-ADAPTED-FATHER-LAST-EXCHANGE",
      "CL-PRIV-EX-LAST-EXCHANGE",
    ]);
  });
});
