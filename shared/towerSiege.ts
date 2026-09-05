import { z } from "zod";

export const SIEGE_VERSION = 1;
export const DEFENSES = {
  launch: {
    name: "Valet Launch",
    cost: 45,
    cooldown: 4.5,
    description: "Launches a car. 2 damage; covers nearby path.",
  },
  surge: {
    name: "Fountain Surge",
    cost: 35,
    cooldown: 8,
    description: "Pushes a crowd back and slows it. No damage.",
  },
  beacon: {
    name: "Beacon",
    cost: 30,
    cooldown: 0,
    description: "Adjacent defenses fire 40% faster. No damage.",
  },
} as const;
export type Defense = keyof typeof DEFENSES;
export const POINTS = [0.24, 0.51, 0.78];
const enemySchema = z.object({
  id: z.number(),
  kind: z.enum(["dust", "lapse"]),
  position: z.number(),
  hp: z.number(),
  maxHp: z.number(),
  slow: z.number(),
  carrying: z.boolean(),
});
const slotSchema = z
  .object({ kind: z.enum(["launch", "surge", "beacon"]), cooldown: z.number() })
  .nullable();
export const siegeSchema = z.object({
  version: z.literal(SIEGE_VERSION),
  sessionId: z.string(),
  phase: z.enum(["planning", "active", "paused", "held", "breach"]),
  wave: z.number().int().min(1).max(5),
  time: z.number().nonnegative(),
  lumen: z.number().min(0).max(120),
  integrity: z.number().min(0).max(6),
  lanterns: z.number().int().min(0).max(3),
  slots: z.array(slotSchema).length(3),
  enemies: z.array(enemySchema).max(100),
  spawned: z.number().int().nonnegative(),
  pulseCooldown: z.number().nonnegative(),
  kills: z.number().int().nonnegative(),
  focus: z.number().nullable(),
  pressure: z.number().min(0.3).max(0.8),
  reflection: z.string(),
  notice: z.string(),
  effects: z.array(
    z.object({
      from: z.number(),
      to: z.number(),
      kind: z.enum(["launch", "surge", "pulse"]),
      life: z.number(),
    })
  ),
});
export type SiegeState = z.infer<typeof siegeSchema>;
export type SiegeAction =
  | { type: "tick" }
  | { type: "start" }
  | { type: "pause" }
  | { type: "deploy"; slot: number; kind: Defense }
  | { type: "sell"; slot: number }
  | { type: "pulse" }
  | { type: "focus"; id: number };

