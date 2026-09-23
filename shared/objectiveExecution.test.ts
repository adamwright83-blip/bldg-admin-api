import { describe, expect, it } from "vitest";
import {
  OBJECTIVE_EXECUTION_AGREEMENT_CASES,
  classifyAgreementCase,
} from "./objectiveExecutionFixture";
import { classifyObjectiveExecution, isObjectiveExecutionType } from "./objectiveExecution";

describe("objective execution classifier", () => {
  it("classifies the shared fixture the same from the full record and from the contract alone", () => {
    for (const row of OBJECTIVE_EXECUTION_AGREEMENT_CASES) {
      const full = classifyAgreementCase(row);
      const contractOnly = classifyObjectiveExecution({
        contract: row.contract,
        identifier: row.identifier,
        motion: row.motion,
      });
      expect(full.executionType, row.id).toBe(row.expected);
      expect(contractOnly.executionType, row.id).toBe(row.expected);
      expect(full.source).toBe("derived");
    }
  });

  it("does not infer a type from an identifier that contains mission", () => {
    expect(
      classifyObjectiveExecution({
        contract: "Check the board",
        identifier: "commercial_mission_weekly_primary",
        motion: "account_acquisition",
        title: "commercial_mission:greystar",
      }).executionType
    ).toBeNull();
  });

  it("keeps a stored type and does not re-derive it", () => {
    const storedChallenge = classifyObjectiveExecution({
      contract: "On-site property pitch",
      identifier: "commercial_mission:greystar",
      persistedType: "challenge",
    });
    expect(storedChallenge.executionType).toBe("challenge");
    expect(storedChallenge.source).toBe("persisted");

    const storedUnknown = classifyObjectiveExecution({
      contract: "On-site property pitch",
      persistedType: null,
    });
    expect(storedUnknown.executionType).toBeNull();
    expect(storedUnknown.source).toBe("persisted");
    expect(storedUnknown.executionType).not.toBe("mission");
  });

  it("does not coerce an invalid stored type into Mission", () => {
    const decision = classifyObjectiveExecution({
      contract: "Visit Greystar on-site",
      persistedType: "Mission" as never,
    });
    expect(isObjectiveExecutionType("Mission")).toBe(false);
    expect(decision.executionType).toBeNull();
    expect(decision.source).toBe("persisted");
  });

  it("treats a website visit as not field and an either-or as unknown", () => {
    expect(classifyObjectiveExecution({ contract: "Visit the website" }).executionType).toBeNull();
    expect(classifyObjectiveExecution({ contract: "Visit the website in the browser" }).executionType).toBe(
      "challenge"
    );
    expect(classifyObjectiveExecution({ contract: "Visit the property or email the manager" }).executionType).toBeNull();
    expect(
      classifyObjectiveExecution({ contract: "Visit the property or email the manager" }).eitherAcceptable
    ).toBe(true);
    expect(classifyObjectiveExecution({ contract: "Visit the property and email the manager" }).executionType).toBe(
      "hybrid_objective"
    );
  });

  it("leaves co-mentioned field and remote work unknown when nothing requires both", () => {
    const decision = classifyObjectiveExecution({
      contract: "Visit the office. Email the proposal.",
    });
    expect(decision.executionType).toBeNull();
    expect(decision.eitherAcceptable).toBe(false);
    expect(decision.fieldRequired).toBe(false);
    expect(decision.remoteRequired).toBe(false);
  });
});
