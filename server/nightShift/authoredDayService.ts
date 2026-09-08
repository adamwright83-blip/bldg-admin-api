/**
 * Goldline Night Shift — the world authors tomorrow's presentation from real evidence.
 * Never writes business truth. Fail closed on hallucinated IDs.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { authoredDays, goldlineWorldEvents } from "../../drizzle/schema";
import type {
  AuthoredDayAllowlist,
  AuthoredDayLine,
  AuthoredDayProvenance,
  AuthoredDayRecord,
} from "../../shared/authoredDay";
import {
  applyAuthoredDayPlan,
  authoredDayStableKey,
  deterministicNightShiftPlan,
  type NightShiftSelectionPlan,
} from "../../shared/authoredDay";
import { AUTHORED_V6_TERRITORY_IDS } from "../goldlineWorld/lanternCityOverviewService";
import { forecastTerritoryDecay } from "../../shared/lanternDecayForecast";
import {
  openObligations,
  projectObligations,
} from "../../shared/goldlineObligations";
import { classifyTerritory } from "../../shared/lanternTerritories";
import { getDb } from "../db";
import { ENV } from "../_core/env";
import { invokeLLM } from "../_core/llm";
import {
  getBusinessDayWindow,
  getDashboardTimeZone,
  zonedDayStartUtc,
} from "../dashboardZoned";
import { getFieldToday } from "../field/fieldTodayService";
import { listFuturePressure } from "../goldlineWorld/futurePressureService";
import { getGeographicTruth } from "../geography/geographicTruthService";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";

export function isNightShiftEnabled(): boolean {
  return ENV.goldlineNightShiftEnabled;
}

export function nightShiftTargetBusinessDate(
  now = new Date(),
  timeZone = getDashboardTimeZone()
): string {
  return getBusinessDayWindow(now, timeZone).businessDate;
}

/** Night Shift runs only after the LA business date has rolled. */
export function isAfterLosAngelesBusinessDateRoll(
  now = new Date(),
  timeZone = getDashboardTimeZone()
): boolean {
  const window = getBusinessDayWindow(now, timeZone);
  return now.getTime() >= window.startUtc.getTime();
}

/** Before rollover the current calendar day has not yet opened in LA. */
export function isBeforeLosAngelesBusinessDateRoll(
  now = new Date(),
  timeZone = getDashboardTimeZone()
): boolean {
  return !isAfterLosAngelesBusinessDateRoll(now, timeZone);
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

function toRecord(row: typeof authoredDays.$inferSelect): AuthoredDayRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorId: row.operatorId,
    businessDate: row.businessDate,
    stableKey: row.stableKey,
    status: row.status as AuthoredDayRecord["status"],
    headline: row.headline,
    framing: row.framing,
    lines: (row.linesJson as AuthoredDayLine[]) ?? [],
    intelligence: row.intelligence as AuthoredDayRecord["intelligence"],
    linkedOperationStableKey: row.linkedOperationStableKey ?? null,
    inputFingerprint: row.inputFingerprint,
    createdAt: row.createdAt.toISOString(),
    committedAt: row.committedAt?.toISOString() ?? null,
  };
}

