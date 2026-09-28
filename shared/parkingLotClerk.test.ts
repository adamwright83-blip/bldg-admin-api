import { describe, expect, it } from "vitest";
import {
  PARKING_LOT_CLERK_EVENT_NAME,
  PARKING_LOT_CLERK_PROVENANCE,
  shouldPromptParkingLotClerk,
} from "./commercialMissionField";

describe("Parking-Lot Clerk shared contract", () => {
  it("uses one operator-reported event vocabulary", () => {
    expect(PARKING_LOT_CLERK_EVENT_NAME).toBe("parking_lot_clerk_observation");
    expect(PARKING_LOT_CLERK_PROVENANCE).toBe("operator_reported");
  });

  it("prompts only after a real visit outcome exists and no observation is stored", () => {
    expect(
      shouldPromptParkingLotClerk({
        hasVisitOutcome: false,
        hasObservation: false,
      })
    ).toBe(false);
    expect(
      shouldPromptParkingLotClerk({
        hasVisitOutcome: true,
        hasObservation: false,
      })
    ).toBe(true);
    expect(
      shouldPromptParkingLotClerk({
        hasVisitOutcome: true,
        hasObservation: true,
      })
    ).toBe(false);
  });

  it("does not treat arrival by itself as sufficient to prompt", () => {
    expect(
      shouldPromptParkingLotClerk({
        hasVisitOutcome: false,
        hasObservation: false,
      })
    ).toBe(false);
  });
});
