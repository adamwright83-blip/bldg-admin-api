import { describe, expect, it } from "vitest";
import { TOWER_WARS_ATTACK_THRESHOLD_CENTS } from "./goldlineGameConfig";
import {
  canUsePromiseForDirectOutreach,
  canExecuteTowerWarsPromise,
  compileTowerWarsState,
  damageStateForIncomingAttacks,
  type TowerWarsBusinessEvent,
} from "./towerWars";

function event(
  id: string,
  buildingId: "opus_la" | "century_park_east",
  cents: number,
  occurredAt = "2026-08-30T17:00:00.000Z"
): TowerWarsBusinessEvent {
  return {
    eventId: id,
    occurredAt,
    businessDate: "2026-08-30",
    buildingId,
    buildingDisplayName:
      buildingId === "opus_la" ? "OPUS LA" : "Century Park East",
    orderId: id,
    customerIdentity: `customer:${id}`,
    customerDisplayName: `Customer ${id}`,
    customerPhone: null,
    revenueSource: "local_order_payment",
    realOrderValueCents: cents,
    sourceEvidence: { id },
  };
}

describe("Tower Wars deterministic compiler", () => {
  it("carries remainder and emits multiple attacks from one order", () => {
    const state = compileTowerWarsState([
      event("a", "opus_la", TOWER_WARS_ATTACK_THRESHOLD_CENTS - 2000),
      event("b", "opus_la", TOWER_WARS_ATTACK_THRESHOLD_CENTS - 500),
      event("c", "opus_la", TOWER_WARS_ATTACK_THRESHOLD_CENTS * 2 + 2000),
    ]);
    expect(state.buildings.opus_la.attackCount).toBe(3);
    expect(state.buildings.opus_la.unspentValueCents).toBe(4500);
    expect(
      state.attacks.every(a => a.weapon === "opus_architectural_driver")
    ).toBe(true);
    expect(state.buildings.century_park_east.damage).toBe("heavily-damaged");
  });

  it("sorts deterministically and replaying produces the same final state", () => {
    const events = [
      event(
        "b",
        "century_park_east",
        TOWER_WARS_ATTACK_THRESHOLD_CENTS,
        "2026-08-30T18:00:00Z"
      ),
      event(
        "a",
        "opus_la",
        TOWER_WARS_ATTACK_THRESHOLD_CENTS,
        "2026-08-30T17:00:00Z"
      ),
    ];
    expect(compileTowerWarsState(events)).toEqual(
      compileTowerWarsState([...events].reverse())
    );
    expect(events[0]?.eventId).toBe("b");
    expect(compileTowerWarsState(events).attacks[1]?.weapon).toBe(
      "century_valet_bazooka"
    );
  });

  it("maps incoming strikes to damage without fake HP", () => {
    expect([0, 1, 2, 3, 4, 12].map(damageStateForIncomingAttacks)).toEqual([
      "pristine",
      "chipped",
      "cracked",
      "heavily-damaged",
      "critical",
      "critical",
    ]);
  });
});

describe("Tower Wars resident permission gate", () => {
  it("requires recorded permission on a direct channel", () => {
    expect(
      canUsePromiseForDirectOutreach({
        permissionStatus: "recorded",
        permissionChannel: "sms",
      })
    ).toBe(true);
    expect(
      canUsePromiseForDirectOutreach({
        permissionStatus: "not_recorded",
        permissionChannel: "sms",
      })
    ).toBe(false);
    expect(
      canUsePromiseForDirectOutreach({
        permissionStatus: "recorded",
        permissionChannel: "physical_delivery",
      })
    ).toBe(false);
  });

  it("does not unlock execution from a recorded flag without evidence", () => {
    expect(
      canExecuteTowerWarsPromise({
        permissionStatus: "recorded",
        permissionChannel: "sms",
        permissionEvidence: null,
      })
    ).toBe(false);
    expect(
      canExecuteTowerWarsPromise({
        permissionStatus: "recorded",
        permissionChannel: "sms",
        permissionEvidence: "Customer explicitly requested the offer by SMS",
      })
    ).toBe(true);
    expect(
      canExecuteTowerWarsPromise({
        permissionStatus: "not_recorded",
        permissionChannel: "sms",
        permissionEvidence: "Talked to 12 people",
      })
    ).toBe(false);
  });
});
