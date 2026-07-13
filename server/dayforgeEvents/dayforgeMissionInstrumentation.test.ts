import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const store = readFileSync(
  new URL("../commercialMissions/commercialMissionStore.ts", import.meta.url),
  "utf8"
);
const game = readFileSync(
  new URL(
    "../commercialMissions/commercialMissionGameService.ts",
    import.meta.url
  ),
  "utf8"
);
const proposals = readFileSync(
  new URL(
    "../commercialProposals/commercialProposalService.ts",
    import.meta.url
  ),
  "utf8"
);
const pipeline = readFileSync(
  new URL(
    "../commercialPipeline/commercialPipelineService.ts",
    import.meta.url
  ),
  "utf8"
);

describe("DayForge mission journey instrumentation", () => {
  it("appends audit and product projections inside mission transactions", () => {
    expect(store).toContain("writeDayforgeEventWith(tx");
    expect(store).toContain("before: missionAuditSnapshot(current)");
    expect(store).toContain("after: missionAuditSnapshot(transitioned)");
    expect(store).toContain("missionProjectionCorrelationId");
    expect(store).toContain("correlationId: projectionCorrelationId");
    expect(store).toContain("`${projectionCorrelationId}:${eventName}`");
  });

  it.each([
    "mission_created",
    "mission_assigned",
    "mission_game_started",
    "mission_game_abandoned",
    "mission_game_retried",
    "mission_game_completed",
    "mission_phone_unlocked",
    "field_preparation_started",
    "field_departed",
    "field_arrived",
    "visit_completed",
    "follow_up_created",
    "account_won",
    "account_lost",
  ])("covers the %s product event", eventName => {
    expect(store).toContain(`"${eventName}"`);
  });

  it("distinguishes a recovered game attempt as a retry", () => {
    expect(game).toContain("const retry = previousAttempts.length > 0");
    expect(game).toContain("const attemptNumber = previousAttempts.length + 1");
    expect(game).toContain(
      "metadata: { gameAttemptId: input.gameAttemptId, retry, attemptNumber }"
    );
  });

  it("does not place account names, addresses, notes, or replay in product properties", () => {
    const productProperties = store.match(
      /properties: \{[\s\S]*?\n\s+\},\n\s+\},/g
    );
    expect(productProperties).not.toBeNull();
    for (const block of productProperties ?? []) {
      expect(block).not.toMatch(
        /account\.name|address|notes|replay|email|phone/
      );
    }
  });

  it("projects proposal creation and approval from their domain transactions", () => {
    expect(proposals.match(/writeDayforgeEventWith\(tx/g)).toHaveLength(2);
    expect(proposals).toContain('name: "proposal_created"');
    expect(proposals).toContain('name: "proposal_approved"');
  });

  it("projects paid revenue without fabricating order creation or invoice truth", () => {
    expect(pipeline).toContain('name: "revenue_realized"');
    expect(pipeline).toContain("if (paidCents > 0)");
    expect(pipeline).not.toContain('name: "first_order_created"');
    expect(pipeline).not.toContain('name: "revenue_invoiced"');
  });
});
