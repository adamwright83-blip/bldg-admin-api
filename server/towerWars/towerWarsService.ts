import { randomUUID } from "node:crypto";
import { and, eq, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import {
  cleancloudPaidOrders,
  dayDirectorCommitments,
  orders,
  towerWarsPromises,
} from "../../drizzle/schema";
import { resolveBuildingEvidence } from "../../shared/buildings";
import { customerIdentityHash } from "../customerAssets/customerIdentity";
import {
  getBusinessDayWindow,
  getDashboardTimeZone,
  zonedDayStartUtc,
  zonedYmd,
} from "../dashboardZoned";
import { getDb } from "../db";
import { normalizePropertyTower } from "../../shared/propertyTowers";
import {
  canExecuteTowerWarsPromise,
  compileTowerWarsState,
  compareTowerWarsEvents,
  type TowerWarsBuildingId,
  type TowerWarsBusinessEvent,
  type TowerWarsPermissionChannel,
  type TowerWarsPermissionStatus,
  type TowerWarsPromiseType,
  type TowerWarsRevenueSource,
} from "../../shared/towerWars";
import { TOWER_WARS_ATTACK_THRESHOLD_CENTS } from "../../shared/goldlineGameConfig";
import { settleTowerWars } from "../../shared/towerWarsSettlement";

export type TowerWarsCandidate = {
  sourceKey: string;
  occurredAt: Date;
  orderId: string | number | null;
  address: string | null;
  buildingSlug: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerIdentity: string | null;
  cents: number;
  source: TowerWarsRevenueSource;
  authoritative: boolean;
  exclusionReason: string | null;
  sourceEvidence: Record<string, string | number | boolean | null>;
};

/** Records the slug/address contradiction on the event so it is never silent. */
function buildingConflictNote(
  address: string | null | undefined,
  slug: string | null | undefined
): string | null {
  const { conflict } = resolveBuildingEvidence(address, slug);
  return conflict
    ? `slug:${conflict.slugBuilding} vs address:${conflict.addressBuilding}`
    : null;
}

function buildingIdFor(
  candidate: Pick<TowerWarsCandidate, "address" | "buildingSlug">
): TowerWarsBuildingId | null {
  const configured = resolveBuildingEvidence(
    candidate.address,
    candidate.buildingSlug
  ).building;
  const normalized = normalizePropertyTower(candidate.address, {
    propertyGroup:
      configured?.id === "opus_la" || configured?.id === "century_park_east"
        ? configured.id
        : undefined,
  });
  return normalized.propertyGroup === "unknown"
    ? null
    : normalized.propertyGroup;
}

function normalizedPhone(value: string | null): string {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Conservative source precedence. Linked/identical evidence is collapsed;
 * ambiguous same-person/same-value same-day CleanCloud evidence yields to the
 * local Stripe event instead of creating a possible duplicate attack.
 */
export function compileAuthoritativeEvents(input: {
  tenantId: string;
  businessDate: string;
  candidates: TowerWarsCandidate[];
}): {
  events: TowerWarsBusinessEvent[];
  exclusions: Array<{ sourceKey: string; reason: string }>;
} {
  const exclusions: Array<{ sourceKey: string; reason: string }> = [];
  const accepted: TowerWarsCandidate[] = [];
  const seen = new Set<string>();
  const sourcePriority: Record<TowerWarsRevenueSource, number> = {
    stripe: 0,
    local_order_payment: 1,
    cleancloud: 2,
    clearent_xplorpay: 2,
  };
  const ordered = [...input.candidates].sort(
    (a, b) =>
      sourcePriority[a.source] - sourcePriority[b.source] ||
      a.occurredAt.getTime() - b.occurredAt.getTime() ||
      a.sourceKey.localeCompare(b.sourceKey)
  );

  for (const candidate of ordered) {
    if (!candidate.authoritative || candidate.exclusionReason) {
      exclusions.push({
        sourceKey: candidate.sourceKey,
        reason: candidate.exclusionReason ?? "non_authoritative_timestamp",
      });
      continue;
    }
    if (!Number.isInteger(candidate.cents) || candidate.cents <= 0) {
      exclusions.push({
        sourceKey: candidate.sourceKey,
        reason: "non_positive_order_value",
      });
      continue;
    }
    const buildingId = buildingIdFor(candidate);
    if (!buildingId) {
      exclusions.push({
        sourceKey: candidate.sourceKey,
        reason: "unresolved_building",
      });
      continue;
    }
    const explicitEconomicKey = String(
      candidate.sourceEvidence.economicEventKey ?? candidate.sourceKey
    );
    if (seen.has(explicitEconomicKey)) {
      exclusions.push({
        sourceKey: candidate.sourceKey,
        reason: "duplicate_economic_event",
      });
      continue;
    }
    const ambiguousDuplicate =
      candidate.source === "cleancloud" ||
      candidate.source === "clearent_xplorpay"
        ? accepted.find(
            existing =>
              existing.source === "stripe" &&
              existing.cents === candidate.cents &&
              normalizedPhone(existing.customerPhone).length >= 7 &&
              normalizedPhone(existing.customerPhone) ===
                normalizedPhone(candidate.customerPhone)
          )
        : undefined;
    if (ambiguousDuplicate) {
      exclusions.push({
        sourceKey: candidate.sourceKey,
        reason: "possible_cross_source_duplicate",
      });
      continue;
    }
    seen.add(explicitEconomicKey);
    accepted.push(candidate);
  }

  const events = accepted
    .flatMap(candidate => {
      const buildingId = buildingIdFor(candidate);
      if (!buildingId) return [];
      return [
        {
          eventId: candidate.sourceKey,
          occurredAt: candidate.occurredAt.toISOString(),
          businessDate: input.businessDate,
          buildingId,
          buildingDisplayName:
            buildingId === "opus_la" ? "OPUS LA" : "Century Park East",
          orderId: candidate.orderId,
          customerIdentity: candidate.customerIdentity,
          customerDisplayName: candidate.customerName,
          customerPhone: candidate.customerPhone,
          revenueSource: candidate.source,
          realOrderValueCents: candidate.cents,
          sourceEvidence: candidate.sourceEvidence,
        } satisfies TowerWarsBusinessEvent,
      ];
    })
    .sort(compareTowerWarsEvents);
  return { events, exclusions };
}

async function loadCandidates(
  tenantId: string,
  start: Date,
  end: Date
): Promise<TowerWarsCandidate[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [localRows, cleancloudRows] = await Promise.all([
    db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.paid, true),
          isNotNull(orders.paidAt),
          gte(orders.paidAt, start),
          lt(orders.paidAt, end)
        )
      ),
    db
      .select()
      .from(cleancloudPaidOrders)
      .where(
        and(
          eq(cleancloudPaidOrders.tenantId, tenantId),
          eq(cleancloudPaidOrders.paid, true),
          or(
            and(
              eq(cleancloudPaidOrders.sourceReportType, "orders_sales"),
              gte(cleancloudPaidOrders.paymentDateUtc, start),
              lt(cleancloudPaidOrders.paymentDateUtc, end)
            ),
            and(
              eq(cleancloudPaidOrders.sourceReportType, "orders_revenue"),
              gte(cleancloudPaidOrders.paidDateUtc, start),
              lt(cleancloudPaidOrders.paidDateUtc, end)
            )
          )
        )
      ),
  ]);

  const candidates: TowerWarsCandidate[] = localRows.map(order => {
    const stripe = Boolean(order.stripePaymentIntentId?.trim());
    return {
      sourceKey: `order:${order.id}`,
      occurredAt: order.paidAt!,
      orderId: order.id,
      address: order.address,
      buildingSlug: order.buildingSlug,
      customerName: `${order.firstName} ${order.lastName}`.trim() || null,
      customerPhone: order.phone || null,
      customerIdentity: customerIdentityHash(tenantId, order),
      cents: Math.round(Number(order.total ?? 0) * 100),
      source: stripe ? "stripe" : "local_order_payment",
      // Migration 0011 proxies cannot be distinguished by paidAt alone. A
      // persisted processor id is authoritative; unproven local rows are held out.
      authoritative: stripe,
      exclusionReason: stripe
        ? null
        : "local_paid_at_has_no_authoritative_payment_evidence",
      sourceEvidence: {
        economicEventKey: `order:${order.id}`,
        orderId: order.id,
        stripePaymentIntentId: order.stripePaymentIntentId,
        paidAtBasis: stripe ? "stripe_payment_intent" : "unverified_paidAt",
        buildingEvidenceConflict: buildingConflictNote(
          order.address,
          order.buildingSlug
        ),
      },
    };
  });

  const byCleancloudOrder = new Map<string, (typeof cleancloudRows)[number]>();
  for (const row of cleancloudRows) {
    const current = byCleancloudOrder.get(row.cleancloudOrderId);
    if (
      !current ||
      (current.sourceReportType === "orders_revenue" &&
        row.sourceReportType === "orders_sales")
    ) {
      byCleancloudOrder.set(row.cleancloudOrderId, row);
    }
  }
  for (const row of Array.from(byCleancloudOrder.values())) {
    const occurredAt =
      row.sourceReportType === "orders_sales"
        ? row.paymentDateUtc
        : row.paidDateUtc;
    if (!occurredAt) continue;
    const isClearent = /clearent/i.test(
      `${row.paymentType ?? ""} ${row.cardPaymentType ?? ""}`
    );
    candidates.push({
      sourceKey: `cleancloud:${row.cleancloudOrderId}`,
      occurredAt,
      orderId: row.cleancloudOrderId,
      address: row.address ?? row.buildingName,
      buildingSlug: row.buildingSlug,
      customerName: row.customerName || null,
      customerPhone: row.customerPhone,
      customerIdentity:
        row.customerPhone || row.customerName
          ? customerIdentityHash(tenantId, {
              phone: row.customerPhone,
              firstName: row.customerName,
              address: row.address,
              buildingSlug: row.buildingSlug,
            })
          : null,
      cents: row.totalCents,
      source: isClearent ? "clearent_xplorpay" : "cleancloud",
      authoritative: true,
      exclusionReason: null,
      sourceEvidence: {
        economicEventKey: `cleancloud:${row.cleancloudOrderId}`,
        cleancloudPaidOrderId: row.id,
        cleancloudOrderId: row.cleancloudOrderId,
        sourceReportType: row.sourceReportType,
        buildingEvidenceConflict: buildingConflictNote(
          row.address ?? row.buildingName,
          row.buildingSlug
        ),
        timestampField:
          row.sourceReportType === "orders_sales"
            ? "paymentDateUtc"
            : "paidDateUtc",
      },
    });
  }
  return candidates;
}

