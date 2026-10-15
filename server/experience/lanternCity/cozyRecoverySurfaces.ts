/**
 * Read-only projection of the existing Silver Lake (or objective-area)
 * recovery mission onto the cozy village and one Day Line card.
 * Send and schedule stay in the outreach services this module only reads.
 */
import type { ScheduledOutreachMessageRow } from "../../../drizzle/schema";
import type { DaphneMissionAdjustment } from "../../../shared/daphneMissionPresentation";
import {
  projectCozyRecoverySurfaces,
  type CozyOutreachEvidenceRow,
  type CozyRecoverySurfaces,
} from "../../../shared/cozyVillagerEvidence";
import { loadMissionPresentations } from "../../agents/daphne/missionFollowUp";
import { readObjectiveArea } from "../../strategy/strategicEvidenceReaders";
import { getCozyEncounterMission } from "./cozyVillagerOutreachService";
import { listScheduledOutreachMessages } from "./scheduledOutreachService";

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function outreachEvidenceFromRow(row: ScheduledOutreachMessageRow): CozyOutreachEvidenceRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorId: row.operatorId,
    customerId: row.customerId,
    currentMessageBody: row.currentMessageBody,
    originalSuggestedDraft: row.originalSuggestedDraft,
    status: row.status,
    deliveryIntent: row.deliveryIntent,
    scheduledFor: iso(row.scheduledFor) ?? new Date(0).toISOString(),
    timezone: row.timezone || "America/Los_Angeles",
    slotId: row.slotId,
    territoryId: row.territoryId,
    dispatchedAt: iso(row.dispatchedAt),
    externalMessageId: row.externalMessageId,
    failureReason: row.failureReason,
  };
}

export async function loadCozyRecoverySurfaces(input: {
  tenantId: string;
  canonicalOperatorId: string;
  territoryId?: string;
  limit?: number;
  now?: Date;
  timeZone?: string;
}): Promise<CozyRecoverySurfaces> {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? "America/Los_Angeles";
  const [mission, messages, area, presentations] = await Promise.all([
    getCozyEncounterMission({
      tenantId: input.tenantId,
      canonicalOperatorId: input.canonicalOperatorId,
      territoryId: input.territoryId,
      limit: input.limit,
      now,
      timeZone,
    }),
    listScheduledOutreachMessages({
      tenantId: input.tenantId,
      operatorId: input.canonicalOperatorId,
      limit: 100,
    }).catch(() => []),
    readObjectiveArea({
      tenantId: input.tenantId,
      canonicalOperatorId: input.canonicalOperatorId,
    }).catch(() => null),
    loadMissionPresentations({
      tenantId: input.tenantId,
      canonicalOperatorId: input.canonicalOperatorId,
    }).catch(() => new Map()),
  ]);
  const presentationRecord =
    presentations.get("customer_recovery") ?? presentations.get("*") ?? null;
  const presentation = presentationRecord
    ? {
        adjustment: presentationRecord.adjustment as DaphneMissionAdjustment,
        note: presentationRecord.note,
      }
    : null;
  return projectCozyRecoverySurfaces({
    tenantId: input.tenantId,
    operatorId: input.canonicalOperatorId,
    mission,
    messages: messages.map(outreachEvidenceFromRow),
    objective: area
      ? { id: area.goal.g.id, statement: area.goal.g.statement, areaLabel: area.label }
      : null,
    presentation,
    now,
    timeZone,
  });
}
