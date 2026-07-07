import { describe, expect, it, vi } from "vitest";
import { BrowserLocalBoreslayDemoAdapter } from "../boreslay-demo/PublicBoreslayDemoAdapter";
import { RallyEngine } from "./rallyEngine";
import { PureReplayAdapter, replayToTick } from "./rallyReplay";
import { cleanupCapture, selectRallyExportKind } from "./rallyShare";

describe("Rally deterministic replay and export", () => {
  it("re-simulates identical hashes at every recorded keyframe", () => {
    const live = new RallyEngine({ controlMode: "flight", seed: 8842, scoringMode: "buttHybrid" });
    const hashes = new Map<number, string>();
    live.start();
    live.setMovement(1, -0.2);
    hashes.set(live.state.tick, live.stateHash());
    live.advanceFixedSteps(20);
    live.setAim(870, 250);
    live.setBreath(true);
    hashes.set(live.state.tick, live.stateHash());
    live.advanceFixedSteps(30);
    live.setBreath(false);
    live.dash();
    hashes.set(live.state.tick, live.stateHash());
    live.advanceFixedSteps(40);
    hashes.set(live.state.tick, live.stateHash());

    const record = live.getReplayRecord();
    for (const [tick, hash] of hashes) {
      expect(replayToTick(record, tick).engine.stateHash()).toBe(hash);
    }
  });

  it("replays mission acceptance as data with zero adapter calls", () => {
    const liveAdapter = new BrowserLocalBoreslayDemoAdapter();
    const live = new RallyEngine({ controlMode: "flight", seed: 19, adapter: liveAdapter });
    live.start();
    live.state.mission.status = "ready";
    live.state.mission.readyAt = 0;
    live.state.mission.acceptDeadline = 20_000;
    expect(live.acceptRescue()).toBe(true);
    const record = live.getReplayRecord();
    const replayAdapter = new PureReplayAdapter();
    const replay = replayToTick(record, live.state.tick, replayAdapter);
    expect(replayAdapter.calls).toBe(0);
    expect(replay.engine.stateHash()).toBe(live.stateHash());
    expect(replay.engine.state.mission.status).toBe("accepted");
    expect(replay.engine.state.mission.deployment).toBeNull();
  });

  it("selects MP4, WebM, and PNG honestly across the capability matrix", () => {
    expect(selectRallyExportKind(undefined)).toEqual({ kind: "png", mimeType: "image/png" });
    expect(selectRallyExportKind({ isTypeSupported: (mime: string) => mime === "video/mp4" } as typeof MediaRecorder))
      .toEqual({ kind: "video", mimeType: "video/mp4" });
    expect(selectRallyExportKind({ isTypeSupported: (mime: string) => mime === "video/webm" } as typeof MediaRecorder))
      .toEqual({ kind: "video", mimeType: "video/webm" });
    expect(selectRallyExportKind({ isTypeSupported: () => false } as unknown as typeof MediaRecorder))
      .toEqual({ kind: "png", mimeType: "image/png" });
  });

  it("stops every stream track and active recorder on cancellation cleanup", () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    const stream = { getTracks: () => tracks } as unknown as MediaStream;
    const recorder = { state: "recording", stop: vi.fn() } as unknown as MediaRecorder;
    cleanupCapture(stream, recorder);
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(tracks.every(track => track.stop.mock.calls.length === 1)).toBe(true);
  });
});
