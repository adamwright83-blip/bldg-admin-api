import { describe, expect, it } from "vitest";
import {
  deduplicateDiscoveredEntities,
  deduplicatePursuedPipelineRows,
  eligibleGeocodeQueue,
  geographicLocationSyncDecision,
  normalizeSourceAddress,
  selectAuthoritativeCustomerOrder,
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

  it("selects one authoritative location for a duplicated commercial account", () => {
    const rows = deduplicateDiscoveredEntities([
      {
        entityType: "commercial_prospect",
        entityKey: "91",
        sourceAddress: "Secondary address",
        latitude: 34.01,
        longitude: -118.41,
        sourceOrdinal: 2,
      },
      {
        entityType: "commercial_prospect",
        entityKey: "91",
        sourceAddress: "Primary address",
        latitude: 34.02,
        longitude: -118.42,
        isPrimary: true,
        sourceUpdatedAt: new Date("2026-08-30T12:00:00Z"),
        sourceOrdinal: 3,
      },
      {
        // The same location multiplied by a second pipeline join row.
        entityType: "commercial_prospect",
        entityKey: "91",
        sourceAddress: "Primary address",
        latitude: 34.02,
        longitude: -118.42,
        isPrimary: true,
        sourceUpdatedAt: new Date("2026-08-30T12:00:00Z"),
        sourceOrdinal: 3,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityKey: "91",
      sourceAddress: "Primary address",
      latitude: 34.02,
      longitude: -118.42,
    });
  });

  it("prefers the customer's current address over an older recognized building", () => {
    const selected = selectAuthoritativeCustomerOrder([
      {
        id: 1,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        buildingSlug: "westview",
        address: "100 Westview Blvd",
        firstName: "Ada",
        lastName: "L",
        unit: "4",
      },
      {
        id: 2,
        createdAt: new Date("2026-08-30T00:00:00Z"),
        buildingSlug: null,
        address: "200 New Place",
        firstName: "Ada",
        lastName: "L",
        unit: "4",
      },
    ]);
    expect(selected.address).toBe("200 New Place");
  });

  it("adopts authoritative coordinates that arrive or change for the same address", () => {
    const arriving = geographicLocationSyncDecision({
      existingNormalizedAddress: "same address",
      existingLatitude: null,
      existingLongitude: null,
      existingProvider: null,
      sourceAddress: "Same address",
      latitude: 34.05,
      longitude: -118.4,
    });
    expect(arriving).toMatchObject({
      addressChanged: false,
      authoritativeCoordinatesChanged: true,
      changed: true,
      geocodeStatus: "success",
    });

    const moved = geographicLocationSyncDecision({
      existingNormalizedAddress: "same address",
      existingLatitude: "34.0500000",
      existingLongitude: "-118.4000000",
      existingProvider: "existing_commercial_location",
      sourceAddress: "Same address",
      latitude: 34.06,
      longitude: -118.41,
    });
    expect(moved).toMatchObject({
      addressChanged: false,
      authoritativeCoordinatesChanged: true,
      changed: true,
    });

    const unchanged = geographicLocationSyncDecision({
      existingNormalizedAddress: "same address",
      existingLatitude: "34.0600000",
      existingLongitude: "-118.4100000",
      existingProvider: "existing_commercial_location",
      sourceAddress: "Same address",
      latitude: 34.06,
      longitude: -118.41,
    });
    expect(unchanged.changed).toBe(false);
  });

  it("returns one current pursuit per account", () => {
    const rows = deduplicatePursuedPipelineRows([
      {
        id: 10,
        accountId: 7,
        updatedAt: new Date("2026-08-29T12:00:00Z"),
        stage: "qualified",
      },
      {
        id: 11,
        accountId: 7,
        updatedAt: new Date("2026-08-30T12:00:00Z"),
        stage: "visit_planned",
      },
      {
        id: 12,
        accountId: 8,
        updatedAt: new Date("2026-08-30T11:00:00Z"),
        stage: "follow_up",
      },
    ]);
    expect(rows.map(row => row.id)).toEqual([11, 12]);
  });

  it("prioritizes never-attempted geocodes and defers recent failures", () => {
    const now = new Date("2026-08-30T12:00:00Z");
    const row = (
      id: string,
      geocodeStatus: string,
      lastAttemptAt: Date | null
    ) => ({
      id,
      entityKey: id,
      geocodeStatus,
      lastAttemptAt,
      createdAt: new Date("2026-08-01T00:00:00Z"),
    });
    const queue = eligibleGeocodeQueue(
      [
        row(
          "recent-transient",
          "transient_failure",
          new Date("2026-08-30T11:59:00Z")
        ),
        row(
          "old-provider",
          "provider_failure",
          new Date("2026-08-30T10:00:00Z")
        ),
        row("never-b", "pending", null),
        row("never-a", "pending", null),
      ],
      { now, providerConfigured: true }
    );
    expect(queue.map(item => item.id)).toEqual([
      "never-a",
      "never-b",
      "old-provider",
    ]);
  });
});