async function readAuthoredDay(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
}): Promise<AuthoredDayRecord | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(authoredDays)
    .where(
      and(
        eq(authoredDays.tenantId, input.tenantId),
        eq(authoredDays.operatorId, input.operatorId),
        eq(authoredDays.businessDate, input.businessDate)
      )
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

export type NightShiftInputBundle = {
  businessDate: string;
  allowlist: AuthoredDayAllowlist;
  candidateLines: AuthoredDayLine[];
  headlineSeed: string;
  framingSeed: string;
  inputFingerprint: string;
};

export async function gatherNightShiftInputs(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
  userId: string;
}): Promise<NightShiftInputBundle> {
  const timeZone = getDashboardTimeZone();
  const targetStart = zonedDayStartUtc(input.businessDate, timeZone);
  const now = new Date(targetStart.getTime() + 60 * 60 * 1000);
  const db = await getDb();
  const eventRows = db
    ? await db
        .select()
        .from(goldlineWorldEvents)
        .where(eq(goldlineWorldEvents.tenantId, input.tenantId))
    : [];
  const [fieldToday, pressure, atlas] = await Promise.all([
    getFieldToday({
      tenantId: input.tenantId,
      userId: input.userId,
      includeAllAssignees: true,
      now,
      timeZone,
    }),
    listFuturePressure({ tenantId: input.tenantId, date: input.businessDate }),
    getGeographicTruth({ tenantId: input.tenantId, now }),
  ]);
  const obligations = openObligations(
    projectObligations(
      eventRows.map(row => ({
        id: row.id,
        tenantId: row.tenantId,
        physicalEntityId: row.physicalEntityId,
        eventType: row.eventType,
        classification: row.classification,
        actorType: row.actorType,
        actorId: row.actorId,
        occurredAt: row.occurredAt.toISOString(),
        observedAt: row.observedAt?.toISOString() ?? null,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        sourceEvidenceReference: row.sourceEvidenceReference,
        provenanceClass: row.provenanceClass,
        verificationClass: row.verificationClass,
        confidence: row.confidence,
        idempotencyKey: row.idempotencyKey,
        correlationId: row.correlationId,
        metadata: (row.metadataJson ?? {}) as Record<string, unknown>,
      }))
    )
  );
  const obligationByReference = new Map(
    obligations.map(record => [record.sourceEvidenceReference, record.id])
  );
  const allowlist: AuthoredDayAllowlist = {
    customerIds: new Set(atlas.customers.map(customer => customer.identityKey)),
    physicalEntityIds: new Set(
      obligations
        .map(record => record.physicalEntityId)
        .filter((value): value is string => Boolean(value))
    ),
    fieldItemIds: new Set(fieldToday.timeline.map(item => item.id)),
    obligationIds: new Set(obligations.map(record => record.id)),
    territoryIds: new Set<string>(AUTHORED_V6_TERRITORY_IDS),
    operationStableKeys: new Set<string>(),
    campaignChapterIds: new Set<string>(),
    orderIds: new Set<string>(),
    followUpIds: new Set<string>(),
    externalOrderIds: new Set<string>(),
    missionIds: new Set<string>(),
  };
  const candidateLines: AuthoredDayLine[] = [];
  for (const item of fieldToday.timeline) {
    const provenance: AuthoredDayProvenance[] = [
      {
        entityType: "field_item",
        entityId: item.id,
        sourceReference: item.source.sourceReference,
      },
    ];
    if (item.physicalEntityId) {
      allowlist.physicalEntityIds.add(item.physicalEntityId);
      provenance.push({
        entityType: "physical_entity",
        entityId: item.physicalEntityId,
        sourceReference: `physical_entities:${item.physicalEntityId}`,
      });
    }
    if (item.source.entityType === "order") {
      allowlist.orderIds.add(item.source.entityId);
      provenance.push({
        entityType: "order",
        entityId: item.source.entityId,
        sourceReference: item.source.sourceReference,
      });
    }
    if (item.source.entityType === "commercial_follow_up") {
      allowlist.followUpIds.add(item.source.entityId);
      provenance.push({
        entityType: "commercial_follow_up",
        entityId: item.source.entityId,
        sourceReference: item.source.sourceReference,
      });
    }
    if (item.source.entityType === "commercial_mission") {
      allowlist.missionIds.add(item.source.entityId);
      provenance.push({
        entityType: "commercial_mission",
        entityId: item.source.entityId,
        sourceReference: item.source.sourceReference,
      });
    }
    const kind: AuthoredDayLine["kind"] =
      item.kind === "pickup"
        ? "pickup"
        : item.kind === "delivery"
          ? "delivery"
          : item.kind === "follow_up"
            ? "follow_up"
            : item.kind === "customer_recovery"
              ? "recovery"
              : item.kind === "commercial_visit" || item.kind === "mission_dispatch"
                ? "commercial"
                : "emphasis";
    candidateLines.push({
      id: `line:${item.id}`,
      title: item.title,
      narrative: item.whySurfaced ?? item.subtitle,
      kind,
      emphasis:
        item.urgency === "blocked" || item.urgency === "overdue"
          ? "primary"
          : "secondary",
      provenance,
    });
  }
  const grouped = new Map<string, typeof atlas.customers>();
  for (const customer of atlas.customers) {
    if (!customer.location) continue;
    const territory = classifyTerritory(
      customer.location.latitude,
      customer.location.longitude
    );
    if (!territory || !AUTHORED_V6_TERRITORY_IDS.includes(territory.id as never))
      continue;
    grouped.set(territory.id, [...(grouped.get(territory.id) ?? []), customer]);
  }
  for (const territoryId of AUTHORED_V6_TERRITORY_IDS) {
    const customers = grouped.get(territoryId) ?? [];
    const counts = customers.reduce(
      (acc, customer) => {
        acc[customer.cadence.state]++;
        acc.total++;
        return acc;
      },
      { total: 0, active: 0, dimming: 0, dark: 0 }
    );
    const forecast = forecastTerritoryDecay({
      territoryId,
      customers: customers.map(customer => ({
        identityKey: customer.identityKey,
        cadence: customer.cadence,
      })),
      occupancy: {
        guarded: false,
        conquered: false,
        pressureReturned: false,
      },
    });
    if (forecast.daysUntil == null) continue;
    candidateLines.push({
      id: `line:decay:${territoryId}`,
      title: `${territoryId.replace(/-/g, " ")} needs attention`,
      narrative: `Territory decay forecast: ${forecast.daysUntil} days until visual decline.`,
      kind: "emphasis",
      emphasis: "background",
      provenance: [
        {
          entityType: "territory",
          entityId: territoryId,
          sourceReference: `lantern_city_territories:${territoryId}`,
        },
      ],
    });
  }
  for (const item of pressure.items) {
    const obligationId = item.isObligation
      ? obligationByReference.get(item.sourceEvidenceReference) ??
        obligations.find(
          record => record.sourceEvidenceReference === item.sourceEvidenceReference
        )?.id
      : null;
    if (item.isObligation && obligationId) {
      candidateLines.push({
        id: `line:pressure:${obligationId}`,
        title: item.reason,
        narrative: item.reason,
        kind: "obligation",
        emphasis: item.weight === "insistent" ? "primary" : "secondary",
        provenance: [
          {
            entityType: "obligation",
            entityId: obligationId,
            sourceReference: item.sourceEvidenceReference,
          },
        ],
      });
      continue;
    }
    if (item.physicalEntityId) {
      allowlist.physicalEntityIds.add(item.physicalEntityId);
      candidateLines.push({
        id: `line:signal:${item.sourceEvidenceReference}`,
        title: item.reason,
        narrative: item.reason,
        kind: "emphasis",
        emphasis: item.weight === "insistent" ? "primary" : "secondary",
        provenance: [
          {
            entityType: "physical_entity",
            entityId: item.physicalEntityId,
            sourceReference: item.sourceEvidenceReference,
          },
        ],
      });
    }
  }
  const inputFingerprint = fingerprint({
    businessDate: input.businessDate,
    fieldIds: fieldToday.timeline.map(item => item.id),
    pressureRefs: pressure.items.map(item => item.sourceEvidenceReference),
  });
  return {
    businessDate: input.businessDate,
    allowlist,
    candidateLines,
    headlineSeed: `Tomorrow on ${input.businessDate}`,
    framingSeed: `${candidateLines.length} real stops and obligations are in play.`,
    inputFingerprint,
  };
}

