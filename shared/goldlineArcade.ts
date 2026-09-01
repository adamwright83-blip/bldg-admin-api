/**
 * The arcade body: a building you are allowed to play with.
 *
 * Every Goldline place has two representations. The *physical entity* is the
 * save file — identity, coordinates, customers, promises, revenue, history.
 * The *arcade body* is the toy: it charges a ridiculous weapon, takes cartoon
 * damage, leans, smokes and rebuilds itself.
 *
 * This module is the entire arcade side, and it is deliberately a closed
 * system: it takes transient state in and returns transient state out. It
 * imports nothing from the business layer, exports no writer, and has no way
 * to reach an order, a stage, a customer or a coordinate. Firing a bazooka at
 * a tower cannot change what that tower means, because nothing here can.
 *
 * Everything it produces is expected to vanish on reload. That is the point.
 */

/** Which absurd machine a building is carrying. Read from forged metadata. */
export type WeaponArchetype =
  /** Century Park East: a valet cannon that launches a parked car. */
  | "valet_bazooka"
  /** OPUS: a colossal driver that tees off from the roofline. */
  | "golf_driver"
  /** A rooftop mechanism derived from a real observed feature. */
  | "terrace_engine"
  /** The fallback when a building has no forged weapon of its own. */
  | "gold_line_pulse";

/**
 * The beats of one shot. Each weapon owns its own timing so a valet cannon
 * does not feel like a golf swing wearing a different label.
 */
export type WeaponPhase = "idle" | "charging" | "firing" | "impact" | "recovering";

export type WeaponProfile = {
  archetype: WeaponArchetype;
  /** What the player sees before anything happens — the tell. */
  anticipation: string;
  /** The action itself. */
  action: string;
  /** Milliseconds per beat, so each weapon has its own rhythm. */
  chargeMs: number;
  fireMs: number;
  impactMs: number;
  /** How hard the arcade body reacts. Purely cosmetic. */
  impactForce: number;
};

export const WEAPON_PROFILES: Record<WeaponArchetype, WeaponProfile> = {
  valet_bazooka: {
    archetype: "valet_bazooka",
    anticipation: "A valet sprints up the ramp, shoulders the cannon and braces.",
    action: "A parked sedan is launched across the block, horn still going.",
    chargeMs: 620,
    fireMs: 260,
    impactMs: 420,
    impactForce: 1,
  },
  golf_driver: {
    archetype: "golf_driver",
    anticipation: "The tower winds up, driver raised over the roofline.",
    action: "An enormous swing sends a glowing ball into the skyline.",
    chargeMs: 780,
    fireMs: 200,
    impactMs: 360,
    impactForce: 0.85,
  },
  terrace_engine: {
    archetype: "terrace_engine",
    anticipation: "The terrace mechanism spins up and the deck lights flare.",
    action: "The engine releases a cascade down the building's own terraces.",
    chargeMs: 540,
    fireMs: 300,
    impactMs: 380,
    impactForce: 0.7,
  },
  gold_line_pulse: {
    archetype: "gold_line_pulse",
    anticipation: "Gold Line energy gathers in the frame.",
    action: "A bright pulse rolls out along the Gold Line.",
    chargeMs: 460,
    fireMs: 220,
    impactMs: 300,
    impactForce: 0.6,
  },
};

/**
 * Picks a weapon from what the forge actually recorded about this building.
 *
 * Falls back to the Gold Line pulse rather than inventing a personality a
 * building never earned.
 */
export function weaponForBuilding(input: {
  displayName?: string | null;
  weaponTitle?: string | null;
  sourceCharacteristic?: string | null;
}): WeaponProfile {
  const haystack = [input.displayName, input.weaponTitle, input.sourceCharacteristic]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/valet|century park|cpe|parking|garage/.test(haystack))
    return WEAPON_PROFILES.valet_bazooka;
  if (/golf|driver|opus/.test(haystack)) return WEAPON_PROFILES.golf_driver;
  if (/terrace|roof|deck|courtyard/.test(haystack)) return WEAPON_PROFILES.terrace_engine;
  return WEAPON_PROFILES.gold_line_pulse;
}

/** Everything the arcade knows about one building right now. All of it transient. */
export type ArcadeBody = {
  physicalEntityId: string;
  phase: WeaponPhase;
  /** 0..1. Cosmetic damage only. */
  damage: number;
  /** Cosmetic lean, in degrees. */
  lean: number;
  /** Cosmetic debris pieces currently in flight. */
  debris: number;
  /** Milliseconds remaining before the building rebuilds itself. */
  regenerationMs: number;
  weapon: WeaponArchetype;
};

export type ArcadeWorld = {
  /** Only buildings currently being played with appear here. */
  bodies: Record<string, ArcadeBody>;
};

export const EMPTY_ARCADE_WORLD: ArcadeWorld = { bodies: {} };

