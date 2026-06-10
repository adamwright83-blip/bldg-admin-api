/**
 * THE SKY COVENANT — the Command screen's weather is a promise, not a verdict.
 *
 * The operator (ADHD, visual, numbers-blind) must never face a permanently
 * red sky while building: discouragement kills behavioral activation. So the
 * sky has two modes and a hope system:
 *
 * MODE "profit": sky color derives from net profit over a chosen period
 *   (today / week / 30 days) against OPERATOR-TUNABLE bars (redBelowCents,
 *   blueAboveCents). He owns the thermostat — the lowest bar is his to set.
 *
 * MODE "campaign": sky derives from progress toward a customer goal
 *   (default 50 new customers — the keep-my-job number). Color maps to
 *   progress %, and every win is weather.
 *
 * HOPE EVENTS (both modes — hope always wins ties):
 *   - verbal_commitment (manual "Log a Win"): blue sky for 3 hours
 *   - first_order (auto-detected on a customer's first paid order, or manual):
 *     blue sky until the end of the current half-day block —
 *     morning win (before 2pm LA) → blue until 2pm;
 *     afternoon/evening win → blue until 10pm.
 *   While a hope window is active the sky is BLUE regardless of the base
 *   metric. When it lapses, the sky returns to the base — but campaign
 *   progress earned is permanent.
 *
 * Storage: two self-provisioning tables (settings + win events), same
 * missing-table tolerance pattern as the Level 4 war. Win events are
 * idempotent via dedupeKey.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  commandSkySettings,
  commandSkyWins,
  orders,
  type CommandSkySettingsRow,
  type CommandSkyWin,
} from "../drizzle/schema";
import { getDb } from "./db";

export type SkyMode = "profit" | "campaign";
export type SkyPeriod = "today" | "week" | "month";
export type SkyTone = "blue" | "fair" | "overcast" | "storm" | "red";

export type CommandSkySettings = {
  mode: SkyMode;
  period: SkyPeriod;
  /** Profit mode bars, operator-tunable. Sky is red below, blue above. */
  redBelowCents: number;
  blueAboveCents: number;
  /** Campaign mode goal. */
  campaignTarget: number;
  campaignLabel: string;
};

export type HopeWindow = {
  kind: "verbal_commitment" | "first_order";
  label: string;
  expiresAt: string;
  minutesLeft: number;
};

export type CommandSkyState = {
  available: boolean;
  settings: CommandSkySettings;
  tone: SkyTone;
  /** 0..1 — how far toward "best sky" within the active mode. */
  brightness: number;
  /** Why the sky looks like this — one plain sentence, no numbers required. */
  reason: string;
  hope: HopeWindow | null;
  campaign: {
    target: number;
    count: number;
    pct: number;
    label: string;
    recentWins: Array<{ kind: string; label: string; at: string }>;
  };
};

const DEFAULT_SETTINGS: CommandSkySettings = {
  mode: "campaign",
  period: "today",
  redBelowCents: 0,
  blueAboveCents: 20_000,
  campaignTarget: 50,
  campaignLabel: "50 new customers",
};

const LA_TZ = "America/Los_Angeles";

function laNow(): { hour: number; date: Date } {
  const now = new Date();
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: LA_TZ, hour: "numeric", hour12: false }).format(now)
  );
  return { hour, date: now };
}

/** End of the current half-day block in LA: 2pm if before 2pm, else 10pm. */
function halfDayBlockEnd(): Date {
  const { hour, date } = laNow();
  const target = hour < 14 ? 14 : 22;
  const end = new Date(date);
  // Walk to the target LA hour by adding the difference.
  end.setTime(date.getTime() + (target - hour) * 3_600_000);
  end.setMinutes(0, 0, 0);
  return end;
}

export function isMissingSkyTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /command_sky_\w+.*doesn'?t exist|Unknown table.*command_sky|ER_NO_SUCH_TABLE/i.test(message);
}

