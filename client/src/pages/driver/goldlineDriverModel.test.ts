import { describe, expect, it, vi } from "vitest";
import {
  canCompleteDelivery,
  nextCommitmentDate,
  requestGoldlineLocation,
} from "./goldlineDriverModel";

describe("Goldline driver truth helpers", () => {
  it("never permits an unpaid delivery completion", () => {
    expect(canCompleteDelivery({ paid: false })).toBe(false);
    expect(canCompleteDelivery({ paid: true })).toBe(true);
  });

  it("turns geolocation denial into a non-blocking unavailable state", async () => {
    const getCurrentPosition = vi.fn((_success, error) =>
      error({ message: "Permission denied" })
    );
    await expect(
      requestGoldlineLocation({ getCurrentPosition })
    ).resolves.toEqual({
      status: "unavailable",
      coordinates: null,
      accuracyMeters: null,
      reason: "Permission denied",
    });
  });

  it("passes a valid one-shot current location with reported accuracy", async () => {
    const getCurrentPosition = vi.fn(success =>
      success({
        coords: { latitude: 34.0522, longitude: -118.2437, accuracy: 27.8 },
      })
    );
    await expect(
      requestGoldlineLocation({ getCurrentPosition })
    ).resolves.toEqual({
      status: "available",
      coordinates: { latitude: 34.0522, longitude: -118.2437 },
      accuracyMeters: 28,
      reason: null,
    });
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });

  it("preserves an absent or invalid next commitment as null", () => {
    expect(nextCommitmentDate(null)).toBeNull();
    expect(nextCommitmentDate("not-a-date")).toBeNull();
    expect(nextCommitmentDate("2026-08-09T17:00:00.000Z")?.toISOString()).toBe(
      "2026-08-09T17:00:00.000Z"
    );
  });
});
