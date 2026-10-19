import type { MandateDecisionPayload, ResolvedOperatingMandate } from "../../../shared/operatingMandate";
import { STATED_METHOD_LEVERS, STATED_METHOD_POPULATIONS } from "../../../shared/operatingMandate";
import { normalizeAreaKey } from "../../../shared/workThread";
import type { CanonicalOperatorIdentity } from "../../agents/persistentOperator/identity";
import { areaLedgerFilters, loadOperatingMandate } from "./loadOperatingMandate";
import { recordMandateDecision } from "./mandateDecisionStore";

/** A decision that names something the operator's mandate does not hold. */
export class MandateDecisionRejected extends Error {}

export type OperatingMandateDecisionInput =
  | { kind: "primary_outcome"; outcomeId: string | null }
  | { kind: "focus"; action: "confirm" | "dismiss"; area: string; statement: string; servesOutcomeId?: string | null }
  | {
      kind: "method";
      outcomeId: string | null;
      lever: (typeof STATED_METHOD_LEVERS)[number];
      population: (typeof STATED_METHOD_POPULATIONS)[number];
      area: string | null;
      statement: string;
      withdrawn?: boolean;
    };

function activeOutcome(mandate: ResolvedOperatingMandate, outcomeId: string | null | undefined): string | null {
  if (!outcomeId) return null;
  if (!mandate.outcomes.some(o => o.id === outcomeId)) throw new MandateDecisionRejected("That goal is not one of your active goals");
  return outcomeId;
}

function knownArea(area: string): { key: string; label: string } {
  const key = normalizeAreaKey(area);
  const filters = key ? areaLedgerFilters(key) : null;
  if (!key || !filters) throw new MandateDecisionRejected(`"${area}" is not an area Claire can measure orders in`);
  return { key, label: filters.addressLabel.replace(/^in\s+/i, "") };
}

/**
 * The operator, through the authenticated app, settles part of their mandate:
 * which goal comes first, an area to focus on or set aside, or how they want a
 * goal pursued. Only their own active goals and areas Claire can measure may
 * be named. Recorded append-only; returns the mandate as it now resolves.
 */
export async function recordOperatingMandateDecision(input: {
  identity: CanonicalOperatorIdentity;
  decidedByOpenId: string;
  decision: OperatingMandateDecisionInput;
  now?: Date;
}) {
  const roles = ["owner", "admin", "operator"];
  if (!roles.includes(input.identity.membership.source) || !roles.includes(input.identity.membership.canonical))
    throw new MandateDecisionRejected("Authenticated operator required");
  const now = input.now ?? new Date();
  const before = await loadOperatingMandate({ identity: input.identity, now });
  const d = input.decision;
  let payload: MandateDecisionPayload;
  if (d.kind === "primary_outcome") {
    payload = { kind: "primary_outcome", outcomeId: activeOutcome(before, d.outcomeId) };
  } else if (d.kind === "focus") {
    const area = knownArea(d.area);
    payload = {
      kind: "focus",
      action: d.action,
      area: area.key,
      label: area.label,
      statement: d.statement.trim(),
      servesOutcomeId: d.action === "confirm" ? activeOutcome(before, d.servesOutcomeId) : null,
    };
  } else {
    payload = {
      kind: "method",
      outcomeId: activeOutcome(before, d.outcomeId),
      lever: d.lever,
      population: d.population,
      area: d.area ? knownArea(d.area).key : null,
      statement: d.statement.trim(),
      ...(d.withdrawn ? { withdrawn: true } : {}),
    };
  }
  const recorded = await recordMandateDecision({
    tenantId: input.identity.tenantId,
    canonicalOperatorId: input.identity.canonicalOperatorId,
    decidedByOpenId: input.decidedByOpenId,
    payload,
  });
  const after = await loadOperatingMandate({ identity: input.identity, now });
  return { ...recorded, previousRevision: before.revision, mandate: after };
}
