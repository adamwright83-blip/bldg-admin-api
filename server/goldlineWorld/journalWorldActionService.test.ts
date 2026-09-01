import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { worldEventTypeForJournalAction } from "./journalWorldActionService";

describe("journal world actions", () => {
  it("maps legitimate journal actions onto existing world event types", () => {
    expect(worldEventTypeForJournalAction("visited")).toBe("visited");
    expect(worldEventTypeForJournalAction("visit_attempted")).toBe("visit_attempted");
    expect(worldEventTypeForJournalAction("called")).toBe("call_completed");
    expect(worldEventTypeForJournalAction("texted")).toBe("text_sent");
    expect(worldEventTypeForJournalAction("emailed")).toBe("email_sent");
    expect(worldEventTypeForJournalAction("proposal_sent")).toBe("proposal_sent");
    expect(worldEventTypeForJournalAction("collateral_delivered")).toBe(
      "collateral_delivered"
    );
  });

  it("refuses to invent a commercial outcome from a journal action", () => {
    expect(worldEventTypeForJournalAction("account_won_reported")).toBeNull();
    expect(worldEventTypeForJournalAction("spoke_with_contact")).toBeNull();
    expect(worldEventTypeForJournalAction("other")).toBeNull();
  });

  it("is lookup-only and does not create physical entities", () => {
    const source = readFileSync(join(__dirname, "journalWorldActionService.ts"), "utf8");
    expect(source).toContain("findPhysicalEntityIdByAddress");
    expect(source).not.toMatch(/insert\(physicalEntities|new_entity|createOrResolve/);
    expect(source).not.toMatch(/account_won|commercialPipeline|orders/);
  });

  it("is invoked from Field Journal processing after commitments", () => {
    const source = readFileSync(join(__dirname, "fieldJournalProcessingService.ts"), "utf8");
    expect(source).toContain("recordJournalActionsOnMatchedEntities");
  });
});
