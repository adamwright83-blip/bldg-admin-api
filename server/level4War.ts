/**
 * LEVEL 4 — THE WAR FOR THE BRIDGE
 *
 * The bridge (14 tiles) is contested territory in a daily duel against The
 * Procrastinator. Real revenue actions push the front line toward him; real
 * decay pushes it back. His HP is the day's revenue gap. Momentum chains a
 * combo. At close of work hours the line settles (the Reckoning) and tomorrow
 * starts from the settled position — with a mercy floor so a bad day can
 * never become a death spiral.
 *
 * Design contract (ADHD/CBT):
 *  - The operator never needs to read a number: position, posture, and color
 *    carry the state.
 *  - Every real action has a visible consequence within one second.
 *  - Burst-mode work (combo) is the optimal strategy, not a guilt pattern.
 *  - The villain can never reach the family (MERCY_FLOOR_TILE).
 *
 * Storage: one append-only events table. All daily state derives from a fold
 * over today's events + yesterday's settled line. Events are idempotent via
 * dedupeKey, so double-fired mutations and replays cannot double-move the war.
 * Missing-table tolerance follows the level4Missions pattern: if the table
 * has not been migrated yet, the war runs in a safe ephemeral mode instead of
 * crashing the dashboard.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { level4WarEvents, type Level4WarEvent } from "../drizzle/schema";
import { getDb } from "./db";
import { getDashboardBusinessDayBoundsUtc } from "./revenueIntervention";
import { zonedYmd } from "./dashboardZoned";
import { getLevel4GateState } from "./level4Gate";

/* ── Geometry ────────────────────────────────────────────────────────────── */

export const WAR_TILE_COUNT = 14;
/** Where the line stands when a day begins with no history. */
export const WAR_NEUTRAL_TILE = 7;
/** The villain can never push past this tile — the family is unreachable. */
export const MERCY_FLOOR_TILE = 3;
/** Hero wins the board at this tile (villain's edge). */
export const WAR_VICTORY_TILE = WAR_TILE_COUNT - 1;

/* ── Action weights (tile-hundredths so small actions still visibly shove) ─ */

export type WarActionKind =
  | "stage_advance" // an order moved forward in the pipeline
  | "reminder_sent" // payment reminder / collection nudge went out
  | "collection_recovered" // known dollars actually landed
  | "outreach_executed" // Level-4 weapon fired (building / referral)
  | "call_strike" // a dial happened (answered or not — dialing scores)
  | "call_connected" // Twilio-confirmed conversation
  | "task_check" // cockpit task checked complete
  | "excuse_shattered" // acted on a decaying lane before the excuse landed
  | "excuse_landed" // an excuse projectile reached the hero (decay)
  | "lane_decayed" // a gate lane slipped to DEGRADED
  | "revive"; // post-impact tiny-action restart

const ACTION_PUSH: Record<WarActionKind, number> = {
  stage_advance: 35,
  reminder_sent: 30,
  collection_recovered: 80,
  outreach_executed: 70,
  call_strike: 40,
  call_connected: 65,
  task_check: 25,
  excuse_shattered: 45,
  excuse_landed: -70,
  lane_decayed: -45,
  revive: 15,
};

/** Combo: actions within this window chain the momentum flame. */
export const COMBO_WINDOW_MS = 45 * 60 * 1000;
const COMBO_TIERS = [
  { minChain: 6, multiplier: 2, label: "x2" },
  { minChain: 3, multiplier: 1.5, label: "x1.5" },
] as const;

/* ── Public state shape ──────────────────────────────────────────────────── */

export type WarProjectile = {
  id: string;
  laneKey: "collections" | "vagueness" | "dispatch";
  /** The villain throws the operator's own distortion at him. */
  excuse: string;
  /** 0..1 — how far the excuse has drifted toward the hero. */
  progress: number;
  /** ms remaining before it lands if nothing is done. */
  msToImpact: number;
};