function contributors(
  events: TowerWarsBusinessEvent[],
  buildingId: TowerWarsBuildingId
) {
  const grouped = new Map<
    string,
    {
      customerIdentity: string | null;
      customerDisplayName: string;
      customerPhone: string | null;
      contributedValueCents: number;
      orderCount: number;
      events: Array<{
        eventId: string;
        orderId: string | number | null;
        occurredAt: string;
        valueCents: number;
      }>;
    }
  >();
  for (const event of events.filter(item => item.buildingId === buildingId)) {
    const key = event.customerIdentity ?? `unresolved:${event.eventId}`;
    const entry = grouped.get(key) ?? {
      customerIdentity: event.customerIdentity,
      customerDisplayName: event.customerDisplayName ?? "Unresolved customer",
      customerPhone: event.customerPhone,
      contributedValueCents: 0,
      orderCount: 0,
      events: [],
    };
    entry.contributedValueCents += event.realOrderValueCents;
    entry.orderCount += 1;
    entry.events.push({
      eventId: event.eventId,
      orderId: event.orderId,
      occurredAt: event.occurredAt,
      valueCents: event.realOrderValueCents,
    });
    grouped.set(key, entry);
  }
  return Array.from(grouped.entries())
    .map(([identityKey, entry]) => ({ identityKey, ...entry }))
    .sort(
      (a, b) =>
        b.contributedValueCents - a.contributedValueCents ||
        a.identityKey.localeCompare(b.identityKey)
    );
}

