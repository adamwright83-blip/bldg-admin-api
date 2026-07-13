import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  dayforgeProviderBudgets,
  dayforgePublicPreviewSessions,
  dayforgeRateLimitBuckets,
  territoryScanResults,
  territoryScanSessions,
} from "../../drizzle/schema";
import {
  writeDayforgeEvent,
  writeDayforgeEventWith,
  type DayforgeEventInput,
} from "../dayforgeEvents/dayforgeEventStore";
import { getDb } from "../db";
import { createCommercialMission } from "../commercialMissions/commercialMissionStore";
import type {
  PublicPreviewEvent,
  PublicPreviewMissionCreator,
  PublicPreviewRepository,
  PublicPreviewSession,
} from "./publicPreviewService";
import { PublicPreviewRateLimitError } from "./publicPreviewService";
import type { RankedTerritoryOpportunity } from "./territoryDiscovery";

type DayforgeDatabase = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type DayforgeTransaction = Parameters<
  Parameters<DayforgeDatabase["transaction"]>[0]
>[0];

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;

function affectedRows(result: unknown): number {
  return Number(
    (result as { [0]?: { affectedRows?: number } })[0]?.affectedRows ?? 0
  );
}

function envPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? "");
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function fixedWindow(now: Date, windowSeconds: number) {
  const windowMs = windowSeconds * 1000;
  const startMs = Math.floor(now.getTime() / windowMs) * windowMs;
  return {
    windowStart: new Date(startMs),
    expiresAt: new Date(startMs + windowMs * 2),
    retryAfterSeconds: Math.max(1, Math.ceil((startMs + windowMs - now.getTime()) / 1000)),
  };
}

async function consumeBucket(
  tx: DayforgeTransaction,
  input: {
    scopeKey: string;
    bucketKey: string;
    action: string;
    limit: number;
    windowSeconds: number;
    now: Date;
  }
) {
  const window = fixedWindow(input.now, input.windowSeconds);
  await tx
    .insert(dayforgeRateLimitBuckets)
    .values({
      scopeKey: input.scopeKey,
      bucketKey: input.bucketKey,
      action: input.action,
      windowStart: window.windowStart,
      windowSeconds: input.windowSeconds,
      requestCount: 0,
      expiresAt: window.expiresAt,
    })
    .onDuplicateKeyUpdate({
      set: { windowSeconds: input.windowSeconds },
    });
  const rows = await tx
    .select()
    .from(dayforgeRateLimitBuckets)
    .where(
      and(
        eq(dayforgeRateLimitBuckets.scopeKey, input.scopeKey),
        eq(dayforgeRateLimitBuckets.bucketKey, input.bucketKey),
        eq(dayforgeRateLimitBuckets.action, input.action),
        eq(dayforgeRateLimitBuckets.windowStart, window.windowStart)
      )
    )
    .limit(1)
    .for("update");
  const row = rows[0];
  if (!row) throw new Error("Rate-limit bucket was not persisted");
  if (row.requestCount >= input.limit) {
    throw new PublicPreviewRateLimitError(
      "Territory preview rate limit exceeded",
      window.retryAfterSeconds
    );
  }
  await tx
    .update(dayforgeRateLimitBuckets)
    .set({ requestCount: sql`${dayforgeRateLimitBuckets.requestCount} + 1` })
    .where(eq(dayforgeRateLimitBuckets.id, row.id));
}

function utcBudgetDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function secondsUntilNextUtcDay(now: Date): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  );
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

