import { describe, expect, it } from "vitest";
import type { GoldlineWorldEvent } from "./goldlineWorld";
import {
  COMMITMENT_MADE_EVENT,
  COMMITMENT_RESOLVED_EVENT,
  commitmentEventMetadata,
  openObligations,
  presentObligations,
  projectObligations,
} from "./goldlineObligations";
import { classifyTemporalClaim } from "./goldlineTemporal";

const TUESDAY = "2026-09-01";
const WEDNESDAY = "2026-09-02";
const FRIDAY = "2026-09-04";
const BUILDING = "building-el-royale";

const event = (
  overrides: Partial<GoldlineWorldEvent> & { id: string }
): GoldlineWorldEvent => ({
  tenantId: "default",
  physicalEntityId: BUILDING,
  eventType: COMMITMENT_MADE_EVENT,
  classification: "evidence",
  actorType: "field",
  actorId: "driver-1",
  occurredAt: `${TUESDAY}T15:14:00.000Z`,
  observedAt: null,
  sourceType: "driver_sales_journals",
  sourceId: "journal-1",
  sourceEvidenceReference: "driver_sales_journals:journal-1",
  provenanceClass: "operator_reported",
  verificationClass: "ATTESTED",
  confidence: "high",
  idempotencyKey: overrides.id,
  correlationId: "journal-1",
  metadata: {},
  ...overrides,
});

const promise = event({
  id: "commitment-1",
  metadata: {
    statement: "I told them I'd email Sarah Wednesday morning",
    promisedTo: "the front desk",
    dueDate: WEDNESDAY,
    explanation: "You said you would email Sarah — 2026-09-02 morning.",
  },
});

describe("a promise becomes world state", () => {
  it("is read back out of the Chronicle, not from a task table", () => {
    const [record] = projectObligations([promise]);
    expect(record!.id).toBe("commitment-1");
    expect(record!.physicalEntityId).toBe(BUILDING);
    expect(record!.dueDate).toBe(WEDNESDAY);
    expect(record!.promisedTo).toBe("the front desk");
    expect(record!.resolution).toBeNull();
  });

  it("gives the same answer however many times it is replayed", () => {
    // Viewing, refreshing and reopening are all just replays of this stream.
    const once = projectObligations([promise]);
    const twice = projectObligations([promise]);
    const thrice = projectObligations([promise, promise]);
    expect(twice).toEqual(once);
    expect(openObligations(thrice)).toHaveLength(2);
    expect(openObligations(once)).toHaveLength(1);
  });

  it("cannot be cleared by anything short of a real resolution", () => {
    /*
      There is deliberately no dismiss, seen or snooze in this module. The only
      way a promise leaves the open set is an appended resolution event, so no
      amount of looking at it can discharge it.
    */
    // Scan the code with comments stripped, so the prose describing this rule
    // cannot be mistaken for a violation of it.
    const code = readModule().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bdismiss\b|\bsnooze\b|markSeen|acknowledge/i);
    expect(openObligations(projectObligations([promise]))).toHaveLength(1);
  });

  it("closes only when something real discharges it", () => {
    const resolved = projectObligations([
      promise,
      event({
        id: "resolution-1",
        eventType: COMMITMENT_RESOLVED_EVENT,
        classification: "action",
        occurredAt: `${WEDNESDAY}T09:02:00.000Z`,
        sourceEvidenceReference: "emails:sent-1",
        metadata: { commitmentEventId: "commitment-1", resolution: "fulfilled" },
      }),
    ]);
    expect(resolved[0]!.resolution).toBe("fulfilled");
    expect(resolved[0]!.resolvedBy).toBe("emails:sent-1");
    expect(openObligations(resolved)).toHaveLength(0);
  });

  it("ignores a resolution that points at no real promise", () => {
    const records = projectObligations([
      promise,
      event({
        id: "resolution-x",
        eventType: COMMITMENT_RESOLVED_EVENT,
        metadata: { commitmentEventId: "does-not-exist", resolution: "fulfilled" },
      }),
    ]);
    expect(openObligations(records)).toHaveLength(1);
  });
});

describe("how a building wears what is owed", () => {
  it("shows nothing at a place with a clean slate", () => {
    expect(presentObligations("building-other", projectObligations([promise]), WEDNESDAY)).toBeNull();
  });

  it("is slack before the day, taut on it, overdue after", () => {
    const records = projectObligations([promise]);
    expect(presentObligations(BUILDING, records, TUESDAY)!.tension).toBe("slack");
    expect(presentObligations(BUILDING, records, WEDNESDAY)!.tension).toBe("taut");
    expect(presentObligations(BUILDING, records, FRIDAY)!.tension).toBe("overdue");
  });

  it("always says out loud what the restraint means", () => {
    // Never colour alone — the tether has to be readable without seeing it.
    const shown = presentObligations(BUILDING, projectObligations([promise]), WEDNESDAY)!;
    expect(shown.explanation).toMatch(/promise/i);
    expect(shown.explanation).toContain("email Sarah");
    expect(shown.explanation).not.toMatch(/physicalEntityId|metadata|null/);
  });

  it("disappears once the promise is discharged", () => {
    const records = projectObligations([
      promise,
      event({
        id: "resolution-1",
        eventType: COMMITMENT_RESOLVED_EVENT,
        metadata: { commitmentEventId: "commitment-1", resolution: "fulfilled" },
      }),
    ]);
    expect(presentObligations(BUILDING, records, WEDNESDAY)).toBeNull();
  });
});

describe("only a real promise may restrain a building", () => {
  const metaFor = (text: string) =>
    commitmentEventMetadata(classifyTemporalClaim(text, TUESDAY)!);

  it("accepts what the operator actually promised someone", () => {
    const meta = metaFor("I told the front desk I'd email Sarah Wednesday morning");
    expect(meta).not.toBeNull();
    expect(meta!.dueDate).toBe(WEDNESDAY);
    expect(meta!.impliesAppointment).toBe(false);
  });

  it("refuses a third party's report of availability", () => {
    // "Sarah is back Wednesday" is a reason to go, not a promise to keep.
    expect(metaFor("Front desk said she should be back Wednesday")).toBeNull();
  });

  it("refuses a musing", () => {
    expect(metaFor("I should probably go back Wednesday")).toBeNull();
  });

  it("refuses a bare intention", () => {
    expect(metaFor("I'm going back Wednesday")).toBeNull();
  });

  it("never records a promise as an appointment", () => {
    const meta = metaFor("I told Sarah I'd send pricing Wednesday afternoon");
    expect(meta!.impliesAppointment).toBe(false);
    // Wednesday afternoon stays a daypart; it never becomes a clock time.
    expect(meta!.duePrecision).toBe("daypart");
  });
});

function readModule(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  return readFileSync(join(__dirname, "goldlineObligations.ts"), "utf8");
}