export async function getTowerWarsToday(input: {
  tenantId: string;
  now?: Date;
}) {
  const bounds = getBusinessDayWindow(input.now);
  const compiled = compileAuthoritativeEvents({
    tenantId: input.tenantId,
    businessDate: bounds.businessDate,
    candidates: await loadCandidates(
      input.tenantId,
      bounds.startUtc,
      bounds.endExclusiveUtc
    ),
  });
  const state = compileTowerWarsState(compiled.events);
  const [promises, db] = await Promise.all([
    listTowerWarsPromises(input.tenantId),
    getDb(),
  ]);
  const sourceBreakdown = (buildingId: TowerWarsBuildingId) =>
    compiled.events
      .filter(event => event.buildingId === buildingId)
      .reduce<
        Record<string, number>
      >((totals, event) => ({ ...totals, [event.revenueSource]: (totals[event.revenueSource] ?? 0) + event.realOrderValueCents }), {});
  return {
    tenantId: input.tenantId,
    businessDate: bounds.businessDate,
    timeZone: bounds.timeZone,
    window: {
      startUtc: bounds.startUtc.toISOString(),
      endExclusiveUtc: bounds.endExclusiveUtc.toISOString(),
    },
    thresholdCents: TOWER_WARS_ATTACK_THRESHOLD_CENTS,
    evidenceSufficient: Boolean(db),
    ledger: compiled.events,
    exclusions: compiled.exclusions,
    state,
    sourceBreakdown: {
      opus_la: sourceBreakdown("opus_la"),
      century_park_east: sourceBreakdown("century_park_east"),
    },
    contributors: {
      opus_la: contributors(compiled.events, "opus_la"),
      century_park_east: contributors(compiled.events, "century_park_east"),
    },
    promises,
  };
}

