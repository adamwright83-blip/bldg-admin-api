import { describe, expect, it, vi } from "vitest";
import {
  CorridorTransitionController,
  type CorridorTransitionPhase,
} from "./corridorTransition";
import type { ResolvedCorridorPack } from "../world/corridorPack";

function pack(id: string): ResolvedCorridorPack {
  return {
    id,
    version: 1,
    stage: "playable",
    visualReview: {
      status: "approved",
      reviewedAt: "2026-08-12T00:00:00.000Z",
      reviewer: "test",
    },
    basePath: `/assets/goldline/${id}`,
    assets: {
      far: null,
      mid: `/assets/goldline/${id}/mid.webp`,
      foreground: null,
      effects: null,
      portal: null,
      stronghold: null,
      waterfallVideo: null,
    },
    data: {
      traversal: `/assets/goldline/${id}/traversal.json`,
      occlusion: `/assets/goldline/${id}/occlusion.json`,
      goldRoute: `/assets/goldline/${id}/gold_route.json`,
    },
    parallax: { far: 0.1, mid: 0.45 },
    landmarks: [],
    population: {
      assetStage: "engineering_placeholder",
      atlas: null,
      ambient: [],
      missionAnchorPoints: [],
    },
    capabilities: {
      coldCallPortal: false,
      stronghold: false,
      missionSources: [],
    },
    loadPriority: { critical: [], deferred: [] },
  };
}

/** A loader whose completion the test controls explicitly. */
function deferredLoader() {
  const resolvers = new Map<string, (value: ResolvedCorridorPack) => void>();
  const rejecters = new Map<string, (reason: unknown) => void>();
  const loader = (corridorId: string) =>
    new Promise<ResolvedCorridorPack>((resolvePromise, rejectPromise) => {
      resolvers.set(corridorId, resolvePromise);
      rejecters.set(corridorId, rejectPromise);
    });
  return {
    loader,
    finish: (corridorId: string) =>
      resolvers.get(corridorId)!(pack(corridorId)),
    fail: (corridorId: string, error: Error) =>
      rejecters.get(corridorId)!(error),
  };
}

