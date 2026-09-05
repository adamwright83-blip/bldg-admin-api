import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import {
  commercialAccountLocations,
  commercialAccounts,
  commercialPipelineRecords,
  entityLocations,
  orders,
} from "../../drizzle/schema";
import { BUILDINGS, matchBuilding } from "../../shared/buildings";
import { computeRecencyStatus } from "../../shared/customerStatus";
import {
  inferCustomerCadence,
  projectLatLngToLanternAtlas,
  type LanternState,
} from "../../shared/lanternCity";
import {
  customerIdentityHash,
  groupCustomerRecords,
} from "../customerAssets/customerIdentity";
import { getDashboardTimeZone, zonedYmd } from "../dashboardZoned";
import { getDb } from "../db";
import { GoogleGeocoder } from "./googleGeocoder";
import { GoogleAddressValidationService, type AddressValidationResult } from "../google/googleAddressValidationService";
import { ENV } from "../_core/env";

export type GeographicEntityType =
  | "customer"
  | "building"
  | "commercial_prospect";

const ACTIVE_COMMERCIAL_PIPELINE_STAGES: Array<
  typeof commercialPipelineRecords.$inferSelect.stage
> = [
  "discovered",
  "qualified",
  "mission_created",
  "game_ready",
  "field_ready",
  "visit_planned",
  "visited",
  "follow_up",
  "proposal_sent",
  "pilot_requested",
  "verbal_yes",
];
export type DiscoveredEntity = {
  entityType: GeographicEntityType;
  entityKey: string;
  sourceAddress: string;
  latitude?: number | null;
  longitude?: number | null;
  isPrimary?: boolean;
  sourceUpdatedAt?: Date | null;
  sourceOrdinal?: number;
};

function hasValidCoordinates(entity: {
  latitude?: number | null;
  longitude?: number | null;
}): boolean {
  return (
    Number.isFinite(entity.latitude) &&
    Number.isFinite(entity.longitude) &&
    entity.latitude! >= -90 &&
    entity.latitude! <= 90 &&
    entity.longitude! >= -180 &&
    entity.longitude! <= 180
  );
}

function compareDiscoveredAuthority(
  left: DiscoveredEntity,
  right: DiscoveredEntity
): number {
  return (
    Number(Boolean(right.isPrimary)) - Number(Boolean(left.isPrimary)) ||
    Number(hasValidCoordinates(right)) - Number(hasValidCoordinates(left)) ||
    (right.sourceUpdatedAt?.getTime() ?? 0) -
      (left.sourceUpdatedAt?.getTime() ?? 0) ||
    (right.sourceOrdinal ?? 0) - (left.sourceOrdinal ?? 0) ||
    normalizeSourceAddress(left.sourceAddress).localeCompare(
      normalizeSourceAddress(right.sourceAddress)
    )
  );
}

/** One deterministic persistence candidate per tenant-scoped entity key. */
export function deduplicateDiscoveredEntities(
  entities: readonly DiscoveredEntity[]
): DiscoveredEntity[] {
  const byKey = new Map<string, DiscoveredEntity>();
  for (const entity of entities) {
    const key = `${entity.entityType}:${entity.entityKey}`;
    const current = byKey.get(key);
    if (!current || compareDiscoveredAuthority(entity, current) < 0) {
      byKey.set(key, entity);
    }
  }
  return Array.from(byKey.values()).sort(
    (left, right) =>
      left.entityType.localeCompare(right.entityType) ||
      left.entityKey.localeCompare(right.entityKey)
  );
}

export function deduplicatePursuedPipelineRows<
  T extends { accountId: number; id: number; updatedAt: Date },
>(rows: readonly T[]): T[] {
  const sorted = [...rows].sort(
    (left, right) =>
      right.updatedAt.getTime() - left.updatedAt.getTime() || right.id - left.id
  );
  const byAccount = new Map<number, T>();
  for (const row of sorted) {
    if (!byAccount.has(row.accountId)) byAccount.set(row.accountId, row);
  }
  return Array.from(byAccount.values());
}