export type Level4WarState = {
  available: boolean; // false → table not migrated yet; render calm board
  ymd: string;
  /** 0..WAR_TILE_COUNT-1 in tile-hundredths, e.g. 712 = tile 7.12 */
  frontLineHundredths: number;
  frontLineTile: number; // floor for tile ownership coloring
  /** 0..100 — The Procrastinator's remaining life (revenue gap). */
  bossHpPct: number;
  combo: { chain: number; multiplier: number; label: string | null; msLeft: number };
  projectiles: WarProjectile[];
  victoryToday: boolean;
  reckoning: null | { outcome: "WON" | "HELD" | "LOST"; settledTile: number };
  /** Yesterday's settled outcome, for the morning banner. */
  yesterday: null | { outcome: "WON" | "HELD" | "LOST"; settledTile: number };
  lastEventAt: string | null;
};

export type WarActionResult = {
  recorded: boolean;
  deduped: boolean;
  kind: WarActionKind;
  pushApplied: number;
  state: Level4WarState;
};

/* ── Excuse arsenal — the villain's voice lines, keyed by what's decaying ── */

const LANE_EXCUSES: Record<string, string[]> = {
  collections: ["it can wait!", "they'll pay eventually…", "asking twice is rude"],
  vagueness: ["monday's better", "you need more info first", "it's probably fine"],
  dispatch: ["you don't wanna seem pushy…", "traffic's bad anyway", "tomorrow's lighter"],
};

function excuseFor(laneKey: string, seed: number): string {
  const pool = LANE_EXCUSES[laneKey] ?? LANE_EXCUSES.collections;
  return pool[seed % pool.length];
}

/* ── Missing-table tolerance (level4Missions pattern) ────────────────────── */

export function isMissingWarTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /level4_war_events.*doesn'?t exist|Unknown table.*level4_war_events|ER_NO_SUCH_TABLE/i.test(
    message
  );
}

/* ── Core fold: events → state ───────────────────────────────────────────── */

function clampLine(h: number): number {
  return Math.max(MERCY_FLOOR_TILE * 100, Math.min(WAR_VICTORY_TILE * 100, h));
}

function comboFromEvents(events: Level4WarEvent[], now: Date) {
  const positives = events
    .filter((e) => (ACTION_PUSH[e.kind as WarActionKind] ?? 0) > 0)
    .map((e) => new Date(e.createdAt).getTime())
    .sort((a, b) => a - b);
  let chain = 0;
  let prev = 0;
  let chainStart = 0;
  for (const t of positives) {
    if (prev && t - prev <= COMBO_WINDOW_MS) chain += 1;
    else {
      chain = 1;
      chainStart = t;
    }
    prev = t;
  }
  if (!prev || now.getTime() - prev > COMBO_WINDOW_MS) {
    return { chain: 0, multiplier: 1, label: null as string | null, msLeft: 0 };
  }
  const tier = COMBO_TIERS.find((t) => chain >= t.minChain);
  return {
    chain,
    multiplier: tier?.multiplier ?? 1,
    label: tier?.label ?? null,
    msLeft: Math.max(0, COMBO_WINDOW_MS - (now.getTime() - prev)),
  };
}

const PROJECTILE_FLIGHT_MS = 90_000;

/**
 * Live projectiles derive from gate lanes that are currently BLOCKED/DEGRADED
 * and how long since the operator last acted. They are not stored — they are
 * a pure render of present danger, so acting on the lane dissolves them.
 */
function projectilesFromGate(
  lanes: Array<{ key: string; state: string; count: number }>,
  lastPositiveActionAt: Date | null,
  now: Date
): WarProjectile[] {
  const idleMs = lastPositiveActionAt
    ? now.getTime() - lastPositiveActionAt.getTime()
    : PROJECTILE_FLIGHT_MS / 2;
  const out: WarProjectile[] = [];
  lanes.forEach((lane, i) => {
    if (lane.count <= 0) return;
    if (lane.state !== "BLOCKED" && lane.state !== "DEGRADED") return;
    const headStart = lane.state === "DEGRADED" ? 0.35 : 0;
    const progress = Math.min(
      0.96,
      headStart + Math.max(0, idleMs) / PROJECTILE_FLIGHT_MS
    );
    out.push({
      id: `${lane.key}:${now.toDateString()}`,
      laneKey: lane.key as WarProjectile["laneKey"],
      excuse: excuseFor(lane.key, i + now.getDate()),
      progress,
      msToImpact: Math.max(0, Math.round((1 - progress) * PROJECTILE_FLIGHT_MS)),
    });
  });
  return out;
}