async function reserveProviderBudget(
  tx: DayforgeTransaction,
  input: { providerName: string; now: Date }
) {
  const operation = "territory_discovery";
  const budgetDate = utcBudgetDate(input.now);
  await tx
    .insert(dayforgeProviderBudgets)
    .values({ providerName: input.providerName, operation, budgetDate })
    .onDuplicateKeyUpdate({ set: { operation } });
  const rows = await tx
    .select()
    .from(dayforgeProviderBudgets)
    .where(
      and(
        eq(dayforgeProviderBudgets.providerName, input.providerName),
        eq(dayforgeProviderBudgets.operation, operation),
        eq(dayforgeProviderBudgets.budgetDate, budgetDate)
      )
    )
    .limit(1)
    .for("update");
  const row = rows[0];
  if (!row) throw new Error("Provider budget was not persisted");

  const circuitCooldownMs = envPositiveInteger(
    "DAYFORGE_TERRITORY_PROVIDER_CIRCUIT_COOLDOWN_SECONDS",
    15 * 60
  ) * 1000;
  if (row.circuitState === "half_open") {
    throw new PublicPreviewRateLimitError(
      "Territory provider is recovering",
      60
    );
  }
  if (
    row.circuitState === "open" &&
    row.circuitOpenedAt &&
    row.circuitOpenedAt.getTime() + circuitCooldownMs > input.now.getTime()
  ) {
    throw new PublicPreviewRateLimitError(
      "Territory provider is temporarily unavailable",
      Math.max(
        1,
        Math.ceil(
          (row.circuitOpenedAt.getTime() + circuitCooldownMs - input.now.getTime()) /
            1000
        )
      )
    );
  }

  const requestUnits = envPositiveInteger(
    "DAYFORGE_TERRITORY_PROVIDER_REQUEST_UNITS",
    9
  );
  const dailyLimit = envPositiveInteger(
    "DAYFORGE_TERRITORY_PROVIDER_DAILY_REQUEST_LIMIT",
    500
  );
  if (row.requestCount + requestUnits > dailyLimit) {
    throw new PublicPreviewRateLimitError(
      "Territory provider daily capacity reached",
      secondsUntilNextUtcDay(input.now)
    );
  }
  await tx
    .update(dayforgeProviderBudgets)
    .set({
      requestCount: sql`${dayforgeProviderBudgets.requestCount} + ${requestUnits}`,
      estimatedCostMicros: sql`${dayforgeProviderBudgets.estimatedCostMicros} + ${envPositiveInteger(
        "DAYFORGE_TERRITORY_PROVIDER_ESTIMATED_COST_MICROS",
        50_000
      )}`,
      circuitState: row.circuitState === "open" ? "half_open" : row.circuitState,
    })
    .where(eq(dayforgeProviderBudgets.id, row.id));
}

function decodeSession(
  row: typeof dayforgePublicPreviewSessions.$inferSelect,
  now?: Date
): PublicPreviewSession {
  return {
    id: row.id,
    status:
      now && row.expiresAt <= now && row.status !== "converted"
        ? "expired"
        : row.status,
    addressQuery: row.addressQuery,
    providerName: row.providerName,
    resultCount: row.resultCount,
    scanSessionId: row.scanSessionId,
    selectedCandidateKey: row.selectedCandidateKey,
    sampleMissionCreatedAt: row.sampleMissionCreatedAt,
    convertedTenantId: row.convertedTenantId,
    convertedMissionId: row.convertedMissionId,
    failureCode: row.failureCode,
    expiresAt: row.expiresAt,
  };
}

function decodeOpportunity(
  row: typeof territoryScanResults.$inferSelect
): RankedTerritoryOpportunity {
  const score = row.scoreSnapshotJson as RankedTerritoryOpportunity["score"] & {
    primarySignal: string;
    distanceMiles: number;
  };
  return {
    candidateKey: row.candidateKey,
    providerName: row.providerName,
    providerAccountId: row.providerAccountId,
    account: row.accountSnapshotJson as RankedTerritoryOpportunity["account"],
    score,
    primarySignal: score.primarySignal,
    distanceMiles: score.distanceMiles,
    evidence: row.evidenceJson as RankedTerritoryOpportunity["evidence"],
  };
}

async function providerSucceeded(
  tx: DayforgeTransaction,
  providerName: string,
  now: Date
) {
  await tx
    .update(dayforgeProviderBudgets)
    .set({
      consecutiveFailureCount: 0,
      circuitState: "closed",
      circuitOpenedAt: null,
      lastSuccessAt: now,
    })
    .where(
      and(
        eq(dayforgeProviderBudgets.providerName, providerName),
        eq(dayforgeProviderBudgets.operation, "territory_discovery"),
        eq(dayforgeProviderBudgets.budgetDate, utcBudgetDate(now))
      )
    );
}