type GeocodeQueueRow = {
  id: string;
  entityKey: string;
  geocodeStatus: string;
  lastAttemptAt: Date | null;
  createdAt: Date;
};

function geocodeRetryDelayMs(
  status: string,
  providerConfigured: boolean
): number {
  if (status === "pending") return 0;
  if (status === "transient_failure") return 5 * 60_000;
  if (status === "provider_failure") return 60 * 60_000;
  if (status === "ambiguous") return 24 * 60 * 60_000;
  if (status === "unconfigured") return providerConfigured ? 0 : 15 * 60_000;
  return Number.POSITIVE_INFINITY;
}

export function eligibleGeocodeQueue<T extends GeocodeQueueRow>(
  rows: readonly T[],
  input: { now: Date; providerConfigured: boolean }
): T[] {
  return rows
    .filter(row => {
      if (
        row.geocodeStatus === "success" ||
        row.geocodeStatus === "missing_address"
      )
        return false;
      if (!row.lastAttemptAt) return true;
      return (
        input.now.getTime() - row.lastAttemptAt.getTime() >=
        geocodeRetryDelayMs(row.geocodeStatus, input.providerConfigured)
      );
    })
    .sort(
      (left, right) =>
        Number(Boolean(left.lastAttemptAt)) -
          Number(Boolean(right.lastAttemptAt)) ||
        (left.lastAttemptAt?.getTime() ?? 0) -
          (right.lastAttemptAt?.getTime() ?? 0) ||
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.entityKey.localeCompare(right.entityKey) ||
        left.id.localeCompare(right.id)
    );
}

export function normalizeSourceAddress(address: string): string {
  return address
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ");
}

export function geographicLocationSyncDecision(input: {
  existingNormalizedAddress?: string | null;
  existingLatitude?: string | number | null;
  existingLongitude?: string | number | null;
  existingProvider?: string | null;
  sourceAddress: string;
  latitude?: number | null;
  longitude?: number | null;
}) {
  const normalizedSourceAddress = normalizeSourceAddress(input.sourceAddress);
  const hasCoordinates = hasValidCoordinates(input);
  const addressChanged =
    input.existingNormalizedAddress == null ||
    input.existingNormalizedAddress !== normalizedSourceAddress;
  const coordinatesEqual =
    hasCoordinates &&
    input.existingLatitude != null &&
    input.existingLongitude != null &&
    input.existingLatitude !== "" &&
    input.existingLongitude !== "" &&
    Number.isFinite(Number(input.existingLatitude)) &&
    Number.isFinite(Number(input.existingLongitude)) &&
    Math.abs(Number(input.existingLatitude) - input.latitude!) <= 0.0000001 &&
    Math.abs(Number(input.existingLongitude) - input.longitude!) <= 0.0000001;
  const authoritativeCoordinatesChanged =
    hasCoordinates &&
    (input.existingProvider !== "existing_commercial_location" ||
      !coordinatesEqual);
  return {
    normalizedSourceAddress,
    hasCoordinates,
    addressChanged,
    authoritativeCoordinatesChanged,
    changed: addressChanged || authoritativeCoordinatesChanged,
    geocodeStatus: hasCoordinates
      ? ("success" as const)
      : normalizedSourceAddress
        ? ("pending" as const)
        : ("missing_address" as const),
  };
}

function displayTier(order: {
  buildingSlug: string | null;
  address: string;
  firstName: string;
  lastName: string;
  unit: string | null;
}): number {
  if (order.buildingSlug?.trim()) return 4;
  if (matchBuilding(order.address)) return 3;
  if (order.firstName.trim() || order.lastName.trim() || order.unit?.trim())
    return 2;
  return 1;
}

export function selectAuthoritativeCustomerOrder<
  T extends {
    buildingSlug: string | null;
    address: string;
    firstName: string;
    lastName: string;
    unit: string | null;
    createdAt: Date;
    id: number;
  },