const nightShiftPlanSchema = {
  name: "night_shift_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["headline", "framing", "selections"],
    properties: {
      headline: { type: "string" },
      framing: { type: "string" },
      selections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["candidateId", "emphasis"],
          properties: {
            candidateId: { type: "string" },
            emphasis: {
              type: "string",
              enum: ["primary", "secondary", "background"],
            },
          },
        },
      },
    },
  },
};

function contentText(result: Awaited<ReturnType<typeof invokeLLM>>): string {
  const content = result.choices[0]?.message.content;
  if (typeof content === "string") return content;
  return (content ?? [])
    .filter(part => part.type === "text")
    .map(part => (part.type === "text" ? part.text : ""))
    .join("");
}

function deterministicFallback(bundle: NightShiftInputBundle): {
  headline: string;
  framing: string;
  lines: AuthoredDayLine[];
  intelligence: AuthoredDayRecord["intelligence"];
} {
  const plan = deterministicNightShiftPlan(bundle.candidateLines);
  const applied = applyAuthoredDayPlan({
    candidateLines: bundle.candidateLines,
    allowlist: bundle.allowlist,
    headlineSeed: bundle.headlineSeed,
    framingSeed: bundle.framingSeed,
    plan: {
      ...plan,
      headline: bundle.headlineSeed,
      framing: bundle.framingSeed,
    },
  });
  if (!applied.ok) {
    const sorted = [...bundle.candidateLines].sort((a, b) => {
      const rank = { primary: 0, secondary: 1, background: 2 };
      return rank[a.emphasis] - rank[b.emphasis] || a.id.localeCompare(b.id);
    });
    return {
      headline: bundle.headlineSeed,
      framing: bundle.framingSeed,
      lines: sorted,
      intelligence: "deterministic_fallback",
    };
  }
  return {
    headline: applied.headline,
    framing: applied.framing,
    lines: applied.lines,
    intelligence: "deterministic_fallback",
  };
}