async function readDayEvents(
  tenantId: string,
  bounds: { startUtc: Date; endUtc: Date }
): Promise<Level4WarEvent[] | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    return await db
      .select()
      .from(level4WarEvents)
      .where(
        and(
          eq(level4WarEvents.tenantId, tenantId),
          gte(level4WarEvents.createdAt, bounds.startUtc),
          lt(level4WarEvents.createdAt, bounds.endUtc)
        )
      )
      .orderBy(level4WarEvents.createdAt);
  } catch (error) {
    if (isMissingWarTableError(error)) return null;
    throw error;
  }
}

/**
 * Self-provisioning: the deployed environment applies migrations on its own
 * schedule, so the first write attempts to create the table if it's missing.
 * Idempotent (IF NOT EXISTS) and safe to race.
 */
async function ensureWarTable(): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS \`level4_war_events\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`tenantId\` varchar(64) NOT NULL DEFAULT 'default',
        \`kind\` varchar(48) NOT NULL,
        \`dedupeKey\` varchar(191) NOT NULL,
        \`pushHundredths\` int NOT NULL DEFAULT 0,
        \`metadata\` json,
        \`createdAt\` timestamp NOT NULL DEFAULT (now()),
        CONSTRAINT \`level4_war_events_id\` PRIMARY KEY(\`id\`),
        CONSTRAINT \`uq_level4_war_events_tenant_dedupe\` UNIQUE(\`tenantId\`,\`dedupeKey\`),
        INDEX \`idx_level4_war_events_tenant_created\` (\`tenantId\`,\`createdAt\`)
      )
    `);
    return true;
  } catch (error) {
    console.warn("[Level4War] ensureWarTable failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function settleOutcome(lineH: number): "WON" | "HELD" | "LOST" {
  if (lineH >= (WAR_NEUTRAL_TILE + 2) * 100) return "WON";
  if (lineH <= (WAR_NEUTRAL_TILE - 2) * 100) return "LOST";
  return "HELD";
}

/**
 * Tomorrow inherits a softened version of today's settled line: wins carry
 * 60% forward (yesterday's push matters), losses regress toward neutral
 * (every morning is winnable).
 */
function inheritLine(settled: number): number {
  const neutral = WAR_NEUTRAL_TILE * 100;
  return clampLine(Math.round(neutral + (settled - neutral) * 0.6));
}

export async function getLevel4WarState(tenantId: string): Promise<Level4WarState> {
  const now = new Date();
  const bounds = getDashboardBusinessDayBoundsUtc(now);
  const ymd = zonedYmd(now, bounds.timeZone);
  const gate = await getLevel4GateState(tenantId);

  // Boss HP = remaining revenue gap vs daily target (already business-day
  // scoped inside the gate). Numbers in, posture out.
  const bossHpPct = Math.max(
    0,
    Math.min(100, Math.round(100 - gate.dailyXpProgressPct))
  );

  const events = await readDayEvents(tenantId, bounds);
  if (events === null) {
    // Table not migrated yet — the war still renders fully: projectiles and
    // boss HP derive from gate data that already exists. The line simply
    // holds at neutral until the first write auto-creates the table.
    const ephemeralProjectiles = projectilesFromGate(gate.lanes, null, now);
    return {
      available: true,
      ymd,
      frontLineHundredths: WAR_NEUTRAL_TILE * 100,
      frontLineTile: WAR_NEUTRAL_TILE,
      bossHpPct,
      combo: { chain: 0, multiplier: 1, label: null, msLeft: 0 },
      projectiles: ephemeralProjectiles,
      victoryToday: gate.state === "COMPLETE_TODAY",
      reckoning: null,
      yesterday: null,
      lastEventAt: null,
    };
  }

  // Yesterday's settle → today's starting line.
  const prevBounds = getDashboardBusinessDayBoundsUtc(
    new Date(bounds.startUtc.getTime() - 12 * 60 * 60 * 1000)
  );
  const prevEvents = (await readDayEvents(tenantId, prevBounds)) ?? [];
  let prevLine = WAR_NEUTRAL_TILE * 100;
  for (const e of prevEvents) {
    prevLine = clampLine(prevLine + (e.pushHundredths ?? 0));
  }
  const yesterday =
    prevEvents.length > 0
      ? { outcome: settleOutcome(prevLine), settledTile: Math.round(prevLine / 100) }
      : null;

  let line = prevEvents.length > 0 ? inheritLine(prevLine) : WAR_NEUTRAL_TILE * 100;
  let lastPositiveAt: Date | null = null;
  for (const e of events) {
    line = clampLine(line + (e.pushHundredths ?? 0));
    if ((e.pushHundredths ?? 0) > 0) lastPositiveAt = new Date(e.createdAt);
  }

  const combo = comboFromEvents(events, now);
  const projectiles = projectilesFromGate(gate.lanes, lastPositiveAt, now);
  const victoryToday = line >= WAR_VICTORY_TILE * 100 || gate.state === "COMPLETE_TODAY";

  // Reckoning: outside business hours, today reads as settled.
  const closed = now >= bounds.endUtc || now < bounds.startUtc;
  const reckoning = closed
    ? { outcome: settleOutcome(line), settledTile: Math.round(line / 100) }
    : null;

  return {
    available: true,
    ymd,
    frontLineHundredths: line,
    frontLineTile: Math.floor(line / 100),
    bossHpPct: victoryToday ? 0 : bossHpPct,
    combo,
    projectiles,
    victoryToday,
    reckoning,
    yesterday,
    lastEventAt: events.length
      ? new Date(events[events.length - 1].createdAt).toISOString()
      : null,
  };
}

/* ── Writing actions ─────────────────────────────────────────────────────── */

export async function recordLevel4WarAction(params: {
  tenantId: string;
  kind: WarActionKind;
  dedupeKey: string;
  meta?: Record<string, unknown>;
}): Promise<WarActionResult> {
  const db = await getDb();
  const basePush = ACTION_PUSH[params.kind] ?? 0;

  if (!db) {
    const state = await getLevel4WarState(params.tenantId);
    return { recorded: false, deduped: false, kind: params.kind, pushApplied: 0, state };
  }

  try {
    // First write self-provisions the table when migrations haven't run yet.
    await ensureWarTable();
    // Idempotency: same dedupeKey today → no double shove.
    const existing = await db
      .select({ id: level4WarEvents.id })
      .from(level4WarEvents)
      .where(
        and(
          eq(level4WarEvents.tenantId, params.tenantId),
          eq(level4WarEvents.dedupeKey, params.dedupeKey)
        )
      )
      .limit(1);
    if (existing.length > 0) {
      const state = await getLevel4WarState(params.tenantId);
      return { recorded: false, deduped: true, kind: params.kind, pushApplied: 0, state };
    }

    // Combo multiplies positive pushes — momentum is the optimal strategy.
    const pre = await getLevel4WarState(params.tenantId);
    const multiplier = basePush > 0 ? pre.combo.multiplier : 1;
    const push = Math.round(basePush * multiplier);

    await db.insert(level4WarEvents).values({
      tenantId: params.tenantId,
      kind: params.kind,
      dedupeKey: params.dedupeKey,
      pushHundredths: push,
      metadata: params.meta ?? null,
    });

    const state = await getLevel4WarState(params.tenantId);
    return { recorded: true, deduped: false, kind: params.kind, pushApplied: push, state };
  } catch (error) {
    if (isMissingWarTableError(error)) {
      const state = await getLevel4WarState(params.tenantId);
      return { recorded: false, deduped: false, kind: params.kind, pushApplied: 0, state };
    }
    throw error;
  }
}

/**
 * Fire-and-forget wrapper for instrumenting existing mutations: the war must
 * never break a real business action. Any error is logged and swallowed.
 */
export function recordWarActionSafe(params: {
  tenantId: string;
  kind: WarActionKind;
  dedupeKey: string;
  meta?: Record<string, unknown>;
}): void {
  void recordLevel4WarAction(params).catch((error) =>
    console.warn("[Level4War] action not recorded", {
      kind: params.kind,
      error: error instanceof Error ? error.message : String(error),
    })
  );
}
