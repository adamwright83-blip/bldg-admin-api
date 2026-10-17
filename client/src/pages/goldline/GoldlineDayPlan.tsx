import type { PickupCounts } from "@shared/cleancloudPickup";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Check,
  ChevronRight,
  CloudUpload,
  Compass,
  Flame,
  Menu,
  X,
} from "lucide-react";
import type { Order } from "@shared/types";
import type { CommercialMission } from "@shared/commercialMission";
import type { ExternalOperationalOrder } from "@shared/externalOperationalOrder";
import type {
  DayDirectorCommitment,
  DayDirectorProposal,
  ProcessingLocation,
} from "@shared/dayDirector";
import type {
  DaphneMissionFollowUp,
  DaphneMissionPresentation,
} from "@shared/daphneMissionPresentation";

type CarriedForwardWorkView = {
  commitmentId: string;
  originalBusinessDate: string;
  title: string;
  presentation: DaphneMissionPresentation | null;
};
import type { AuthoredDayRecord } from "@shared/authoredDay";
import type { MissionPlanOutcome } from "@shared/missionDirector";
import {
  executionTypeLabel,
  presentCurrentDayLine,
  type CurrentDayLine,
} from "@shared/currentDayLine";
import type { OpenChannelMission } from "../../../../server/openChannel/openChannelTypes";
import {
  buildDayPlanProjection,
  executableDayLineStops,
  type DayPlanStop,
  type LiveAdventureObjective,
} from "../driver/goldlineDayPlanModel";
import type { TerritoryBundleHint } from "@shared/goldlineAdventure";
import type { CozyRecoveryDayLineCard } from "@shared/cozyVillagerEvidence";
import world from "@/assets/goldline/generated/goldline-world-empty.png";
import operator from "@/assets/goldline/generated/trailblazer-operator.png";
import type { VehicleCargoItem } from "@/components/goldline/VehicleCargo";
import { DriverVehicleDrawer } from "@/components/goldline/DriverVehicleDrawer";
import { DriverStopChapter } from "@/components/goldline/DriverStopChapter";
import { LanternRun } from "@/components/goldline/LanternRun";
import { GoldlineGameNav } from "./GoldlineGameNav";
import { BuildMissionSheet } from "@/components/driver/BuildMissionSheet";
import { PreparedOpportunityCard } from "@/pages/home/PreparedOpportunityCard";
import "./goldline-day-plan.css";
import { DaylineWorldCompositor } from "./DaylineWorldCompositor";
import {
  ApprovedDaylineDock,
  ApprovedDaylineHeader,
} from "./ApprovedDaylineChrome";

function CurrentDayLineBlock({ line }: { line: CurrentDayLine }) {
  const presented = presentCurrentDayLine(line);
  return (
    <div
      data-testid="current-day-line"
      data-ranking-status={presented.rankingStatus}
    >
      <p>
        <strong>Today</strong>
      </p>
      {presented.items.length ? (
        <ol>
          {presented.items.map(item => (
            <li
              key={item.id}
              data-day-line-id={item.id}
              data-execution-type={item.executionType ?? "unspecified"}
            >
              {executionTypeLabel(item.executionType)} · {item.title}
            </li>
          ))}
        </ol>
      ) : (
        <p data-testid="current-day-line-status">{presented.statusText}</p>
      )}
      {presented.designated ? (
        <p data-testid="current-day-line-designated">
          {executionTypeLabel(presented.designated.executionType)} ·{" "}
          {presented.designated.title}
        </p>
      ) : null}
    </div>
  );
}

export type GoldlineDayPlanProps = {
  businessDate: string;
  pickups?: Order[];
  deliveries?: Order[];
  externalOrders?: ExternalOperationalOrder[];
  openChannelMission?: OpenChannelMission | null;
  salesMissions?: CommercialMission[];
  liveObjectives?: LiveAdventureObjective[];
  territoryBundles?: TerritoryBundleHint[];
  campaignTitle?: string | null;
  campaignChapters?: Array<{ objectiveIds: readonly string[] }>;
  nextCommitmentAt?: string | null;
  isLoading?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  onResolveStop?: (
    stop: DayPlanStop,
    counts?: PickupCounts
  ) => Promise<boolean>;
  onRetryPickup?: (stop: DayPlanStop) => Promise<void>;
  onArchiveStop?: (stop: DayPlanStop) => Promise<boolean>;
  onOpenJournal?: () => void;
  onOpenFirstMission?: () => void;
  firstMissionEvidence?: { text: string; reportedAt: string } | null;
  onOpenImport: () => void;
  onEnterOperations: () => void;
  onEnterWorld: (trackedStopId?: string) => void;
  onEnterColosseum: () => void;
  /** Opens the Week brochure. Day Line stays the launch surface. */
  onOpenWeek?: () => void;
  processingLocation?: ProcessingLocation | null;
  commitments?: DayDirectorCommitment[];
  /** Claire's one question about overdue, still-open work. */
  missionFollowUp?: DaphneMissionFollowUp | null;
  /** Unfinished approved work Mission Director carried into this plan date. */
  carriedForward?: CarriedForwardWorkView | null;
  onAnswerMissionFollowUp?: (commitmentId: string, answer: string) => Promise<string>;
  intelligenceAvailable?: boolean;
  dismissedPromptKeys?: string[];
  onProposeCommitment?: (sourceText: string) => Promise<DayDirectorProposal>;
  onAcceptProposal?: (proposal: DayDirectorProposal) => Promise<void>;
  onDismissProposal?: (promptKey: string) => Promise<void>;
  onCompleteCommitment?: (commitmentId: string) => Promise<void>;
  authoredDay?: Pick<
    AuthoredDayRecord,
    "headline" | "framing" | "lines" | "status"
  > | null;
  cargoFixture?: VehicleCargoItem[];
  /** Slice 4/5: the Mission Director's plan for tomorrow, surfaced unprompted. */
  missionPlan?: MissionPlanOutcome | null;
  /** Today's prioritized line, already ordered by Mission Director. */
  currentDayLine?: CurrentDayLine | null;
  /** Locked-week readiness whose existing completeByDate is today. Read-only. */
  weeklyReadiness?: Array<{
    text: string;
    kind: string;
    neededForDate: string;
    completeByDate: string;
    status: "open" | "ready" | "blocked";
    missionTitle: string;
    provenance: "weekly_intent_readiness";
  }>;
  /** Slice 5 §5.4: shown when Kingdom 2 has unlocked (Kingdom 1 complete). */
  onEnterChapter?: () => void;
  /** Independent travel state is required before optional walking animations can run. */
  isDriving?: boolean;
  allowWalkingAnimation?: boolean;
  /** Compact Campaign Run identity on the Day Line, when a run exists. */
  campaignRunCard?: {
    title: string;
    iconSrc: string;
    onOpen: () => void;
  } | null;
  rescueMissionCard?: {
    title: string;
    status: string;
    onOpen: () => void;
  } | null;
  /** Existing customer-recovery objective. A send does not complete it. */
  recoveryOutreachCard?: CozyRecoveryDayLineCard | null;
  onOpenRecoveryOutreach?: (href: string) => void;
  /** Schedules the card's existing draft. Scheduling is not a send. */
  onScheduleRecoveryOutreach?: (
    input: RecoveryOutreachScheduleInput
  ) => Promise<RecoveryOutreachScheduleRow>;
  /** Revises the same stored message. Does not create another outreach. */
  onEditRecoveryDraft?: (input: {
    messageId: string;
    newMessageBody: string;
  }) => Promise<RecoveryOutreachScheduleRow>;
};

