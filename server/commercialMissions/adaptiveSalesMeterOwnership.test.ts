import { describe, expect, it } from "vitest";
import { ownsSalesMissionEvent } from "./adaptiveSalesMeter";

describe("adaptive sales meter historical ownership", () => {
  it("counts a walk-in when the mission is assigned to the driver even if the old event actor is missing", () => {
    expect(ownsSalesMissionEvent({ driverId: "driver-1", actorId: null, assignedTo: "driver-1" })).toBe(true);
  });

  it("counts a walk-in directly logged by the driver", () => {
    expect(ownsSalesMissionEvent({ driverId: "driver-1", actorId: "driver-1", assignedTo: null })).toBe(true);
  });

  it("does not count another driver's mission", () => {
    expect(ownsSalesMissionEvent({ driverId: "driver-1", actorId: "driver-2", assignedTo: "driver-2" })).toBe(false);
  });
});