async function providerFailed(
  tx: DayforgeTransaction,
  providerName: string,
  now: Date
) {
  const rows = await tx
    .select()
    .from(dayforgeProviderBudgets)
    .where(
      and(
        eq(dayforgeProviderBudgets.providerName, providerName),
        eq(dayforgeProviderBudgets.operation, "territory_discovery"),
        eq(dayforgeProviderBudgets.budgetDate, utcBudgetDate(now))
      )
    )
    .limit(1)
    .for("update");
  const row = rows[0];
  if (!row) return;
  const consecutive = row.consecutiveFailureCount + 1;
  const threshold = envPositiveInteger(
    "DAYFORGE_TERRITORY_PROVIDER_CIRCUIT_FAILURES",
    3
  );
  const open = consecutive >= threshold;
  await tx
    .update(dayforgeProviderBudgets)
    .set({
      failureCount: row.failureCount + 1,
      consecutiveFailureCount: consecutive,
      circuitState: open ? "open" : "closed",
      circuitOpenedAt: open ? now : row.circuitOpenedAt,
      lastFailureAt: now,
    })
    .where(eq(dayforgeProviderBudgets.id, row.id));
}

function dayforgeEventInput(event: PublicPreviewEvent): DayforgeEventInput {
  return {
    tenantId: event.tenantId,
    anonymousSessionId: event.anonymousSessionId,
    actor: { type: event.actorType, id: event.actorId },
    entityType: event.entityType,
    entityId: event.entityId,
    eventName: event.eventName,
    source: event.source,
    correlationId: event.correlationId,
    idempotencyKey: event.idempotencyKey,
    productEvent: {
      name: event.eventName,
      properties: event.properties,
      purgeAfter: new Date(
        Date.now() + (event.tenantId ? 400 : 90) * DAY_SECONDS * 1000
      ),
    },
  };
}