>(group: readonly T[]): T {
  const withAddress = group.filter(order => order.address.trim().length > 0);
  return [...(withAddress.length > 0 ? withAddress : group)].sort(
    (left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime() ||
      displayTier(right) - displayTier(left) ||
      right.id - left.id
  )[0]!;
}

async function loadCustomerGroups(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.tenantId, tenantId));
  const qualifying = rows.filter(row => row.status !== "cancelled");
  qualifying.sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() || left.id - right.id
  );
  return new Map(
    groupCustomerRecords(tenantId, qualifying, order => order).map(group => [
      group.key,
      group.records,
    ])
  );
}

async function discoverEntities(tenantId: string): Promise<DiscoveredEntity[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const groups = await loadCustomerGroups(tenantId);
  const customers = Array.from(groups.entries()).map(([entityKey, group]) => {
    const best = selectAuthoritativeCustomerOrder(group);
    return {
      entityType: "customer" as const,
      entityKey,
      sourceAddress: best.address.trim(),
    };
  });
  const buildings = BUILDINGS.filter(building => building.defaultAddress).map(
    building => ({
      entityType: "building" as const,
      entityKey: building.id,
      sourceAddress: building.defaultAddress!,
    })
  );
  const prospects = await db
    .select({
      accountId: commercialAccounts.id,
      locationId: commercialAccountLocations.id,
      address: commercialAccountLocations.address,
      latitude: commercialAccountLocations.latitude,
      longitude: commercialAccountLocations.longitude,
      isPrimary: commercialAccountLocations.isPrimary,
      locationUpdatedAt: commercialAccountLocations.updatedAt,
    })
    .from(commercialPipelineRecords)
    .innerJoin(
      commercialAccounts,
      and(
        eq(commercialAccounts.tenantId, tenantId),
        eq(commercialAccounts.id, commercialPipelineRecords.accountId)
      )
    )
    .innerJoin(
      commercialAccountLocations,
      and(
        eq(commercialAccountLocations.tenantId, tenantId),
        eq(commercialAccountLocations.accountId, commercialAccounts.id)
      )
    )
    .where(
      and(
        eq(commercialPipelineRecords.tenantId, tenantId),
        inArray(
          commercialPipelineRecords.stage,
          ACTIVE_COMMERCIAL_PIPELINE_STAGES
        )
      )
    );
  return [
    ...customers,
    ...buildings,
    ...prospects.map(row => ({
      entityType: "commercial_prospect" as const,
      entityKey: String(row.accountId),
      sourceAddress: row.address.trim(),
      latitude: row.latitude == null ? null : Number(row.latitude),
      longitude: row.longitude == null ? null : Number(row.longitude),
      isPrimary: row.isPrimary,
      sourceUpdatedAt: row.locationUpdatedAt,
      sourceOrdinal: row.locationId,
    })),
  ];
}

