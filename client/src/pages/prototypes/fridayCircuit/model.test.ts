import { describe, expect, it } from "vitest";
import { INITIAL, afterLeg, reachable, release, retry, slide, turn, type Junction, type PuzzleState } from "./model";
import { AT, DELIVERY_POINT, circuitRoute } from "./geometry";

/** Turn the junction until it reads `to`. */
function turnTo(state: PuzzleState, to: Junction): PuzzleState {
  let next = state;
  for (let i = 0; i < 3 && next.junction !== to; i += 1) next = turn(next);
  return next;
}
const go = (state: PuzzleState) => afterLeg(state, release(state));

describe("the clockwork circuit", () => {
  it("can be completed clockwise: S → J → P, then P → H → Q on NOW, then Q → J → S", () => {
    let state = turnTo(INITIAL, "west-north");
    state = go(state);
    expect(state).toMatchObject({ at: "P", delivered: false, complete: false });
    state = go(slide(state, "now"));
    expect(state).toMatchObject({ at: "Q", delivered: true, complete: false });
    state = go(turnTo(slide(state, "then"), "west-east"));
    expect(state).toMatchObject({ at: "S", delivered: true, complete: true });
  });

  it("can be completed counterclockwise: S → J → Q, then Q → H → P on NOW, then P → J → S", () => {
    let state = turnTo(INITIAL, "west-east");
    state = go(state);
    expect(state).toMatchObject({ at: "Q", delivered: false });
    state = go(slide(state, "now"));
    expect(state).toMatchObject({ at: "P", delivered: true, complete: false });
    state = go(turnTo(slide(state, "then"), "west-north"));
    expect(state).toMatchObject({ at: "S", delivered: true, complete: true });
  });

  it("can't be completed on either layer alone, and can with both", () => {
    const completes = (layers: Array<"then" | "now">) => reachable(INITIAL, layers).some(state => state.complete);
    expect(completes(["then"])).toBe(false);
    // NOW alone can't even leave the studio
    expect(completes(["now"])).toBe(false);
    expect(reachable(INITIAL, ["now"]).every(state => state.at === "S")).toBe(true);
    expect(completes(["then", "now"])).toBe(true);
  });

  it("stops against the junction when it doesn't admit the courier, and a retry puts it back on its pad, nothing lost", () => {
    const leg = release(INITIAL);
    expect(leg).toEqual({ kind: "blocked", from: "S", side: "west", path: ["S", "J"], carrying: true });
    const stuck = afterLeg(INITIAL, leg);
    expect(stuck.stuck).toBe("west");
    // it can't be released again, or the map slid, until it's back on a pad; the junction still turns
    expect(slide(stuck, "now")).toBe(stuck);
    const turned = turn(stuck);
    expect(turned.junction).toBe("west-north");
    const back = retry(turned);
    expect(back).toMatchObject({ at: "S", stuck: null, junction: "west-north", layer: "then", delivered: false });
    expect(go(back)).toMatchObject({ at: "P" });
  });

  it("released on the wrong layer, the wheels turn and it settles where it was", () => {
    const onNow = slide(INITIAL, "now");
    expect(release(onNow)).toEqual({ kind: "spun", from: "S" });
    expect(go(onNow)).toMatchObject({ at: "S", stuck: null, delivered: false });
  });

  it("delivering isn't coming home, and a return through an unset junction stops there", () => {
    let state = go(turnTo(INITIAL, "west-north"));
    state = go(slide(state, "now"));
    expect(state).toMatchObject({ at: "Q", delivered: true, complete: false });
    // back on THEN with the junction still joining west and north: the courier reaches it from the east and stops
    const back = slide(state, "then");
    const leg = release(back);
    expect(leg).toEqual({ kind: "blocked", from: "Q", side: "east", path: ["Q", "J"], carrying: false });
    const stopped = afterLeg(back, leg);
    expect(stopped).toMatchObject({ stuck: "east", delivered: true, complete: false });
    // a retry keeps the delivery and the configuration
    expect(retry(stopped)).toMatchObject({ at: "Q", delivered: true, layer: "then", junction: "west-north", stuck: null });
  });

  it("coming home without delivering isn't a win, and a finished circuit stays finished", () => {
    const home = go(turnTo(go(turnTo(INITIAL, "west-north")), "west-north"));
    expect(home).toMatchObject({ at: "S", delivered: false, complete: false });
    let won = go(turnTo(INITIAL, "west-east"));
    won = go(slide(won, "now"));
    won = go(turnTo(slide(won, "then"), "west-north"));
    expect(won.complete).toBe(true);
    expect(turn(won)).toBe(won);
    expect(slide(won, "now")).toBe(won);
    expect(retry(won)).toBe(won);
  });

  it("lights the round trip it actually made, from the studio round the hotel and home", () => {
    const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 1;
    for (const homeFrom of ["Q", "P"] as const) {
      const route = circuitRoute(homeFrom);
      expect(near(route[0], AT.S)).toBe(true);
      expect(near(route[route.length - 1], AT.S)).toBe(true);
      expect(route.some(point => near(point, AT.P))).toBe(true);
      expect(route.some(point => near(point, AT.Q))).toBe(true);
      // past the hotel, where the invitation was handed over
      expect(route.some(point => Math.hypot(point.x - DELIVERY_POINT.x, point.y - DELIVERY_POINT.y) < 12)).toBe(true);
    }
    // clockwise when it came home from Q: P comes before Q on the way round
    const clockwise = circuitRoute("Q");
    expect(clockwise.findIndex(point => near(point, AT.P))).toBeLessThan(clockwise.findIndex(point => near(point, AT.Q)));
    const counter = circuitRoute("P");
    expect(counter.findIndex(point => near(point, AT.Q))).toBeLessThan(counter.findIndex(point => near(point, AT.P)));
  });
});