export const publicPreviewRepository: PublicPreviewRepository = {
  async assertStartLimits({ ipHash, now }) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db.transaction(async tx => {
      await consumeBucket(tx, {
        scopeKey: `ip:${ipHash}`,
        bucketKey: ipHash,
        action: "territory_preview_start",
        limit: envPositiveInteger("DAYFORGE_TERRITORY_PREVIEW_IP_HOURLY_LIMIT", 5),
        windowSeconds: HOUR_SECONDS,
        now,
      });
      await consumeBucket(tx, {
        scopeKey: "system:territory-preview",
        bucketKey: "global",
        action: "territory_preview_start",
        limit: envPositiveInteger(
          "DAYFORGE_TERRITORY_PREVIEW_GLOBAL_HOURLY_LIMIT",
          250
        ),
        windowSeconds: HOUR_SECONDS,
        now,
      });
    });
  },

  async assertSessionLimit({ sessionId, action, now }) {
    const limits = {
      status: 120,
      execute: 10,
      open: 30,
      sample: 10,
      convert: 10,
    } as const;
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db.transaction(tx =>
      consumeBucket(tx, {
        scopeKey: `public:${sessionId}`,
        bucketKey: sessionId,
        action: `territory_preview_${action}`,
        limit: limits[action],
        windowSeconds: HOUR_SECONDS,
        now,
      })
    );
  },

  async createRunningSession(input) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db.transaction(async tx => {
      await tx.insert(dayforgePublicPreviewSessions).values({
        id: input.sessionId,
        tokenHash: input.tokenHash,
        ipHash: input.ipHash,
        status: "running",
        addressQuery: input.addressQuery,
        attributionJson: input.attribution,
        expiresAt: input.expiresAt,
        purgeAfter: input.purgeAfter,
      });
      await writeDayforgeEventWith(tx, dayforgeEventInput(input.event));
    });
  },

  async getAuthorizedSession({ sessionId, tokenHash, now }) {
    const db = await getDb();
    if (!db) return null;
    const rows = await db
      .select()
      .from(dayforgePublicPreviewSessions)
      .where(
        and(
          eq(dayforgePublicPreviewSessions.id, sessionId),
          eq(dayforgePublicPreviewSessions.tokenHash, tokenHash)
        )
      )
      .limit(1);
    return rows[0] ? decodeSession(rows[0], now) : null;
  },

  async claimExecution(input) {
    const { sessionId, providerName, now, leaseUntil } = input;
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    return db.transaction(async tx => {
      const rows = await tx
        .select()
        .from(dayforgePublicPreviewSessions)
        .where(eq(dayforgePublicPreviewSessions.id, sessionId))
        .limit(1)
        .for("update");
      const row = rows[0];
      if (!row || row.status !== "running" || row.expiresAt <= now) {
        return "not_running" as const;
      }
      if (row.executionLeaseUntil && row.executionLeaseUntil > now) {
        return "busy" as const;
      }
      await reserveProviderBudget(tx, { providerName, now });
      await tx
        .update(dayforgePublicPreviewSessions)
        .set({
          providerName,
          executionStartedAt: row.executionStartedAt ?? now,
          executionLeaseUntil: leaseUntil,
          executionAttemptCount: row.executionAttemptCount + 1,
        })
        .where(eq(dayforgePublicPreviewSessions.id, sessionId));
      await writeDayforgeEventWith(tx, dayforgeEventInput(input.event));
      return "claimed" as const;
    });
  },

  async completeSession(input) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db.transaction(async tx => {
      const result = await tx
        .update(dayforgePublicPreviewSessions)
        .set({
          status: "completed",
          providerName: input.providerName,
          resultCount: input.resultCount,
          scanSessionId: input.scanSessionId,
          executionLeaseUntil: null,
          failureCode: null,
        })
        .where(
          and(
            eq(dayforgePublicPreviewSessions.id, input.sessionId),
            eq(dayforgePublicPreviewSessions.status, "running")
          )
        );
      if (affectedRows(result) !== 1) {
        throw new Error("Public territory preview completion lost its session claim");
      }
      await providerSucceeded(tx, input.providerName, new Date());
      await writeDayforgeEventWith(tx, dayforgeEventInput(input.event));
    });
  },

  async failSession(input) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db.transaction(async tx => {
      const result = await tx
        .update(dayforgePublicPreviewSessions)
        .set({
          status: "failed",
          providerName: input.providerName,
          failureCode: input.failureCode,
          executionLeaseUntil: null,
        })
        .where(
          and(
            eq(dayforgePublicPreviewSessions.id, input.sessionId),
            eq(dayforgePublicPreviewSessions.status, "running")
          )
        );
      if (affectedRows(result) !== 1) {
        throw new Error("Public territory preview failure lost its session claim");
      }
      await providerFailed(tx, input.providerName, new Date());
      await writeDayforgeEventWith(tx, dayforgeEventInput(input.event));
    });
  },

  async listOpportunities(scanSessionId) {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(territoryScanResults)
      .where(
        and(
          eq(territoryScanResults.scanSessionId, scanSessionId),
          isNull(territoryScanResults.tenantId)
        )
      )
      .orderBy(asc(territoryScanResults.id));
    return rows.map(decodeOpportunity);
  },

  async getScanCenter(scanSessionId) {
    const db = await getDb();
    if (!db) return null;
    const rows = await db
      .select({ center: territoryScanSessions.centerJson })
      .from(territoryScanSessions)
      .where(
        and(
          eq(territoryScanSessions.id, scanSessionId),
          eq(territoryScanSessions.mode, "public_preview"),
          isNull(territoryScanSessions.tenantId)
        )
      )
      .limit(1);
    return (rows[0]?.center as {
      lat: number;
      lng: number;
      formattedAddress: string;
    } | undefined) ?? null;
  },

  async getOpportunity({ scanSessionId, candidateKey }) {
    const db = await getDb();
    if (!db) return null;
    const rows = await db
      .select()
      .from(territoryScanResults)
      .where(
        and(
          eq(territoryScanResults.scanSessionId, scanSessionId),
          eq(territoryScanResults.candidateKey, candidateKey),
          isNull(territoryScanResults.tenantId)
        )
      )
      .limit(1);
    return rows[0] ? decodeOpportunity(rows[0]) : null;
  },

  async selectOpportunity({
    sessionId,
    candidateKey,
    sampleMissionCreated,
    now,
  }) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const result = await db
      .update(dayforgePublicPreviewSessions)
      .set({
        selectedCandidateKey: candidateKey,
        sampleMissionCreatedAt: sampleMissionCreated ? now : null,
      })
      .where(
        and(
          eq(dayforgePublicPreviewSessions.id, sessionId),
          eq(dayforgePublicPreviewSessions.status, "completed")
        )
      );
    return affectedRows(result) === 1;
  },

  async claimConversion({ sessionId, candidateKey, tenantId, now }) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    return db.transaction(async tx => {
      const rows = await tx
        .select()
        .from(dayforgePublicPreviewSessions)
        .where(eq(dayforgePublicPreviewSessions.id, sessionId))
        .limit(1)
        .for("update");
      const row = rows[0];
      if (!row || row.expiresAt <= now) return "not_convertible" as const;
      if (row.status === "converting" || row.status === "converted") {
        if (row.convertedTenantId !== tenantId) return "other_tenant" as const;
        return row.selectedCandidateKey === candidateKey
          ? ("owned_retry" as const)
          : ("not_convertible" as const);
      }
      if (
        row.status !== "completed" ||
        row.selectedCandidateKey !== candidateKey ||
        !row.sampleMissionCreatedAt
      ) {
        return "not_convertible" as const;
      }
      await tx
        .update(dayforgePublicPreviewSessions)
        .set({ status: "converting", convertedTenantId: tenantId })
        .where(eq(dayforgePublicPreviewSessions.id, sessionId));
      return "claimed" as const;
    });
  },

  async completeConversion({ sessionId, tenantId, missionId }) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const result = await db
      .update(dayforgePublicPreviewSessions)
      .set({ status: "converted", convertedMissionId: missionId })
      .where(
        and(
          eq(dayforgePublicPreviewSessions.id, sessionId),
          eq(dayforgePublicPreviewSessions.status, "converting"),
          eq(dayforgePublicPreviewSessions.convertedTenantId, tenantId)
        )
      );
    if (affectedRows(result) === 1) return;
    const existing = await db
      .select({
        tenantId: dayforgePublicPreviewSessions.convertedTenantId,
        missionId: dayforgePublicPreviewSessions.convertedMissionId,
        status: dayforgePublicPreviewSessions.status,
      })
      .from(dayforgePublicPreviewSessions)
      .where(eq(dayforgePublicPreviewSessions.id, sessionId))
      .limit(1);
    if (
      existing[0]?.status !== "converted" ||
      existing[0].tenantId !== tenantId ||
      existing[0].missionId !== missionId
    ) {
      throw new Error("Public territory preview conversion lost its session claim");
    }
  },

  async appendEvent(event: PublicPreviewEvent) {
    await writeDayforgeEvent(dayforgeEventInput(event));
  },
};