export async function syncGeographicEntities(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const discovered = deduplicateDiscoveredEntities(
    await discoverEntities(tenantId)
  );
  const existing = await db
    .select()
    .from(entityLocations)
    .where(eq(entityLocations.tenantId, tenantId));
  const byKey = new Map(
    existing.map(row => [`${row.entityType}:${row.entityKey}`, row])
  );
  let inserted = 0,
    changed = 0,
    unchanged = 0;
  for (const entity of discovered) {
    const decision = geographicLocationSyncDecision({
      sourceAddress: entity.sourceAddress,
      latitude: entity.latitude,
      longitude: entity.longitude,
    });
    const normalized = decision.normalizedSourceAddress;
    const key = `${entity.entityType}:${entity.entityKey}`;
    const current = byKey.get(key);
    if (!current) {
      const hasCoordinates = decision.hasCoordinates;
      const insertedValues = {
        id: randomUUID(),
        tenantId,
        entityType: entity.entityType,
        entityKey: entity.entityKey,
        sourceAddress: entity.sourceAddress,
        normalizedSourceAddress: normalized,
        canonicalAddress: hasCoordinates ? entity.sourceAddress : null,
        latitude: hasCoordinates ? String(entity.latitude) : null,
        longitude: hasCoordinates ? String(entity.longitude) : null,
        geocodeStatus: decision.geocodeStatus,
        geocodeProvider: hasCoordinates ? "existing_commercial_location" : null,
        geocodedAt: hasCoordinates ? new Date() : null,
      };
      await db
        .insert(entityLocations)
        .values(insertedValues)
        .onDuplicateKeyUpdate({
          set: hasCoordinates
            ? {
                sourceAddress: insertedValues.sourceAddress,
                normalizedSourceAddress: insertedValues.normalizedSourceAddress,
                canonicalAddress: insertedValues.canonicalAddress,
                latitude: insertedValues.latitude,
                longitude: insertedValues.longitude,
                geocodeStatus: insertedValues.geocodeStatus,
                geocodeProvider: insertedValues.geocodeProvider,
                geocodedAt: insertedValues.geocodedAt,
                googlePlaceId: null,
                geocodeError: null,
              }
            : {
                // A concurrent sync won the insert. Do not let a stale,
                // coordinate-free candidate overwrite its geographic truth;
                // the next sync will reconcile from the persisted row.
                entityKey: insertedValues.entityKey,
              },
        });
      inserted += 1;
    } else if (
      geographicLocationSyncDecision({
        existingNormalizedAddress: current.normalizedSourceAddress,
        existingLatitude: current.latitude,
        existingLongitude: current.longitude,
        existingProvider: current.geocodeProvider,
        sourceAddress: entity.sourceAddress,
        latitude: entity.latitude,
        longitude: entity.longitude,
      }).changed
    ) {
      const hasCoordinates = decision.hasCoordinates;
      await db
        .update(entityLocations)
        .set({
          sourceAddress: entity.sourceAddress,
          normalizedSourceAddress: normalized,
          canonicalAddress: hasCoordinates ? entity.sourceAddress : null,
          latitude: hasCoordinates ? String(entity.latitude) : null,
          longitude: hasCoordinates ? String(entity.longitude) : null,
          googlePlaceId: null,
          geocodeStatus: decision.geocodeStatus,
          geocodeProvider: hasCoordinates
            ? "existing_commercial_location"
            : null,
          geocodedAt: hasCoordinates ? new Date() : null,
          geocodeError: null,
        })
        .where(
          and(
            eq(entityLocations.tenantId, tenantId),
            eq(entityLocations.id, current.id)
          )
        );
      changed += 1;
    } else unchanged += 1;
  }
  return { discovered: discovered.length, inserted, changed, unchanged };
}

