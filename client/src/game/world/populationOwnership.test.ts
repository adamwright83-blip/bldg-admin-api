import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { PopulationSystem } from "./PopulationSystem";
import type { CorridorPopulation } from "../../../../shared/corridorManifest";
import type { AuthoritativeMissionForEmbodiment } from "./populationProjection";
import type { AuthoritativeOrderForEmbodiment } from "./populationProjection";

/**
 * PopulationSystem ownership must survive being reparented into a shared
 * external actor host. Before this fix, setMission/setOrder/setAgentPresence
 * cleared their OWN nested layer (missionLayer/orderLayer/capabilityLayer),
 * which no longer parented the actor once attachActorHost had moved it — so
 * the old actor was orphaned in the shared host instead of destroyed. The
 * sharpest case: completing a real pickup calls setOrder(null), and the old
 * visible pickup marker had nowhere to disappear from.
 */

const EMPTY_POPULATION: CorridorPopulation = {
  ambient: [],
  missionAnchorPoints: [
    { id: "anchor-1", progress: 0.4, lateral: 0.1 },
    { id: "anchor-2", progress: 0.6, lateral: -0.1 },
  ],
  assetStage: "engineering_placeholder",
};

function order(id: number): AuthoritativeOrderForEmbodiment {
  return {
    orderId: id,
    orderKey: `order:${id}`,
    kind: "pickup",
    label: `Order #${id}`,
    blocked: false,
  } as AuthoritativeOrderForEmbodiment;
}

function mission(id: number): AuthoritativeMissionForEmbodiment {
  return {
    missionId: id,
    missionKey: `mission:${id}`,
    archetype: "STALLER",
    state: "active",
    affordance: "VISIT",
    worldSignal: "threshold",
  } as AuthoritativeMissionForEmbodiment;
}

describe("owned actors survive reparenting into a shared host", () => {
  it("removes the old order actor from the external host on setOrder(null)", () => {
    const pop = new PopulationSystem(EMPTY_POPULATION);
    const host = new Container();
    pop.attachActorHost(host);

    pop.setOrder(order(630031));
    expect(host.children.length).toBeGreaterThan(0);
    const before = host.children.length;

    pop.setOrder(null);
    // The Phase-E requirement: real completion must not leave the old
    // pickup marker sitting in the world.
    expect(host.children.length).toBeLessThan(before);
  });

  it("destroys A and leaves exactly one B visible when order changes", () => {
    const pop = new PopulationSystem(EMPTY_POPULATION);
    const host = new Container();
    pop.attachActorHost(host);

    pop.setOrder(order(1));
    const afterA = host.children.length;
    pop.setOrder(order(2));
    const afterB = host.children.length;

    // Replacing, not accumulating.
    expect(afterB).toBe(afterA);
  });

  it("destroys the old mission actor and keeps the new one depth-sortable in the host", () => {
    const pop = new PopulationSystem(EMPTY_POPULATION);
    const host = new Container();
    pop.attachActorHost(host);

    pop.setMission(mission(1));
    const afterA = host.children.length;
    pop.setMission(mission(2));
    const afterB = host.children.length;

    expect(afterB).toBe(afterA);
    expect(host.children.every(c => c.parent === host)).toBe(true);
  });

  it("keeps capability stations reading from an explicit ownership record", () => {
    const pop = new PopulationSystem(EMPTY_POPULATION);
    const host = new Container();
    pop.attachActorHost(host);

    pop.setAgentPresence([
      { agentId: "SCOUT", hasAuthoritativeSignal: true } as never,
    ]);
    const before = host.children.length;

    // A second call must replace, not read stale indices out of a
    // container the stations no longer live in.
    pop.setAgentPresence([
      { agentId: "SCOUT", hasAuthoritativeSignal: false } as never,
      { agentId: "INTEL", hasAuthoritativeSignal: true } as never,
    ]);
    expect(host.children.length).toBeGreaterThan(before);
  });

  it("leaves no owned actor in the host after destroy()", () => {
    const pop = new PopulationSystem(EMPTY_POPULATION);
    const host = new Container();
    pop.attachActorHost(host);

    pop.setOrder(order(1));
    pop.setMission(mission(1));
    pop.setAgentPresence([
      { agentId: "SCOUT", hasAuthoritativeSignal: true } as never,
    ]);
    expect(host.children.length).toBeGreaterThan(0);

    pop.destroy();
    expect(host.children.length).toBe(0);
    // The host itself must survive — destroy() must never destroy what it
    // does not own.
    expect(host.destroyed).toBe(false);
  });

  it("attachActorHost is idempotent — repeated calls do not duplicate actors", () => {
    const pop = new PopulationSystem(EMPTY_POPULATION);
    const host = new Container();
    pop.setOrder(order(1));

    pop.attachActorHost(host);
    const first = host.children.length;
    pop.attachActorHost(host);
    expect(host.children.length).toBe(first);
  });

  it("hides duplicate presentation without deleting the underlying business object", () => {
    const pop = new PopulationSystem(EMPTY_POPULATION);
    const host = new Container();
    pop.attachActorHost(host);
    pop.setOrder(order(1));

    pop.setExpeditionPresentation(true);
    expect(pop.orderEmbodiment).not.toBeNull();

    pop.setExpeditionPresentation(false);
    expect(pop.orderEmbodiment).not.toBeNull();
  });
});