export const createMissionFromPublicPreview: PublicPreviewMissionCreator = input =>
  createCommercialMission({
    tenantId: input.tenantId,
    assignedTo: input.assignedTo,
    account: {
      providerName: input.opportunity.providerName,
      providerAccountId: input.opportunity.providerAccountId,
      name: input.opportunity.account.name,
      accountType: input.opportunity.account.accountType,
      address: input.opportunity.account.address,
      latitude: input.opportunity.account.latitude,
      longitude: input.opportunity.account.longitude,
      locationCount: input.opportunity.account.locationCount,
      decisionMaker: input.opportunity.account.decisionMaker,
    },
    opportunity: {
      estimatedAnnualValueCents:
        input.opportunity.score.estimatedAnnualValueCents,
      estimateConfidence: input.opportunity.score.grade,
      score: input.opportunity.score.score,
      primarySignal: input.opportunity.primarySignal,
      reasons: input.opportunity.score.reasons,
      risks: input.opportunity.score.risks,
    },
    brief: {
      laundryOpportunity: `Recurring commercial laundry service for ${input.opportunity.account.name}.`,
      salesAngle: `A local pickup-and-delivery laundry program sized to this account's estimated demand.`,
      openingLine: `Who is the right person to discuss laundry service for ${input.opportunity.account.name}?`,
      discoveryQuestions: [
        "How is recurring laundry handled today?",
        "Which items and locations create the most laundry work?",
        "What pickup schedule would fit the operation?",
      ],
      objections: [
        "Current provider",
        "Pricing",
        "Pickup schedule",
        "Turnaround time",
      ],
    },
    steps: [
      {
        key: "scout",
        label: "Scout",
        detail: "Review sourced account evidence and fit.",
        status: "completed",
        position: 0,
      },
      {
        key: "prepare",
        label: "Prepare",
        detail: "Build the pitch and collateral.",
        status: "ready",
        position: 1,
      },
      {
        key: "battle",
        label: "Battle",
        detail: "Complete the BORESLAY mission.",
        status: "locked",
        position: 2,
      },
      {
        key: "field",
        label: "Field",
        detail: "Complete the real-world visit.",
        status: "locked",
        position: 3,
      },
    ],
    actor: { type: "operator", id: input.actorId },
    idempotencyKey: input.idempotencyKey,
  });