async function ensureSkyTables(): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS \`command_sky_settings\` (
        \`tenantId\` varchar(64) NOT NULL,
        \`mode\` varchar(16) NOT NULL DEFAULT 'campaign',
        \`period\` varchar(16) NOT NULL DEFAULT 'today',
        \`redBelowCents\` int NOT NULL DEFAULT 0,
        \`blueAboveCents\` int NOT NULL DEFAULT 20000,
        \`campaignTarget\` int NOT NULL DEFAULT 50,
        \`campaignLabel\` varchar(120) NOT NULL DEFAULT '50 new customers',
        \`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT \`command_sky_settings_tenant\` PRIMARY KEY(\`tenantId\`)
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS \`command_sky_wins\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`tenantId\` varchar(64) NOT NULL DEFAULT 'default',
        \`kind\` varchar(32) NOT NULL,
        \`label\` varchar(191) NOT NULL,
        \`dedupeKey\` varchar(191) NOT NULL,
        \`hopeExpiresAt\` timestamp NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT (now()),
        CONSTRAINT \`command_sky_wins_id\` PRIMARY KEY(\`id\`),
        CONSTRAINT \`uq_command_sky_wins_tenant_dedupe\` UNIQUE(\`tenantId\`,\`dedupeKey\`),
        INDEX \`idx_command_sky_wins_tenant_created\` (\`tenantId\`,\`createdAt\`)
      )
    `);
    return true;
  } catch (error) {
    console.warn("[CommandSky] ensure tables failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function getCommandSkySettings(tenantId: string): Promise<CommandSkySettings> {
  const db = await getDb();
  if (!db) return DEFAULT_SETTINGS;
  try {
    const rows = await db
      .select()
      .from(commandSkySettings)
      .where(eq(commandSkySettings.tenantId, tenantId))
      .limit(1);
    const row = rows[0] as CommandSkySettingsRow | undefined;
    if (!row) return DEFAULT_SETTINGS;
    return {
      mode: (row.mode as SkyMode) ?? DEFAULT_SETTINGS.mode,
      period: (row.period as SkyPeriod) ?? DEFAULT_SETTINGS.period,
      redBelowCents: row.redBelowCents ?? DEFAULT_SETTINGS.redBelowCents,
      blueAboveCents: row.blueAboveCents ?? DEFAULT_SETTINGS.blueAboveCents,
      campaignTarget: row.campaignTarget ?? DEFAULT_SETTINGS.campaignTarget,
      campaignLabel: row.campaignLabel ?? DEFAULT_SETTINGS.campaignLabel,
    };
  } catch (error) {
    if (isMissingSkyTableError(error)) return DEFAULT_SETTINGS;
    throw error;
  }
}

export async function updateCommandSkySettings(
  tenantId: string,
  patch: Partial<CommandSkySettings>
): Promise<CommandSkySettings> {
  const db = await getDb();
  if (!db) return { ...DEFAULT_SETTINGS, ...patch };
  await ensureSkyTables();
  const current = await getCommandSkySettings(tenantId);
  const next = { ...current, ...patch };
  // Keep the bars sane: blue must sit above red.
  if (next.blueAboveCents <= next.redBelowCents) {
    next.blueAboveCents = next.redBelowCents + 5_000;
  }
  next.campaignTarget = Math.max(1, Math.min(100_000, Math.round(next.campaignTarget)));
  await db
    .insert(commandSkySettings)
    .values({ tenantId, ...next })
    .onDuplicateKeyUpdate({
      set: {
        mode: next.mode,
        period: next.period,
        redBelowCents: next.redBelowCents,
        blueAboveCents: next.blueAboveCents,
        campaignTarget: next.campaignTarget,
        campaignLabel: next.campaignLabel,
      },
    });
  return next;
}

export async function logCommandSkyWin(params: {
  tenantId: string;
  kind: "verbal_commitment" | "first_order";
  label: string;
  dedupeKey: string;
}): Promise<{ recorded: boolean; deduped: boolean; hopeExpiresAt: string }> {
  const db = await getDb();
  const hopeEnd =
    params.kind === "verbal_commitment"
      ? new Date(Date.now() + 3 * 3_600_000) // 3 hours of blue
      : halfDayBlockEnd(); // blue until 2pm / 10pm LA
  if (!db) return { recorded: false, deduped: false, hopeExpiresAt: hopeEnd.toISOString() };
  await ensureSkyTables();
  try {
    const existing = await db
      .select({ id: commandSkyWins.id })
      .from(commandSkyWins)
      .where(and(eq(commandSkyWins.tenantId, params.tenantId), eq(commandSkyWins.dedupeKey, params.dedupeKey)))
      .limit(1);
    if (existing.length > 0) {
      return { recorded: false, deduped: true, hopeExpiresAt: hopeEnd.toISOString() };
    }
    await db.insert(commandSkyWins).values({
      tenantId: params.tenantId,
      kind: params.kind,
      label: params.label.slice(0, 191),
      dedupeKey: params.dedupeKey,
      hopeExpiresAt: hopeEnd,
    });
    return { recorded: true, deduped: false, hopeExpiresAt: hopeEnd.toISOString() };
  } catch (error) {
    if (isMissingSkyTableError(error)) {
      return { recorded: false, deduped: false, hopeExpiresAt: hopeEnd.toISOString() };
    }
    throw error;
  }
}

/**
 * Auto-detect new first-paid-order customers (campaign progress + hope)
 * that haven't been recorded as wins yet. Uses each customer's phone as the
 * campaign identity; the win dedupeKey pins to the first paid order id, so
 * re-runs are idempotent. Called lazily from getCommandSkyState.
 */
async function syncFirstOrderWins(tenantId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    // Last 30 days of paid orders, oldest first; first per phone = candidate.
    const since = new Date(Date.now() - 30 * 86_400_000);
    const paid = await db
      .select({
        id: orders.id,
        phone: orders.phone,
        firstName: orders.firstName,
        lastName: orders.lastName,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(and(eq(orders.paid, true), gte(orders.createdAt, since)))
      .orderBy(orders.createdAt)
      .limit(500);
    const seen = new Set<string>();
    for (const order of paid) {
      const phone = String(order.phone ?? "").replace(/\D/g, "");
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      const name =
        `${order.firstName ?? ""} ${order.lastName ?? ""}`.trim() || `…${phone.slice(-4)}`;
      await logCommandSkyWin({
        tenantId,
        kind: "first_order",
        label: `${name} — first order`,
        dedupeKey: `first-order:${phone}:${order.id}`,
      });
    }
  } catch (error) {
    if (!isMissingSkyTableError(error)) {
      console.warn("[CommandSky] first-order sync failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function toneFromBrightness(b: number): SkyTone {
  if (b >= 0.85) return "blue";
  if (b >= 0.6) return "fair";
  if (b >= 0.35) return "overcast";
  if (b >= 0.15) return "storm";
  return "red";
}

export async function getCommandSkyState(params: {
  tenantId: string;
  /** Net profit cents for the CONFIGURED period, supplied by the caller
   * (cockpit summary already computes this — no duplicate math). Null when
   * profit data is unavailable; profit mode then reads neutral overcast. */
  netCents: number | null;
}): Promise<CommandSkyState> {
  const settings = await getCommandSkySettings(params.tenantId);
  const db = await getDb();

  let wins: CommandSkyWin[] = [];
  if (db) {
    await syncFirstOrderWins(params.tenantId);
    try {
      wins = await db
        .select()
        .from(commandSkyWins)
        .where(eq(commandSkyWins.tenantId, params.tenantId))
        .orderBy(desc(commandSkyWins.createdAt))
        .limit(200);
    } catch (error) {
      if (!isMissingSkyTableError(error)) throw error;
    }
  }

  const now = Date.now();
  const activeHope = wins.find(
    (w) => w.hopeExpiresAt && new Date(w.hopeExpiresAt).getTime() > now
  );
  const hope: HopeWindow | null = activeHope
    ? {
        kind: activeHope.kind as HopeWindow["kind"],
        label: activeHope.label,
        expiresAt: new Date(activeHope.hopeExpiresAt as unknown as string).toISOString(),
        minutesLeft: Math.max(
          1,
          Math.round((new Date(activeHope.hopeExpiresAt as unknown as string).getTime() - now) / 60_000)
        ),
      }
    : null;

  // Campaign progress: distinct first-order wins count toward the goal.
  const campaignCount = wins.filter((w) => w.kind === "first_order").length;
  const campaignPct = Math.min(1, campaignCount / Math.max(1, settings.campaignTarget));

  let brightness: number;
  let reason: string;
  if (settings.mode === "campaign") {
    brightness = 0.12 + campaignPct * 0.88;
    reason =
      campaignCount === 0
        ? `Campaign morning — first of ${settings.campaignTarget} still out there.`
        : `${campaignCount} of ${settings.campaignTarget} won. The sky remembers every one.`;
  } else if (params.netCents == null) {
    brightness = 0.5;
    reason = "Profit data still syncing — sky holding neutral.";
  } else {
    const net = params.netCents;
    const span = Math.max(1, settings.blueAboveCents - settings.redBelowCents);
    brightness = Math.max(0, Math.min(1, (net - settings.redBelowCents) / span));
    reason =
      brightness >= 0.85
        ? "Above your blue bar for this period."
        : brightness <= 0.15
          ? "Below your red bar — one win changes the weather."
          : "Between your bars — climbing.";
  }

  if (hope) {
    brightness = Math.max(brightness, 0.95);
    reason =
      hope.kind === "verbal_commitment"
        ? `Blue sky: ${hope.label} (${hope.minutesLeft}m of promise light left).`
        : `Blue sky until the block ends: ${hope.label}.`;
  }

  return {
    available: db != null,
    settings,
    tone: toneFromBrightness(brightness),
    brightness,
    reason,
    hope,
    campaign: {
      target: settings.campaignTarget,
      count: campaignCount,
      pct: Math.round(campaignPct * 100),
      label: settings.campaignLabel,
      recentWins: wins.slice(0, 6).map((w) => ({
        kind: w.kind,
        label: w.label,
        at: new Date(w.createdAt as unknown as string).toISOString(),
      })),
    },
  };
}
