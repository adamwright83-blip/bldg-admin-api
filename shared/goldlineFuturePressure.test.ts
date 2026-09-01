import { describe, expect, it } from "vitest";
import { classifyTemporalClaim } from "./goldlineTemporal";
import type { ObligationRecord } from "./goldlineObligations";
import {
  futureAtmosphereFor,
  projectFuturePressure,
} from "./goldlineFuturePressure";

const TUESDAY = "2026-09-01";
const WEDNESDAY = "2026-09-02";
const SATURDAY = "2026-09-05";
const BUILDING = "building-el-royale";

const promise: ObligationRecord = {
  id: "commitment-1",
  physicalEntityId: BUILDING,
  statement: "I told them I'd email Sarah Wednesday morning",
  promisedTo: "the front desk",
  dueDate: WEDNESDAY,
  madeAt: `${TUESDAY}T15:14:00.000Z`,
  sourceEvidenceReference: "driver_sales_journals:journal-1",
  resolution: null,
  resolvedAt: null,
  resolvedBy: null,
  explanation: "You said you would email Sarah — 2026-09-02 morning.",
};

const reported = {
  claim: classifyTemporalClaim("Front desk said she should be back Wednesday", TUESDAY)!,
  physicalEntityId: BUILDING,
  sourceEvidenceReference: "driver_sales_journals:journal-1",
};

const project = (date: string, obligations = [promise], claims = [reported]) =>
  projectFuturePressure({ date, obligations, claims });

describe("what the day is allowed to surface", () => {
  it("says nothing about Wednesday on Tuesday", () => {
    // Goldline holds it quietly. It does not nag the day before.
    expect(project(TUESDAY).items).toEqual([]);
  });

  it("brings back both the promise and the reason on Wednesday", () => {
    const items = project(WEDNESDAY).items;
    expect(items).toHaveLength(2);
    expect(items.some(item => item.isObligation)).toBe(true);
    expect(items.some(item => !item.isObligation)).toBe(true);
  });

  it("puts the promise ahead of the reason to go", () => {
    const [first] = project(WEDNESDAY).items;
    expect(first!.isObligation).toBe(true);
    expect(first!.weight).toBe("insistent");
  });

  it("keeps an unmet promise on the horizon after its day passes", () => {
    const items = project(SATURDAY).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.isObligation).toBe(true);
    expect(items[0]!.weight).toBe("insistent");
  });

  it("lets a soft signal expire with its own window", () => {
    // "Sarah is back Wednesday" says nothing at all about Saturday.
    expect(project(SATURDAY).items.some(item => !item.isObligation)).toBe(false);
  });

  it("drops a promise entirely once it is resolved", () => {
    const done = { ...promise, resolution: "fulfilled" as const };
    expect(project(WEDNESDAY, [done]).items.some(item => item.isObligation)).toBe(false);
  });

  it("keeps a promise with no stated day permanently live", () => {
    const undated = { ...promise, dueDate: null };
    expect(project(TUESDAY, [undated]).items).toHaveLength(1);
    expect(project(SATURDAY, [undated]).items[0]!.weight).toBe("notable");
  });

  it("carries the evidence reference on every single item", () => {
    for (const item of project(WEDNESDAY).items) {
      expect(item.sourceEvidenceReference).toBe("driver_sales_journals:journal-1");
      expect(item.reason.length).toBeGreaterThan(10);
    }
  });
});

describe("uncertainty survives all the way to the atmosphere", () => {
  it("marks a hedged report as uncertain", () => {
    const items = project(WEDNESDAY).items.filter(item => !item.isObligation);
    expect(items[0]!.uncertain).toBe(true);
  });

  it("never marks a promise uncertain", () => {
    const items = project(WEDNESDAY).items.filter(item => item.isObligation);
    expect(items[0]!.uncertain).toBe(false);
  });

  it("lets the building lean, and says why in words", () => {
    const atmosphere = futureAtmosphereFor(BUILDING, project(WEDNESDAY))!;
    expect(atmosphere.intensity).toBe("leaning");
    expect(atmosphere.explanation).toMatch(/email Sarah/);
    expect(atmosphere.entirelyUncertain).toBe(false);
  });

  it("only stirs when everything it knows is soft", () => {
    const soft = projectFuturePressure({
      date: WEDNESDAY,
      obligations: [],
      claims: [reported],
    });
    const atmosphere = futureAtmosphereFor(BUILDING, soft)!;
    expect(atmosphere.intensity).toBe("stirring");
    expect(atmosphere.entirelyUncertain).toBe(true);
    // A maybe must never render as a scheduled thing.
    expect(atmosphere.explanation).not.toMatch(/\b\d{1,2}\s*(am|pm)\b|appointment|meeting/i);
  });

  it("leaves a place with nothing coming completely alone", () => {
    expect(futureAtmosphereFor("building-quiet", project(WEDNESDAY))).toBeNull();
  });
});

describe("reality recompiles the future without rewriting the past", () => {
  it("moves the day when new evidence moves it", () => {
    /*
      Tuesday said Wednesday. Tuesday night says Friday. Wednesday must not
      still carry a stale Sarah mission, but Tuesday's sentence is history and
      stays exactly as it was said.
    */
    const corrected = {
      claim: classifyTemporalClaim("They said she is now back Friday", TUESDAY)!,
      physicalEntityId: BUILDING,
      sourceEvidenceReference: "driver_sales_journals:journal-2",
    };

    const wednesday = projectFuturePressure({
      date: WEDNESDAY,
      obligations: [],
      claims: [corrected],
    });
    expect(wednesday.items).toEqual([]);

    const friday = projectFuturePressure({
      date: "2026-09-04",
      obligations: [],
      claims: [corrected],
    });
    expect(friday.items).toHaveLength(1);

    // The original Tuesday statement is untouched by any of this.
    expect(reported.claim.sourceText).toBe(
      "Front desk said she should be back Wednesday"
    );
  });

  it("keeps the promise even when the reason to visit moves", () => {
    // Sarah moving to Friday does not release the operator from emailing her.
    const items = projectFuturePressure({
      date: WEDNESDAY,
      obligations: [promise],
      claims: [],
    }).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.isObligation).toBe(true);
  });
});
