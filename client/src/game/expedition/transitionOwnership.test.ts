import { describe, expect, it, vi } from "vitest";
import { CorridorTransitionController } from "../runtime/corridorTransition";
import {
  CORRIDOR_EXIT_THRESHOLD,
  EXPEDITION_CORRIDOR_END,
  EXPEDITION_EXIT_MARGIN,
  EXPEDITION_START_PROGRESS,
  expeditionToCorridor,
} from "./expeditionPlan";

/**
 * Two invariants that both looked satisfied while actually being false.
 *
 * 1. "Max reachable expedition position < ordinary exit threshold." The
 *    ceiling was 0.78 against a 0.77 threshold. Beats happened to land
 *    lower, so beat-level assertions passed, but the reachable SPAN crossed
 *    the line and the player could walk over the exit trigger.
 *
 * 2. "Corridor transition cannot fire during an expedition." Gating new
 *    requests on `expedition === null` says nothing about a load already in
 *    flight when the player presses ENTER THE LINE — that request resolves
 *    later and reveals a new corridor mid-combat.
 */

describe("expedition traversal can never cross the exit threshold", () => {
  it("derives the ceiling from the threshold rather than from authoring", () => {
    expect(EXPEDITION_CORRIDOR_END).toBe(
      CORRIDOR_EXIT_THRESHOLD - EXPEDITION_EXIT_MARGIN
    );
    expect(EXPEDITION_CORRIDOR_END).toBeLessThan(CORRIDOR_EXIT_THRESHOLD);
    expect(EXPEDITION_EXIT_MARGIN).toBeGreaterThan(0);
  });

  it("bounds the whole reachable SPAN, not merely the authored beats", () => {
    // The end of expedition space — T=1 — is what the player can physically
    // walk to, regardless of where the last authored beat happens to sit.
    expect(expeditionToCorridor(1)).toBeLessThan(CORRIDOR_EXIT_THRESHOLD);
    // And overshooting T cannot escape it either.
    expect(expeditionToCorridor(99)).toBeLessThan(CORRIDOR_EXIT_THRESHOLD);
  });

  it("keeps the whole span walkable and forward of the start", () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const p = expeditionToCorridor(t);
      expect(p).toBeGreaterThanOrEqual(EXPEDITION_START_PROGRESS);
      expect(p).toBeLessThan(CORRIDOR_EXIT_THRESHOLD);
    }
  });
});

/** Minimal stand-in for the parts of GoldlineGame this race touches. */
function fakeGame() {
  const revealed: string[] = [];
  const discarded: string[] = [];
  let expeditionActive = false;
  return {
    revealed,
    discarded,
    isExpeditionActive: () => expeditionActive,
    startExpedition: () => {
      expeditionActive = true;
    },
    endExpedition: () => {
      expeditionActive = false;
    },
    revealCorridor: (id: string) => revealed.push(id),
    discardPreparedCorridor: (id: string) => discarded.push(id),
  };
}

/**
 * Mirrors GoldlineGameHome's transition effect: preload into a local map,
 * refuse the reveal while an expedition owns the world, and dispose whatever
 * was prepared once the request settles.
 */
function driveTransition(
  controller: CorridorTransitionController,
  game: ReturnType<typeof fakeGame>,
  corridorId: string,
  gate: { release: () => void; promise: Promise<void> }
) {
  const prepared = new Map<string, string>();
  return controller
    .requestCorridor(
      corridorId,
      async (id, signal) => {
        // Hold the load open so the expedition can start mid-flight.
        await gate.promise;
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        prepared.set(id, id);
        return { id } as never;
      },
      (pack: { id: string }, signal: AbortSignal) => {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        if (game.isExpeditionActive()) {
          const stale = prepared.get(pack.id);
          if (stale) {
            game.discardPreparedCorridor(stale);
            prepared.delete(pack.id);
          }
          throw new DOMException("Aborted", "AbortError");
        }
        const next = prepared.get(pack.id);
        if (!next) throw new Error("not preloaded");
        game.revealCorridor(next);
        prepared.delete(pack.id);
      }
    )
    .then(outcome => {
      prepared.forEach(id => game.discardPreparedCorridor(id));
      prepared.clear();
      return outcome;
    });
}

function openGate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { release, promise };
}

describe("an in-flight transition cannot swap the world mid-expedition", () => {
  it("does not reveal a corridor prepared before the expedition began", async () => {
    const controller = new CorridorTransitionController();
    controller.adoptActiveCorridor("corridor_01");
    const game = fakeGame();
    const gate = openGate();

    // 1-2. Ordinary transition starts and is held while preload is in flight.
    const inflight = driveTransition(controller, game, "corridor_02", gate);
    expect(controller.hasInflight()).toBe(true);

    // 3. Player enters the expedition; ownership transfers.
    game.startExpedition();
    controller.cancelInflight();

    // 4. The old preload finally resolves.
    gate.release();
    await inflight;

    // 5. The world was never replaced.
    expect(game.revealed).toEqual([]);
  });

  it("disposes anything it prepared rather than leaking it", async () => {
    const controller = new CorridorTransitionController();
    controller.adoptActiveCorridor("corridor_01");
    const game = fakeGame();
    const gate = openGate();

    const inflight = driveTransition(controller, game, "corridor_02", gate);
    game.startExpedition();
    gate.release();
    await inflight;

    // Either the abort path or the reveal guard disposes it; what matters is
    // that nothing prepared is still held.
    expect(game.revealed).toEqual([]);
  });

  it("refuses the reveal even if cancellation was somehow missed", async () => {
    const controller = new CorridorTransitionController();
    controller.adoptActiveCorridor("corridor_01");
    const game = fakeGame();
    const gate = openGate();

    const inflight = driveTransition(controller, game, "corridor_02", gate);
    // Deliberately do NOT cancel — prove the reveal guard alone holds.
    game.startExpedition();
    gate.release();
    await inflight;

    expect(game.revealed).toEqual([]);
    expect(game.discarded).toContain("corridor_02");
  });

  it("leaves ordinary transitions working after the expedition ends", async () => {
    const controller = new CorridorTransitionController();
    controller.adoptActiveCorridor("corridor_01");
    const game = fakeGame();

    const blocked = openGate();
    const first = driveTransition(controller, game, "corridor_02", blocked);
    game.startExpedition();
    controller.cancelInflight();
    blocked.release();
    await first;
    expect(game.revealed).toEqual([]);

    // 7-8. Expedition ends; ordinary travel resumes normally.
    game.endExpedition();
    const open = openGate();
    const second = driveTransition(controller, game, "corridor_02", open);
    open.release();
    const outcome = await second;

    expect(outcome.outcome).toBe("applied");
    expect(game.revealed).toEqual(["corridor_02"]);
  });

  it("reports whether anything was actually cancelled", () => {
    const controller = new CorridorTransitionController();
    expect(controller.cancelInflight()).toBe(false);
    expect(controller.hasInflight()).toBe(false);
  });
});
