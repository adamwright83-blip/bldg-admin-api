import { describe, expect, it } from "vitest";
import {
  geographicLocationSyncDecision,
  normalizeSourceAddress,
} from "./geographicTruthService";

describe("geographic truth location synchronization", () => {
  it("does not re-geocode an unchanged normalized address", () => {
    const normalized = normalizeSourceAddress(
      "10000 Santa Monica Blvd., Los Angeles CA"
    );
    expect(
      geographicLocationSyncDecision({
        existingNormalizedAddress: normalized,
        sourceAddress: " 10000 Santa Monica Blvd Los Angeles CA ",
      })
    ).toMatchObject({ changed: false, geocodeStatus: "pending" });
  });

  it("requeues a changed address and preserves authoritative coordinates", () => {
    expect(
      geographicLocationSyncDecision({
        existingNormalizedAddress: "old address",
        sourceAddress: "New address",
      })
    ).toMatchObject({ changed: true, geocodeStatus: "pending" });
    expect(
      geographicLocationSyncDecision({
        existingNormalizedAddress: "old address",
        sourceAddress: "New address",
        latitude: 34.05,
        longitude: -118.4,
      })
    ).toMatchObject({ changed: true, geocodeStatus: "success" });
  });
});
