/**
 * Feature flags for Claire StrategyEngine.
 *
 * All user-visible StrategyEngine behavior is tenant-scoped and default off in production
 * unless the plan explicitly establishes otherwise. Tests/fixtures may enable flags.
 */

export const STRATEGY_FLAGS = {
  LEGACY_AUTONOMY: "claire.strategy.legacyAutonomy",
  SAFETY_BASELINE: "claire.strategy.s01-safety-baseline",
  GROWTH_METRICS: "claire.strategy.s02-growth-metrics",
  PLAYGROUND_RULES: "claire.strategy.s03-playground-rules",
  STRATEGY_SNAPSHOT: "claire.strategy.s04-strategy-snapshot",
  CLAIRE_SNAPSHOT_READ: "claire.strategy.s05-claire-reads-snapshot",
  PLAYS_AND_FORKS: "claire.strategy.s06-plays-ranking-offers",
  MISSION_SEQUENCER: "claire.strategy.s07-mission-sequencer",
  OUTCOME_EVIDENCE: "claire.strategy.s08-outcome-attribution",
  AUTONOMOUS_TRIGGERS: "claire.strategy.s09-autonomous-triggers",
  RECOVERY_KINTSUGI: "claire.strategy.s10-recovery-drop-patterns",
} as const;

export type StrategyFlagKey = (typeof STRATEGY_FLAGS)[keyof typeof STRATEGY_FLAGS] | string;

const flagStore = new Map<string, boolean>();

function makeKey(tenantId: string, flag: string): string {
  return `${tenantId}:${flag}`;
}

/**
 * Check if a strategy feature flag is enabled for a given tenant.
 * - `claire.strategy.legacyAutonomy` defaults to true to preserve existing non-spend behavior.
 * - All other StrategyEngine behavior defaults to false in production unless explicitly enabled.
 */
export function isStrategyFeatureEnabled(
  tenantId: string,
  flag: StrategyFlagKey,
  fixtureDefault?: boolean
): boolean {
  const key = makeKey(tenantId, flag);
  const explicit = flagStore.get(key);
  if (explicit !== undefined) {
    return explicit;
  }
  if (fixtureDefault !== undefined) {
    return fixtureDefault;
  }
  if (flag === STRATEGY_FLAGS.LEGACY_AUTONOMY) {
    return true;
  }
  return false;
}

export function setStrategyFeatureFlag(
  tenantId: string,
  flag: StrategyFlagKey,
  enabled: boolean
): void {
  flagStore.set(makeKey(tenantId, flag), enabled);
}

export function resetStrategyFeatureFlagsForTesting(): void {
  flagStore.clear();
}
