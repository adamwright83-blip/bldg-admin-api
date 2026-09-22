/**
 * Daily Command read model: derive "what actually matters today?" from
 * authoritative stores. This is not a planner and not a second task table.
 *
 * READ. Does not project recurrence, designate a primary, write Day Director
 * rows, create ops tasks, or mutate campaigns. Recurrence materialization
 * belongs to the day-execution writer (`planForDate`), and only after an
 * operator has confirmed a rule.
 *
 * Narrator OS is never imported. Brain V2 consumes this read-only, in shadow.
 * A future locked weekly primary may wrap this picture. This reader does not
 * plan a week and does not read or overwrite locked weekly history.
 */

import { createHash } from "node:crypto";
import {
  deriveDailyCommand,
  readCommandMetadata,
  UNKNOWN_CARGO_IDENTITY,
  type CommandCargoSource,
  type CommandCommitmentSource,
  type CommandFollowUpSource,
  type CommandRouteSource,
  type DailyCommand,
} from "../../shared/claireWorkdayCommand";
import { getClaireCampaignSummary } from "./campaignAwareness";
import { getDayDirectorState } from "../dayDirector/dayDirectorService";
import { getFieldToday } from "../field/fieldTodayService";
import { listCargo } from "../goldlineCargo/cargoService";

export type DailyCommandDeps = {
  getState?: typeof getDayDirectorState;
  getField?: typeof getFieldToday;
  getCampaign?: typeof getClaireCampaignSummary;
  listVehicleCargo?: typeof listCargo;
};

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function fingerprintCommandConstraints(fingerprintSource: string): string {
  return sha(fingerprintSource);
}

export type LoadDailyCommandInput = {
  tenantId: string;
  actorId: string;
  dayDirectorActorId: string;
  operatorUserId: string;
  businessDate: string;
  vehicleId?: string;
  now?: Date;
  timeZone?: string;
};

/**
 * Read today's derived command. Callers that need recurring Day Line rows
 * must materialize them on the execution path first. This function never does.
 */
export async function loadDailyCommand(
  input: LoadDailyCommandInput,
  deps: DailyCommandDeps = {}
): Promise<DailyCommand> {
  const getState = deps.getState ?? getDayDirectorState;
  const getField = deps.getField ?? getFieldToday;
  const getCampaign = deps.getCampaign ?? getClaireCampaignSummary;
  const listVehicleCargo = deps.listVehicleCargo ?? listCargo;

  const [state, field, campaign, cargoRows] = await Promise.all([
    getState({
      tenantId: input.tenantId,
      actorId: input.dayDirectorActorId,
      businessDate: input.businessDate,
    }),
    getField({
      tenantId: input.tenantId,
      userId: input.operatorUserId,
      includeAllAssignees: true,
      businessDate: input.businessDate,
      timeZone: input.timeZone,
      now: input.now,
    }).catch(() => null),
    getCampaign({ tenantId: input.tenantId, actorId: input.dayDirectorActorId }).catch(() => null),
    listVehicleCargo(input.tenantId, input.vehicleId ?? input.operatorUserId).catch(() => []),
  ]);

  const commitments: CommandCommitmentSource[] = (state.commitments ?? []).map(commitment => ({
    id: commitment.id,
    title: commitment.title,
    kind: commitment.kind,
    status: commitment.status,
    sourceText: commitment.sourceText ?? null,
    detailState: commitment.detailState ?? "COMPLETE",
    scheduleKind: commitment.scheduleKind ?? null,
    scheduleLabel: commitment.scheduleLabel ?? null,
    command: commitment.command ?? readCommandMetadata(null),
  }));

  const route: CommandRouteSource[] = (field?.timeline ?? []).map(entry => ({
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    scheduledAt: entry.scheduledAt,
    status: entry.status,
    sourceReference: entry.source.sourceReference,
  }));

  const followUps: CommandFollowUpSource[] = (field?.timeline ?? [])
    .filter(entry => ["follow_up", "commercial_call", "commercial_visit", "field_commitment"].includes(entry.kind))
    .map(entry => ({
      id: entry.id,
      title: entry.title,
      sourceReference: entry.source.sourceReference,
      status: "open" as const,
    }));

  const cargo: CommandCargoSource[] = (cargoRows as Array<Record<string, unknown>>).map(row => {
    const customer =
      String(row.customerDisplayName ?? `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() ?? "cargo");
    const identityUnknown =
      customer === UNKNOWN_CARGO_IDENTITY || Boolean(row.identityUnknown);
    return {
      id: String(row.id),
      title: identityUnknown
        ? `Dry cleaning in vehicle (${UNKNOWN_CARGO_IDENTITY})`
        : `${customer} cargo`,
      customerDisplayName: identityUnknown ? UNKNOWN_CARGO_IDENTITY : customer,
      identityUnknown,
      unlinked: Boolean(row.unlinked) || row.source === "field",
      custodyLocation: typeof row.custodyLocation === "string" ? row.custodyLocation : "vehicle",
      linkedOrderId: typeof row.linkedOrderId === "number" ? row.linkedOrderId : typeof row.id === "number" && row.source === "order" ? row.id : null,
      fieldCargoId: typeof row.fieldCargoId === "string" ? row.fieldCargoId : row.source === "field" ? String(row.id).replace(/^field:/, "") : null,
      source: row.source === "field" ? "field" : "order",
    };
  });

  const command = deriveDailyCommand({
    businessDate: input.businessDate,
    actorId: input.dayDirectorActorId,
    commitments,
    route,
    cargo,
    campaign: campaign
      ? {
          active: campaign.active,
          remainingCount: campaign.remainingCount,
          remainingProven: Number.isFinite(campaign.remainingCount),
          campaignName: campaign.campaignName,
        }
      : null,
    followUps,
  });
  return {
    ...command,
    constraints: {
      ...command.constraints,
      fingerprint: fingerprintCommandConstraints(command.constraints.fingerprint),
    },
  };
}