export async function geocodePendingLocations(input: {
  tenantId: string;
  batchSize?: number;
  geocoder?: GoogleGeocoder;
  addressValidator?: GoogleAddressValidationService;
  now?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await syncGeographicEntities(input.tenantId);
  const batchSize = Math.max(1, Math.min(50, input.batchSize ?? 20));
  const now = input.now ?? new Date();
  const providerConfigured = Boolean(
    ENV.googleAddressValidationApiKey ||
    ENV.googleGeocodingApiKey ||
    ENV.googlePlacesApiKey
  );
  const pending = eligibleGeocodeQueue(
    await db
      .select()
      .from(entityLocations)
      .where(eq(entityLocations.tenantId, input.tenantId)),
    { now, providerConfigured }
  ).slice(0, batchSize);
  const successful = await db
    .select()
    .from(entityLocations)
    .where(
      and(
        eq(entityLocations.tenantId, input.tenantId),
        eq(entityLocations.geocodeStatus, "success")
      )
    );
  const cache = new Map(
    successful.map(row => [row.normalizedSourceAddress, row])
  );
  const geocoder = input.geocoder ?? new GoogleGeocoder();
  const addressValidator = input.addressValidator ?? new GoogleAddressValidationService();
  const counts = {
    attempted: 0,
    success: 0,
    cached: 0,
    failed: 0,
    unconfigured: 0,
  };
  for (const row of pending) {
    const cached = cache.get(row.normalizedSourceAddress);
    if (cached?.latitude && cached.longitude) {
      await db
        .update(entityLocations)
        .set({
          canonicalAddress: cached.canonicalAddress,
          latitude: cached.latitude,
          longitude: cached.longitude,
          googlePlaceId: cached.googlePlaceId,
          geocodeStatus: "success",
          geocodeProvider: cached.geocodeProvider,
          geocodedAt: cached.geocodedAt,
          geocodeError: null,
        })
        .where(eq(entityLocations.id, row.id));
      counts.cached += 1;
      continue;
    }
    counts.attempted += 1;
    // Address Validation is the authoritative first pass; only fall back to
    // legacy Geocoding when it cannot establish a usable premise coordinate.
    const validated = await addressValidator.validateAddress(row.sourceAddress);
    const result = validated.status === "success" && validated.latitude != null && validated.longitude != null
      ? {
          status: "success" as const,
          canonicalAddress: validated.formattedAddress,
          latitude: validated.latitude,
          longitude: validated.longitude,
          googlePlaceId: validated.placeId,
          provider: "google_address_validation" as const,
        }
      : await geocoder.geocode(row.sourceAddress);
    if (result.status === "success") {
      await db
        .update(entityLocations)
        .set({
          canonicalAddress: result.canonicalAddress,
          latitude: String(result.latitude),
          longitude: String(result.longitude),
          googlePlaceId: result.googlePlaceId,
          geocodeStatus: "success",
          geocodeProvider: result.provider,
          geocodedAt: now,
          lastAttemptAt: now,
          geocodeError: null,
        })
        .where(eq(entityLocations.id, row.id));
      counts.success += 1;
    } else {
      const status =
        result.status === "unconfigured" ? "unconfigured" : result.status;
      await db
        .update(entityLocations)
        .set({
          geocodeStatus: status,
          geocodeProvider: "google_geocoding",
          lastAttemptAt: now,
          geocodeError:
            "error" in result
              ? result.error
              : "GOOGLE_GEOCODING_API_KEY is not configured",
        })
        .where(eq(entityLocations.id, row.id));
      if (result.status === "unconfigured") counts.unconfigured += 1;
      else counts.failed += 1;
    }
  }
  const unresolved = await db
    .select()
    .from(entityLocations)
    .where(eq(entityLocations.tenantId, input.tenantId));
  const immediatelyEligible = eligibleGeocodeQueue(unresolved, {
    now,
    providerConfigured,
  });
  const unresolvedCount = unresolved.filter(
    row =>
      row.geocodeStatus !== "success" && row.geocodeStatus !== "missing_address"
  ).length;
  return {
    ...counts,
    processed: pending.length,
    hasMore: immediatelyEligible.length > 0,
    deferred: Math.max(0, unresolvedCount - immediatelyEligible.length),
  };
}

function sparseFallback(
  status: ReturnType<typeof computeRecencyStatus>
): LanternState {
  if (status === "lapsed") return "dark";
  if (status === "cooling") return "dimming";
  return "active";
}

export async function getGeographicTruth(input: {
  tenantId: string;
  now?: Date;
}) {
  await syncGeographicEntities(input.tenantId);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = input.now ?? new Date();
  const timeZone = getDashboardTimeZone();
  const today = zonedYmd(now, timeZone);
  const [locations, groups, pipeline] = await Promise.all([
    db
      .select()
      .from(entityLocations)
      .where(eq(entityLocations.tenantId, input.tenantId)),
    loadCustomerGroups(input.tenantId),
    db
      .select({
        id: commercialPipelineRecords.id,
        stage: commercialPipelineRecords.stage,
        updatedAt: commercialPipelineRecords.updatedAt,
        accountId: commercialAccounts.id,
        name: commercialAccounts.name,
      })
      .from(commercialPipelineRecords)
      .innerJoin(
        commercialAccounts,
        and(
          eq(commercialAccounts.tenantId, input.tenantId),
          eq(commercialAccounts.id, commercialPipelineRecords.accountId)
        )
      )
      .where(
        and(
          eq(commercialPipelineRecords.tenantId, input.tenantId),
          inArray(
            commercialPipelineRecords.stage,
            ACTIVE_COMMERCIAL_PIPELINE_STAGES
          )
        )
      )
      .orderBy(
        desc(commercialPipelineRecords.updatedAt),
        desc(commercialPipelineRecords.id)
      ),
  ]);
  const locationMap = new Map(
    locations.map(row => [`${row.entityType}:${row.entityKey}`, row])
  );
  const customers = Array.from(groups.entries()).map(([identityKey, group]) => {
    const sorted = [...group].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id
    );
    const latest = sorted.at(-1)!;
    const recency = computeRecencyStatus({
      totalOrders: sorted.length,
      firstOrderAt: sorted[0]!.createdAt,
      lastOrderAt: latest.createdAt,
    });
    const cadence = inferCustomerCadence({
      qualifyingOrderDates: sorted.map(order =>
        formatInTimeZone(order.createdAt, timeZone, "yyyy-MM-dd")
      ),
      today,
      sparseFallback: sparseFallback(recency),
    });
    const location = locationMap.get(`customer:${identityKey}`);
    const latitude =
      location?.latitude == null ? null : Number(location.latitude);
    const longitude =
      location?.longitude == null ? null : Number(location.longitude);
    return {
      identityKey,
      phone: latest.phone,
      displayName:
        `${latest.firstName} ${latest.lastName}`.trim() ||
        "Customer name unavailable",
      address: location?.sourceAddress ?? latest.address,
      unit: latest.unit,
      cadence,
      totalOrders: sorted.length,
      lastOrderAt: latest.createdAt.toISOString(),
      location:
        latitude != null &&
        longitude != null &&
        location?.geocodeStatus === "success"
          ? {
              latitude,
              longitude,
              canonicalAddress: location.canonicalAddress,
              ...projectLatLngToLanternAtlas({ latitude, longitude }),
            }
          : null,
      geocodeStatus: location?.geocodeStatus ?? "pending",
    };
  });
  const pursued = deduplicatePursuedPipelineRows(pipeline)
    .slice(0, 250)
    .map(row => {
      const location = locationMap.get(`commercial_prospect:${row.accountId}`);
      const latitude =
        location?.latitude == null ? null : Number(location.latitude);
      const longitude =
        location?.longitude == null ? null : Number(location.longitude);
      return {
        pipelineId: row.id,
        accountId: row.accountId,
        name: row.name,
        address: location?.sourceAddress ?? "Address unavailable",
        stage: row.stage,
        updatedAt: row.updatedAt.toISOString(),
        location:
          latitude != null &&
          longitude != null &&
          location?.geocodeStatus === "success"
            ? {
                latitude,
                longitude,
                canonicalAddress: location.canonicalAddress,
                ...projectLatLngToLanternAtlas({ latitude, longitude }),
              }
            : null,
        geocodeStatus: location?.geocodeStatus ?? "pending",
      };
    });
  const statusCounts = locations.reduce<Record<string, number>>(
    (acc, row) => ({
      ...acc,
      [row.geocodeStatus]: (acc[row.geocodeStatus] ?? 0) + 1,
    }),
    {}
  );
  const lastRunAt = locations
    .map(row => row.lastAttemptAt?.getTime() ?? 0)
    .reduce((latest, value) => Math.max(latest, value), 0);
  return {
    tenantId: input.tenantId,
    businessDate: today,
    timeZone,
    provider: {
      status: (
        ENV.googleAddressValidationApiKey ||
        ENV.googleGeocodingApiKey ||
        ENV.googlePlacesApiKey
      )
        ? ("configured" as const)
        : ("unconfigured" as const),
      variable: "GOOGLE_ADDRESS_VALIDATION_API_KEY" as const,
    },
    statusCounts,
    lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
    customers,
    pursued,
  };
}