const KIND_LABEL = {
  pickup: "PICKUP",
  dropoff: "DROPOFF",
  sales: "SALES STOP",
  prep: "PREP TASK",
  processing: "PROCESSING",
  growth: "GROWTH",
  marketing: "MARKETING CHALLENGE",
} as const;

function dateHeading(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function shortTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function evidenceTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed
    .toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    .toUpperCase();
}

export function isForcedMobileDayPlanViewport(input: {
  layoutWidth: number;
  screenWidth: number;
  coarsePointer: boolean;
  hoverless: boolean;
}) {
  return (
    input.layoutWidth >= 700 &&
    input.screenWidth <= 699 &&
    input.coarsePointer &&
    input.hoverless
  );
}

export const RECOVERY_SCHEDULE_TIMEZONE = "America/Los_Angeles" as const;
export const RECOVERY_SCHEDULED_LABEL = "Scheduled — not sent";

export type RecoveryOutreachScheduleInput = {
  customerId: string;
  messageBody: string;
  scheduledFor: string;
  timezone: typeof RECOVERY_SCHEDULE_TIMEZONE;
  territoryId?: string;
  idempotencyKey: string;
};

export type RecoveryOutreachScheduleRow = {
  id: string;
  customerId: string;
  status: string;
  currentMessageBody: string;
  dispatchedAt: Date | string | null;
  externalMessageId: string | null;
  deliveryIntent?: "immediate" | "scheduled" | null;
};

export type RecoveryScheduleResult = {
  objectiveId: string;
  customerId: string;
  messageId: string;
  objectiveComplete: false;
  communicationState: "scheduled" | "awaiting_sender";
  label: string;
  messageSent: false;
};

/** Tomorrow at 10:00 Pacific, as a wall-clock string the outbox converts. */
export function defaultRecoveryScheduleWallTime(now = new Date()): string {
  const laDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: RECOVERY_SCHEDULE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, day] = laDateStr.split("-").map(Number);
  const tomorrowUtc = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
  const tomorrowStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: RECOVERY_SCHEDULE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(tomorrowUtc);
  return `${tomorrowStr}T10:00`;
}