/** Only supplied, authoritative weekly events influence this bounded game projection. */
export function siegePressure(paidOrders?: number) {
  return paidOrders === undefined
    ? 0.45
    : 0.3 + 0.5 * (1 - Math.min(10, Math.max(0, paidOrders)) / 10);
}
export function newSiege(
  pressure = 0.45,
  reflection = "Business feed unavailable. Playing at standard difficulty."
): SiegeState {
  return {
    version: 1,
    sessionId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    phase: "planning",
    wave: 1,
    time: 0,
    lumen: 80,
    integrity: 6,
    lanterns: 3,
    slots: [null, null, null],
    enemies: [],
    spawned: 0,
    pulseCooldown: 0,
    kills: 0,
    focus: null,
    pressure: Math.max(0.3, Math.min(0.8, pressure)),
    reflection,
    notice: "Choose a pad, then deploy. A Launch is a good first defense.",
    effects: [],
  };
}
export function waveSchedule(wave: number) {
  const enemies: { at: number; kind: "dust" | "lapse" }[] = Array.from(
    { length: 10 + wave * 2 },
    (_, i) => ({ at: i * 3, kind: "dust" })
  );
  if (wave >= 2) enemies.push({ at: 30, kind: "lapse" });
  if (wave === 5) enemies.push({ at: 48, kind: "lapse" });
  return enemies.sort((a, b) => a.at - b.at);
}
export function lapseWarning(state: SiegeState) {
  return (
    state.phase === "active" &&
    waveSchedule(state.wave)
      .slice(state.spawned)
      .some(
        e =>
          e.kind === "lapse" && e.at - state.time <= 3 && e.at - state.time > 0
      )
  );
}
export function siegeReducer(
  previous: SiegeState,
  action: SiegeAction
): SiegeState {
  if (action.type === "pause")
    return previous.phase === "active"
      ? {
          ...previous,
          phase: "paused",
          notice: "Battle paused. Your Stronghold can wait.",
        }
      : previous;
  if (action.type === "start")
    return previous.phase === "planning" || previous.phase === "paused"
      ? {
          ...previous,
          phase: "active",
          notice: `Wave ${previous.wave}: defend the Approach Route.`,
        }
      : previous;
  if (
    previous.phase === "held" ||
    previous.phase === "breach" ||
    previous.phase === "paused"
  )
    return previous;
  const s: SiegeState = structuredClone(previous);
  if (action.type === "focus") {
    s.focus = action.id;
    return s;
  }
  if (action.type === "deploy") {
    if (
      !Number.isInteger(action.slot) ||
      action.slot < 0 ||
      action.slot > 2 ||
      s.slots[action.slot] ||
      s.lumen < DEFENSES[action.kind].cost
    )
      return previous;
    s.slots[action.slot] = { kind: action.kind, cooldown: 0 };
    s.lumen -= DEFENSES[action.kind].cost;
    s.notice = `${DEFENSES[action.kind].name} deployed at pad ${action.slot + 1}.`;
    /*
      Entering Siege must not cost the player two clicks before anything happens.
      The first defense IS the opening move of wave 1, so committing it starts
      combat. Later waves keep their deliberate planning beat: the player has a
      board to adjust and asks for the next wave when ready.
    */
    if (s.phase === "planning" && s.wave === 1) {
      s.phase = "active";
      s.notice = `${DEFENSES[action.kind].name} deployed. Wave 1: defend the Approach Route.`;
    }
    return s;
  }
  if (action.type === "sell") {
    const slot = s.slots[action.slot];
    if (!slot) return previous;
    s.lumen = Math.min(
      120,
      s.lumen + Math.floor(DEFENSES[slot.kind].cost * 0.75)
    );
    s.slots[action.slot] = null;
    s.notice = "Defense recalled. 75% of Lumen returned.";
    return s;
  }
  if (action.type === "pulse") {
    if (s.phase !== "active" || s.pulseCooldown > 0) return previous;
    s.pulseCooldown = 12;
    for (const e of s.enemies) {
      e.position = Math.max(
        0,
        Math.min(0.99, e.position + (e.carrying ? 0.14 : -0.14))
      );
      e.hp -= 1;
      e.slow = 2;
    }
    s.effects.push({ from: 0.5, to: 0.5, kind: "pulse", life: 0.6 });
    s.notice = "Repulse! Ruinbound pushed back. Lantern thieves interrupted.";
  } else if (action.type === "tick") {
    if (s.phase !== "active") return previous;
    const dt = 0.1;
    s.time = Math.round((s.time + dt) * 10) / 10;
    s.lumen = Math.min(
      120,
      s.lumen + (s.wave === 1 ? 1 : s.wave < 4 ? 0.7 : 1.5) * dt
    );
    s.pulseCooldown = Math.max(0, s.pulseCooldown - dt);
    s.effects = s.effects
      .map(e => ({ ...e, life: e.life - dt }))
      .filter(e => e.life > 0);
    const schedule = waveSchedule(s.wave);
    while (s.spawned < schedule.length && schedule[s.spawned].at <= s.time) {
      const kind = schedule[s.spawned].kind;
      const hp =
        kind === "lapse"
          ? 5
          : 2 + Math.floor(s.wave / 2) + (s.pressure >= 0.7 ? 1 : 0);
      s.enemies.push({
        id: s.wave * 100 + s.spawned,
        kind,
        position: 0,
        hp,
        maxHp: hp,
        slow: 0,
        carrying: false,
      });
      s.spawned++;
    }
    s.slots.forEach((slot, index) => {
      if (!slot || slot.kind === "beacon") return;
      const boosted = s.slots.some(
        (other, j) => other?.kind === "beacon" && Math.abs(index - j) === 1
      );
      slot.cooldown = Math.max(0, slot.cooldown - dt);
      const targets = s.enemies
        .filter(e => e.hp > 0 && Math.abs(e.position - POINTS[index]) <= 0.34)
        .sort(
          (a, b) =>
            Number(b.id === s.focus) - Number(a.id === s.focus) ||
            Number(b.carrying) - Number(a.carrying) ||
            b.position - a.position
        );
      if (slot.cooldown > 0 || !targets.length) return;
      slot.cooldown = DEFENSES[slot.kind].cooldown * (boosted ? 0.6 : 1);
      if (slot.kind === "launch") targets[0].hp -= 2;
      else
        for (const e of targets) {
          e.position = Math.max(
            0,
            Math.min(0.99, e.position + (e.carrying ? 0.12 : -0.12))
          );
          e.slow = 3;
        }
      s.effects.push({
        from: index,
        to: targets[0].position,
        kind: slot.kind,
        life: 0.5,
      });
    });
    for (const e of s.enemies) {
      if (e.hp <= 0) continue;
      e.slow = Math.max(0, e.slow - dt);
      const speed =
        (e.kind === "lapse" ? 0.075 : 0.023) * (0.9 + s.pressure * 0.3);
      e.position +=
        speed * dt * (e.slow > 0 ? 0.45 : 1) * (e.carrying ? -1 : 1);
      if (e.position >= 1) {
        if (e.kind === "lapse") {
          e.carrying = true;
          e.position = 1;
          s.notice =
            "The Lapse has a lantern! Tap it to focus fire; Repulse delays its escape.";
        } else {
          s.integrity = Math.max(0, s.integrity - 1);
          s.notice =
            "Dust breached the Approach Route. Cover the upper path or use Repulse.";
        }
      }
      if (e.carrying && e.position <= 0) {
        s.lanterns = Math.max(0, s.lanterns - 1);
        s.notice =
          "The Lapse escaped with a lantern. Focus the thief and hold Repulse for its return.";
      }
    }
  }
  s.kills += s.enemies.filter(e => e.hp <= 0).length;
  if (s.enemies.some(e => e.carrying && e.hp <= 0))
    s.notice = "Lantern recovered! The Lapse is down.";
  s.enemies = s.enemies.filter(
    e => e.hp > 0 && (e.carrying ? e.position > 0 : e.position < 1)
  );
  if (s.integrity <= 0 || s.lanterns <= 0) {
    s.phase = "breach";
    s.notice =
      s.integrity <= 0
        ? "Approach Route overrun by Dust. Try two Launches and keep Repulse for crowds."
        : "The Lapse stole all three lanterns. Focus thieves; use Surge to delay their escape.";
  } else if (
    s.phase === "active" &&
    s.spawned === waveSchedule(s.wave).length &&
    !s.enemies.length
  ) {
    if (s.wave === 5) {
      s.phase = "held";
      s.notice = "The Stronghold held. The Ruinbound recede.";
    } else {
      s.phase = "planning";
      s.wave++;
      s.time = 0;
      s.spawned = 0;
      s.lumen = Math.min(120, s.lumen + 20);
      s.integrity = Math.min(6, s.integrity + 1);
      s.notice =
        "Wave held. +20 Lumen, one barricade repaired. Adjust your defenses.";
    }
  }
  return s;
}

