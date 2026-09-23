import { describe, expect, it } from "vitest";
import { DECK_FOLLOW, facingFor, followSpot, stepFollow, type RookFollowState } from "./rookBrain";

const anywhere = () => true;

function run(state: RookFollowState, player: { x: number; y: number }, seconds: number, walkable = anywhere) {
  let s = state;
  for (let t = 0; t < seconds; t += 1 / 60) s = stepFollow(s, player, "back", 150, 1 / 60, DECK_FOLLOW, walkable);
  return s;
}

describe("Rook keeps up on his own two feet", () => {
  it("walks to his spot beside and behind her, then stands", () => {
    const start: RookFollowState = { position: { x: 200, y: 600 }, facing: "back", moving: false, stillFor: 0, side: 1 };
    const player = { x: 700, y: 520 };
    const after = run(start, player, 6);
    const spot = followSpot(player, "back", after.side, DECK_FOLLOW);
    expect(Math.hypot(after.position.x - spot.x, after.position.y - spot.y)).toBeLessThan(DECK_FOLLOW.startDistance);
    expect(after.moving).toBe(false);
  });

  it("does not walk where there is no deck", () => {
    const start: RookFollowState = { position: { x: 300, y: 600 }, facing: "back", moving: false, stillFor: 0, side: 1 };
    const walkable = (p: { x: number; y: number }) => p.x < 500;
    const after = run(start, { x: 900, y: 600 }, 6, walkable);
    expect(after.position.x).toBeLessThan(500);
  });

  it("turns to face her once he has stood still a moment", () => {
    let s: RookFollowState = { position: { x: 600, y: 600 }, facing: "back", moving: false, stillFor: 0, side: 1 };
    for (let t = 0; t < 2; t += 1 / 60) s = stepFollow(s, { x: 540, y: 600 }, "right", 0, 1 / 60, { ...DECK_FOLLOW, startDistance: 999 }, anywhere);
    expect(s.facing).toBe("left");
  });

  it("faces the way he walks", () => {
    expect(facingFor({ x: -10, y: 1 }, "front")).toBe("left");
    expect(facingFor({ x: 1, y: -10 }, "front")).toBe("back");
    expect(facingFor({ x: 0, y: 0 }, "right")).toBe("right");
  });
});
