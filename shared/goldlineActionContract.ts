import type {
  GoldlineActionDescriptor,
  GoldlineActionKind,
} from "../client/src/game/actions/actionRegistry";

export const GOLDLINE_AUTHORITIES = [
  "AUTO",
  "AUTO_INFORM",
  "APPROVAL_REQUIRED",
  "HUMAN_EXECUTION",
] as const;

export type GoldlineAuthority = (typeof GOLDLINE_AUTHORITIES)[number];

export const GOLDLINE_ACTION_STATUSES = [
  "available",
  "proposed",
  "approved",
  "executing",
  "completed",
  "failed",
  "cancelled",
] as const;

export type GoldlineActionStatus = (typeof GOLDLINE_ACTION_STATUSES)[number];

export type GoldlineActionTarget = {
  type:
    | "customer"
    | "commercial_account"
    | "mission"
    | "order"
    | "route"
    | "building"
    | "person"
    | "system";
  id: string;
  displayName: string | null;
};

export type CanonicalGoldlineAction = {
  actionId: string;
  kind: string;
  target: GoldlineActionTarget;
  reason: string;
  authority: GoldlineAuthority;
  status: GoldlineActionStatus;
  sourceReferences: string[];
  inputs: Record<string, unknown>;
  result: null | {
    outcome: string;
    sourceReferences: string[];
  };
};

const AUTONOMY_RANK: Record<GoldlineAuthority, number> = {
  HUMAN_EXECUTION: 0,
  APPROVAL_REQUIRED: 1,
  AUTO_INFORM: 2,
  AUTO: 3,
};

/**
 * Runtime policy may always become more restrictive without permission. It may
 * never become more autonomous than the contract granted unless an explicit
 * policy/approval changes the authority itself.
 */
export function canRestrictAuthorityWithoutApproval(
  from: GoldlineAuthority,
  to: GoldlineAuthority
): boolean {
  return AUTONOMY_RANK[to] <= AUTONOMY_RANK[from];
}

export function assertNoSilentAuthorityEscalation(
  from: GoldlineAuthority,
  to: GoldlineAuthority
): void {
  if (!canRestrictAuthorityWithoutApproval(from, to)) {
    throw new Error(`Authority cannot silently escalate from ${from} to ${to}`);
  }
}

export function defaultAuthorityForGoldlineAction(
  kind: GoldlineActionKind
): GoldlineAuthority {
  switch (kind) {
    case "REVIEW":
    case "WAIT":
      return "AUTO";
    case "FOLLOW_UP":
    case "RECOVER":
    case "SCOUT":
      return "APPROVAL_REQUIRED";
    case "CALL":
    case "VISIT":
    case "PICKUP":
    case "DELIVERY":
      return "HUMAN_EXECUTION";
  }
}

export function canonicalActionFromDescriptor(input: {
  descriptor: GoldlineActionDescriptor;
  reason: string;
  target?: GoldlineActionTarget;
  sourceReferences?: string[];
}): CanonicalGoldlineAction {
  const descriptor = input.descriptor;
  const target =
    input.target ??
    ({
      type: descriptor.missionId == null ? "system" : "mission",
      id:
        descriptor.missionId == null
          ? descriptor.kind.toLowerCase()
          : String(descriptor.missionId),
      displayName: descriptor.label,
    } satisfies GoldlineActionTarget);
  return {
    actionId:
      descriptor.missionId == null
        ? `${descriptor.kind.toLowerCase()}:system`
        : `${descriptor.kind.toLowerCase()}:mission:${descriptor.missionId}`,
    kind: descriptor.kind,
    target,
    reason: input.reason,
    authority: defaultAuthorityForGoldlineAction(descriptor.kind),
    status: "available",
    sourceReferences: input.sourceReferences ?? [],
    inputs: { mode: descriptor.mode },
    result: null,
  };
}
