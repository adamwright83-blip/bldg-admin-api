import { describe, expect, it } from "vitest";
import {
  claimCreatesObligation,
  claimIsRelevantOn,
  classifyTemporalClaim,
  classifyTranscriptClaims,
  describeTemporalClaim,
  resolveTemporalReference,
  resolveTranscriptClaims,
  validateProposedClaim,
} from "./goldlineTemporal";

/** A Tuesday, so "Wednesday" is tomorrow and "Monday" is next week. */
const TUESDAY = "2026-09-01";

describe("reading time out of ordinary speech", () => {
  it("anchors relative days to when the journal was captured", () => {
    expect(resolveTemporalReference("GM is back tomorrow", TUESDAY)?.startDate).toBe(
      "2026-09-02"
    );
    expect(resolveTemporalReference("stopped by today", TUESDAY)?.startDate).toBe(TUESDAY);
    expect(
      resolveTemporalReference("day after tomorrow", TUESDAY)?.startDate
    ).toBe("2026-09-03");
  });

  it("resolves a weekday to its next occurrence, never to today", () => {
    // Said on Tuesday, "Wednesday" is tomorrow.
    expect(resolveTemporalReference("back Wednesday", TUESDAY)?.startDate).toBe(
      "2026-09-02"
    );
    // Said on Tuesday, "Tuesday" means the next one, not this instant.
    expect(resolveTemporalReference("back Tuesday", TUESDAY)?.startDate).toBe(
      "2026-09-08"
    );
  });

  it("keeps a week a week instead of inventing a day", () => {
    const week = resolveTemporalReference("come back next week", TUESDAY);
    expect(week?.precision).toBe("window");
    expect(week?.startDate).toBe("2026-09-08");
    expect(week?.endDate).toBe("2026-09-14");
  });

  it("keeps a daypart a daypart instead of inventing a clock time", () => {
    // This is the exact failure mode that turns a field note into a fake
    // appointment: "Wednesday afternoon" must never become 3:00 PM.
    const when = resolveTemporalReference("Sarah should be there Wednesday afternoon", TUESDAY);
    expect(when?.precision).toBe("daypart");
    expect(when?.daypart).toBe("afternoon");
    expect(when?.startDate).toBe("2026-09-02");
  });

  it("reaches clock precision only from a spoken clock time", () => {
    expect(
      resolveTemporalReference("meeting Wednesday at 3pm", TUESDAY)?.precision
    ).toBe("time");
    expect(resolveTemporalReference("back Wednesday", TUESDAY)?.precision).toBe("day");
  });

  it("marks hedged time as hedged", () => {
    expect(resolveTemporalReference("she should be back Wednesday", TUESDAY)?.hedged).toBe(true);
    expect(resolveTemporalReference("she is back Wednesday", TUESDAY)?.hedged).toBe(false);
  });

  it("treats a working pattern as recurring, not as one appointment", () => {
    const when = resolveTemporalReference("they told me he works Thursdays", TUESDAY);
    expect(when?.recurring).toBe(true);
  });

  it("returns nothing rather than guessing when it cannot resolve a date", () => {
    expect(resolveTemporalReference("try again after Labor Day", TUESDAY)?.startDate).toBeNull();
    expect(resolveTemporalReference("nice courtyard", TUESDAY)).toBeNull();
  });
});

describe("telling apart the six kinds of temporal claim", () => {
  const classify = (text: string) => classifyTemporalClaim(text, TUESDAY);

  it("a promise made to another person is a commitment", () => {
    const claim = classify("I told the front desk I'd email Sarah Wednesday morning");
    expect(claim?.kind).toBe("operator_commitment");
    expect(claimCreatesObligation(claim!)).toBe(true);
  });

  it("what the front desk reported is not the operator's promise", () => {
    // The single most important distinction in this module.
    const claim = classify("Front desk said she should be back Wednesday");
    expect(claim?.kind).toBe("reported_availability");
    expect(claimCreatesObligation(claim!)).toBe(false);
  });

  it("a stated plan is weaker than a promise", () => {
    const claim = classify("I'm going back Wednesday");
    expect(claim?.kind).toBe("operator_intent");
    expect(claimCreatesObligation(claim!)).toBe(false);
  });

  it("a musing is not a task", () => {
    // No guilt architecture from casual thoughts.
    const claim = classify("I should probably go back Wednesday");
    expect(claim?.kind).toBe("suggested_action");
    expect(claimCreatesObligation(claim!)).toBe(false);
  });

  it("a maybe stays a maybe", () => {
    const claim = classify("She might be there Wednesday");
    expect(["uncertain_possibility", "reported_availability"]).toContain(claim?.kind);
    expect(claimCreatesObligation(claim!)).toBe(false);
    expect(claim?.when?.hedged).toBe(true);
  });

  it("names who the promise was made to when the sentence says", () => {
    expect(classify("I told Sarah I would send pricing Wednesday")?.promisedTo).toBe("Sarah");
  });
});