function parseNightShiftPlan(raw: unknown): NightShiftSelectionPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<NightShiftSelectionPlan>;
  if (typeof value.headline !== "string" || typeof value.framing !== "string") {
    return null;
  }
  if (!Array.isArray(value.selections)) return null;
  const selections = value.selections
    .map(item => {
      if (!item || typeof item !== "object") return null;
      const selection = item as {
        candidateId?: unknown;
        emphasis?: unknown;
      };
      if (typeof selection.candidateId !== "string") return null;
      if (
        selection.emphasis !== "primary" &&
        selection.emphasis !== "secondary" &&
        selection.emphasis !== "background"
      ) {
        return null;
      }
      return {
        candidateId: selection.candidateId,
        emphasis: selection.emphasis,
      };
    })
    .filter((item): item is NightShiftSelectionPlan["selections"][number] =>
      Boolean(item)
    );
  return {
    headline: value.headline,
    framing: value.framing,
    selections,
  };
}

export async function composeAuthoredDayFromBundle(
  bundle: NightShiftInputBundle,
  tenantId: string
): Promise<
  | {
      ok: true;
      headline: string;
      framing: string;
      lines: AuthoredDayLine[];
      intelligence: AuthoredDayRecord["intelligence"];
    }
  | { ok: false; reason: string }
> {
  if (bundle.candidateLines.length === 0) {
    return { ok: false, reason: "no real work to author" };
  }
  if (!ENV.anthropicApiKey?.trim()) {
    const fallback = deterministicFallback(bundle);
    if (!fallback.lines.length) return { ok: false, reason: "no real work to author" };
    return { ok: true, ...fallback };
  }
  try {
    const result = await invokeLLM({
      tenantId,
      model: ENV.anthropicModel,
      maxTokens: 4000,
      temperature: 0,
      outputSchema: nightShiftPlanSchema,
      messages: [
        {
          role: "system",
          content:
            "You are the Goldline Night Shift. Choose ordering and emphasis among the supplied canonical candidate IDs only. Headline and framing may be atmospheric presentation language only and must not introduce meetings, outcomes, human commitments, revenue, or timing facts.",
        },
        {
          role: "user",
          content: JSON.stringify({
            businessDate: bundle.businessDate,
            candidates: bundle.candidateLines.map(candidate => ({
              candidateId: candidate.id,
              title: candidate.title,
              narrative: candidate.narrative,
              kind: candidate.kind,
              emphasis: candidate.emphasis,
            })),
          }),
        },
      ],
    });
    const plan = parseNightShiftPlan(JSON.parse(contentText(result)));
    if (!plan) return { ok: false, reason: "malformed structured output" };
    const applied = applyAuthoredDayPlan({
      candidateLines: bundle.candidateLines,
      allowlist: bundle.allowlist,
      headlineSeed: bundle.headlineSeed,
      framingSeed: bundle.framingSeed,
      plan,
    });
    if (!applied.ok) {
      const fallback = deterministicFallback(bundle);
      if (!fallback.lines.length) return applied;
      return { ok: true, ...fallback, intelligence: "deterministic_fallback" };
    }
    return {
      ok: true,
      headline: applied.headline,
      framing: applied.framing,
      lines: applied.lines,
      intelligence: "anthropic",
    };
  } catch (error) {
    console.warn(
      "[NightShift] Anthropic authoring unavailable",
      error instanceof Error ? error.message : error
    );
    const fallback = deterministicFallback(bundle);
    if (!fallback.lines.length) return { ok: false, reason: "no real work to author" };
    return { ok: true, ...fallback };
  }
}

async function insertAuthoredDay(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
  headline: string;
  framing: string;
  lines: AuthoredDayLine[];
  intelligence: AuthoredDayRecord["intelligence"];
  inputFingerprint: string;
}): Promise<AuthoredDayRecord> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const row = {
    id: randomUUID(),
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    businessDate: input.businessDate,
    stableKey: authoredDayStableKey(input.businessDate),
    status: "draft" as const,
    headline: input.headline,
    framing: input.framing,
    linesJson: input.lines,
    inputFingerprint: input.inputFingerprint,
    intelligence: input.intelligence,
    linkedOperationStableKey: null,
    committedAt: null,
  };
  try {
    await db.insert(authoredDays).values(row);
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
    const existing = await readAuthoredDay(input);
    if (!existing) throw error;
    return existing;
  }
  const stored = await readAuthoredDay(input);
  if (!stored) throw new Error("Authored day was not persisted");
  return stored;
}

