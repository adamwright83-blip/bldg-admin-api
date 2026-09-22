/**
 * Field-for-field mirror of Project A's locked WeeklyIntent agreement.
 * Source of truth: `WeeklyIntentRecord` in shared/weeklyMissionReadiness.ts
 * on the readiness branch. This file is the render boundary until that
 * module is on main and an import can replace this file.
 *
 * No presentation-skin fields. No private hypothesis. No draft planner.
 */

export const READINESS_KINDS = ["physical", "document", "information", "approval", "location"] as const;
export type ReadinessKind = (typeof READINESS_KINDS)[number];
export type ReadinessStatus = "open" | "ready" | "blocked";
export type RemnantDisposition = "primary" | "stand_down";
export type PrimarySource = "existing_work" | "operator_stated" | "claire_recommended";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

export type WeeklyFixedConstraint = {
  sourceRef: string;
  title: string;
  businessDate: string;
  scheduleLabel: string;
};

export type MissionReadinessRequirement = {
  text: string;
  kind: ReadinessKind;
  neededForDate: string;
  completeByDate: string;
  status: ReadinessStatus;
};

export type WeeklyIntentDay = {
  businessDate: string;
  weekday: WeekdayName;
  disposition: RemnantDisposition;
  primary: {
    text: string;
    source: PrimarySource;
    commitmentId: string | null;
  } | null;
  fixedConstraints: WeeklyFixedConstraint[];
  readinessRequirements: MissionReadinessRequirement[];
};

/** Thin durable agreement. Not a task database. */
export type WeeklyIntentRecord = {
  id: string;
  tenantId: string;
  operatorId: string;
  weekStart: string;
  revision: number;
  source: "operator_confirmed_proposal";
  lockedAt: string;
  days: WeeklyIntentDay[];
};

const PRIMARY_SOURCES: readonly string[] = ["existing_work", "operator_stated", "claire_recommended"];
const READINESS_STATUS: readonly string[] = ["open", "ready", "blocked"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWeekdayName(value: unknown): value is WeekdayName {
  return typeof value === "string" && (WEEKDAY_NAMES as readonly string[]).includes(value);
}

function isPrimary(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (typeof value.text !== "string" || value.text.trim().length === 0) return false;
  if (typeof value.source !== "string" || !PRIMARY_SOURCES.includes(value.source)) return false;
  if (value.commitmentId !== null && typeof value.commitmentId !== "string") return false;
  return true;
}

function isConstraint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.sourceRef === "string" &&
    typeof value.title === "string" &&
    typeof value.businessDate === "string" &&
    typeof value.scheduleLabel === "string"
  );
}

function isReadiness(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.text === "string" &&
    typeof value.kind === "string" &&
    (READINESS_KINDS as readonly string[]).includes(value.kind) &&
    typeof value.neededForDate === "string" &&
    typeof value.completeByDate === "string" &&
    typeof value.status === "string" &&
    READINESS_STATUS.includes(value.status)
  );
}

function isIntentDay(value: unknown): value is WeeklyIntentDay {
  if (!isRecord(value)) return false;
  if (typeof value.businessDate !== "string" || !isWeekdayName(value.weekday)) return false;
  if (value.disposition !== "primary" && value.disposition !== "stand_down") return false;
  if (!isPrimary(value.primary)) return false;
  if (!Array.isArray(value.fixedConstraints) || !value.fixedConstraints.every(isConstraint)) return false;
  if (!Array.isArray(value.readinessRequirements) || !value.readinessRequirements.every(isReadiness)) return false;
  return true;
}

/**
 * Locked agreement: operator-confirmed proposal plus a lock timestamp.
 * The old brochure-only shape (source "locked", primary.title, readiness[])
 * does not pass.
 */
export function isLockedWeeklyIntent(value: unknown): value is WeeklyIntentRecord {
  if (!isRecord(value)) return false;
  if (value.source !== "operator_confirmed_proposal") return false;
  if (typeof value.lockedAt !== "string" || value.lockedAt.length === 0) return false;
  if (typeof value.id !== "string" || typeof value.tenantId !== "string" || typeof value.operatorId !== "string") {
    return false;
  }
  if (typeof value.weekStart !== "string" || typeof value.revision !== "number") return false;
  if (!Array.isArray(value.days) || !value.days.every(isIntentDay)) return false;
  return true;
}