export function recoveryTerritoryId(openHref: string): string | undefined {
  const match = /[?&]territory=([^&]+)/.exec(openHref);
  if (!match?.[1]) return undefined;
  try {
    const value = decodeURIComponent(match[1]).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

export function recoveryScheduleIdempotencyKey(
  card: Pick<CozyRecoveryDayLineCard, "objectiveId" | "customerId">
): string {
  return `day-line-recovery:${card.objectiveId}:${card.customerId ?? "none"}`;
}

export function recoveryScheduleLabel(state: string | null | undefined): string | null {
  if (state === "scheduled") return RECOVERY_SCHEDULED_LABEL;
  if (state === "claimed") return "Claimed — send not observed";
  if (state === "awaiting_sender" || state === "send_not_observed") {
    return "Awaiting sender. This is not a send.";
  }
  if (state === "failed") return "Failed — not sent";
  return null;
}

/** A prepared draft with no outbox row can be scheduled. An existing row is not scheduled again. */
export function canScheduleRecoveryDraft(card: CozyRecoveryDayLineCard): boolean {
  return Boolean(
    card.customerId &&
      card.messageBody?.trim() &&
      !card.messageId &&
      (card.communicationState === "draft_prepared" || card.communicationState == null)
  );
}

export function canEditRecoveryDraft(card: CozyRecoveryDayLineCard): boolean {
  return Boolean(
    card.customerId &&
      card.messageId &&
      (card.communicationState === "scheduled" || card.communicationState === "awaiting_sender")
  );
}

function unsentScheduleState(
  row: RecoveryOutreachScheduleRow,
  customerId: string
): RecoveryScheduleResult["communicationState"] {
  if (row.customerId !== customerId) {
    throw new Error("Schedule returned a different customer.");
  }
  if (row.dispatchedAt || row.externalMessageId || row.status === "dispatched") {
    throw new Error("Schedule must not mark the message sent.");
  }
  if (row.status === "awaiting_sender_setup") return "awaiting_sender";
  if (row.deliveryIntent === "immediate" || row.status !== "pending") {
    throw new Error("Schedule must not mark the message sent.");
  }
  return "scheduled";
}

function recoveryResultFromRow(
  card: CozyRecoveryDayLineCard,
  row: RecoveryOutreachScheduleRow,
  messageId: string
): RecoveryScheduleResult {
  const customerId = card.customerId;
  if (!customerId) throw new Error("This recovery card has no customer.");
  const communicationState = unsentScheduleState(row, customerId);
  return {
    objectiveId: card.objectiveId,
    customerId,
    messageId,
    objectiveComplete: false,
    communicationState,
    label:
      communicationState === "awaiting_sender"
        ? "Awaiting sender. This is not a send."
        : RECOVERY_SCHEDULED_LABEL,
    messageSent: false,
  };
}

function preparedDraftBody(editedBody: string): string {
  const messageBody = editedBody.trim();
  if (!messageBody) throw new Error("The draft is empty.");
  if (messageBody.length > 500) throw new Error("Draft must be 500 characters or fewer.");
  return messageBody;
}

/**
 * Schedules the draft already on this card through `scheduleCozyOutreach`.
 * One objective, one customer, one new outbox row. The objective stays open.
 * A card that already has a message id must be edited in place.
 */
export async function scheduleExistingRecoveryDraft(input: {
  card: CozyRecoveryDayLineCard;
  editedBody: string;
  scheduledFor: string;
  schedule: (request: RecoveryOutreachScheduleInput) => Promise<RecoveryOutreachScheduleRow>;
}): Promise<RecoveryScheduleResult> {
  const customerId = input.card.customerId;
  if (!customerId) throw new Error("This recovery card has no customer to schedule.");
  if (input.card.messageId) {
    throw new Error(
      "This outreach already has a message. Edit that draft instead of scheduling another."
    );
  }
  const scheduledFor = input.scheduledFor.trim();
  if (!scheduledFor) throw new Error("Choose a future time. Scheduling is not sending.");
  const territoryId = recoveryTerritoryId(input.card.openHref);
  const row = await input.schedule({
    customerId,
    messageBody: preparedDraftBody(input.editedBody),
    scheduledFor,
    timezone: RECOVERY_SCHEDULE_TIMEZONE,
    ...(territoryId ? { territoryId } : {}),
    idempotencyKey: recoveryScheduleIdempotencyKey(input.card),
  });
  return recoveryResultFromRow(input.card, row, row.id);
}

/** Saves a revision of the same message id. Does not schedule a second outreach. */
export async function editExistingRecoveryDraft(input: {
  card: CozyRecoveryDayLineCard;
  editedBody: string;
  edit: (request: {
    messageId: string;
    newMessageBody: string;
  }) => Promise<RecoveryOutreachScheduleRow>;
}): Promise<RecoveryScheduleResult> {
  const messageId = input.card.messageId;
  if (!input.card.customerId || !messageId) {
    throw new Error("This recovery card has no stored draft to edit.");
  }
  const row = await input.edit({
    messageId,
    newMessageBody: preparedDraftBody(input.editedBody),
  });
  if (row.id !== messageId) throw new Error("Edit returned a different message.");
  return recoveryResultFromRow(input.card, row, messageId);
}

export function RecoveryOutreachCard({
  card,
  onOpen,
  onSchedule,
  onEdit,
}: {
  card: CozyRecoveryDayLineCard;
  onOpen?: (href: string) => void;
  onSchedule?: (input: RecoveryOutreachScheduleInput) => Promise<RecoveryOutreachScheduleRow>;
  onEdit?: (input: {
    messageId: string;
    newMessageBody: string;
  }) => Promise<RecoveryOutreachScheduleRow>;
}) {
  const [draft, setDraft] = useState(card.messageBody ?? "");
  const [scheduledFor, setScheduledFor] = useState(() => defaultRecoveryScheduleWallTime());
  const [outcome, setOutcome] = useState<RecoveryScheduleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draftKey = `${card.objectiveId}:${card.customerId ?? ""}:${card.messageId ?? ""}:${card.messageBody ?? ""}`;
  const [seenKey, setSeenKey] = useState(draftKey);
  if (draftKey !== seenKey) {
    setSeenKey(draftKey);
    setDraft(card.messageBody ?? "");
    setOutcome(null);
    setError(null);
  }

  const messageId = card.messageId || outcome?.messageId || "";
  const communicationState =
    card.messageId && card.communicationState && card.communicationState !== "draft_prepared"
      ? card.communicationState
      : (outcome?.communicationState ?? card.communicationState ?? "");
  const statusLabel =
    outcome && !card.messageId ? outcome.label : recoveryScheduleLabel(communicationState);
  const scheduleReady = canScheduleRecoveryDraft(card) && !outcome?.messageId;
  const editReady = canEditRecoveryDraft(card);
  const draftChanged = draft.trim() !== (card.messageBody ?? "").trim();

  const commitSchedule = async () => {
    if (!onSchedule || busy) return;
    setBusy(true);
    setError(null);
    try {
      setOutcome(
        await scheduleExistingRecoveryDraft({
          card,
          editedBody: draft,
          scheduledFor,
          schedule: onSchedule,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Schedule could not be committed.");
    } finally {
      setBusy(false);
    }
  };

  const commitEdit = async () => {
    if (!onEdit || busy) return;
    setBusy(true);
    setError(null);
    try {
      setOutcome(
        await editExistingRecoveryDraft({
          card,
          editedBody: draft,
          edit: onEdit,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "The draft could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className="gdp-stop gdp-stop--growth gdp-stop--ready"
      data-testid="recovery-outreach-day-line-card"
      data-objective-id={card.objectiveId}
      data-customer-id={card.customerId ?? ""}
      data-message-id={messageId}
      data-communication-state={communicationState}
      data-objective-complete="false"
    >
      <div className="gdp-node" aria-hidden="true">
        1
      </div>
      <div className="gdp-card-copy">
        <div className="gdp-card-kicker">
          <span>CUSTOMER RECOVERY</span>
          <strong>OPEN</strong>
        </div>
        <h2>
          <button
            type="button"
            className="gdp-stop-open"
            onClick={() => onOpen?.(card.openHref)}
            aria-label={`Open ${card.missionTitle}`}
          >
            {card.missionTitle}
            <ChevronRight size={17} />
          </button>
        </h2>
        {card.missionTitle !== card.objectiveStatement ? <p>{card.objectiveStatement}</p> : null}
        <div className="gdp-card-meta">
          <span>
            {card.customerDisplayName ?? "No unfinished customer"}
            {card.customerId ? ` · ${card.customerId}` : ""}
            {card.communicationLabel ? ` · ${card.communicationLabel}` : ""}
          </span>
        </div>
        <div className="gdp-source">{card.nextAction}</div>
        {card.timeWindow ? <div className="gdp-card-meta">{card.timeWindow}</div> : null}
        {card.presentationNote ? <div className="gdp-source">{card.presentationNote}</div> : null}
        <div className="gdp-source">{card.evidenceToComplete}</div>
        {card.transport === "simulated" ? (
          <div className="gdp-source">Simulated transport. Not a live carrier delivery.</div>
        ) : null}
        {card.messageBody != null ? (
          <div className="gdp-recovery-draft">
            <label>
              Draft
              <textarea
                data-testid="recovery-outreach-draft"
                value={draft}
                maxLength={500}
                rows={4}
                readOnly={!scheduleReady && !editReady}
                onChange={event => setDraft(event.target.value)}
              />
            </label>
            <div className="gdp-source">{draft.trim().length} / 500</div>
            {scheduleReady ? (
              <>
                <label>
                  Pacific time
                  <input
                    type="datetime-local"
                    data-testid="recovery-outreach-schedule-time"
                    value={scheduledFor}
                    onChange={event => setScheduledFor(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  data-testid="recovery-outreach-schedule"
                  disabled={!onSchedule || busy || !draft.trim() || !scheduledFor.trim()}
                  onClick={() => void commitSchedule()}
                >
                  Schedule
                </button>
                <p className="gdp-source">Scheduling keeps this draft pending. It does not send it.</p>
              </>
            ) : null}
            {editReady ? (
              <button
                type="button"
                data-testid="recovery-outreach-save-draft"
                disabled={!onEdit || busy || !draftChanged || !draft.trim()}
                onClick={() => void commitEdit()}
              >
                Save draft
              </button>
            ) : null}
            {statusLabel ? (
              <p className="gdp-recovery-status" data-testid="recovery-outreach-schedule-state">
                {statusLabel}
              </p>
            ) : null}
            {error ? (
              <p className="gdp-recovery-error" role="alert" data-testid="recovery-outreach-schedule-error">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function StopCard({
  stop,
  index,
  onOpen,
}: {
  stop: DayPlanStop;
  index: number;
  onOpen: () => void;
}) {
  return (
    <article
      className={`gdp-stop gdp-stop--${stop.kind} gdp-stop--${stop.status} gdp-stop--${index % 2 ? "right" : "left"}${
        stop.attentionState === "needs_details"
          ? " gdp-stop--needs-details"
          : ""
      }`}
      data-testid={`day-plan-stop-${stop.id}`}
    >
      <div className="gdp-node" aria-hidden="true">
        {stop.status === "completed" ? <Check /> : index + 1}
      </div>
      <div className="gdp-card-copy">
        <div className="gdp-card-kicker">
          <span>{KIND_LABEL[stop.kind]}</span>
          <strong>
            {stop.status === "completed"
              ? "SEALED"
              : stop.status === "blocked"
                ? "BLOCKED"
                : stop.attentionState === "needs_details"
                  ? "NEEDS DETAILS"
                  : "OPEN"}
          </strong>
        </div>
        <h2>
          <button
            type="button"
            className="gdp-stop-open"
            onClick={onOpen}
            aria-label={`Open ${stop.title}`}
          >
            {stop.title}
            <ChevronRight size={17} />
          </button>
        </h2>
        <div className="gdp-card-meta">
          <span>{stop.timeLabel}</span>
        </div>
        <div className="gdp-source">{stop.sourceLabel}</div>
        {stop.status === "completed" && (
          <div className="gdp-complete">
            <Check /> COMPLETED
            {shortTime(stop.completedAt)
              ? ` · ${shortTime(stop.completedAt)}`
              : ""}
          </div>
        )}
      </div>
    </article>
  );
}
function MissionFollowUpCard({
  followUp,
  onAnswer,
}: {
  followUp: DaphneMissionFollowUp | null;
  onAnswer?: (commitmentId: string, answer: string) => Promise<string>;
}) {
  const [answer, setAnswer] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!followUp || !onAnswer) return null;
  return (
    <section className="gdp-mission-followup" data-testid="claire-mission-followup">
      <p>
        <strong>Claire:</strong>{" "}
        <span data-testid="claire-mission-followup-question">{followUp.question}</span>
      </p>
      <p className="gdp-mission-followup-item">
        {followUp.title} · {followUp.businessDate} · still open
      </p>
      {reply ? (
        <p data-testid="claire-mission-followup-reply">{reply}</p>
      ) : (
        <form
          onSubmit={async event => {
            event.preventDefault();
            if (!answer.trim()) return;
            setBusy(true);
            try {
              setReply(await onAnswer(followUp.commitmentId, answer.trim()));
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            aria-label="Tell Claire what happened"
            data-testid="claire-mission-followup-answer"
            value={answer}
            maxLength={2000}
            onChange={event => setAnswer(event.target.value)}
          />
          <button type="submit" disabled={busy || !answer.trim()}>
            Tell Claire
          </button>
        </form>
      )}
    </section>
  );
}

function CarriedForwardCard({
  work,
  onComplete,
}: {
  work: CarriedForwardWorkView | null;
  onComplete?: (commitmentId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  if (!work) return null;
  return (
    <section className="gdp-mission-adjustments" data-testid="carried-forward-mission">
      <p>
        <strong>Still open from {work.originalBusinessDate}:</strong> {work.title}
      </p>
      {work.presentation ? (
        <p data-testid="carried-forward-presentation">{work.presentation.note}</p>
      ) : null}
      {onComplete ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onComplete(work.commitmentId);
            } finally {
              setBusy(false);
            }
          }}
        >
          Mark done
        </button>
      ) : null}
    </section>
  );
}

function DaphneMissionAdjustments({
  commitments,
}: {
  commitments?: DayDirectorCommitment[];
}) {
  const adjusted = (commitments ?? []).filter(
    c => c.status === "open" && c.presentation
  );
  if (!adjusted.length) return null;
  return (
    <section className="gdp-mission-adjustments" data-testid="daphne-mission-adjustments">
      {adjusted.map(c => (
        <p key={c.id} data-testid={`daphne-mission-adjustment-${c.id}`}>
          <strong>{c.title}</strong> — {c.presentation!.note}
        </p>
      ))}
    </section>
  );
}

export default function GoldlineDayPlan(props: GoldlineDayPlanProps) {
  // GOLDLINE world is the default Day Line. The operator can switch to
  // the previous layout with ?dayline=classic while visual QA continues.
  const artPreview =
    typeof window === "undefined" ||
    new URLSearchParams(window.location.search).get("dayline") !== "classic";
  const callClaireForMission = trpc.system.claire.callBeforeDrive.useMutation();
  const [activeStop, setActiveStop] = useState<DayPlanStop | null>(null);
  function selectStop(stop: DayPlanStop) {
    // Keep the pickup chapter open in this tab while Maps opens. Returning
    // from navigation goes directly to the counts and Picked up action.
    if (
      stop.kind === "pickup" &&
      stop.status !== "completed" &&
      stop.status !== "cancelled" &&
      stop.navigationUrl
    ) {
      window.open(stop.navigationUrl, "_blank", "noopener,noreferrer");
    }
    setActiveStop(stop);
  }

  const [playing, setPlaying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [worldNavigationOpen, setWorldNavigationOpen] = useState(false);
  const [buildMissionOpen, setBuildMissionOpen] = useState(false);
  const [truthText, setTruthText] = useState("");
  const [proposal, setProposal] = useState<DayDirectorProposal | null>(null);
  const [directorBusy, setDirectorBusy] = useState(false);
  const [directorError, setDirectorError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [forcedMobileViewport, setForcedMobileViewport] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const updateViewportMode = () => {
      const fixtureOverride =
        import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1" &&
        new URLSearchParams(window.location.search).has(
          "goldlineForcedMobileViewport"
        );
      setForcedMobileViewport(
        fixtureOverride ||
          isForcedMobileDayPlanViewport({
            layoutWidth: window.innerWidth,
            screenWidth: window.screen.width,
            coarsePointer: window.matchMedia("(pointer: coarse)").matches,
            hoverless: window.matchMedia("(hover: none)").matches,
          })
      );
    };
    updateViewportMode();
    window.addEventListener("resize", updateViewportMode);
    return () => window.removeEventListener("resize", updateViewportMode);
  }, []);
  const plan = useMemo(
    () =>
      buildDayPlanProjection({
        businessDate: props.businessDate,
        pickups: props.pickups,
        deliveries: props.deliveries,
        externalOrders: props.externalOrders,
        openChannelMission: props.openChannelMission,
        salesMissions: props.salesMissions,
        liveObjectives: props.liveObjectives,
        territoryBundles: props.territoryBundles,
        campaignChapters: props.campaignChapters,
        nextCommitmentAt: props.nextCommitmentAt,
        processingLocation: props.processingLocation,
        commitments: props.commitments,
        now,
        authoredDay: props.authoredDay,
        missionPlan: props.missionPlan,
      }),
    [
      props.businessDate,
      props.pickups,
      props.deliveries,
      props.externalOrders,
      props.openChannelMission,
      props.salesMissions,
      props.liveObjectives,
      props.territoryBundles,
      props.missionPlan,
      props.campaignChapters,
      props.nextCommitmentAt,
      props.processingLocation,
      props.commitments,
      props.authoredDay,
      now,
    ]
  );
  const completedCount = plan.stops.filter(
    stop => stop.status === "completed"
  ).length;
  const progress = plan.stops.length ? completedCount / plan.stops.length : 0;
  const nextStop = executableDayLineStops(plan.stops)[0] ?? null;
  const startNext = () => {
    if (!nextStop) return props.onOpenImport();
    selectStop(nextStop);
  };

  return (
    <main
      className={`gdp-shell${forcedMobileViewport ? " gdp-shell--forced-mobile" : ""}${artPreview ? " gdp-shell--v2" : ""}`}
      style={{ "--gdp-world": `url(${world})` } as React.CSSProperties}
    >
      <PreparedOpportunityCard className="gdp-prepared" />
      <MissionFollowUpCard
        followUp={props.missionFollowUp ?? null}
        onAnswer={props.onAnswerMissionFollowUp}
      />
      <DaphneMissionAdjustments commitments={props.commitments} />
      <CarriedForwardCard
        work={props.carriedForward ?? null}
        onComplete={props.onCompleteCommitment}
      />
      {!artPreview && (
        <button
          type="button"
          className="gdp-build-mission-cta"
          onClick={() => setBuildMissionOpen(true)}
          data-testid="build-mission-cta"
        >
          BUILD MISSION
        </button>
      )}
      <BuildMissionSheet
        open={buildMissionOpen}
        onOpenChange={setBuildMissionOpen}
      />
      {!artPreview && (
        <header className="gdp-header">
          <div className="gdp-brand">
            <Compass />
            <strong>GOLDLINE</strong>
            <small>SMALL ACTIONS. A WORLD CHANGED.</small>
          </div>
          <p>
            {plan.authoredDay?.headline ??
              (props.campaignTitle ? `${props.campaignTitle} · ` : "TODAY · ")}
            {!plan.authoredDay?.headline && dateHeading(props.businessDate)}
            {plan.authoredDay?.headline
              ? ` · ${dateHeading(props.businessDate)}`
              : null}
          </p>
          {plan.authoredDay?.framing ? (
            <p
              className="gdp-authored-framing"
              data-testid="authored-day-framing"
            >
              {plan.authoredDay.framing}
            </p>
          ) : null}
          {plan.missionPlan ? (
            <div
              className="gdp-mission-plan"
              data-testid="mission-director-plan"
            >
              {plan.missionPlan.status === "planned" ? (
                <>
                  <p>
                    <strong>Tomorrow's growth mission:</strong>{" "}
                    {plan.missionPlan.primary.title}
                  </p>
                  <p className="gdp-mission-explanation">
                    {plan.missionPlan.explanation}
                  </p>
                  <p className="gdp-mission-fallback">
                    If the day changes: {plan.missionPlan.fallback.title}
                  </p>
                </>
              ) : plan.missionPlan.status === "fallback_only" ? (
                <>
                  <p>
                    <strong>Tomorrow's fallback mission:</strong>{" "}
                    {plan.missionPlan.fallback.title}
                  </p>
                  <p className="gdp-mission-explanation">
                    {plan.missionPlan.explanation}
                  </p>
                </>
              ) : (
                <p className="gdp-mission-explanation">
                  {plan.missionPlan.remedy}
                </p>
              )}
            </div>
          ) : null}
          {props.currentDayLine ? (
            <details className="gdp-dayline-disclosure">
              <summary>DAY LINE DETAILS</summary>
              <CurrentDayLineBlock line={props.currentDayLine} />
            </details>
          ) : null}
          {props.weeklyReadiness?.length ? (
            <section
              className="gdp-weekly-readiness"
              data-testid="weekly-readiness-due-today"
              aria-label="Readiness due today"
            >
              <p>
                <strong>Ready for what's next</strong>
              </p>
              <ul>
                {props.weeklyReadiness.map(item => (
                  <li
                    key={`${item.neededForDate}:${item.text}`}
                    data-readiness-status={item.status}
                  >
                    <b>{item.text}</b>
                    <small>
                      {item.status.toUpperCase()} · for {item.missionTitle}
                    </small>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {props.onEnterChapter ? (
            <button
              type="button"
              className="gdp-chapter-entry"
              onClick={props.onEnterChapter}
              data-testid="enter-chapter-button"
            >
              A new Kingdom has opened — enter The Last Valet
            </button>
          ) : null}
          {props.campaignRunCard ? (
            <button
              type="button"
              className="gdp-campaign-run-card"
              onClick={props.campaignRunCard.onOpen}
              data-testid="bio-containment-day-line-card"
            >
              <img src={props.campaignRunCard.iconSrc} alt="" />
              <span>
                <small>CAMPAIGN RUN</small>
                <b>{props.campaignRunCard.title}</b>
              </span>
            </button>
          ) : null}
          {props.rescueMissionCard ? (
            <button
              type="button"
              className="gdp-campaign-run-card"
              onClick={props.rescueMissionCard.onOpen}
              data-testid="spirit-human-day-line-card"
            >
              <span>
                <small>
                  RESCUE · {props.rescueMissionCard.status.toUpperCase()}
                </small>
                <b>{props.rescueMissionCard.title}</b>
              </span>
            </button>
          ) : null}
          <button
            className="gdp-menu-button"
            type="button"
            onClick={() => setMenuOpen(value => !value)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
          {menuOpen && (
            <div className="gdp-menu">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  props.onOpenImport();
                }}
              >
                IMPORT ROUTE
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  props.onEnterOperations();
                }}
              >
                FIELD OPERATIONS
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  props.onEnterWorld();
                }}
              >
                EXPLORE OVERLAND
              </button>
              {props.onOpenFirstMission && (
                <button type="button" onClick={props.onOpenFirstMission}>
                  SIDE QUEST · THE FIRST SPARK
                </button>
              )}
            </div>
          )}
          <div className="gdp-counts">
            <div>
              <strong>{plan.counts.pickup}</strong>
              <span>PICKUPS</span>
            </div>
            <div>
              <strong>{plan.counts.dropoff}</strong>
              <span>DROPOFFS</span>
            </div>
            <div>
              <strong>{plan.counts.sales}</strong>
              <span>SALES STOPS</span>
            </div>
            <div>
              <strong>{plan.counts.prep}</strong>
              <span>PREP TASKS</span>
            </div>
          </div>
          <div className="gdp-summary">
            <span>{plan.stops.length} STOPS</span>
            <i>•</i>
            <span>{plan.fixedWindowCount} FIXED WINDOWS</span>
            <i>•</i>
            <span className={plan.cleanCloudCount ? "is-synced" : "is-needed"}>
              {plan.cleanCloudCount
                ? `${plan.cleanCloudCount} CLEANCloud SYNCED`
                : "IMPORT NEEDED"}
            </span>
          </div>
          <button
            className={`gdp-import ${plan.cleanCloudCount ? "is-synced" : ""}`}
            type="button"
            onClick={props.onOpenImport}
          >
            <CloudUpload />
            <span>
              <strong>{plan.cleanCloudCount ? "CLEANCloud" : "IMPORT"}</strong>
              {plan.cleanCloudCount
                ? `${plan.cleanCloudCount} STOPS SYNCED`
                : "TODAY'S ROUTE"}
            </span>
          </button>
        </header>
      )}

      {!artPreview && (
        <>
          <DriverVehicleDrawer
            completed={completedCount}
            total={plan.stops.length}
            cargo={props.cargoFixture}
          />
          <div className="gdp-chapter-invite">
            <span>
              <Flame />
              <strong>THE LANTERN RUN</strong>
              <small>Three lanterns. Find your rhythm.</small>
            </span>
            <button type="button" onClick={() => setPlaying(true)}>
              PLAY <ChevronRight size={15} />
            </button>
          </div>
        </>
      )}
      {props.loadError && (
        <div className="gdp-load-error" role="alert">
          <strong>Your route needs a connection.</strong>
          <p>{props.loadError}</p>
          <button onClick={props.onRetry}>RETRY ROUTE</button>
        </div>
      )}
      <div className="gdp-trail-heading">
        <span>DAILY LINE</span>
        <span>
          {completedCount} / {plan.stops.length} COMPLETE
        </span>
      </div>
      {props.recoveryOutreachCard ? (
        <RecoveryOutreachCard
          card={props.recoveryOutreachCard}
          onOpen={props.onOpenRecoveryOutreach}
          onSchedule={props.onScheduleRecoveryOutreach}
          onEdit={props.onEditRecoveryDraft}
        />
      ) : null}

      {artPreview && props.currentDayLine && (
        <details className="gdp-dayline-disclosure">
          <summary>DAY LINE DETAILS</summary>
          <CurrentDayLineBlock line={props.currentDayLine} />
        </details>
      )}
      {props.firstMissionEvidence && (
        <section
          className="gdp-load-error"
          data-testid="day-line-first-mission-evidence"
          aria-label="Completed field evidence"
        >
          <strong>THE FIRST SPARK · FIELD OBSERVATION RECORDED</strong>
          <p>{props.firstMissionEvidence.text}</p>
          <small>
            Operator-attested observation ·{" "}
            {new Date(props.firstMissionEvidence.reportedAt).toLocaleString()}.
            No sale or revenue verified.
          </small>
        </section>
      )}
      {artPreview && (
        <details
          className="gdp-v2-operations"
          data-testid="goldline-world-operations"
        >
          <summary>FIELD OPERATIONS</summary>
          {props.isLoading && <p>Charting today's Day Line…</p>}
          {plan.stops.length === 0 && !props.isLoading && (
            <p>
              No Action Slots yet. Import your route or add an existing
              commitment.
            </p>
          )}
          <div className="gdp-v2-operations-actions">
            <button type="button" onClick={props.onOpenImport}>
              IMPORT OR ADD STOPS
            </button>
            <button type="button" onClick={props.onEnterOperations}>
              FIELD OPERATIONS
            </button>
            <button
              type="button"
              onClick={props.onOpenJournal ?? props.onEnterOperations}
            >
              JOURNAL
            </button>
          </div>
          {plan.growthCoverage !== "covered" &&
            !props.dismissedPromptKeys?.includes("growth-intake") &&
            !proposal &&
            props.onProposeCommitment && (
              <div className="gdp-v2-commitment">
                <label htmlFor="gdp-v2-commitment-text">
                  What needs to move forward today?
                </label>
                <textarea
                  id="gdp-v2-commitment-text"
                  value={truthText}
                  onChange={event => setTruthText(event.target.value)}
                />
                <button
                  type="button"
                  disabled={directorBusy || !truthText.trim()}
                  onClick={async () => {
                    setDirectorBusy(true);
                    try {
                      setDirectorError(null);
                      setProposal(await props.onProposeCommitment!(truthText));
                    } catch {
                      setDirectorError(
                        "Could not prepare your commitment. Text preserved."
                      );
                    } finally {
                      setDirectorBusy(false);
                    }
                  }}
                >
                  REVIEW COMMITMENT
                </button>
              </div>
            )}
          {proposal && (
            <div className="gdp-v2-commitment">
              <strong>{proposal.title}</strong>
              {proposal.question && <p>{proposal.question}</p>}
              <button
                type="button"
                disabled={directorBusy || !props.onAcceptProposal}
                onClick={async () => {
                  setDirectorBusy(true);
                  try {
                    setDirectorError(null);
                    await props.onAcceptProposal?.(proposal);
                    setProposal(null);
                    setTruthText("");
                  } catch {
                    setDirectorError("Could not add commitment; retry.");
                  } finally {
                    setDirectorBusy(false);
                  }
                }}
              >
                ADD TO DAY
              </button>
              <button
                type="button"
                disabled={directorBusy}
                onClick={async () => {
                  setDirectorBusy(true);
                  try {
                    await props.onDismissProposal?.(proposal.promptKey);
                    setProposal(null);
                  } catch {
                    setDirectorError("Could not dismiss this prompt.");
                  } finally {
                    setDirectorBusy(false);
                  }
                }}
              >
                NOT NOW
              </button>
            </div>
          )}
          {directorError && <p role="alert">{directorError}</p>}
        </details>
      )}
      {artPreview ? (
        <DaylineWorldCompositor
          stops={plan.stops}
          isLoading={props.isLoading}
          onSelect={selectStop}
          onEnterExistingChapter={props.onEnterChapter}
          onEnterOverworld={props.onEnterWorld}
          isDriving={props.isDriving ?? true}
          allowWalkingAnimation={Boolean(
            props.allowWalkingAnimation && props.isDriving === false
          )}
          sceneHeader={
            <ApprovedDaylineHeader
              businessDate={props.businessDate}
              navigationOpen={worldNavigationOpen}
              onToggleNavigation={() => setWorldNavigationOpen(open => !open)}
              onCallClaire={() => {
                callClaireForMission.mutate({
                  missionId:
                    nextStop?.action?.type === "commercial"
                      ? nextStop.action.missionId
                      : undefined,
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                });
              }}
            />
          }
          sceneFooter={
            <ApprovedDaylineDock
              navigationOpen={worldNavigationOpen}
              onLanternCity={() =>
                window.location.assign("/growth/lantern-city")
              }
              onDayLine={() => {
                setWorldNavigationOpen(false);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              onCollection={() => props.onOpenWeek?.()}
              onBriefings={() => setWorldNavigationOpen(open => !open)}
            />
          }
        />
      ) : (
        <section className="gdp-route" aria-label="Today's Gold Line">
          <svg
            className="gdp-line"
            viewBox="0 0 100 1000"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d="M50 0 C18 90 82 145 45 225 S75 365 48 455 S25 610 57 690 S80 825 48 1000" />
            <path
              className="gdp-line-complete"
              pathLength="1"
              strokeDasharray={`${progress} 1`}
              d="M50 0 C18 90 82 145 45 225 S75 365 48 455 S25 610 57 690 S80 825 48 1000"
            />
          </svg>
          {props.isLoading && (
            <div className="gdp-empty">Charting today’s Gold Line…</div>
          )}
          {directorError && !proposal && (
            <div className="gdp-director-error" role="alert">
              {directorError}
            </div>
          )}
          {!props.isLoading &&
            plan.growthCoverage !== "covered" &&
            !proposal &&
            !props.dismissedPromptKeys?.includes("growth-intake") && (
              <details
                className="gdp-director"
                data-testid="day-director-intake"
              >
                <summary>
                  ADD A COMMITMENT <ChevronRight size={16} />
                </summary>
                <strong>DAY DIRECTOR</strong>
                <p>What has to move forward today?</p>
                {!props.intelligenceAvailable && (
                  <small>
                    Planning intelligence unavailable — operational route
                    preserved. Add today’s commitment manually.
                  </small>
                )}
                <textarea
                  aria-label="Today's commitment"
                  value={truthText}
                  onChange={event => setTruthText(event.target.value)}
                  placeholder="Tell me what you committed to, promised, need to sell, or need to finish."
                />
                <div>
                  <button
                    type="button"
                    disabled={directorBusy || !truthText.trim()}
                    onClick={async () => {
                      if (!props.onProposeCommitment) return;
                      setDirectorBusy(true);
                      try {
                        setDirectorError(null);
                        setProposal(await props.onProposeCommitment(truthText));
                      } catch {
                        setDirectorError(
                          "Could not prepare this commitment. Your text is kept; please try again."
                        );
                      } finally {
                        setDirectorBusy(false);
                      }
                    }}
                  >
                    {props.intelligenceAvailable
                      ? "REVIEW PLAN"
                      : "ADD MANUALLY"}
                  </button>
                  <button
                    type="button"
                    disabled={directorBusy}
                    onClick={async () => {
                      try {
                        await props.onDismissProposal?.("growth-intake");
                        setProposal(null);
                      } catch {
                        setDirectorError(
                          "Could not dismiss this prompt. Please try again."
                        );
                      }
                    }}
                  >
                    NOT NOW
                  </button>
                </div>
              </details>
            )}
          {proposal &&
            !props.dismissedPromptKeys?.includes(proposal.promptKey) && (
              <aside
                className="gdp-director"
                data-testid="day-director-proposal"
              >
                <strong>DAY DIRECTOR</strong>
                <p>
                  {proposal.title}
                  {proposal.quantity ? ` · ${proposal.quantity}` : ""}
                </p>
                {proposal.question && <small>{proposal.question}</small>}
                {directorError && (
                  <small className="gdp-director-error" role="alert">
                    {directorError}
                  </small>
                )}
                <div>
                  <button
                    type="button"
                    disabled={directorBusy}
                    onClick={async () => {
                      setDirectorBusy(true);
                      try {
                        setDirectorError(null);
                        await props.onAcceptProposal?.(proposal);
                        setProposal(null);
                        setTruthText("");
                      } catch {
                        setDirectorError(
                          "Could not add this to Today. Please try again."
                        );
                      } finally {
                        setDirectorBusy(false);
                      }
                    }}
                  >
                    ADD TO PLAN
                  </button>
                  <button
                    type="button"
                    disabled={directorBusy}
                    onClick={async () => {
                      setDirectorBusy(true);
                      try {
                        setDirectorError(null);
                        await props.onDismissProposal?.(proposal.promptKey);
                        setProposal(null);
                      } catch {
                        setDirectorError(
                          "Could not dismiss this prompt. Please try again."
                        );
                      } finally {
                        setDirectorBusy(false);
                      }
                    }}
                  >
                    NOT NOW
                  </button>
                </div>
              </aside>
            )}
          {!props.isLoading && !props.loadError && plan.stops.length === 0 && (
            <div className="gdp-empty">
              <strong>
                {props.onOpenFirstMission
                  ? "Your first objective is ready."
                  : "A blank page. Your next chapter."}
              </strong>
              <span>
                {props.onOpenFirstMission
                  ? "Your scout mission is waiting. Complete your field observation to map your territory and uncover your world."
                  : "No stops are scheduled yet. Bring in your route, capture a field opportunity, or warm up with a Lantern Run."}
              </span>
              {props.onOpenFirstMission ? (
                <button
                  type="button"
                  className="gdp-first-mission-btn"
                  onClick={props.onOpenFirstMission}
                >
                  BEGIN FIRST MISSION · THE FIRST SPARK{" "}
                  <ChevronRight size={16} />
                </button>
              ) : (
                <button type="button" onClick={props.onOpenImport}>
                  IMPORT OR ADD STOPS <ChevronRight size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={props.onOpenJournal ?? props.onEnterOperations}
              >
                OPEN FIELD JOURNAL
              </button>
            </div>
          )}
          {plan.stops.map((stop, index) => (
            <div className="gdp-route-step" key={stop.id}>
              {index === completedCount && (
                <div className="gdp-now">
                  <div>
                    <strong>NOW</strong>
                    <span>
                      {now.toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    <small>Day-progress position</small>
                  </div>
                  <img
                    src={operator}
                    alt="Trailblazer at the current point in the day"
                  />
                </div>
              )}
              <StopCard
                stop={stop}
                index={index}
                onOpen={() => selectStop(stop)}
              />
            </div>
          ))}
          {completedCount === plan.stops.length && (
            <div className="gdp-now">
              <div>
                <strong>NOW</strong>
                <span>
                  {now.toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <small>Day-progress position</small>
              </div>
              <img
                src={operator}
                alt="Trailblazer at the current point in the day"
              />
            </div>
          )}
        </section>
      )}
      {!artPreview && (
        <section className="gdp-next-up" data-testid="day-plan-next-up">
          <div>
            <small>NEXT UP</small>
            <strong>
              {nextStop?.title ??
                (props.onOpenFirstMission
                  ? "THE FIRST SPARK"
                  : "THE LINE IS OPEN")}
            </strong>
            <span>
              {nextStop
                ? `${KIND_LABEL[nextStop.kind]} · ${nextStop.timeLabel}`
                : props.onOpenFirstMission
                  ? "OPTIONAL SCOUT · TERRITORY UNMAPPED"
                  : "NO SCHEDULED STOP"}
            </span>
          </div>
          <button
            type="button"
            onClick={
              nextStop
                ? startNext
                : props.onOpenFirstMission
                  ? props.onOpenFirstMission
                  : startNext
            }
            disabled={props.isLoading}
          >
            {nextStop
              ? "OPEN CHAPTER"
              : props.onOpenFirstMission
                ? "START MISSION"
                : "ADD STOPS"}{" "}
            <ChevronRight />
          </button>
        </section>
      )}
      {!artPreview && (
        <>
          <button
            type="button"
            className="gdp-v3-nav-toggle"
            onClick={() => setWorldNavigationOpen(open => !open)}
            aria-label={
              worldNavigationOpen
                ? "Close GOLDLINE navigation"
                : "Open GOLDLINE navigation"
            }
            aria-expanded={worldNavigationOpen}
          >
            <Compass size={23} />
            <span>{worldNavigationOpen ? "CLOSE" : "WORLD"}</span>
          </button>
          <div className="gdp-v3-classic-nav">
            <GoldlineGameNav
              active="day"
              onYourDay={() => {
                setWorldNavigationOpen(false);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              onWeek={props.onOpenWeek}
              onPlay={() => {
                setWorldNavigationOpen(false);
                setPlaying(true);
              }}
              onJournal={props.onOpenJournal ?? props.onEnterOperations}
            />
          </div>
        </>
      )}
      {artPreview && worldNavigationOpen && (
        <div
          className="gdp-v3-nav-layer gdp-approved-navigation"
          id="goldline-world-navigation"
        >
          <GoldlineGameNav
            active="day"
            onYourDay={() => {
              setWorldNavigationOpen(false);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onWeek={props.onOpenWeek}
            onPlay={() => {
              setWorldNavigationOpen(false);
              setPlaying(true);
            }}
            onJournal={props.onOpenJournal ?? props.onEnterOperations}
          />
          <div className="gdp-approved-navigation-actions">
            <button
              type="button"
              data-testid="build-mission-cta"
              onClick={() => {
                setWorldNavigationOpen(false);
                setBuildMissionOpen(true);
              }}
            >
              BUILD MISSION
            </button>
            <button
              type="button"
              onClick={() => {
                setWorldNavigationOpen(false);
                props.onOpenImport();
              }}
            >
              IMPORT OR ADD STOPS
            </button>
            <button
              type="button"
              onClick={() => {
                setWorldNavigationOpen(false);
                props.onEnterOperations();
              }}
            >
              FIELD OPERATIONS
            </button>
            <button
              type="button"
              onClick={() => {
                setWorldNavigationOpen(false);
                props.onEnterWorld();
              }}
            >
              EXPLORE OVERWORLD
            </button>
            {props.onEnterChapter && (
              <button
                type="button"
                onClick={() => {
                  setWorldNavigationOpen(false);
                  props.onEnterChapter?.();
                }}
              >
                ENTER KINGDOM
              </button>
            )}
            {props.onOpenFirstMission && (
              <button
                type="button"
                onClick={() => {
                  setWorldNavigationOpen(false);
                  props.onOpenFirstMission?.();
                }}
              >
                THE FIRST SPARK
              </button>
            )}
          </div>
        </div>
      )}
      {activeStop && (
        <DriverStopChapter
          stop={
            plan.stops.find(stop => stop.id === activeStop.id) ?? activeStop
          }
          onClose={() => setActiveStop(null)}
          onResolve={props.onResolveStop}
          onRetryPickup={props.onRetryPickup}
          onArchive={props.onArchiveStop}
          onCallClaireForMission={async missionId => {
            await callClaireForMission.mutateAsync({
              missionId,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
          }}
          onEnter={() => {
            props.onEnterWorld(activeStop.id);
            setActiveStop(null);
          }}
          onJournal={() => {
            setActiveStop(null);
            (props.onOpenJournal ?? props.onEnterOperations)();
          }}
          onPlay={() => {
            setActiveStop(null);
            setPlaying(true);
          }}
        />
      )}
      {playing && <LanternRun onClose={() => setPlaying(false)} />}

      {!artPreview && (
        <footer className="gdp-world-entry">
          <button type="button" onClick={() => props.onEnterWorld()}>
            <span>ENTER</span>
            <span>THE WORLD</span>
            <ChevronRight />
          </button>
        </footer>
      )}
    </main>
  );
}
