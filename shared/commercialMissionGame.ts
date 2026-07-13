export type CommercialMissionGameTelemetry = {
  sparkScore: number;
  clockheadScore: number;
  durationMs: number;
  replay: Record<string, unknown>;
};

export type CommercialMissionGameReward = {
  xpAwarded: number;
  streakDays: number;
  phoneMissionReady: boolean;
};

export function assertQualifyingCommercialMissionGameTelemetry(input: CommercialMissionGameTelemetry): void {
  if (!Number.isInteger(input.sparkScore) || input.sparkScore < 5 || input.sparkScore <= input.clockheadScore) {
    throw new Error("A qualifying BORESLAY result requires Spark to win with at least five points");
  }
  if (!Number.isInteger(input.clockheadScore) || input.clockheadScore < 0) {
    throw new Error("Clockhead score must be a non-negative integer");
  }
  if (!Number.isInteger(input.durationMs) || input.durationMs <= 0 || input.durationMs > 3_600_000) {
    throw new Error("BORESLAY duration must be between 1 ms and one hour");
  }
  if (JSON.stringify(input.replay).length > 250_000) {
    throw new Error("BORESLAY replay exceeds the persisted payload limit");
  }
}

export function calculateCommercialMissionXp(input: Pick<CommercialMissionGameTelemetry, "sparkScore" | "clockheadScore" | "durationMs">): number {
  const margin = Math.max(0, input.sparkScore - input.clockheadScore);
  const speedBonus = input.durationMs <= 120_000 ? 25 : input.durationMs <= 240_000 ? 10 : 0;
  return 100 + margin * 15 + speedBonus;
}

export function consecutiveCompletionDays(completedAt: readonly Date[], now: Date): number {
  const days = new Set(completedAt.map(value => value.toISOString().slice(0, 10)));
  let cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let streak = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return Math.max(1, streak);
}
