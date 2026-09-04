import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shared = readFileSync(new URL("../../shared/commercialPipeline.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("./commercialPipelineService.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("../dayforgeToday/dayforgeTodayRouter.ts", import.meta.url), "utf8");
const surface = readFileSync(new URL("../../client/src/game/actions/GoldlineActionSurface.tsx", import.meta.url), "utf8");

describe("Real Workday follow-up truth", () => {
  it("records observed outcomes without treating an attempt as success", () => {
    expect(shared).toContain('"no_contact"');
    expect(shared).toContain('"contacted_no_decision"');
    expect(shared).toContain('return outcome === "won" || outcome === "lost" ? outcome : null');
    expect(service).toContain("missionStatusForFollowUpOutcome(input.outcome)");
    expect(service).toContain("outcome: input.outcome");
    expect(service).toContain("notes: input.notes");
  });

  it("allows only explicit won/lost to resolve terminal mission truth", () => {
    expect(service).toContain("if (terminalStatus)");
    expect(service).toContain("toStatus: terminalStatus");
    expect(service).toContain("pipeline-follow-up-outcome:");
    expect(router).toContain('value.outcome === "won" || value.outcome === "lost"');
  });

  it("creates a new future obligation only from an explicit future date", () => {
    expect(service).toContain("if (input.nextFollowUpAt)");
    expect(service).toContain("dueAt: input.nextFollowUpAt");
    expect(router).toContain("Next follow-up time must be in the future");
    expect(surface).toContain("EXPLICIT NEW FOLLOW-UP · OPTIONAL");
  });

  it("removes the naked complete button from the game surface", () => {
    expect(surface).not.toContain("RECORD FOLLOW-UP COMPLETE");
    expect(surface).toContain("RECORD FOLLOW-UP RESULT");
    expect(surface).toContain('value="no_contact"');
    expect(surface).toContain('value="contacted_no_decision"');
    expect(surface).toContain("MOVE THIS FOLLOW-UP WITHOUT RECORDING AN ATTEMPT");
  });
});
