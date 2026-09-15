import { describe, expect, it, beforeEach } from "vitest";
import {
  listClaireConversionJoins,
  recordClaireConversionJoin,
  resetClaireConversionJoinsForTesting,
} from "./conversionJoins";

describe("Claire → reality conversion joins", () => {
  beforeEach(() => {
    resetClaireConversionJoinsForTesting();
  });

  it("records conversation → proposal → accepted → details → completed → outcome", () => {
    recordClaireConversionJoin({
      tenantId: "t1",
      operatorUserId: "op",
      conversationId: "c1",
      stage: "conversation",
    });
    recordClaireConversionJoin({
      tenantId: "t1",
      operatorUserId: "op",
      conversationId: "c1",
      stage: "proposal",
      proposalTitle: "Research Zeely",
      detailState: "NEEDS_DETAILS",
    });
    recordClaireConversionJoin({
      tenantId: "t1",
      operatorUserId: "op",
      conversationId: "c1",
      stage: "accepted",
      actionId: "a1",
      detailState: "NEEDS_DETAILS",
    });
    recordClaireConversionJoin({
      tenantId: "t1",
      operatorUserId: "op",
      conversationId: "c1",
      stage: "details_supplied",
      actionId: "a1",
      detailState: "COMPLETE",
    });
    recordClaireConversionJoin({
      tenantId: "t1",
      operatorUserId: "op",
      conversationId: "c1",
      stage: "completed",
      actionId: "a1",
    });
    recordClaireConversionJoin({
      tenantId: "t1",
      operatorUserId: "op",
      conversationId: "c1",
      stage: "outcome",
      actionId: "a1",
      outcomeId: "o1",
    });
    expect(listClaireConversionJoins("t1").map(join => join.stage)).toEqual([
      "conversation",
      "proposal",
      "accepted",
      "details_supplied",
      "completed",
      "outcome",
    ]);
  });
});
