import { describe, expect, it } from "vitest";
import { ActionGatewayError, executeGrantedAction } from "../actions/gateway";
import { mintActionGrant } from "../executive/grants";

describe("persistent operator Brain authority", () => {
  it("background grants require tenant/canonical identity and cannot invent a user utterance", () => {
    expect(() =>
      mintActionGrant({
        actionClass: "place_weekly_planning_call",
        scope: {},
        authorityBasis: "scheduled_operator_appointment",
        sourceTurnAssembledText: "",
        source: {
          type: "scheduled_operator_appointment",
          tenantId: "tenant-a",
          canonicalOperatorId: "canonical-a",
          appointmentId: "appt-a",
          appointmentKind: "sunday_weekly_planning",
          standingAuthorizationId: "auth-a",
        },
        expiresAtMs: Date.now() + 60_000,
        constraints: { mutationAllowed: true, shadowOnly: false },
      })
    ).toThrow(/tenant and canonical operator identity/);

    expect(() =>
      mintActionGrant({
        actionClass: "place_weekly_planning_call",
        scope: {},
        authorityBasis: "scheduled_operator_appointment",
        sourceTurnAssembledText: "fake user permission",
        source: {
          type: "scheduled_operator_appointment",
          tenantId: "tenant-a",
          canonicalOperatorId: "canonical-a",
          appointmentId: "appt-a",
          appointmentKind: "sunday_weekly_planning",
          standingAuthorizationId: "auth-a",
        },
        tenantId: "tenant-a",
        canonicalOperatorId: "canonical-a",
        expiresAtMs: Date.now() + 60_000,
        constraints: { mutationAllowed: true, shadowOnly: false },
      })
    ).toThrow(/may not fabricate conversational source text/);
  });

  it("Action Gateway refuses expired branded authority", async () => {
    const grant = mintActionGrant({
      actionClass: "propose_day_line",
      scope: {},
      authorityBasis: "current_turn_explicit_request",
      sourceTurnAssembledText: "show me the day line",
      expiresAtMs: Date.now() - 1,
      constraints: { mutationAllowed: true, shadowOnly: false },
    });
    await expect(
      executeGrantedAction(grant, { execute: async () => "should-not-run" })
    ).rejects.toBeInstanceOf(ActionGatewayError);
  });
});
