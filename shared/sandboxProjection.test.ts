import { describe, expect, it } from "vitest";
import { sandboxFixture } from "./sandboxScenarios";
import { projectSandboxSettlement } from "./sandboxProjection";

describe("sandbox visual projection honors daily settlement boundaries", () => {
  it("renders HISTORY_SCARS as settled history with pristine today", () => {
    const fixture = sandboxFixture("HISTORY_SCARS");
    const result = projectSandboxSettlement({ events: fixture.events, todayBusinessDate: fixture.todayBusinessDate, cursor: fixture.events.length });
    expect(result.buildings.opus_la.today.incomingAttacks).toBe(0);
    expect(result.buildings.opus_la.strata.length).toBeGreaterThan(0);
    expect(result.buildings.century_park_east.today.damage).toBe("pristine");
  });

  it("preserves HISTORY_STRESS patina input without carrying prior-day charge", () => {
    const fixture = sandboxFixture("HISTORY_STRESS");
    const result = projectSandboxSettlement({ events: fixture.events, todayBusinessDate: fixture.todayBusinessDate, cursor: fixture.events.length });
    expect(result.buildings.opus_la.today.damage).toBe("pristine");
    expect(result.buildings.opus_la.today.unspentValueCents).toBe(0);
    expect(result.buildings.opus_la.strata.length).toBe(40);
    expect(result.buildings.opus_la.settledScars).toBeGreaterThan(72);
  });

  it("keeps a prior-day remainder out of today's accumulator", () => {
    const fixture = sandboxFixture("HISTORY_SCARS");
    const result = projectSandboxSettlement({ events: fixture.events, todayBusinessDate: fixture.todayBusinessDate, cursor: fixture.events.length });
    expect(result.buildings.opus_la.today.unspentValueCents).toBe(0);
  });
});
