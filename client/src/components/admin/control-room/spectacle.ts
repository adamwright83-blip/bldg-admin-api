/**
 * THE CAUSAL SPECTACLE ENGINE
 *
 * The player must be able to read this sentence without text:
 *
 *   this building got the order -> it charged its weapon -> it fired ->
 *   the other building was hit -> it is now damaged -> that is why it was
 *   glowing red back in the city.
 *
 * Three rules make that honest rather than decorative.
 *
 * 1. ANIMATION EARNS AUTHORITY ONLY FROM UNSEEN REAL EVENTS.
 *    Tower Wars never polled (staleTime 30s, no interval, no socket) while sibling
 *    admin components poll at 2.5s-60s, so new orders never reached an open tab. Now
 *    it refreshes — but a refresh is not an event. Only an authoritative event id
 *    this viewer has never seen may produce spectacle. Refetch, hydration, remount
 *    and replay-init must all produce nothing.
 *
 * 2. THE SEEN CURSOR IS PRESENTATION, NEVER TRUTH.
 *    It lives in this viewer's own storage. It is not server state, it is not
 *    business state, and nothing downstream of it may write to either. This is the
 *    third clock: `shared/twoClockOutcome.ts` already firewalls fictional performance
 *    from authoritative resolution; presentation is a third thing again.
 *
 * 3. MAGNITUDE IS A PURE FUNCTION OF IMPACT CLASS.
 *    `IMPACT_CLASSES` is the honesty ladder, and it is currently used nowhere for
 *    presentation. The animation layer is exactly where effort-inflation would sneak
 *    back in — a door knock must not detonate like a paid order. So the loudest a
 *    thing may animate is decided by what class of fact it actually is.
 */
import type { ImpactClass } from "@shared/impactSignal";

/* ── Magnitude ──────────────────────────────────────────────────────────── */

export const SPECTACLE_MAGNITUDES = [
  "whisper",
  "murmur",
  "beat",
  "surge",
  "detonation",
] as const;
export type SpectacleMagnitude = (typeof SPECTACLE_MAGNITUDES)[number];

/**
 * The ceiling for a fact of this class. Nothing may animate above its own rung.
 *
 * Deliberately not a free parameter: if a caller wants a bigger effect it must
 * produce a stronger real outcome, not pass a louder flag.
 */
export function spectacleMagnitude(impactClass: ImpactClass): SpectacleMagnitude {
  switch (impactClass) {
    case "economic_outcome":
      return "detonation";
    case "customer_outcome":
      return "surge";
    case "opportunity":
      return "beat";
    case "response":
      return "murmur";
    case "field_activity":
    case "observation":
    default:
      return "whisper";
  }
}

/** Relative weight, for callers that need a number rather than a name. */
export function magnitudeWeight(m: SpectacleMagnitude): number {
  return (SPECTACLE_MAGNITUDES.indexOf(m) + 1) / SPECTACLE_MAGNITUDES.length;
}

/* ── The unseen-event cursor ────────────────────────────────────────────── */

const CURSOR_KEY = "goldline.spectacle.seen.v1";
const MAX_REMEMBERED = 400;

export type SeenCursor = { seen: string[] };

function safeRead(storage?: Storage): SeenCursor {
  try {
    const raw = (storage ?? window.localStorage).getItem(CURSOR_KEY);
    if (!raw) return { seen: [] };
    const parsed = JSON.parse(raw) as SeenCursor;
    return Array.isArray(parsed?.seen) ? { seen: parsed.seen } : { seen: [] };
  } catch {
    // Private mode, cleared storage, quota — a viewer with no cursor simply sees
    // nothing replay, which is the safe direction to fail.
    return { seen: [] };
  }
}

function safeWrite(cursor: SeenCursor, storage?: Storage): void {
  try {
    (storage ?? window.localStorage).setItem(
      CURSOR_KEY,
      JSON.stringify({ seen: cursor.seen.slice(-MAX_REMEMBERED) })
    );
  } catch {
    /* presentation only — never worth surfacing */
  }
}

/**
 * Which of these authoritative events this viewer has genuinely never seen.
 *
 * Order is preserved so the causal chain plays in the order reality produced it.
 */
export function unseenEventIds(
  eventIds: readonly string[],
  cursor: SeenCursor
): string[] {
  const seen = new Set(cursor.seen);
  const out: string[] = [];
  for (const id of eventIds) {
    if (!seen.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

export function markSeen(
  eventIds: readonly string[],
  cursor: SeenCursor
): SeenCursor {
  const seen = new Set(cursor.seen);
  for (const id of eventIds) seen.add(id);
  return { seen: Array.from(seen).slice(-MAX_REMEMBERED) };
}

export function readSeenCursor(storage?: Storage): SeenCursor {
  return safeRead(storage);
}

export function writeSeenCursor(cursor: SeenCursor, storage?: Storage): void {
  safeWrite(cursor, storage);
}

/**
 * The first load of a session must not detonate the whole day.
 *
 * Opening Tower Wars at 4pm should not replay every order since breakfast as if
 * each had just happened. On a cold cursor we adopt the current ledger silently:
 * the world shows its true state, and only genuinely subsequent events animate.
 */
export function adoptWithoutSpectacle(
  eventIds: readonly string[],
  cursor: SeenCursor
): { cursor: SeenCursor; play: string[] } {
  if (cursor.seen.length === 0) {
    return { cursor: markSeen(eventIds, cursor), play: [] };
  }
  const play = unseenEventIds(eventIds, cursor);
  return { cursor: markSeen(eventIds, cursor), play };
}

/* ── The weapon charge ──────────────────────────────────────────────────── */

/**
 * How full the weapon is, 0..1, toward its next strike.
 *
 * `unspentValueCents` already exists on the settlement's TodayMatch but only ever
 * rendered as a line of text. Making it physical is what lets a non-firing order
 * still resolve: $10 charged plus a $20 order rises to $30 and settles, rather than
 * producing green money spectacle followed by nothing, which reads as a bug.
 */
export function chargeFraction(
  unspentValueCents: number,
  thresholdCents: number
): number {
  if (thresholdCents <= 0) return 0;
  return Math.max(0, Math.min(1, unspentValueCents / thresholdCents));
}

/** How many strikes a single order's value discharges, and what remains charged. */
export function dischargePlan(input: {
  chargedBeforeCents: number;
  orderValueCents: number;
  thresholdCents: number;
}): { strikes: number; remainderCents: number } {
  const total = Math.max(0, input.chargedBeforeCents + input.orderValueCents);
  if (input.thresholdCents <= 0) return { strikes: 0, remainderCents: total };
  return {
    // One order may discharge more than once. The spectacle must show ONE revenue
    // arrival then N discharges — never N fake order bursts.
    strikes: Math.floor(total / input.thresholdCents),
    remainderCents: total % input.thresholdCents,
  };
}
