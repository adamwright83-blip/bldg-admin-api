/**
 * Canonical locked-week agreement. The schema lives in the shared contract.
 */

export type {
  ReadinessKind,
  ReadinessStatus,
  RemnantDisposition,
  PrimarySource,
  WeekdayName,
  WeeklyFixedConstraint,
  MissionReadinessRequirement,
  WeeklyIntentDay,
  WeeklyIntentRecord,
} from "@shared/weeklyMissionReadiness";

export { isLockedWeeklyIntent } from "@shared/weeklyMissionReadiness";
