import { describe, expect, it } from "vitest";
import { decideStatus, inferStatus, type ChronologyEvent, type CoverageView } from "./chronology";

const now = new Date("2026-10-31T16:00:00Z");
const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
let n = 0;
const event = (iso: string, patch: Partial<ChronologyEvent> = {}): ChronologyEvent => ({
  id: `e${++n}`,
  kind: "correspondence",
  signal: "owner_action",
  occurredAt: at(iso),
  evidenceId: `ev${n}`,
  provider: "gmail",
  summary: "something",
  ...patch,
});
const everything: CoverageView = { covered: () => true };
const nothing: CoverageView = { covered: () => false };
const mailOnly: CoverageView = { covered: source => source === "gmail" };

describe("current versus historical, from dated evidence", () => {
  it("historical freelancing: proposals in spring, quiet searched since → possibly dormant, never 'ended'", () => {
    const events = [event("2026-03-04", { kind: "proposal" }), event("2026-03-14", { kind: "proposal" }), event("2026-04-19", { kind: "proposal" })];
    const decision = inferStatus({ kind: "project", events, observed: [], coverage: everything, now });
    expect(decision.status).toBe("dormant");
    expect(decision.rationale).toContain("2026-04-19");
    expect(decision.rationale).toContain("may be paused, not that it ended");
    expect(decision.status).not.toBe("abandoned");
  });

  it("lack of email is not proof: if the quiet months couldn't be searched, it's unknown", () => {
    const events = [event("2026-03-04", { kind: "proposal" })];
    expect(inferStatus({ kind: "project", events, observed: [], coverage: nothing, now }).status).toBe("unknown");
  });

  it("dormant is less certain when recent documents weren't checked", () => {
    const events = [event("2026-03-04", { kind: "proposal" })];
    const withDocs = inferStatus({ kind: "project", events, observed: [], coverage: everything, now });
    const withoutDocs = inferStatus({ kind: "project", events, observed: [], coverage: mailOnly, now });
    expect(withoutDocs.status).toBe("dormant");
    expect(withoutDocs.confidence).toBeLessThan(withDocs.confidence);
    expect(withoutDocs.rationale).toContain("Recent documents weren't checked");
  });

  it("a recently modified file alone is not activity", () => {
    const events = [event("2026-10-29", { kind: "document", signal: "metadata", provider: "drive" })];
    const decision = inferStatus({ kind: "project", events, observed: [], coverage: everything, now });
    expect(decision.status).toBe("unknown");
    expect(decision.rationale).toContain("isn't evidence");
  });

  it("an old proposal plus a recently touched template stays dormant, not active", () => {
    const events = [event("2026-04-19", { kind: "proposal" }), event("2026-10-29", { kind: "document", signal: "metadata", provider: "drive" })];
    expect(inferStatus({ kind: "project", events, observed: [], coverage: everything, now }).status).toBe("dormant");
  });

  it("a business with the owner's own recent work is active", () => {
    const events = ["2026-09-03", "2026-10-01", "2026-10-20"].map(iso => event(iso, { kind: "operations" }));
    const decision = inferStatus({ kind: "company", events, observed: [], coverage: everything, now });
    expect(decision.status).toBe("active");
    expect(decision.confidence).toBeGreaterThanOrEqual(85);
  });

  it("a product in development with no launch or sale is prelaunch, and nothing implies a launch date or revenue", () => {
    const events = [event("2026-10-05"), event("2026-10-28", { kind: "planning", provider: "docs" }), event("2026-10-30", { kind: "spreadsheet", provider: "sheets" })];
    const decision = inferStatus({ kind: "product", events, observed: [{ status: "prelaunch", at: at("2026-10-28"), evidenceIds: ["s"], summary: "Status: prelaunch" }], coverage: everything, now });
    expect(decision.status).toBe("prelaunch");
    expect(decision.basis).toBe("observed");
    expect(decision.rationale).toContain("no verified launch or sale");
    expect(decision.rationale).not.toMatch(/\$|revenue|customers|launch(es|ed) on/i);
  });

  it("a product with a verified sale is active", () => {
    const events = [event("2026-10-05", { kind: "sale" })];
    expect(inferStatus({ kind: "product", events, observed: [], coverage: everything, now }).status).toBe("active");
  });

  it("an explicit statement that something closed, with activity after it, is conflicting", () => {
    const events = [event("2026-10-10", { kind: "operations" })];
    const decision = inferStatus({ kind: "company", events, observed: [{ status: "historical", at: at("2026-08-01"), evidenceIds: ["s"], summary: "We closed the shop" }], coverage: everything, now });
    expect(decision.status).toBe("conflicting");
  });
});

describe("the person's answer is the status", () => {
  const proposals = [event("2026-03-04", { kind: "proposal" })];

  it("prefers the confirmed current understanding", () => {
    const decision = decideStatus({ kind: "project", events: proposals, observed: [], user: { status: "historical", at: at("2026-10-31"), detail: "I stopped building websites", basis: "user_corrected" }, coverage: everything, now });
    expect(decision.status).toBe("historical");
    expect(decision.basis).toBe("user_corrected");
    expect(decision.conflict).toBeNull();
  });

  it("newer owner activity after 'it's over' is a conflict kept beside the answer, never replacing it", () => {
    const events = [...proposals, event("2026-10-30", { kind: "proposal" })];
    const decision = decideStatus({ kind: "project", events, observed: [], user: { status: "historical", at: at("2026-10-01"), detail: null, basis: "user_corrected" }, coverage: everything, now });
    expect(decision.status).toBe("historical");
    expect(decision.conflict?.status).toBe("active");
  });

  it("silence never contradicts 'it's still going'", () => {
    const decision = decideStatus({ kind: "company", events: proposals, observed: [], user: { status: "active", at: at("2026-10-01"), detail: null, basis: "user_confirmed" }, coverage: everything, now });
    expect(decision.status).toBe("active");
    expect(decision.conflict).toBeNull();
  });
});
