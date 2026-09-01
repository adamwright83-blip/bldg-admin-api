import { describe, expect, it } from "vitest";
import {
  claimCreatesObligation,
  claimIsRelevantOn,
  classifyTemporalClaim,
  classifyTranscriptClaims,
  describeTemporalClaim,
  resolveTemporalReference,
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
  });
});
