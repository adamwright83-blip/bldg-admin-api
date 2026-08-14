import { describe, expect, it } from "vitest";
import { CORRIDOR_TRIGGERS, pendingTrigger } from "./RouteCorridor";

/**
 * A real Android player reported JUMP/CLIMB/VAULT prompts with no visible
 * obstacle. Investigation confirmed fallen-arch/white-stone/water-gap were
 * pure percentage gates with zero corresponding manifest landmark, sprite,
 * or occlusion geometry anywhere near their positions. "Ordinary movement
 * is better than fake platforming" — those three triggers were removed
 * rather than given fake programmer-art geometry. This guards against
 * either reintroducing them, or adding a new invisible gate the same way.
 */
describe("CORRIDOR_TRIGGERS — every remaining trigger must have visible backing geometry", () => {
  it("no longer contains the unsupported fallen-arch/white-stone/water-gap gates", () => {
    const ids = CORRIDOR_TRIGGERS.map(trigger => trigger.id);
    expect(ids).not.toContain("fallen-arch");
    expect(ids).not.toContain("white-stone");
    expect(ids).not.toContain("water-gap");
  });

  it("no longer produces a JUMP, CLIMB, or VAULT action from any trigger", () => {
    const actions = CORRIDOR_TRIGGERS.map(trigger => trigger.action);
    expect(actions).not.toContain("JUMP");
    expect(actions).not.toContain("CLIMB");
    expect(actions).not.toContain("VAULT");
  });

  it("keeps only fortress-gate, which renders real always-visible gate geometry in GoldlineGame.ts", () => {
    expect(CORRIDOR_TRIGGERS).toHaveLength(1);
    expect(CORRIDOR_TRIGGERS[0]?.id).toBe("fortress-gate");
    expect(CORRIDOR_TRIGGERS[0]?.action).toBe("INTERACT");
  });

  it("pendingTrigger never returns a JUMP/CLIMB/VAULT trigger at any progress value", () => {
    for (let progress = 0; progress <= 1; progress += 0.05) {
      const trigger = pendingTrigger(progress, new Set());
      if (trigger) {
        expect(["INTERACT"]).toContain(trigger.action);
      }
    }
  });

  it("free movement is never blocked before the fortress-gate's own position", () => {
    // Progress values that used to sit behind the removed fallen-arch
    // (0.24) and white-stone (0.43) gates must now report no trigger at
    // all, since nothing legitimate blocks movement there.
    expect(pendingTrigger(0.25, new Set())).toBeNull();
    expect(pendingTrigger(0.45, new Set())).toBeNull();
    expect(pendingTrigger(0.65, new Set())).toBeNull();
  });
});
