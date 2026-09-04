import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../../drizzle/schema.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../drizzle/0064_real_workday_visit_outcomes.sql", import.meta.url), "utf8");
const service = readFileSync(new URL("./commercialMissionFieldService.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("./commercialMissionRouter.ts", import.meta.url), "utf8");
const actionServices = readFileSync(new URL("../../client/src/game/actions/actionServices.ts", import.meta.url), "utf8");
const actionSurface = readFileSync(new URL("../../client/src/game/actions/GoldlineActionSurface.tsx", import.meta.url), "utf8");

describe("Real Workday visit outcome truth", () => {
  it("stores unresolved reality without forcing win, loss, or scheduled follow-up", () => {
    expect(schema).toContain('"no_contact"');
    expect(schema).toContain('"no_decision"');
    expect(migration).toContain("'no_contact','no_decision'");
    expect(router).toContain('"no_contact", "no_decision"');
    expect(actionServices).toContain('"no_contact" | "no_decision"');
    expect(service).toContain('"no_contact" | "no_decision"');
    expect(service).toContain('toStatus: "visit_completed"');
  });

  it("advances past visit_completed only for explicit follow-up, won, or lost truth", () => {
    expect(service).toContain('input.outcome === "follow_up"');
    expect(service).toContain('input.outcome === "won"');
    expect(service).toContain('input.outcome === "lost"');
    expect(service).toContain("toStatus: input.outcome");
    expect(router).toContain('value.outcome === "follow_up" && !value.followUpAt');
  });

  it("makes uncertainty the UI default and captures supported real evidence", () => {
    expect(actionSurface).toContain('VisitOutcomeRequest["outcome"]>("no_decision")');
    expect(actionSurface).toContain('value="no_contact"');
    expect(actionSurface).toContain('value="no_decision"');
    expect(actionSurface).toContain("setDecisionMakerStatus");
    expect(actionSurface).toContain("setCollateralDelivered");
    expect(actionSurface).toContain("setQuoteRequested");
    expect(actionSurface).toContain("setPilotRequested");
    expect(actionSurface).toContain("setFollowUpRequested");
  });
});