type NightShiftRunResult =
  | { status: "disabled" }
  | { status: "before_rollover" }
  | { status: "existing"; authoredDay: AuthoredDayRecord }
  | { status: "authored"; authoredDay: AuthoredDayRecord }
  | { status: "unavailable"; reason: string };

const activeNightShiftRuns = new Map<string, Promise<NightShiftRunResult>>();

async function runNightShiftForBusinessDateInner(input: {
  tenantId: string;
  operatorId: string;
  userId: string;
  businessDate: string;
  now?: Date;
}): Promise<NightShiftRunResult> {
  if (!isNightShiftEnabled()) return { status: "disabled" };
  const timeZone = getDashboardTimeZone();
  const now = input.now ?? new Date();
  const currentDate = nightShiftTargetBusinessDate(now, timeZone);
  if (input.businessDate > currentDate) {
    return { status: "before_rollover" };
  }
  if (
    input.businessDate === currentDate &&
    isBeforeLosAngelesBusinessDateRoll(now, timeZone)
  ) {
    return { status: "before_rollover" };
  }
  const existing = await readAuthoredDay(input);
  if (existing) return { status: "existing", authoredDay: existing };
  const bundle = await gatherNightShiftInputs(input);
  const composed = await composeAuthoredDayFromBundle(bundle, input.tenantId);
  if (!composed.ok) return { status: "unavailable", reason: composed.reason };
  const authoredDay = await insertAuthoredDay({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    businessDate: input.businessDate,
    headline: composed.headline,
    framing: composed.framing,
    lines: composed.lines,
    intelligence: composed.intelligence,
    inputFingerprint: bundle.inputFingerprint,
  });
  return { status: "authored", authoredDay };
}

export async function runNightShiftForBusinessDate(input: {
  tenantId: string;
  operatorId: string;
  userId: string;
  businessDate: string;
  now?: Date;
}): Promise<NightShiftRunResult> {
  const key = `${input.tenantId}:${input.operatorId}:${input.businessDate}`;
  const active = activeNightShiftRuns.get(key);
  if (active) return active;
  const run = runNightShiftForBusinessDateInner(input).finally(() => {
    activeNightShiftRuns.delete(key);
  });
  activeNightShiftRuns.set(key, run);
  return run;
}

export async function getOrAuthorTodayAuthoredDay(input: {
  tenantId: string;
  operatorId: string;
  userId: string;
  now?: Date;
}): Promise<
  | { available: false; reason: string }
  | { available: true; authoredDay: AuthoredDayRecord | null }
> {
  if (!isNightShiftEnabled()) {
    return { available: false, reason: "night_shift_disabled" };
  }
  const timeZone = getDashboardTimeZone();
  const now = input.now ?? new Date();
  const businessDate = nightShiftTargetBusinessDate(now, timeZone);
  if (isBeforeLosAngelesBusinessDateRoll(now, timeZone)) {
    return { available: false, reason: "before_rollover" };
  }
  const result = await runNightShiftForBusinessDate({
    ...input,
    businessDate,
    now,
  });
  if (result.status === "disabled") {
    return { available: false, reason: "night_shift_disabled" };
  }
  if (result.status === "before_rollover") {
    return { available: false, reason: "before_rollover" };
  }
  if (result.status === "unavailable") {
    return { available: false, reason: result.reason };
  }
  return {
    available: true,
    authoredDay:
      result.status === "existing" || result.status === "authored"
        ? result.authoredDay
        : null,
  };
}

export async function getAuthoredDayForDate(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
}): Promise<AuthoredDayRecord | null> {
  return readAuthoredDay(input);
}

export async function commitAuthoredDayForOperation(input: {
  tenantId: string;
  operatorId: string;
  businessDate: string;
  operationStableKey: string;
}): Promise<AuthoredDayRecord | null> {
  const db = await getDb();
  if (!db) return null;
  const existing = await readAuthoredDay(input);
  if (!existing) return null;
  await db
    .update(authoredDays)
    .set({
      status: "committed",
      linkedOperationStableKey: input.operationStableKey,
      committedAt: new Date(),
    })
    .where(
      and(
        eq(authoredDays.tenantId, input.tenantId),
        eq(authoredDays.operatorId, input.operatorId),
        eq(authoredDays.businessDate, input.businessDate)
      )
    );
  return {
    ...existing,
    status: "committed",
    linkedOperationStableKey: input.operationStableKey,
    committedAt: new Date().toISOString(),
  };
}
