import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  arcadeIsSettled,
  arcadeReducer,
  describeArcadeBody,
  EMPTY_ARCADE_WORLD,
  REGENERATION_DELAY_MS,
  weaponForBuilding,
  WEAPON_PROFILES,
  type ArcadeWorld,
} from "./goldlineArcade";
import { projectPhysicalWorldState, type GoldlineWorldEvent } from "./goldlineWorld";
import { projectObligations, presentObligations } from "./goldlineObligations";

const SHOOTER = "building-cpe";
const TARGET = "building-opus";

const fire = (world: ArcadeWorld, force = 1): ArcadeWorld => {
  let next = arcadeReducer(world, {
    type: "charge",
    physicalEntityId: SHOOTER,
    weapon: "valet_bazooka",
  });
  next = arcadeReducer(next, { type: "fire", physicalEntityId: SHOOTER });
  return arcadeReducer(next, {
    type: "impact",
    physicalEntityId: SHOOTER,
    targetId: TARGET,
    force,
  });
};

describe("each building's weapon has its own personality", () => {
  it("gives Century Park East the valet cannon", () => {
    const weapon = weaponForBuilding({ displayName: "Century Park East" });
    expect(weapon.archetype).toBe("valet_bazooka");
    expect(weapon.anticipation).toMatch(/valet/i);
  });

  it("gives OPUS the golf driver", () => {
    expect(weaponForBuilding({ displayName: "OPUS LA" }).archetype).toBe("golf_driver");
  });

  it("derives a weapon from a real observed feature", () => {
    expect(
      weaponForBuilding({ displayName: "The Louise", sourceCharacteristic: "terraced roof deck" })
        .archetype
    ).toBe("terrace_engine");
  });

  it("falls back rather than inventing a personality a building never earned", () => {
    expect(weaponForBuilding({ displayName: "Some Building" }).archetype).toBe(
      "gold_line_pulse"
    );
  });

  it("gives each weapon its own rhythm, not one timing with new labels", () => {
    const charges = Object.values(WEAPON_PROFILES).map(profile => profile.chargeMs);
    expect(new Set(charges).size).toBe(charges.length);
  });
});

describe("the shot has beats, not a single flash", () => {
  it("runs anticipation, action, then impact", () => {
    const charging = arcadeReducer(EMPTY_ARCADE_WORLD, {
      type: "charge",
      physicalEntityId: SHOOTER,
      weapon: "valet_bazooka",
    });
    expect(charging.bodies[SHOOTER]!.phase).toBe("charging");

    const firing = arcadeReducer(charging, { type: "fire", physicalEntityId: SHOOTER });
    expect(firing.bodies[SHOOTER]!.phase).toBe("firing");

    const hit = arcadeReducer(firing, {
      type: "impact",
      physicalEntityId: SHOOTER,
      targetId: TARGET,
      force: 1,
    });
    expect(hit.bodies[TARGET]!.phase).toBe("impact");
    expect(hit.bodies[TARGET]!.damage).toBeGreaterThan(0);
    expect(hit.bodies[TARGET]!.debris).toBeGreaterThan(0);
  });

  it("cannot fire without charging first", () => {
    const world = arcadeReducer(EMPTY_ARCADE_WORLD, {
      type: "fire",
      physicalEntityId: SHOOTER,
    });
    expect(world.bodies[SHOOTER]).toBeUndefined();
  });

  it("caps how wrecked a building can look", () => {
    let world = EMPTY_ARCADE_WORLD;
    for (let shot = 0; shot < 12; shot += 1) world = fire(world);
    expect(world.bodies[TARGET]!.damage).toBeLessThanOrEqual(1);
    expect(Math.abs(world.bodies[TARGET]!.lean)).toBeLessThanOrEqual(9);
  });
});

describe("the rebuild is the payoff", () => {
  it("waits, then heals gradually rather than snapping back", () => {
    let world = fire(EMPTY_ARCADE_WORLD);
    const wrecked = world.bodies[TARGET]!.damage;

    // Still broken while the delay runs.
    world = arcadeReducer(world, { type: "tick", deltaMs: REGENERATION_DELAY_MS - 100 });
    expect(world.bodies[TARGET]!.damage).toBe(wrecked);

    world = arcadeReducer(world, { type: "tick", deltaMs: 200 });
    const healing = world.bodies[TARGET]!.damage;
    expect(healing).toBeLessThan(wrecked);
    expect(healing).toBeGreaterThan(0);
  });

  it("finishes, and leaves no lingering state to animate", () => {
    // A world that never settles is an animation loop that never stops.
    let world = fire(EMPTY_ARCADE_WORLD);
    for (let frame = 0; frame < 400; frame += 1) {
      world = arcadeReducer(world, { type: "tick", deltaMs: 32 });
    }
    expect(arcadeIsSettled(world)).toBe(true);
  });
});

