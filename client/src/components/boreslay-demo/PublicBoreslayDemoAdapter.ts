export type SimulatedCrewMissionId = "follow-up";
export type FollowUpMissionStatus = "charging" | "ready" | "briefing" | "working" | "result-incoming" | "resolved";
export type SimulatedCrewMissionDeployment = { missionId: SimulatedCrewMissionId; simulated: true; deployedAt: number; seed: string };
export type SimulatedCrewMissionProgress = { stage: 0 | 1 | 2 | 3; progress: number; message: string | null };
export type SimulatedCrewMissionResult = {
  missionId: SimulatedCrewMissionId; simulated: true; repliesReceived: 2; estimatesReopened: 1; estimatedOpportunityCents: 74000;
  combatRewards: { bossDamage: 20; influenceGain: 12; energyRestore: 20; contractTimeRestoreMs: 10000 };
};

export interface PublicBoreslayDemoAdapter {
  readonly mode: "public-simulation";
  readonly productionMutationsReachable: false;
  deployCrewMission(battleTimeMs: number, seed?: string): SimulatedCrewMissionDeployment;
  advanceCrewMission(deployment: SimulatedCrewMissionDeployment, battleTimeMs: number): SimulatedCrewMissionProgress;
  resolveCrewMission(deployment: SimulatedCrewMissionDeployment): SimulatedCrewMissionResult;
  reset(seed?: string): void;
}

export class BrowserLocalBoreslayDemoAdapter implements PublicBoreslayDemoAdapter {
  readonly mode = "public-simulation" as const;
  readonly productionMutationsReachable = false as const;
  private seed = "boreslay-public-follow-up-v1";
  deployCrewMission(battleTimeMs: number, seed = this.seed): SimulatedCrewMissionDeployment { return { missionId: "follow-up", simulated: true, deployedAt: battleTimeMs, seed }; }
  advanceCrewMission(d: SimulatedCrewMissionDeployment, battleTimeMs: number): SimulatedCrewMissionProgress {
    const elapsed = Math.max(0, battleTimeMs - d.deployedAt);
    if (elapsed >= 7500) return { stage: 3, progress: 1, message: "SIMULATED OPPORTUNITY · $740" };
    if (elapsed >= 5000) return { stage: 2, progress: elapsed / 7500, message: "SIMULATED · 1 ESTIMATE REOPENED" };
    if (elapsed >= 2500) return { stage: 1, progress: elapsed / 7500, message: "SIMULATED · 2 REPLIES RECEIVED" };
    return { stage: 0, progress: elapsed / 7500, message: null };
  }
  resolveCrewMission(_deployment: SimulatedCrewMissionDeployment): SimulatedCrewMissionResult { return { missionId: "follow-up", simulated: true, repliesReceived: 2, estimatesReopened: 1, estimatedOpportunityCents: 74000, combatRewards: { bossDamage: 20, influenceGain: 12, energyRestore: 20, contractTimeRestoreMs: 10000 } }; }
  reset(seed = "boreslay-public-follow-up-v1") { this.seed = seed; }
}
