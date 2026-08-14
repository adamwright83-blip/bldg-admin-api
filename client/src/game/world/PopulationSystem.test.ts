import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Texture } from "pixi.js";
import { parseCorridorManifest } from "../../../../shared/corridorManifest";
import {
  PopulationSystem,
  PRODUCTION_ROLE_ATLAS_COLUMNS,
  PRODUCTION_ROLE_ATLAS_ORDER,
} from "./PopulationSystem";

function populationFixture(corridorId = "corridor_01") {
  const raw = JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        `../../../public/assets/goldline/${corridorId}/manifest.json`
      ),
      "utf8"
    )
  );
  const parsed = parseCorridorManifest(raw);
  if (!parsed.success) throw new Error("corridor_01 population must validate");
  return parsed.data.population;
}

describe("PopulationSystem", () => {
  it("keeps a stable one-cell mapping for every authored production role", () => {
    expect(PRODUCTION_ROLE_ATLAS_COLUMNS).toBe(6);
    expect(PRODUCTION_ROLE_ATLAS_ORDER).toEqual([
      "field-role-a",
      "field-role-b",
      "field-role-c",
      "field-role-d",
      "field-role-e",
      "field-role-f",
    ]);
  });

  it("shows five authored ambient figures in the opening scene", () => {
    const system = new PopulationSystem(populationFixture());
    system.update({ now: 0, width: 412, height: 923, playerProgress: 0.06 });
    expect(system.visibleAmbientCount).toBeGreaterThanOrEqual(5);
    system.destroy();
  });

  it("keeps a normalized sprite child under authored perspective scaling", () => {
    const system = new PopulationSystem(
      populationFixture("corridor_02"),
      Texture.EMPTY
    );
    system.update({ now: 0, width: 412, height: 923, playerProgress: 0.06 });
    const ambientLayer = system.container.children[0];
    const firstRole = ambientLayer?.children[0];
    expect(system.assetStage).toBe("production");
    expect(firstRole?.children).toHaveLength(1);
    expect(firstRole?.children[0]?.width).toBeLessThanOrEqual(72);
    expect(firstRole?.children[0]?.height).toBeLessThanOrEqual(144);
    system.destroy();
  });

  it("sleeps ambient figures beyond their authored visibility radius", () => {
    const system = new PopulationSystem(populationFixture());
    system.update({ now: 0, width: 412, height: 923, playerProgress: 0.06 });
    const openingCount = system.visibleAmbientCount;
    system.update({ now: 200, width: 412, height: 923, playerProgress: 0.82 });
    expect(system.visibleAmbientCount).toBeLessThan(openingCount);
    system.destroy();
  });

  it("mounts only an authoritative mission and destroys idempotently", () => {
    const system = new PopulationSystem(populationFixture());
    expect(system.missionEmbodiment).toBeNull();
    system.setMission({
      missionId: 71,
      missionKey: "mission:71",
      archetype: "STALLER",
      state: "active",
      affordance: "VISIT",
      worldSignal: "threshold",
    });
    expect(system.missionEmbodiment?.missionId).toBe(71);
    system.setMission(null);
    expect(system.missionEmbodiment).toBeNull();
    system.setAgentPresence([
      { agentId: "SCOUT", hasAuthoritativeSignal: false },
      { agentId: "INTEL", hasAuthoritativeSignal: true },
    ]);
    expect(() => {
      system.destroy();
      system.destroy();
    }).not.toThrow();
  });

  it("mounts a genuine pickup/delivery order as its own world objective", () => {
    const system = new PopulationSystem(populationFixture());
    expect(system.orderEmbodiment).toBeNull();
    system.setOrder({
      orderId: 501,
      orderKey: "order:501",
      kind: "pickup",
      label: "Fixture Customer",
      blocked: false,
    });
    expect(system.orderEmbodiment?.orderId).toBe(501);
    expect(system.orderEmbodiment?.kind).toBe("pickup");
    system.update({ now: 0, width: 412, height: 923, playerProgress: 0.06 });
    // A real order's anchor position/index are the only thing carried into
    // the world — never a fabricated customer/address fact.
    expect(system.orderEmbodiment).not.toHaveProperty("address");
    system.setOrder(null);
    expect(system.orderEmbodiment).toBeNull();
    system.destroy();
  });

  it("keeps mission and order embodiments independent — resolving one does not disturb the other", () => {
    const system = new PopulationSystem(populationFixture());
    system.setMission({
      missionId: 71,
      missionKey: "mission:71",
      archetype: "STALLER",
      state: "active",
      affordance: "VISIT",
      worldSignal: "threshold",
    });
    system.setOrder({
      orderId: 501,
      orderKey: "order:501",
      kind: "delivery",
      label: "Fixture Customer",
      blocked: false,
    });
    expect(system.missionEmbodiment?.missionId).toBe(71);
    expect(system.orderEmbodiment?.orderId).toBe(501);
    system.setOrder(null);
    expect(system.missionEmbodiment?.missionId).toBe(71);
    expect(system.orderEmbodiment).toBeNull();
    system.destroy();
  });

  it("falls back to the vector marker when no illustrated texture is supplied", () => {
    const system = new PopulationSystem(populationFixture());
    system.setOrder({
      orderId: 501,
      orderKey: "order:501",
      kind: "pickup",
      label: "Fixture Customer",
      blocked: false,
    });
    // No orderTextures were passed to the constructor — a missing asset can
    // never masquerade as loaded production art.
    expect(system.orderPropVisualState).toBeNull();
    system.destroy();
  });

  it("shows the illustrated idle prop, then swaps to active as Trailblazer enters the staging radius", () => {
    const system = new PopulationSystem(populationFixture(), null, {
      pickupIdle: Texture.WHITE,
      pickupActive: Texture.EMPTY,
    });
    system.setOrder({
      orderId: 501,
      orderKey: "order:501",
      kind: "pickup",
      label: "Fixture Customer",
      blocked: false,
    });
    expect(system.orderPropVisualState).toBe("idle");
    const anchor = system.orderEmbodiment!.anchor;
    // Far away: stays idle.
    system.update({
      now: 0,
      width: 412,
      height: 923,
      playerProgress: anchor.position.progress - 0.5,
      playerLateral: 0,
    });
    expect(system.orderPropVisualState).toBe("idle");
    // Physically inside the authored staging radius: swaps to active.
    system.update({
      now: 200,
      width: 412,
      height: 923,
      playerProgress: anchor.position.progress,
      playerLateral: anchor.position.lateral,
    });
    expect(system.orderPropVisualState).toBe("active");
    system.destroy();
  });

  it("keeps a payment-blocked delivery visually blocked even at point-blank proximity", () => {
    const system = new PopulationSystem(populationFixture(), null, {
      deliveryIdle: Texture.WHITE,
      deliveryActive: Texture.EMPTY,
      deliveryBlocked: Texture.WHITE,
    });
    system.setOrder({
      orderId: 777,
      orderKey: "order:777",
      kind: "delivery",
      label: "Fixture Customer",
      blocked: true,
    });
    expect(system.orderPropVisualState).toBe("blocked");
    const anchor = system.orderEmbodiment!.anchor;
    // Standing right on top of the anchor — the real payment block still
    // wins over proximity; fiction cannot bypass it.
    system.update({
      now: 0,
      width: 412,
      height: 923,
      playerProgress: anchor.position.progress,
      playerLateral: anchor.position.lateral,
    });
    expect(system.orderPropVisualState).toBe("blocked");
    system.destroy();
  });

  it("clears the blocked presentation once authoritative payment state resolves", () => {
    const system = new PopulationSystem(populationFixture(), null, {
      deliveryIdle: Texture.WHITE,
      deliveryActive: Texture.EMPTY,
      deliveryBlocked: Texture.WHITE,
    });
    system.setOrder({
      orderId: 777,
      orderKey: "order:777",
      kind: "delivery",
      label: "Fixture Customer",
      blocked: true,
    });
    expect(system.orderPropVisualState).toBe("blocked");
    // A real refetch reports the order is now paid — same order/anchor, only
    // the authoritative blocked flag changed.
    system.setOrder({
      orderId: 777,
      orderKey: "order:777",
      kind: "delivery",
      label: "Fixture Customer",
      blocked: false,
    });
    expect(system.orderPropVisualState).toBe("idle");
    system.destroy();
  });
});