/** How far back a settlement reads by default. */
export const TOWER_WARS_SETTLEMENT_HISTORY_DAYS = 180;

/**
 * Today's match plus the permanent strata underneath it.
 *
 * Each business day is compiled SEPARATELY through `compileAuthoritativeEvents`
 * rather than compiling the whole window at once. That is deliberate: the
 * cross-source duplicate guard in that function compares candidates without a
 * date bound, so a single multi-month compile would start flagging a stripe
 * order and a CleanCloud order with the same amount and phone as duplicates
 * even when they are weeks apart. Per-day compilation keeps its semantics
 * exactly as they behave in production today.
 */
export async function getTowerWarsSettlement(input: {
  tenantId: string;
  now?: Date;
  historyDays?: number;
}) {
  const timeZone = getDashboardTimeZone();
  const bounds = getBusinessDayWindow(input.now, timeZone);
  const historyDays = Math.max(
    1,
    input.historyDays ?? TOWER_WARS_SETTLEMENT_HISTORY_DAYS
  );
  const startUtc = new Date(
    zonedDayStartUtc(bounds.businessDate, timeZone).getTime() -
      historyDays * 86_400_000
  );

  const db = await getDb();
  if (!db) {
    return {
      evidenceSufficient: false,
      settlement: settleTowerWars({
        events: [],
        todayBusinessDate: bounds.businessDate,
      }),
      businessDate: bounds.businessDate,
      timeZone,
      historyDays,
    };
  }

  const candidates = await loadCandidates(
    input.tenantId,
    startUtc,
    bounds.endExclusiveUtc
  );

  const byBusinessDate = new Map<string, TowerWarsCandidate[]>();
  for (const candidate of candidates) {
    const businessDate = zonedYmd(candidate.occurredAt, timeZone);
    const bucket = byBusinessDate.get(businessDate);
    if (bucket) bucket.push(candidate);
    else byBusinessDate.set(businessDate, [candidate]);
  }

  const events: TowerWarsBusinessEvent[] = [];
  for (const [businessDate, dayCandidates] of Array.from(
    byBusinessDate.entries()
  )) {
    events.push(
      ...compileAuthoritativeEvents({
        tenantId: input.tenantId,
        businessDate,
        candidates: dayCandidates,
      }).events
    );
  }

  return {
    evidenceSufficient: true,
    settlement: settleTowerWars({
      events,
      todayBusinessDate: bounds.businessDate,
    }),
    businessDate: bounds.businessDate,
    timeZone,
    historyDays,
  };
}

