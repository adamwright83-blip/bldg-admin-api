import { useEffect, useMemo, useState } from "react";
import "./day1-ten-doors.css";
import {
  DAY1_DAY_INDEX,
  DAY1_LOCATION_POLL_MS,
  DAY1_MISSION_LINE,
  RESCUE_TOTAL_DAYS,
  effectiveArrivalRadiusMeters,
  haversineMeters,
  type Day1Target,
  type Day1TargetOutcome,
} from "../../../../shared/day1TenDoors";
import {
  requestGoldlineLocation,
  type GoldlineLocationSnapshot,
} from "../driver/goldlineDriverModel";

export type Day1TenDoorsMissionView = {
  missionId: string;
  targets: Day1Target[];
  outcomes: Record<string, Day1TargetOutcome>;
  currentTarget: Day1Target | null;
  progressLabel: string | null;
  visitedCount: number;
  totalCount: number;
  isComplete: boolean;
  outcomeCounts: { pitched: number; couldntReach: number };
};

export type Day1TenDoorsPresentation = {
  eyebrow?: string;
  title?: string;
  missionLine?: string;
  completeTitle?: string;
};

const ORDINALS = [
  "FIRST",
  "SECOND",
  "THIRD",
  "FOURTH",
  "FIFTH",
  "SIXTH",
  "SEVENTH",
  "EIGHTH",
  "NINTH",
  "TENTH",
];

function outcomeLabel(outcome: Day1TargetOutcome): string {
  return outcome === "pitched" ? "PITCHED" : "COULDN'T REACH";
}