describe("a sentence carrying both a report and a promise", () => {
  const transcript =
    "Stopped at El Royale. Sarah wasn't there. Front desk said she should be back Wednesday. I told them I'd email Sarah Wednesday morning before I come back.";
  const claims = classifyTranscriptClaims(transcript, TUESDAY);

  it("keeps the report and the promise as separate claims", () => {
    const kinds = claims.map(claim => claim.kind);
    expect(kinds).toContain("reported_availability");
    expect(kinds).toContain("operator_commitment");
  });

  it("creates exactly one obligation, from the promise only", () => {
    expect(claims.filter(claimCreatesObligation)).toHaveLength(1);
  });

  it("puts both on Wednesday without inventing an appointment", () => {
    for (const claim of claims.filter(item => item.when?.startDate)) {
      expect(claim.when!.startDate).toBe("2026-09-02");
      expect(claim.when!.precision).not.toBe("time");
    }
  });
});

describe("when a claim is worth surfacing", () => {
  const promise = classifyTemporalClaim(
    "I told them I'd email Sarah Wednesday",
    TUESDAY
  )!;
  const reported = classifyTemporalClaim(
    "Front desk said she is back Wednesday",
    TUESDAY
  )!;

  it("does not surface tomorrow's things today", () => {
    expect(claimIsRelevantOn(promise, TUESDAY)).toBe(false);
    expect(claimIsRelevantOn(reported, TUESDAY)).toBe(false);
  });

  it("surfaces both on the day they land", () => {
    expect(claimIsRelevantOn(promise, "2026-09-02")).toBe(true);
    expect(claimIsRelevantOn(reported, "2026-09-02")).toBe(true);
  });

  it("keeps an unmet promise relevant after its day passes", () => {
    // A promise does not stop mattering because Wednesday ended.
    expect(claimIsRelevantOn(promise, "2026-09-05")).toBe(true);
  });

  it("lets a reported availability expire with its window", () => {
    // Sarah being back on Wednesday says nothing about Saturday.
    expect(claimIsRelevantOn(reported, "2026-09-05")).toBe(false);
  });
});

describe("explaining why a place surfaced", () => {
  it("speaks in the operator's own words, not in internal vocabulary", () => {
    const reported = describeTemporalClaim(
      classifyTemporalClaim("Front desk said she should be back Wednesday", TUESDAY)!
    );
    expect(reported).toContain("Reported on site");
    expect(reported).toContain("2026-09-02");
    expect(reported).not.toMatch(/physicalEntityId|projection|schema|null/);
  });

  it("distinguishes a promise from a report in what it says", () => {
    const promise = describeTemporalClaim(
      classifyTemporalClaim("I told them I'd email Sarah Wednesday", TUESDAY)!
    );
    expect(promise).toMatch(/You said you would/);
    expect(promise).toMatch(/email Sarah/i);
  });

  it("still explains a promise when the transcript uses a typographic apostrophe", () => {
    const promise = describeTemporalClaim(
      classifyTemporalClaim("I told the desk I’d email her first", TUESDAY)!
    );
    expect(promise).toMatch(/You said you would email her first/i);
    expect(promise).not.toMatch(/You said you would I told/i);
  });
});

