import { describe, expect, it, vi } from "vitest";
import {
  canCompleteDelivery,
  detectOpenChannelGap,
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

  it("opens the channel for an empty open-ended day without inventing an end time", () => {
    expect(
      detectOpenChannelGap({
        now: new Date(2026, 7, 9, 11, 16),
        selectedDate: "2026-08-09",
        nextCommitmentAt: null,
        fixedStopCount: 0,
        hasMission: false,
      })
    ).toEqual({
      available: true,
      availableMinutes: null,
      nextCommitmentAt: null,
      label: "OPEN-ENDED WINDOW",
    });
  });

  it("opens only a genuinely large timed gap and preserves its verified boundary", () => {
    const now = new Date("2026-08-09T18:00:00.000Z");
    expect(
      detectOpenChannelGap({
        now,
        selectedDate: [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, "0"),
          String(now.getDate()).padStart(2, "0"),
        ].join("-"),
        nextCommitmentAt: "2026-08-09T21:30:00.000Z",
        fixedStopCount: 1,
        hasMission: false,
      })
    ).toMatchObject({
      available: true,
      availableMinutes: 210,
      nextCommitmentAt: "2026-08-09T21:30:00.000Z",
    });
  });

  it("keeps an active mission reachable even when the detected gap changes", () => {
    const now = new Date(2026, 7, 9, 11, 16);
    expect(
      detectOpenChannelGap({
        now,
        selectedDate: "2026-08-09",
        nextCommitmentAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
        fixedStopCount: 1,
        hasMission: true,
      }).available
    ).toBe(true);
  });
});
