import type { CommercialMissionStatus } from "../../../../shared/commercialMission";
import type { FieldOutcomeReason } from "../../../../shared/commercialMissionField";
import type { ScoutReport } from "../../../../shared/expansionScout";
import type { DriverGameWorldNode } from "../../../../shared/driverGameWorld";
import type { RealActionRequest } from "../encounters/RealActionBridge";
import type { AuthoritativeFollowUp } from "./actionRegistry";

export type GoldlineVisitContext = {
  mission: { id: number; version: number; status: CommercialMissionStatus };
  field: {
    version: number;
    notes: string;
    preparationStartedAt: string | null;
    departedAt: string | null;
    arrivedAt: string | null;
  } | null;
  checklist: Array<{
    itemKey: string;
    label: string;
    required: boolean;
    status: "pending" | "completed" | "skipped";
  }>;
  visitOutcome: {
    outcome: "follow_up" | "won" | "lost";
    followUpAt: string | null;
  } | null;
  proposal: { id: string; status: string; validThrough: string } | null;
  navigationUrl: string | null;
};

export type VisitOutcomeRequest = {
  missionId: number;
  requestId: string;
  outcome: "follow_up" | "won" | "lost";
  notes: string;
  followUpAt?: Date;
  decisionMakerStatus: "met" | "unavailable" | "not_recorded";
  collateralDelivered: boolean;
  quoteRequested: boolean;
  pilotRequested: boolean;
  followUpRequested: boolean;
  reason?: FieldOutcomeReason;
};

export type GoldlineActionServices = {
  recordCall: (request: RealActionRequest) => Promise<void>;
  loadVisit: (missionId: number) => Promise<GoldlineVisitContext>;
  startVisitPreparation: (input: {
    missionId: number;
    requestId: string;
  }) => Promise<GoldlineVisitContext>;
  departVisit: (input: {
    missionId: number;
    requestId: string;
  }) => Promise<GoldlineVisitContext>;
  arriveVisit: (input: {
    missionId: number;
    requestId: string;
  }) => Promise<GoldlineVisitContext>;
  recordVisitOutcome: (
    input: VisitOutcomeRequest
  ) => Promise<GoldlineVisitContext>;
  loadFollowUp: (missionId: number) => Promise<AuthoritativeFollowUp | null>;
  completeFollowUp: (input: {
    followUp: AuthoritativeFollowUp;
    requestId: string;
  }) => Promise<void>;
  rescheduleFollowUp: (input: {
    followUp: AuthoritativeFollowUp;
    requestId: string;
    dueAt: Date;
  }) => Promise<void>;
  recover: (input: {
    missionId: number;
    requestId: string;
  }) => Promise<DriverGameWorldNode>;
  scout: (input: { requestId: string }) => Promise<ScoutReport>;
  refetchAuthoritativeTruth: (missionId: number | null) => Promise<void>;
};