describe("the provider proposes, the contract disposes", () => {
  const propose = (
    overrides: Partial<Parameters<typeof validateProposedClaim>[0]>
  ) =>
    validateProposedClaim(
      {
        kind: "reported_availability",
        sourceText: "Front desk said she should be back Wednesday",
        subject: "Sarah back Wednesday",
        promisedTo: null,
        when: {
          text: "Wednesday",
          startDate: "2026-09-02",
          endDate: "2026-09-02",
          daypart: null,
          precision: "day",
          hedged: true,
          recurring: false,
        },
        ...overrides,
      },
      TUESDAY
    );

  it("accepts a well-formed proposal unchanged", () => {
    const claim = propose({});
    expect(claim.kind).toBe("reported_availability");
    expect(claim.when?.startDate).toBe("2026-09-02");
    expect(claim.adjustments).toEqual([]);
  });

  it("refuses to let a model invent a promise the operator never made", () => {
    // The single most dangerous provider failure: confidently upgrading a
    // third party's report into the operator's own commitment.
    const claim = propose({ kind: "operator_commitment", promisedTo: "Sarah" });
    expect(claim.kind).toBe("reported_availability");
    expect(claim.promisedTo).toBeNull();
    expect(claim.adjustments.join(" ")).toMatch(/do not commit/i);
  });

  it("keeps a genuine promise a promise", () => {
    const claim = propose({
      kind: "operator_commitment",
      sourceText: "I told them I'd email Sarah Wednesday morning",
      promisedTo: "the front desk",
      when: {
        text: "Wednesday morning",
        startDate: "2026-09-02",
        endDate: "2026-09-02",
        daypart: "morning",
        precision: "daypart",
        hedged: false,
        recurring: false,
      },
    });
    expect(claim.kind).toBe("operator_commitment");
    expect(claim.promisedTo).toBe("the front desk");
    expect(claim.adjustments).toEqual([]);
  });

  it("refuses to let a model manufacture a clock time", () => {
    const claim = propose({
      sourceText: "Front desk said she is back Wednesday afternoon",
      when: {
        text: "Wednesday afternoon",
        startDate: "2026-09-02",
        endDate: "2026-09-02",
        daypart: "afternoon",
        precision: "time",
        hedged: false,
        recurring: false,
      },
    });
    expect(claim.when?.precision).not.toBe("time");
    expect(claim.adjustments.join(" ")).toMatch(/not an appointment/i);
  });

  it("keeps a clock time the operator actually spoke", () => {
    const claim = propose({
      sourceText: "She confirmed Wednesday at 3pm",
      when: {
        text: "Wednesday at 3pm",
        startDate: "2026-09-02",
        endDate: "2026-09-02",
        daypart: null,
        precision: "time",
        hedged: false,
        recurring: false,
      },
    });
    expect(claim.when?.precision).toBe("time");
  });

  it("re-anchors a date the model got wrong", () => {
    // The capture date is not negotiable.
    const claim = propose({
      when: {
        text: "Wednesday",
        startDate: "2026-10-14",
        endDate: "2026-10-14",
        daypart: null,
        precision: "day",
        hedged: false,
        recurring: false,
      },
    });
    expect(claim.when?.startDate).toBe("2026-09-02");
    expect(claim.adjustments.join(" ")).toMatch(/Re-anchored/);
  });

  it("keeps the operator's hedge even when the model sounds certain", () => {
    const claim = propose({
      sourceText: "She might be back Wednesday",
      when: {
        text: "Wednesday",
        startDate: "2026-09-02",
        endDate: "2026-09-02",
        daypart: null,
        precision: "day",
        hedged: false,
        recurring: false,
      },
    });
    expect(claim.when?.hedged).toBe(true);
  });

  it("downgrades a promise the operator themselves hedged", () => {
    const claim = propose({
      kind: "operator_commitment",
      sourceText: "I might email her Wednesday",
      when: {
        text: "Wednesday",
        startDate: "2026-09-02",
        endDate: "2026-09-02",
        daypart: null,
        precision: "day",
        hedged: true,
        recurring: false,
      },
    });
    expect(claim.kind).not.toBe("operator_commitment");
  });
});

describe("provider first, deterministic only as a fallback", () => {
  const transcript =
    "Front desk said she should be back Wednesday. I told them I'd email Sarah Wednesday morning.";

  it("uses the provider's claims when it answered", () => {
    const claims = resolveTranscriptClaims({
      transcript,
      anchorDate: TUESDAY,
      proposed: [
        {
          kind: "reported_availability",
          sourceText: "Front desk said she should be back Wednesday",
          subject: "Sarah returns",
          promisedTo: null,
          when: { text: "Wednesday", startDate: "2026-09-02", endDate: "2026-09-02", daypart: null, precision: "day", hedged: true, recurring: false },
        },
      ],
    });
    expect(claims).toHaveLength(1);
    expect(claims[0]!.adjustments).not.toContain(
      "Read deterministically; no intelligence provider answered."
    );
  });

  it("falls back to deterministic reading only when nothing answered", () => {
    const claims = resolveTranscriptClaims({ transcript, anchorDate: TUESDAY, proposed: [] });
    const kinds = claims.map(claim => claim.kind);
    expect(kinds).toContain("operator_commitment");
    expect(kinds).toContain("reported_availability");
    expect(claims[0]!.adjustments[0]).toMatch(/no intelligence provider answered/);
  });
});
