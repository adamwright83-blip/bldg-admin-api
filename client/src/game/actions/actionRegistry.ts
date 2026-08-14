import type {
  CapabilityEvaluation,
  ScoutReport,
} from "../../../../shared/expansionScout";
import type { PlayableMission } from "../state/GameState";
import {
  projectMissionAffordance,
  type MissionAffordance,
} from "../encounters/missionAffordance";

export const GOLDLINE_ACTION_KINDS = [
  "CALL",
  "VISIT",
  "FOLLOW_UP",
  "RECOVER",
  "SCOUT",
  "REVIEW",
  "WAIT",
  "PICKUP",
  "DELIVERY",
] as const;

export type GoldlineActionKind = (typeof GOLDLINE_ACTION_KINDS)[number];

export type AuthoritativeFollowUp = {
  pipelineId: number;
  followUpId: string;
  dueAt: string;
  note: string | null;
  channel: "phone" | "email" | "sms" | "in_person" | "unknown";
};

export type GoldlineActionContext = {
  mission: PlayableMission;
  now: Date;
  followUp: AuthoritativeFollowUp | null;
  scoutCapability: CapabilityEvaluation | null;
  scoutReport: ScoutReport | null;
};

type BaseAction<
  K extends GoldlineActionKind,
  M extends "write" | "external" | "read",
> = {
  kind: K;
  mode: M;
  missionId: number | null;
  label: string;
};

export type GoldlineActionDescriptor =
  | (BaseAction<"CALL", "write"> & { phoneUrl: string })
  | (BaseAction<"VISIT", "external"> & {
      navigationUrl: string;
      address: string;
      destinationPath: string;
    })
  | (BaseAction<"FOLLOW_UP", "write"> & {
      followUp: AuthoritativeFollowUp;
      phoneUrl: string | null;
    })
  | (BaseAction<"RECOVER", "write"> & {
      recoveryState: "recovery_available" | "recovery_active";
    })
  | (BaseAction<"SCOUT", "write"> & { capabilityId: "EXPANSION_SCOUT" })
  | (BaseAction<"REVIEW", "read"> & { destinationPath: string | null })
  | (BaseAction<"WAIT", "read"> & { dueAt: string | null })
  | (BaseAction<"PICKUP", "write"> & {
      orderId: number;
      customerName: string;
      address: string | null;
      navigationUrl: string | null;
    })
  | (BaseAction<"DELIVERY", "write"> & {
      orderId: number;
      customerName: string;
      address: string | null;
      navigationUrl: string | null;
      /** True only when the real order is paid — never fabricated. */
      paid: boolean;
    });

type Adapter<K extends GoldlineActionKind> = {
  kind: K;
  resolve: (
    context: GoldlineActionContext
  ) => Extract<GoldlineActionDescriptor, { kind: K }> | null;
};

function projected(context: GoldlineActionContext): MissionAffordance | null {
  return projectMissionAffordance(context.mission, context.now).primary;
}

export const GOLDLINE_ACTION_REGISTRY = {
  CALL: {
    kind: "CALL",
    resolve: context =>
      projected(context) === "CALL" &&
      context.mission.missionId != null &&
      context.mission.phoneUrl
        ? {
            kind: "CALL",
            mode: "write",
            missionId: context.mission.missionId,
            label: "CALL",
            phoneUrl: context.mission.phoneUrl,
          }
        : null,
  },
  VISIT: {
    kind: "VISIT",
    resolve: context =>
      projected(context) === "VISIT" &&
      context.mission.missionId != null &&
      context.mission.address &&
      context.mission.navigationUrl &&
      context.mission.destinationPath
        ? {
            kind: "VISIT",
            mode: "external",
            missionId: context.mission.missionId,
            label: "DEPART",
            address: context.mission.address,
            navigationUrl: context.mission.navigationUrl,
            destinationPath: context.mission.destinationPath,
          }
        : null,
  },
  FOLLOW_UP: {
    kind: "FOLLOW_UP",
    resolve: context =>
      projected(context) === "FOLLOW_UP" &&
      context.mission.missionId != null &&
      context.followUp
        ? {
            kind: "FOLLOW_UP",
            mode: "write",
            missionId: context.mission.missionId,
            label: "FOLLOW UP",
            followUp: context.followUp,
            phoneUrl: context.mission.phoneUrl,
          }
        : null,
  },
  RECOVER: {
    kind: "RECOVER",
    resolve: context =>
      projected(context) === "RECOVER" &&
      context.mission.missionId != null &&
      (context.mission.state === "recovery_available" ||
        context.mission.state === "recovery_active")
        ? {
            kind: "RECOVER",
            mode: "write",
            missionId: context.mission.missionId,
            label: "RECOVER",
            recoveryState: context.mission.state,
          }
        : null,
  },
  SCOUT: {
    kind: "SCOUT",
    resolve: context =>
      projected(context) === "SCOUT" && context.scoutCapability?.unlocked
        ? {
            kind: "SCOUT",
            mode: "write",
            missionId: context.mission.missionId,
            label: "SCOUT",
            capabilityId: "EXPANSION_SCOUT",
          }
        : null,
  },
  REVIEW: {
    kind: "REVIEW",
    resolve: context => {
      const affordance = projectMissionAffordance(context.mission, context.now);
      return affordance.available.includes("REVIEW")
        ? {
            kind: "REVIEW",
            mode: "read",
            missionId: context.mission.missionId,
            label: "REVIEW",
            destinationPath: context.mission.destinationPath,
          }
        : null;
    },
  },
  WAIT: {
    kind: "WAIT",
    resolve: context =>
      projected(context) === "WAIT"
        ? {
            kind: "WAIT",
            mode: "read",
            missionId: context.mission.missionId,
            label: "WAIT",
            dueAt: context.mission.contestedUntil,
          }
        : null,
  },
  // Pickups/deliveries have no PlayableMission/commercial-mission concept —
  // their descriptors are built directly from real order fields (see
  // GoldlineGameHome.tsx's handleSelectOrder), never resolved from this
  // mission-context adapter table.
  PICKUP: { kind: "PICKUP", resolve: () => null },
  DELIVERY: { kind: "DELIVERY", resolve: () => null },
} satisfies { [K in GoldlineActionKind]: Adapter<K> };

export function resolveGoldlineAction(
  context: GoldlineActionContext,
  requested: GoldlineActionKind = projectMissionAffordance(
    context.mission,
    context.now
  ).primary as GoldlineActionKind
): GoldlineActionDescriptor | null {
  if (!requested || !GOLDLINE_ACTION_KINDS.includes(requested)) return null;
  return GOLDLINE_ACTION_REGISTRY[requested].resolve(
    context
  ) as GoldlineActionDescriptor | null;
}