export default function Day1TenDoors({
  mission,
  isRecordingOutcome,
  onRecordOutcome,
  onDismiss,
  presentation,
}: {
  mission: Day1TenDoorsMissionView;
  isRecordingOutcome: boolean;
  onRecordOutcome: (targetId: string, outcome: Day1TargetOutcome) => void;
  onDismiss: () => void;
  presentation?: Day1TenDoorsPresentation;
}) {
  const [location, setLocation] = useState<GoldlineLocationSnapshot>({
    status: "requesting",
    coordinates: null,
    accuracyMeters: null,
    reason: null,
  });
  const [showFullRoute, setShowFullRoute] = useState(false);
  /**
   * GPS may HELP, never BLOCK. Manual check-in is operator-confirmed
   * location context — it never itself claims a pitch happened, it only
   * unlocks the same two outcome buttons automatic arrival would. Keyed
   * by target id and reset the moment the current target changes, so a
   * stale check-in from a prior stop can never leak onto the next one.
   */
  const [manuallyCheckedInTargetId, setManuallyCheckedInTargetId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (mission.isComplete) return;

    let active = true;
    function poll() {
      void requestGoldlineLocation(navigator.geolocation).then(result => {
        if (active) setLocation(result);
      });
    }
    poll();
    const interval = window.setInterval(poll, DAY1_LOCATION_POLL_MS);

    // Poll immediately on returning to the app — e.g. after NAVIGATE opened
    // Google Maps and the operator switched back — rather than waiting up
    // to DAY1_LOCATION_POLL_MS for the next scheduled tick. Foreground-only:
    // both listeners only ever fire while this tab is the one being looked
    // at, never in the background.
    function onForegroundReturn() {
      if (document.visibilityState === "visible") poll();
    }
    document.addEventListener("visibilitychange", onForegroundReturn);
    window.addEventListener("focus", onForegroundReturn);

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onForegroundReturn);
      window.removeEventListener("focus", onForegroundReturn);
    };
  }, [mission.isComplete]);

  const currentTarget = mission.currentTarget;

  // A stale manual check-in from a previous stop must never carry forward.
  useEffect(() => {
    setManuallyCheckedInTargetId(null);
  }, [currentTarget?.id]);

  const distanceToCurrentTarget = useMemo(() => {
    if (!currentTarget || location.status !== "available") return null;
    return haversineMeters(
      { lat: location.coordinates.latitude, lng: location.coordinates.longitude },
      { lat: currentTarget.lat, lng: currentTarget.lng }
    );
  }, [currentTarget, location]);

  const autoArrived =
    currentTarget != null &&
    distanceToCurrentTarget != null &&
    distanceToCurrentTarget <=
      effectiveArrivalRadiusMeters(
        currentTarget,
        location.status === "available" ? location.accuracyMeters : null
      );

  const manuallyCheckedIn =
    currentTarget != null && manuallyCheckedInTargetId === currentTarget.id;

  const arrived = autoArrived || manuallyCheckedIn;

  if (mission.isComplete) {
    return (
      <div className="day1-screen day1-screen--complete">
        <div className="day1-header">
          <div className="day1-eyebrow">DAY {DAY1_DAY_INDEX} COMPLETE</div>
          <div className="day1-title">
            {presentation?.completeTitle ?? "10 DOORS VISITED"}
          </div>
        </div>
        <div className="day1-complete-breakdown">
          <div className="day1-complete-row">
            <span className="day1-complete-count">
              {mission.outcomeCounts.pitched}
            </span>
            <span className="day1-complete-label">PITCHED</span>
          </div>
          <div className="day1-complete-row">
            <span className="day1-complete-count">
              {mission.outcomeCounts.couldntReach}
            </span>
            <span className="day1-complete-label">COULDN'T REACH</span>
          </div>
        </div>
        <button
          type="button"
          className="day1-btn day1-btn--primary"
          onClick={onDismiss}
          data-testid="day1-continue"
        >
          CONTINUE TO GOLDLINE
        </button>
      </div>
    );
  }

  const targetIndex = currentTarget
    ? mission.targets.findIndex(target => target.id === currentTarget.id)
    : -1;

  return (
    <div className="day1-screen" data-testid="day1-screen">
      <div className="day1-header">
        <div className="day1-eyebrow">
          {presentation?.eyebrow ?? `${RESCUE_TOTAL_DAYS} DAYS TO SAVE THE BUSINESS`}
        </div>
        <div className="day1-title">
          {presentation?.title ?? `DAY ${DAY1_DAY_INDEX} — THE TEN DOORS`}
        </div>
        <div className="day1-mission-line">
          {presentation?.missionLine ?? DAY1_MISSION_LINE}
        </div>
        <div className="day1-progress" data-testid="day1-progress">
          {mission.visitedCount} / {mission.totalCount} VISITED
        </div>
      </div>

      {currentTarget && !arrived && (
        <div className="day1-target-card" data-testid="day1-target-card">
          <div className="day1-target-of">{mission.progressLabel}</div>
          <div className="day1-target-name">{currentTarget.name}</div>
          <div className="day1-target-neighborhood">
            {currentTarget.neighborhood}
          </div>
          <div className="day1-target-address">{currentTarget.address}</div>
          <div
            className={
              currentTarget.isGreystar
                ? "day1-manager-badge day1-manager-badge--greystar"
                : "day1-manager-badge"
            }
          >
            {currentTarget.isGreystar
              ? "GREYSTAR"
              : currentTarget.managerLabel
                ? currentTarget.managerLabel.toUpperCase()
                : "MANAGER UNKNOWN"}
          </div>
          <div className="day1-target-note">{currentTarget.prospectNote}</div>
          <a
            className="day1-btn day1-btn--navigate"
            href={currentTarget.navigationUrl}
            target="_blank"
            rel="noreferrer"
            data-testid="day1-navigate"
          >
            NAVIGATE
          </a>
          {/* Always available, regardless of location permission/accuracy —
              GPS may help recognize arrival, it may never be the only way
              to reach the pitch outcome buttons. */}
          <button
            type="button"
            className="day1-btn day1-btn--checkin"
            onClick={() => setManuallyCheckedInTargetId(currentTarget.id)}
            data-testid="day1-checkin"
          >
            I'M HERE — CHECK IN
          </button>
        </div>
      )}

      {currentTarget && arrived && (
        <div className="day1-arrival-card" data-testid="day1-arrival-card">
          <div className="day1-arrival-headline">
            YOU'VE REACHED THE {ORDINALS[Math.max(0, targetIndex)]} DOOR
          </div>
          <div className="day1-target-name">{currentTarget.name}</div>
          <div className="day1-arrival-sub">
            GO INSIDE. ASK FOR THE GENERAL MANAGER OR PROPERTY MANAGER. PITCH
            LAUNDRY BUTLER.
          </div>
          <div className="day1-outcome-buttons">
            <button
              type="button"
              className="day1-btn day1-btn--pitch"
              disabled={isRecordingOutcome}
              onClick={() => onRecordOutcome(currentTarget.id, "pitched")}
              data-testid="day1-pitched"
            >
              I MADE THE PITCH
            </button>
            <button
              type="button"
              className="day1-btn day1-btn--couldnt-reach"
              disabled={isRecordingOutcome}
              onClick={() => onRecordOutcome(currentTarget.id, "couldnt_reach")}
              data-testid="day1-couldnt-reach"
            >
              COULDN'T REACH THEM
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="day1-route-toggle"
        onClick={() => setShowFullRoute(value => !value)}
        data-testid="day1-route-toggle"
      >
        {showFullRoute ? "HIDE FULL ROUTE" : "SEE FULL ROUTE"}
      </button>

      {showFullRoute && (
        <ol className="day1-route-list" data-testid="day1-route-list">
          {mission.targets.map((target, index) => {
            const outcome = mission.outcomes[target.id];
            const isCurrent = currentTarget?.id === target.id;
            return (
              <li
                key={target.id}
                className={
                  outcome
                    ? "day1-route-item day1-route-item--done"
                    : isCurrent
                      ? "day1-route-item day1-route-item--current"
                      : "day1-route-item"
                }
              >
                <span className="day1-route-index">{index + 1}</span>
                <span className="day1-route-name">{target.name}</span>
                <span className="day1-route-status">
                  {outcome ? outcomeLabel(outcome) : isCurrent ? "EN ROUTE" : ""}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
