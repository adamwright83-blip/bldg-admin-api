/**
 * What the courtyard remembers about Rook's airmail: authored discoveries, the fan's setting, and a few counts.
 *
 * Only observed facts are recorded (a flight's collisions really happened in that order), never a guess about what the
 * player meant. This is fiction: it never says anything about a customer, a message or money. Shared by the client
 * and the server (server/experience/lanternCity/courtyardDiscoveriesService.ts), which keeps it with the neighbourhood memory.
 */

export const DISCOVERY_IDS = [
  "first_delivery",
  "cat_assist",
  "three_cups",
  "fan_and_line",
  "rook_save",
  "rim_shot",
  "laundry_rescue",
] as const;
export type DiscoveryId = (typeof DISCOVERY_IDS)[number];

export const FAN_SETTING_IDS = ["up", "forward", "back"] as const;
export type FanSettingId = (typeof FAN_SETTING_IDS)[number];

export const BEAT_IDS = ["intro_seen", "orchestra_performed", "improvements_unveiled", "desk_offered"] as const;
export type BeatId = (typeof BEAT_IDS)[number];

export type DiscoveryRecord = { firstAt: string; lastAt: string; count: number };

export type CourtyardDiscoveries = {
  version: 1;
  discoveries: Partial<Record<DiscoveryId, DiscoveryRecord>>;
  beats: Partial<Record<BeatId, string>>;
  fan: FanSettingId;
  fanChangedAt: string | null;
  deliveries: number;
  attempts: number;
  sessions: number;
  /** the last flights recorded, so a retried write never counts twice */
  recentFlights: string[];
};

export const EMPTY_DISCOVERIES: CourtyardDiscoveries = {
  version: 1,
  discoveries: {},
  beats: {},
  fan: "up",
  fanChangedAt: null,
  deliveries: 0,
  attempts: 0,
  sessions: 0,
  recentFlights: [],
};

/** One flight's outcome, as observed by the simulation. */
export type FlightObservation = {
  flightId: string;
  delivered: boolean;
  /** the contacts this flight made, in order (deliveryPhysics WorldState.via) */
  via: string[];
  /** cups rung in order, by index */
  cups: number[];
};

/** The discoveries a flight's observed contacts prove. Pure; the same flight always proves the same things. */
export function discoveriesFromFlight(f: FlightObservation): DiscoveryId[] {
  const out: DiscoveryId[] = [];
  const seq = f.cups.join(",");
  if (seq.includes("0,1,2")) out.push("three_cups");
  if (!f.delivered) return out;
  out.push("first_delivery");
  if (f.via.includes("tail")) out.push("cat_assist");
  if (f.via.includes("fan") && f.via.includes("line")) out.push("fan_and_line");
  if (f.via.includes("rook_flick")) out.push("rook_save");
  if (f.via.includes("rim") || f.via.includes("railing")) out.push("rim_shot");
  if (f.via.some(v => v.startsWith("sheet"))) out.push("laundry_rescue");
  return out;
}

export type CourtyardObservation =
  | { kind: "flight"; flight: FlightObservation }
  | { kind: "fan"; setting: FanSettingId }
  | { kind: "beat"; beat: BeatId }
  | { kind: "session" };

/** Apply one observation. Idempotent for flights (by flightId) and beats (first time only). */
export function applyObservation(state: CourtyardDiscoveries, obs: CourtyardObservation, nowIso: string): CourtyardDiscoveries {
  const next: CourtyardDiscoveries = {
    ...EMPTY_DISCOVERIES,
    ...state,
    discoveries: { ...state.discoveries },
    beats: { ...state.beats },
    recentFlights: [...(state.recentFlights ?? [])],
  };
  if (obs.kind === "flight") {
    const f = obs.flight;
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(f.flightId) || next.recentFlights.includes(f.flightId)) return next;
    next.recentFlights.push(f.flightId);
    if (next.recentFlights.length > 40) next.recentFlights.splice(0, next.recentFlights.length - 40);
    next.attempts = (next.attempts ?? 0) + 1;
    if (f.delivered) next.deliveries = (next.deliveries ?? 0) + 1;
    for (const id of discoveriesFromFlight(f)) {
      const prev = next.discoveries[id];
      next.discoveries[id] = prev ? { ...prev, lastAt: nowIso, count: prev.count + 1 } : { firstAt: nowIso, lastAt: nowIso, count: 1 };
    }
  } else if (obs.kind === "fan") {
    if (FAN_SETTING_IDS.includes(obs.setting) && obs.setting !== next.fan) {
      next.fan = obs.setting;
      next.fanChangedAt = nowIso;
    }
  } else if (obs.kind === "beat") {
    if (BEAT_IDS.includes(obs.beat) && !next.beats[obs.beat]) next.beats[obs.beat] = nowIso;
  } else if (obs.kind === "session") {
    next.sessions = (next.sessions ?? 0) + 1;
  }
  return next;
}

/** Read whatever was stored (older or partial shapes included) as a complete, valid state. */
export function normalizeDiscoveries(raw: unknown): CourtyardDiscoveries {
  if (!raw || typeof raw !== "object") return { ...EMPTY_DISCOVERIES, discoveries: {}, beats: {}, recentFlights: [] };
  const r = raw as Partial<CourtyardDiscoveries>;
  const discoveries: CourtyardDiscoveries["discoveries"] = {};
  for (const id of DISCOVERY_IDS) {
    const d = r.discoveries?.[id];
    if (d && typeof d.firstAt === "string" && typeof d.count === "number") discoveries[id] = { firstAt: d.firstAt, lastAt: typeof d.lastAt === "string" ? d.lastAt : d.firstAt, count: Math.max(1, Math.floor(d.count)) };
  }
  const beats: CourtyardDiscoveries["beats"] = {};
  for (const id of BEAT_IDS) if (typeof r.beats?.[id] === "string") beats[id] = r.beats[id];
  return {
    version: 1,
    discoveries,
    beats,
    fan: FAN_SETTING_IDS.includes(r.fan as FanSettingId) ? (r.fan as FanSettingId) : "up",
    fanChangedAt: typeof r.fanChangedAt === "string" ? r.fanChangedAt : null,
    deliveries: Number.isFinite(r.deliveries) ? Math.max(0, Math.floor(r.deliveries!)) : 0,
    attempts: Number.isFinite(r.attempts) ? Math.max(0, Math.floor(r.attempts!)) : 0,
    sessions: Number.isFinite(r.sessions) ? Math.max(0, Math.floor(r.sessions!)) : 0,
    recentFlights: Array.isArray(r.recentFlights) ? r.recentFlights.filter(x => typeof x === "string").slice(-40) : [],
  };
}

/** Was this remembered before the current visit began? (So a sign appears on the next visit, not mid-performance.) */
export function rememberedBefore(iso: string | undefined | null, visitStartedAt: number) {
  return Boolean(iso) && new Date(iso!).getTime() < visitStartedAt;
}
