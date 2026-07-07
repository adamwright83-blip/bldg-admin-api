import type {
  PublicBoreslayDemoAdapter,
  SimulatedCrewMissionDeployment,
  SimulatedCrewMissionProgress,
  SimulatedCrewMissionResult,
} from "../boreslay-demo/PublicBoreslayDemoAdapter";
import { FIXED_STEP_MS, RALLY_CONFIG } from "./rallyConfig";
import { RallyEngine, configHash, type RallyReplayRecord } from "./rallyEngine";

export class PureReplayAdapter implements PublicBoreslayDemoAdapter {
  readonly mode = "public-simulation" as const;
  readonly productionMutationsReachable = false as const;
  calls = 0;

  deployCrewMission(): SimulatedCrewMissionDeployment {
    this.calls += 1;
    throw new Error("Replay isolation violation: mission deployment attempted");
  }

  advanceCrewMission(): SimulatedCrewMissionProgress {
    this.calls += 1;
    throw new Error("Replay isolation violation: mission advancement attempted");
  }

  resolveCrewMission(): SimulatedCrewMissionResult {
    this.calls += 1;
    throw new Error("Replay isolation violation: mission resolution attempted");
  }

  reset() {
    // Replay reset is intentionally pure and local.
  }
}

const ceremonyWallClockMs =
  RALLY_CONFIG.ceremony.ingestionMs +
  RALLY_CONFIG.ceremony.hitStopMs +
  RALLY_CONFIG.ceremony.reactionMs +
  RALLY_CONFIG.ceremony.bannerMs +
  RALLY_CONFIG.ceremony.beatMs +
  RALLY_CONFIG.ceremony.serveTelegraphMs + 1;

export function replayToTick(
  record: RallyReplayRecord,
  targetTick: number,
  adapter = new PureReplayAdapter()
) {
  if (record.initialConfigHash !== configHash()) {
    throw new Error("Replay config mismatch");
  }
  const engine = new RallyEngine({
    seed: record.seed,
    controlMode: record.controlMode,
    scoringMode: record.scoringMode,
    replay: true,
    adapter,
  });
  engine.restoreRandomState(record.initialRngState);
  const inputLog = [...record.inputLog].sort(
    (left, right) => left.tick - right.tick || left.order - right.order
  );
  let inputIndex = 0;
  while (engine.state.tick <= targetTick) {
    while (
      inputIndex < inputLog.length &&
      inputLog[inputIndex].tick === engine.state.tick
    ) {
      engine.applyReplayInput(inputLog[inputIndex]);
      inputIndex += 1;
    }
    if (engine.state.tick === targetTick) break;
    if (engine.state.ceremony) engine.advanceFrame(ceremonyWallClockMs);
    const before = engine.state.tick;
    engine.advanceFixedSteps(1);
    if (engine.state.tick === before && engine.state.status !== "playing") break;
  }
  return { engine, adapter };
}

export function replayKeyframeHashes(record: RallyReplayRecord, ticks: number[]) {
  return ticks.map(tick => ({ tick, hash: replayToTick(record, tick).engine.stateHash() }));
}

export function maxReplayTicks() {
  return Math.ceil(RALLY_CONFIG.replay.maxSimMs / FIXED_STEP_MS);
}