export async function listTowerWarsPromises(tenantId: string) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(towerWarsPromises)
    .where(eq(towerWarsPromises.tenantId, tenantId));
  return rows.map(row => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    fulfilledAt: row.fulfilledAt?.toISOString() ?? null,
  }));
}

export async function recordTowerWarsPromise(input: {
  tenantId: string;
  buildingId: TowerWarsBuildingId;
  customerIdentity?: string | null;
  promiseType: TowerWarsPromiseType;
  sourceText: string;
  quantity?: number | null;
  permissionStatus: TowerWarsPermissionStatus;
  permissionChannel: TowerWarsPermissionChannel;
  permissionEvidence?: string | null;
  sourceReference: string;
  idempotencyKey: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (
    input.permissionStatus === "recorded" &&
    !input.permissionEvidence?.trim()
  )
    throw new Error(
      "Recorded permission requires explicit permission evidence"
    );
  await db
    .insert(towerWarsPromises)
    .values({ id: randomUUID(), ...input })
    .onDuplicateKeyUpdate({ set: { sourceText: input.sourceText } });
  const [row] = await db
    .select()
    .from(towerWarsPromises)
    .where(
      and(
        eq(towerWarsPromises.tenantId, input.tenantId),
        eq(towerWarsPromises.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);
  return row;
}

export async function activateTowerWarsPromise(input: {
  tenantId: string;
  promiseId: string;
  actorId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [promise] = await db
    .select()
    .from(towerWarsPromises)
    .where(
      and(
        eq(towerWarsPromises.tenantId, input.tenantId),
        eq(towerWarsPromises.id, input.promiseId)
      )
    )
    .limit(1);
  if (!promise) throw new Error("Promise not found");
  if (!canExecuteTowerWarsPromise(promise))
    throw new Error("Promise lacks explicit execution permission evidence");
  const bounds = getBusinessDayWindow();
  const idempotencyKey = `tower-wars:${promise.id}`;
  const title = (
    {
      offer_insert: "Fulfill promised offer inserts",
      referral_card: "Fulfill permission-backed referral action",
      loyalty_reward: "Fulfill configured loyalty action",
      thank_you_presentation: "Upgrade promised presentation",
      other: "Fulfill permission-backed promise",
    } as const
  )[promise.promiseType];
  await db
    .insert(dayDirectorCommitments)
    .values({
      id: randomUUID(),
      tenantId: input.tenantId,
      actorId: input.actorId,
      businessDate: bounds.businessDate,
      idempotencyKey,
      title,
      kind: "growth",
      quantity: promise.quantity,
      provenance: "user_reported",
      sourceText: promise.sourceText,
      metadataJson: {
        towerWarsPromiseId: promise.id,
        buildingId: promise.buildingId,
        sourceReference: promise.sourceReference,
        permissionEvidence: promise.permissionEvidence,
      },
    })
    .onDuplicateKeyUpdate({ set: { title } });
  return {
    ok: true as const,
    businessDate: bounds.businessDate,
    createdRevenue: false as const,
    attackCreated: false as const,
  };
}

export async function fulfillTowerWarsPromise(input: {
  tenantId: string;
  promiseId: string;
  actorId: string;
  fulfillmentEvidence: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .select()
    .from(towerWarsPromises)
    .where(
      and(
        eq(towerWarsPromises.tenantId, input.tenantId),
        eq(towerWarsPromises.id, input.promiseId)
      )
    )
    .limit(1);
  if (!row) throw new Error("Promise not found");
  if (!row.fulfilledAt)
    await db
      .update(towerWarsPromises)
      .set({
        fulfilledAt: new Date(),
        fulfilledBy: input.actorId,
        fulfillmentEvidence: input.fulfillmentEvidence,
      })
      .where(
        and(
          eq(towerWarsPromises.tenantId, input.tenantId),
          eq(towerWarsPromises.id, input.promiseId),
          isNull(towerWarsPromises.fulfilledAt)
        )
      );
  return {
    ok: true as const,
    alreadyFulfilled: Boolean(row.fulfilledAt),
    createdRevenue: false as const,
  };
}
