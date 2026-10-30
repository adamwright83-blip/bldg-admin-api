/**
 * Prototype, not story canon: "The Friday That Didn't Exist" as a small clockwork machine (Adam's brief, 2026-10-30).
 * A courier on a tabletop map, two map layers (THEN and NOW) that slide beneath fixed docking pads, and one rotating
 * junction. Neither layer holds a whole circuit: the courier needs THEN's tracks to leave and come home, and NOW's to
 * reach the hotel. Isolated from onboarding; built to be revised or thrown away cheaply.
 *
 *            P ───────── H
 *             │           │
 *   S ─────── J ───────── Q
 *
 * S studio (start and finish), J junction, P upper pad, H hotel (a bend, not a stop), Q lower pad.
 */

export type Pad = "S" | "P" | "Q";
export type Layer = "then" | "now";
export type Side = "west" | "north" | "east";
/** The junction's three positions, named by the sides they join: west–north joins S and P, and so on. */
export type Junction = "west-north" | "west-east" | "north-east";

/** Clicking the junction turns it to the next position, round and round. */
export const JUNCTION_TURNS: readonly Junction[] = ["north-east", "west-north", "west-east"];

/** The side of the junction each pad's track arrives at. */
const SIDE_OF: Record<Pad, Side> = { S: "west", P: "north", Q: "east" };
const PAD_AT: Record<Side, Pad> = { west: "S", north: "P", east: "Q" };

/** The track leaving each pad on each layer. THEN: S–J, J–P, J–Q. NOW: P–H, H–Q. S has nothing on NOW. */
const LEAVES: Record<Layer, Record<Pad, "J" | "H" | null>> = {
  then: { S: "J", P: "J", Q: "J" },
  now: { S: null, P: "H", Q: "H" },
};

export type PuzzleState = {
  layer: Layer;
  junction: Junction;
  /** the pad the courier is docked at, or was released from while it's stopped at the junction */
  at: Pad;
  /** the invitation has been delivered at the hotel */
  delivered: boolean;
  /** stopped against the junction, on the side it arrived at, until the player retries */
  stuck: Side | null;
  /** where the last leg began, for "retry the last leg" */
  lastPad: Pad | null;
  /** delivered and home */
  complete: boolean;
};

export const INITIAL: PuzzleState = { layer: "then", junction: "north-east", at: "S", delivered: false, stuck: null, lastPad: null, complete: false };

/** What one release does. The path names the places the courier passes, in order. */
export type Leg =
  | { kind: "docked"; from: Pad; to: Pad; path: Array<Pad | "J" | "H">; delivers: boolean }
  /** reached the junction on a side the junction doesn't join */
  | { kind: "blocked"; from: Pad; side: Side; path: Array<Pad | "J">; carrying: boolean }
  /** nothing to run on from this pad, on this layer: the wheels turn, and it settles */
  | { kind: "spun"; from: Pad };

export function joins(junction: Junction, side: Side): Side | null {
  const [a, b] = junction.split("-") as [Side, Side];
  return side === a ? b : side === b ? a : null;
}

/** What happens when the courier is wound and released from its pad. */
export function release(state: PuzzleState): Leg {
  const from = state.at;
  const next = LEAVES[state.layer][from];
  if (!next) return { kind: "spun", from };
  if (next === "H") {
    // the hotel is a bend: the invitation is delivered on the way to the other pad
    const to: Pad = from === "P" ? "Q" : "P";
    return { kind: "docked", from, to, path: [from, "H", to], delivers: true };
  }
  const side = SIDE_OF[from];
  const out = joins(state.junction, side);
  if (!out) return { kind: "blocked", from, side, path: [from, "J"], carrying: !state.delivered };
  const to = PAD_AT[out];
  return { kind: "docked", from, to, path: [from, "J", to], delivers: false };
}

/** The state once a leg has played out. */
export function afterLeg(state: PuzzleState, leg: Leg): PuzzleState {
  if (leg.kind === "spun") return { ...state, stuck: null };
  if (leg.kind === "blocked") return { ...state, stuck: leg.side, lastPad: leg.from };
  const delivered = state.delivered || leg.delivers;
  return { ...state, at: leg.to, delivered, stuck: null, lastPad: leg.from, complete: delivered && leg.to === "S" };
}

export function canRelease(state: PuzzleState): boolean {
  return !state.stuck && !state.complete;
}

/** Layers change only while the courier is docked, and changing them never moves it. */
export function slide(state: PuzzleState, layer: Layer): PuzzleState {
  if (state.stuck || state.complete) return state;
  return { ...state, layer };
}

/** The junction turns whenever the courier isn't running, including while it's stopped against it. */
export function turn(state: PuzzleState): PuzzleState {
  if (state.complete) return state;
  const index = JUNCTION_TURNS.indexOf(state.junction);
  return { ...state, junction: JUNCTION_TURNS[(index + 1) % JUNCTION_TURNS.length] };
}

/** Back to the pad the last leg began at. The delivery, the layer and the junction stay as they are. */
export function retry(state: PuzzleState): PuzzleState {
  if (!state.lastPad || state.complete) return state;
  return { ...state, at: state.lastPad, stuck: null };
}

/** Every state the machine can reach, and whether a whole circuit is among them. For checking, not for play. */
export function reachable(start: PuzzleState, layers: readonly Layer[] = ["then", "now"]): PuzzleState[] {
  const key = (state: PuzzleState) => `${state.layer}|${state.junction}|${state.at}|${state.delivered}|${state.stuck ?? ""}|${state.complete}`;
  const seen = new Map<string, PuzzleState>([[key(start), start]]);
  const queue = [start];
  while (queue.length) {
    const state = queue.shift()!;
    const moves = [
      turn(state),
      ...layers.map(layer => slide(state, layer)),
      ...(canRelease(state) ? [afterLeg(state, release(state))] : []),
      retry(state),
    ];
    for (const next of moves) {
      if (!layers.includes(next.layer) || seen.has(key(next))) continue;
      seen.set(key(next), next);
      queue.push(next);
    }
  }
  return [...seen.values()];
}