export function restoreSiege(raw: string | null): SiegeState | null {
  try {
    const parsed = siegeSchema.safeParse(JSON.parse(raw ?? "null"));
    return parsed.success
      ? {
          ...parsed.data,
          phase: parsed.data.phase === "active" ? "paused" : parsed.data.phase,
          effects: [],
        }
      : null;
  } catch {
    return null;
  }
}

export const siegeChronicleSchema = z
  .array(
    z.object({
      sessionId: z.string(),
      endedAt: z.number(),
      outcome: z.enum(["held", "breach"]),
      lanterns: z.number().int().min(0).max(3),
      wave: z.number().int().min(1).max(5),
    })
  )
  .max(20);
export type SiegeChronicle = z.infer<typeof siegeChronicleSchema>;
export function readSiegeChronicle(raw: string | null): SiegeChronicle {
  try {
    const result = siegeChronicleSchema.safeParse(JSON.parse(raw ?? "[]"));
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}
export function returningSiegePressure(
  pressure: number,
  history: SiegeChronicle,
  now = Date.now()
) {
  const last = history[0];
  return last && now - last.endedAt >= 7 * 86400000
    ? Math.min(pressure, 0.55)
    : pressure;
}

/**
 * Where one Stronghold's local save lives.
 *
 * Siege is entered from a specific tower, so the key must name that tower.
 * Without the building segment two Strongholds defended by the same operator in
 * the same tenant would share — and silently overwrite — one save.
 *
 * Returns undefined when tenant or operator context is missing: play stays
 * available for the session rather than inventing a tenant to save under.
 */
export function siegeStorageKey(input: {
  tenantId?: string | null;
  openId?: string | null;
  buildingId: string;
}): string | undefined {
  if (!input.tenantId || !input.openId || !input.buildingId) return undefined;
  return `goldline:siege:v1:${input.tenantId}:${input.openId}:${input.buildingId}`;
}