describe("CorridorTransitionController", () => {
  it("applies a corridor that loads cleanly", async () => {
    const controller = new CorridorTransitionController();
    const result = await controller.requestCorridor("corridor_01", async id =>
      pack(id)
    );

    expect(result.outcome).toBe("applied");
    expect(controller.getActiveCorridorId()).toBe("corridor_01");
    expect(controller.getPhase()).toBe("ready");
  });

  it("never blanks the world: no phase between signaling and revealing implies an empty canvas", async () => {
    const phases: CorridorTransitionPhase[] = [];
    const controller = new CorridorTransitionController({
      onPhaseChange: phase => phases.push(phase),
    });

    await controller.requestCorridor("corridor_01", async id => pack(id));

    // The old corridor stays rendered through signaling and loading; only
    // `revealing` hands off. There is deliberately no "blank"/"unloaded" phase
    // for a caller to render a black screen against.
    expect(phases).toEqual(["signaling", "loading", "revealing", "ready"]);
  });

  it("runs the reveal seam after preload and before declaring the destination active", async () => {
    const controller = new CorridorTransitionController();
    controller.adoptActiveCorridor("corridor_01");
    const observations: string[] = [];

    const result = await controller.requestCorridor(
      "corridor_02",
      async id => {
        observations.push("loaded");
        return pack(id);
      },
      destination => {
        observations.push(`revealed:${destination.id}`);
        expect(controller.getActiveCorridorId()).toBe("corridor_01");
        expect(controller.getPhase()).toBe("revealing");
      }
    );

    expect(result.outcome).toBe("applied");
    expect(observations).toEqual(["loaded", "revealed:corridor_02"]);
    expect(controller.getActiveCorridorId()).toBe("corridor_02");
  });

  it("keeps the current corridor active when reveal itself fails", async () => {
    const controller = new CorridorTransitionController();
    controller.adoptActiveCorridor("corridor_01");

    const result = await controller.requestCorridor(
      "corridor_02",
      async id => pack(id),
      () => {
        throw new Error("critical texture unavailable");
      }
    );

    expect(result.outcome).toBe("failed");
    expect(controller.getActiveCorridorId()).toBe("corridor_01");
    expect(controller.getPhase()).toBe("ready");
  });

  describe("stale-load rejection", () => {
    it("a late corridor_A load can never replace a newer corridor_B request", async () => {
      const controller = new CorridorTransitionController();
      const deferred = deferredLoader();

      const first = controller.requestCorridor("corridor_A", deferred.loader);
      const second = controller.requestCorridor("corridor_B", deferred.loader);

      // B finishes first, then the stale A resolves afterwards.
      deferred.finish("corridor_B");
      expect((await second).outcome).toBe("applied");

      deferred.finish("corridor_A");
      const firstResult = await first;

      expect(firstResult.outcome).toBe("superseded");
      expect(controller.getActiveCorridorId()).toBe("corridor_B");
    });

    it("aborts the superseded load rather than letting it run to completion", async () => {
      const controller = new CorridorTransitionController();
      const signals: AbortSignal[] = [];
      const loader = (id: string, signal: AbortSignal) => {
        signals.push(signal);
        return new Promise<ResolvedCorridorPack>(resolvePromise => {
          if (id === "corridor_B") resolvePromise(pack(id));
        });
      };

      void controller.requestCorridor("corridor_A", loader);
      await controller.requestCorridor("corridor_B", loader);

      expect(signals[0]!.aborted).toBe(true);
      expect(signals[1]!.aborted).toBe(false);
    });

    it("a stale failure does not disturb the corridor that superseded it", async () => {
      const controller = new CorridorTransitionController();
      const deferred = deferredLoader();

      const first = controller.requestCorridor("corridor_A", deferred.loader);
      const second = controller.requestCorridor("corridor_B", deferred.loader);

      deferred.finish("corridor_B");
      await second;

      deferred.fail("corridor_A", new Error("network died"));
      expect((await first).outcome).toBe("superseded");
      expect(controller.getActiveCorridorId()).toBe("corridor_B");
      expect(controller.getPhase()).toBe("ready");
    });
  });

  describe("failure leaves the player where they were", () => {
    it("keeps the current corridor active when the next one fails to load", async () => {
      const controller = new CorridorTransitionController();
      await controller.requestCorridor("corridor_01", async id => pack(id));

      const result = await controller.requestCorridor(
        "corridor_broken",
        async () => {
          throw new Error("manifest is invalid");
        }
      );

      expect(result.outcome).toBe("failed");
      // The world the player is standing in is untouched.
      expect(controller.getActiveCorridorId()).toBe("corridor_01");
      expect(controller.getPhase()).toBe("ready");
    });

    it("reports the underlying error rather than swallowing it", async () => {
      const controller = new CorridorTransitionController();
      const result = await controller.requestCorridor(
        "corridor_broken",
        async () => {
          throw new Error("manifest is invalid");
        }
      );

      expect(result.outcome).toBe("failed");
      if (result.outcome === "failed") {
        expect(result.error.message).toBe("manifest is invalid");
      }
    });
  });

  it("short-circuits a request for the corridor already being stood in", async () => {
    const controller = new CorridorTransitionController();
    await controller.requestCorridor("corridor_01", async id => pack(id));

    const loader = vi.fn(async (id: string) => pack(id));
    const result = await controller.requestCorridor("corridor_01", loader);

    expect(result.outcome).toBe("already_active");
    expect(loader).not.toHaveBeenCalled();
  });

  it("adoptActiveCorridor marks the boot corridor without loading anything", () => {
    const controller = new CorridorTransitionController();
    controller.adoptActiveCorridor("corridor_01");

    expect(controller.getActiveCorridorId()).toBe("corridor_01");
    expect(controller.getPhase()).toBe("ready");
  });

  describe("disposal", () => {
    it("a load that lands after dispose can never be applied", async () => {
      const controller = new CorridorTransitionController();
      const deferred = deferredLoader();

      const pending = controller.requestCorridor(
        "corridor_01",
        deferred.loader
      );
      controller.dispose();
      deferred.finish("corridor_01");

      const result = await pending;
      expect(result.outcome).not.toBe("applied");
      expect(controller.getActiveCorridorId()).toBeNull();
    });

    it("aborts the in-flight load on dispose", async () => {
      const controller = new CorridorTransitionController();
      let captured: AbortSignal | null = null;
      void controller.requestCorridor("corridor_01", (_id, signal) => {
        captured = signal;
        return new Promise<ResolvedCorridorPack>(() => {});
      });

      controller.dispose();
      expect(captured!.aborted).toBe(true);
    });

    it("refuses new requests once disposed", async () => {
      const controller = new CorridorTransitionController();
      controller.dispose();

      const loader = vi.fn(async (id: string) => pack(id));
      const result = await controller.requestCorridor("corridor_01", loader);

      expect(result.outcome).toBe("aborted");
      expect(loader).not.toHaveBeenCalled();
    });
  });
});