/** How long a building stays broken before it starts putting itself together. */
export const REGENERATION_DELAY_MS = 3200;
export const REGENERATION_DURATION_MS = 2400;

export type ArcadeEvent =
  | { type: "charge"; physicalEntityId: string; weapon: WeaponArchetype }
  | { type: "fire"; physicalEntityId: string }
  | { type: "impact"; physicalEntityId: string; targetId: string; force: number }
  | { type: "tick"; deltaMs: number }
  | { type: "clear" };

function bodyFor(world: ArcadeWorld, id: string, weapon: WeaponArchetype): ArcadeBody {
  return (
    world.bodies[id] ?? {
      physicalEntityId: id,
      phase: "idle",
      damage: 0,
      lean: 0,
      debris: 0,
      regenerationMs: 0,
      weapon,
    }
  );
}

/**
 * The whole arcade, as one pure reducer.
 *
 * Being a reducer over transient state is what makes the truth boundary
 * structural rather than a matter of discipline: there is no `db`, no fetch and
 * no mutation surface in here, so a toy event has nowhere to write even if
 * someone later wanted it to.
 */
export function arcadeReducer(world: ArcadeWorld, event: ArcadeEvent): ArcadeWorld {
  switch (event.type) {
    case "clear":
      return EMPTY_ARCADE_WORLD;

    case "charge": {
      const body = bodyFor(world, event.physicalEntityId, event.weapon);
      return {
        bodies: {
          ...world.bodies,
          [event.physicalEntityId]: { ...body, phase: "charging", weapon: event.weapon },
        },
      };
    }

    case "fire": {
      const body = world.bodies[event.physicalEntityId];
      if (!body || body.phase !== "charging") return world;
      return {
        bodies: {
          ...world.bodies,
          [event.physicalEntityId]: { ...body, phase: "firing" },
        },
      };
    }

    case "impact": {
      const target = bodyFor(world, event.targetId, "gold_line_pulse");
      const shooter = world.bodies[event.physicalEntityId];
      const bodies = { ...world.bodies };
      // Damage is cosmetic and capped, so a building can look wrecked but never
      // become anything other than a building that looks wrecked.
      bodies[event.targetId] = {
        ...target,
        phase: "impact",
        damage: Math.min(1, target.damage + event.force * 0.45),
        lean: Math.max(-9, Math.min(9, target.lean + event.force * 4)),
        debris: Math.min(24, target.debris + Math.round(event.force * 8)),
        regenerationMs: REGENERATION_DELAY_MS,
      };
      if (shooter) bodies[event.physicalEntityId] = { ...shooter, phase: "recovering" };
      return { bodies };
    }

    case "tick": {
      const bodies: Record<string, ArcadeBody> = {};
      for (const [id, body] of Object.entries(world.bodies)) {
        // Sit wrecked for the delay, so the damage is allowed to land before
        // the building starts putting itself back together.
        if (body.regenerationMs > 0) {
          const remaining = body.regenerationMs - event.deltaMs;
          if (remaining > 0) {
            bodies[id] = { ...body, regenerationMs: remaining };
            continue;
          }
        }

        const active = body.phase === "charging" || body.phase === "firing";
        if (active) {
          bodies[id] = body;
          continue;
        }

        // Past the delay the rebuild runs every frame until there is nothing
        // left to show, which is what makes it a visible recovery rather than
        // a value being reset behind the scenes.
        const damage = Math.max(0, body.damage - event.deltaMs / REGENERATION_DURATION_MS);
        const lean = Math.abs(body.lean) < 0.05 ? 0 : body.lean * 0.86;
        const debris = Math.max(0, body.debris - 1);

        // Nothing visible left: drop the body entirely so the loop can stop.
        if (damage <= 0.001 && lean === 0 && debris === 0) continue;
        bodies[id] = {
          ...body,
          phase: "recovering",
          damage,
          lean,
          debris,
          regenerationMs: 0,
        };
      }
      return { bodies };
    }
  }
}

/** Whether anything is still animating, so the loop can stop when nothing is. */
export function arcadeIsSettled(world: ArcadeWorld): boolean {
  return Object.keys(world.bodies).length === 0;
}

/**
 * What a screen reader is told about an arcade body.
 *
 * The toy is still information: a player who cannot see the explosion should
 * still know the building is pretending to be on fire, and — crucially — that
 * nothing real happened to it.
 */
export function describeArcadeBody(body: ArcadeBody, name: string): string {
  const profile = WEAPON_PROFILES[body.weapon];
  if (body.phase === "charging") return `${name}: ${profile.anticipation}`;
  if (body.phase === "firing") return `${name}: ${profile.action}`;
  if (body.damage > 0.5) return `${name} is comically wrecked. Nothing real changed.`;
  if (body.damage > 0) return `${name} is scorched and rebuilding. Nothing real changed.`;
  return `${name} is intact.`;
}
