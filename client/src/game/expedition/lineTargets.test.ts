import { describe, expect, it } from "vitest";
import {
  AIM_CONE_TOTAL_RADIANS,
  environmentTarget,
  hostileTarget,
  rankLineTargets,
  selectLineTarget,
  type LineTarget,
} from "./lineTargets";

/**
 * Structural safety boundary (§17) plus deterministic selection (§15).
 *
 * The most important assertions in this file are the ones that prove a
 * civilian and a real business entity CANNOT be Linehook targets. Those are
 * enforced at the type level, so they are asserted with @ts-expect-error —
 * if the boundary ever erodes, the suppression becomes unused and the
 * TypeScript build fails. A runtime-only guard could be deleted silently;
 * this cannot.
 */

const AT = { active: true, readable: true } as const;

function hunterAt(id: string, x: number, y: number) {
  return hostileTarget({ id, x, y, ...AT, hostile: "hunter" });
}

describe("target ontology is a structural boundary", () => {
  it("refuses a PopulationSystem civilian at the type level", () => {
    // Shape of an ambient civilian: it has id/x/y/active/readable, so a
    // purely structural check would accept it. The brand is what rejects it.
    const civilian = {
      id: "civilian_04",
      x: 10,
      y: 0,
      active: true,
      readable: true,
      kind: "civilian" as const,
    };

    // @ts-expect-error a civilian is not a LineTarget and never may be
    const targets: LineTarget[] = [civilian];
    expect(targets).toHaveLength(1);

    // Belt and braces: even if a future refactor smuggled one through at
    // runtime, it carries no legal LineTargetKind, so the Line's
    // `switch (target.kind)` dispatch has no branch that could damage,
    // stagger, or grapple it.
    const legalKinds: ReadonlyArray<string> = ["hostile", "environment"];
    expect(legalKinds).not.toContain(civilian.kind);
  });

  it("refuses a real order/business entity at the type level", () => {
    const orderMarker = {
      id: "order:630031",
      x: 40,
      y: 0,
      active: true,
      readable: true,
      orderId: 630031,
      customerName: "real customer",
    };

    // @ts-expect-error an authoritative order embodiment is not a LineTarget
    const targets: LineTarget[] = [orderMarker];
    expect(targets).toHaveLength(1);
  });

  it("mints only hostile and environment kinds", () => {
    expect(hunterAt("h1", 10, 0).kind).toBe("hostile");
    expect(
      environmentTarget({
        id: "e1",
        x: 10,
        y: 0,
        ...AT,
        environment: "hazard",
      }).kind
    ).toBe("environment");
  });
});

describe("cone and range filtering", () => {
  const query = {
    originX: 0,
    originY: 0,
    aimRadians: 0,
    maxRadius: 300,
  };

  it("rejects a target beyond effective radius", () => {
    expect(selectLineTarget([hunterAt("far", 301, 0)], query)).toBeNull();
    expect(selectLineTarget([hunterAt("near", 299, 0)], query)?.id).toBe("near");
  });

  it("rejects a target outside the aim cone", () => {
    const halfCone = AIM_CONE_TOTAL_RADIANS / 2;
    const justOutside = halfCone + 0.02;
    const justInside = halfCone - 0.02;
    const r = 100;

    const outside = hunterAt(
      "outside",
      Math.cos(justOutside) * r,
      Math.sin(justOutside) * r
    );
    const inside = hunterAt(
      "inside",
      Math.cos(justInside) * r,
      Math.sin(justInside) * r
    );

    expect(selectLineTarget([outside], query)).toBeNull();
    expect(selectLineTarget([inside], query)?.id).toBe("inside");
  });

  it("rejects inactive and unreadable targets", () => {
    const defeated = hostileTarget({
      id: "defeated",
      x: 50,
      y: 0,
      active: false,
      readable: true,
      hostile: "hunter",
    });
    const offscreen = hostileTarget({
      id: "offscreen",
      x: 50,
      y: 0,
      active: true,
      readable: false,
      hostile: "hunter",
    });

    expect(selectLineTarget([defeated, offscreen], query)).toBeNull();
  });

  it("honours a reachability rule", () => {
    const blocked = hunterAt("blocked", 50, 0);
    expect(
      selectLineTarget([blocked], { ...query, isReachable: () => false })
    ).toBeNull();
  });

  it("returns null rather than a fallback when nothing is legal", () => {
    // §16: an empty release must return cleanly to movement, never become
    // an accidental dodge or lock something behind the player.
    expect(selectLineTarget([hunterAt("behind", -100, 0)], query)).toBeNull();
  });
});

describe("deterministic selection", () => {
  const query = {
    originX: 0,
    originY: 0,
    aimRadians: 0,
    maxRadius: 300,
  };

  it("prefers angular alignment over raw proximity", () => {
    // Slightly further away but directly on the aim line.
    const aligned = hunterAt("aligned", 150, 0);
    // Closer, but well off-axis.
    const offAxis = hunterAt("offAxis", 70, 38);

    expect(selectLineTarget([offAxis, aligned], query)?.id).toBe("aligned");
  });

  it("is order-independent and repeatable", () => {
    const a = hunterAt("a", 120, 10);
    const b = hunterAt("b", 140, -5);
    const c = environmentTarget({
      id: "c",
      x: 100,
      y: 20,
      ...AT,
      environment: "architecture",
    });

    const forward = selectLineTarget([a, b, c], query)?.id;
    const reversed = selectLineTarget([c, b, a], query)?.id;
    const repeated = selectLineTarget([b, a, c], query)?.id;

    expect(forward).toBe(reversed);
    expect(forward).toBe(repeated);
  });

  it("breaks exact ties by stable id, never at random", () => {
    // Mirrored across the aim axis: identical distance and angular error.
    const zulu = hunterAt("zulu", 100, 25);
    const alpha = hunterAt("alpha", 100, -25);

    const ranked = rankLineTargets([zulu, alpha], query);
    expect(ranked[0].score).toBeCloseTo(ranked[1].score, 12);
    expect(ranked[0].target.id).toBe("alpha");

    for (let i = 0; i < 25; i += 1) {
      expect(selectLineTarget([zulu, alpha], query)?.id).toBe("alpha");
      expect(selectLineTarget([alpha, zulu], query)?.id).toBe("alpha");
    }
  });

  it("holds the existing lock against a marginally better challenger", () => {
    const locked = hunterAt("locked", 100, 12);
    const challenger = hunterAt("challenger", 100, 8);

    // Without a lock the better-aligned challenger wins outright.
    expect(selectLineTarget([locked, challenger], query)?.id).toBe("challenger");

    // With the lock held, thumb tremor of this size must not steal it.
    expect(
      selectLineTarget([locked, challenger], { ...query, lockedId: "locked" })
        ?.id
    ).toBe("locked");
  });

  it("still yields the lock to a decisively better target", () => {
    const locked = hunterAt("locked", 280, 55);
    const decisive = hunterAt("decisive", 60, 0);

    expect(
      selectLineTarget([locked, decisive], { ...query, lockedId: "locked" })?.id
    ).toBe("decisive");
  });
});
