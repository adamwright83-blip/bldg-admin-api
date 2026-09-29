import { describe, expect, it } from "vitest";
import { selectValidatedAuthorityEvent } from "./operationReceipt";

describe("operationReceipt authority lineage", () => {
  it("does not resolve authority from an unvalidated proposal or policy denial", () => {
    const events = [
      {
        status: "proposed",
        operationStatus: "proposed",
        authorityBasis: null,
        approvalBasis: null,
        standingAuthorizationId: "auth-unvalidated",
      },
      {
        status: "policy_denied",
        operationStatus: "policy_denied",
        authorityBasis: null,
        approvalBasis: null,
        standingAuthorizationId: "auth-unvalidated",
      },
    ];
    expect(selectValidatedAuthorityEvent(events)).toBeUndefined();
  });

  it("selects the first post-policy event carrying the validated authority basis", () => {
    const events = [
      {
        status: "proposed",
        operationStatus: "proposed",
        authorityBasis: null,
        approvalBasis: null,
      },
      {
        status: "execution_started",
        operationStatus: "execution_started",
        authorityBasis: "standing_authorization",
        approvalBasis: "standing_authorization",
      },
      {
        status: "success",
        operationStatus: "succeeded",
        authorityBasis: "standing_authorization",
        approvalBasis: "standing_authorization",
      },
    ];
    expect(selectValidatedAuthorityEvent(events)).toMatchObject({
      operationStatus: "execution_started",
      authorityBasis: "standing_authorization",
    });
  });
});