describe("toy combat cannot touch the save file", () => {
  const events: GoldlineWorldEvent[] = [
    {
      id: "commitment-1",
      tenantId: "default",
      physicalEntityId: TARGET,
      eventType: "field_commitment_made",
      classification: "evidence",
      actorType: "operator",
      actorId: "driver-1",
      occurredAt: "2026-09-01T15:14:00.000Z",
      observedAt: null,
      sourceType: "driver_sales_journals",
      sourceId: "journal-1",
      sourceEvidenceReference: "driver_sales_journals:journal-1",
      provenanceClass: "operator_reported",
      verificationClass: "ATTESTED",
      confidence: "high",
      idempotencyKey: "commitment-1",
      correlationId: "journal-1",
      metadata: { statement: "I told them I'd email Sarah", dueDate: "2026-09-02" },
    },
    {
      id: "won-1",
      tenantId: "default",
      physicalEntityId: TARGET,
      eventType: "account_won",
      classification: "outcome",
      actorType: "system",
      actorId: null,
      occurredAt: "2026-08-01T00:00:00.000Z",
      observedAt: null,
      sourceType: "commercial_pipeline_records",
      sourceId: "1",
      sourceEvidenceReference: "commercial_pipeline_records:1",
      provenanceClass: "existing_business_record",
      verificationClass: "VERIFIED",
      confidence: "high",
      idempotencyKey: "won-1",
      correlationId: "pipeline-1",
      metadata: {},
    },
  ];

  const businessSnapshot = () =>
    JSON.stringify({
      projection: projectPhysicalWorldState({
        physicalEntityId: TARGET,
        events,
        residentCount: 9,
        activeResidentCount: 7,
        epistemicState: "confirmed",
      }),
      obligations: presentObligations(TARGET, projectObligations(events), "2026-09-02"),
      events,
    });

  it("leaves canonical business state byte-for-byte identical", () => {
    /*
      The snapshot covers commercial state, history marks, illumination,
      resident counts, the outstanding promise and the raw event ledger. A
      whole bombardment happens between the two reads.
    */
    const before = businessSnapshot();

    let world = EMPTY_ARCADE_WORLD;
    for (let shot = 0; shot < 25; shot += 1) world = fire(world, 1);
    for (let frame = 0; frame < 200; frame += 1) {
      world = arcadeReducer(world, { type: "tick", deltaMs: 16 });
    }

    expect(businessSnapshot()).toBe(before);
  });

  it("leaves the promise exactly as taut as it was", () => {
    let world = EMPTY_ARCADE_WORLD;
    for (let shot = 0; shot < 10; shot += 1) world = fire(world);
    const owed = presentObligations(TARGET, projectObligations(events), "2026-09-02")!;
    // Blowing up a building does not discharge what you promised its front desk.
    expect(owed.count).toBe(1);
    expect(owed.tension).toBe("taut");
  });

  it("has no way to reach the business layer at all", () => {
    /*
      Structural, not disciplinary. If this module cannot import a store, a db
      handle or a business projector, then no future edit can quietly let a toy
      write to truth without that edit being visible right here.
    */
    const source = readFileSync(join(__dirname, "goldlineArcade.ts"), "utf8");
    const imports = source.match(/^import .*$/gm) ?? [];
    expect(imports).toHaveLength(0);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bdb\b|drizzle|fetch\(|localStorage|appendGoldline|mutate/i);
  });
});

describe("the toy is still information", () => {
  it("says what is happening, and that none of it is real", () => {
    const world = fire(EMPTY_ARCADE_WORLD);
    const spoken = describeArcadeBody(world.bodies[TARGET]!, "OPUS LA");
    expect(spoken).toMatch(/OPUS LA/);
    expect(spoken).toMatch(/Nothing real changed/);
  });

  it("narrates each weapon in its own words", () => {
    const charging = arcadeReducer(EMPTY_ARCADE_WORLD, {
      type: "charge",
      physicalEntityId: SHOOTER,
      weapon: "valet_bazooka",
    });
    expect(describeArcadeBody(charging.bodies[SHOOTER]!, "Century Park East")).toMatch(
      /valet/i
    );
  });
});
