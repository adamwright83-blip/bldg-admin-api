import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileText,
  Loader2,
  LocateFixed,
  MapPin,
  Navigation,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useRoute } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { trpc } from "@/lib/trpc";
import {
  FIELD_OUTCOME_REASONS,
  type FieldOutcomeReason,
} from "@shared/commercialMissionField";
import "./commercial-sales-mission.css";

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function requestId(): string {
  return crypto.randomUUID();
}

function SectionHeader({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <header className="csm-screen-head">
      <span>{eyebrow}</span>
      <h1>{title}</h1>
      {body ? <p>{body}</p> : null}
    </header>
  );
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  secondary = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <button
      type="button"
      className={`csm-action${secondary ? " is-secondary" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export default function CommercialSalesMission() {
  const [, params] = useRoute("/driver/sales-mission/:missionId");
  const missionId = Number(params?.missionId);
  const validMissionId = Number.isInteger(missionId) && missionId > 0;
  const { loading: authLoading, isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const stateQuery = trpc.system.commercialMission.fieldState.useQuery(
    { missionId: validMissionId ? missionId : 1 },
    { enabled: isAuthenticated && validMissionId, retry: false }
  );
  const startPreparation =
    trpc.system.commercialMission.fieldStartPreparation.useMutation();
  const checklistMutation =
    trpc.system.commercialMission.fieldChecklist.useMutation();
  const departMutation =
    trpc.system.commercialMission.fieldDepart.useMutation();
  const arriveMutation =
    trpc.system.commercialMission.fieldArrive.useMutation();
  const notesMutation =
    trpc.system.commercialMission.fieldSaveNotes.useMutation();
  const outcomeMutation =
    trpc.system.commercialMission.fieldOutcome.useMutation();
  const handoffMutation =
    trpc.system.commercialMission.consumePhoneHandoff.useMutation();
  const [notes, setNotes] = useState("");
  const [decisionMakerStatus, setDecisionMakerStatus] = useState<
    "met" | "unavailable" | "not_recorded"
  >("not_recorded");
  const [collateralDelivered, setCollateralDelivered] = useState(false);
  const [quoteRequested, setQuoteRequested] = useState(false);
  const [pilotRequested, setPilotRequested] = useState(false);
  const [followUpRequested, setFollowUpRequested] = useState(false);
  const [followUpAt, setFollowUpAt] = useState("");
  const [reason, setReason] = useState<FieldOutcomeReason>("other");
  const [actionError, setActionError] = useState<string | null>(null);
  const consumedHandoffRef = useRef(false);

  const state = stateQuery.data;
  const mission = state?.mission;
  useEffect(() => {
    if (state?.field) setNotes(state.field.notes);
  }, [state?.field?.notes]);

  useEffect(() => {
    if (!isAuthenticated || !validMissionId || consumedHandoffRef.current)
      return;
    const token = new URLSearchParams(window.location.search).get("handoff");
    if (!token) return;
    consumedHandoffRef.current = true;
    window.history.replaceState({}, "", `/driver/sales-mission/${missionId}`);
    handoffMutation.mutate(
      { missionId, token },
      {
        onSuccess: next => {
          if (next)
            utils.system.commercialMission.fieldState.setData(
              { missionId },
              next
            );
        },
        onError: error => setActionError(error.message),
      }
    );
  }, [handoffMutation, isAuthenticated, missionId, utils, validMissionId]);

  const mutate = async <T,>(
    operation: () => Promise<T>,
    adopt: (value: T) => void
  ) => {
    setActionError(null);
    try {
      const result = await operation();
      adopt(result);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The mission could not be updated."
      );
    }
  };

  const adoptState = (next: NonNullable<typeof state>) => {
    utils.system.commercialMission.fieldState.setData({ missionId }, next);
  };

  const allRequiredReady =
    Boolean(state?.checklist.some(item => item.required)) &&
    (state?.checklist.every(
      item => !item.required || item.status === "completed"
    ) ??
      false);
  const busy =
    startPreparation.isPending ||
    checklistMutation.isPending ||
    departMutation.isPending ||
    arriveMutation.isPending ||
    notesMutation.isPending ||
    outcomeMutation.isPending;
  const stageIndex = mission
    ? ((
        {
          phone_ready: 0,
          preparing: 1,
          en_route: 2,
          arrived: 3,
          visit_completed: 4,
          follow_up: 4,
          won: 4,
          lost: 4,
        } as Record<string, number>
      )[mission.status] ?? 0)
    : 0;

  const annualValue = useMemo(
    () => (mission ? money(mission.opportunity.estimatedAnnualValueCents) : ""),
    [mission]
  );

  if (authLoading)
    return (
      <main className="csm-root">
        <Loader2 className="csm-loader" />
      </main>
    );
  if (!isAuthenticated)
    return (
      <LoginForm role="driver" onSuccess={() => window.location.reload()} />
    );
  if (!validMissionId)
    return (
      <main className="csm-root">
        <div className="csm-error">Invalid commercial mission ID.</div>
      </main>
    );
  if (stateQuery.isLoading)
    return (
      <main className="csm-root">
        <Loader2 className="csm-loader" />
      </main>
    );
  if (stateQuery.error || !state || !mission)
    return (
      <main className="csm-root">
        <div className="csm-error">
          {stateQuery.error?.message ?? "Mission unavailable"}
        </div>
      </main>
    );

  const arriveWithLocation = () => {
    if (!navigator.geolocation) {
      setActionError("Location is unavailable. Use manual check-in instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position =>
        void mutate(
          () =>
            arriveMutation.mutateAsync({
              missionId,
              expectedMissionVersion: mission.version,
              expectedFieldVersion: state.field!.version,
              requestId: requestId(),
              checkInMethod: "location",
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              locationAccuracyMeters: Math.round(position.coords.accuracy),
            }),
          next => next && adoptState(next)
        ),
      () =>
        setActionError(
          "Location permission was not granted. Manual check-in remains available."
        ),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
    );
  };

  const submitOutcome = (outcome: "follow_up" | "won" | "lost") =>
    void mutate(
      () =>
        outcomeMutation.mutateAsync({
          missionId,
          expectedMissionVersion: mission.version,
          expectedFieldVersion: state.field!.version,
          requestId: requestId(),
          outcome,
          notes,
          followUpAt:
            outcome === "follow_up" && followUpAt
              ? new Date(followUpAt)
              : undefined,
          decisionMakerStatus,
          collateralDelivered,
          quoteRequested,
          pilotRequested,
          followUpRequested,
          reason: outcome === "lost" ? reason : undefined,
        }),
      adoptState
    );

  return (
    <main className="csm-root">
      <div className="csm-phone-shell">
        <div className="csm-statusbar" aria-hidden="true">
          <span>DAYFORGE FIELD</span>
          <span>SECURE · LIVE</span>
        </div>
        <nav className="csm-nav">
          <div>
            <small>{mission.code}</small>
            <b>{mission.account.name}</b>
          </div>
          <span className="csm-live-dot">SERVER</span>
        </nav>
        <div className="csm-progress" aria-label={`Mission ${mission.status}`}>
          {[0, 1, 2, 3, 4].map(step => (
            <i key={step} className={step <= stageIndex ? "is-done" : ""} />
          ))}
        </div>
        {actionError ? (
          <div className="csm-error" role="alert">
            {actionError}
          </div>
        ) : null}

        <section className="csm-screen">
          {mission.status === "phone_ready" ? (
            <>
              <SectionHeader
                eyebrow="MISSION UNLOCKED"
                title={`${mission.account.name} is ready for the field.`}
                body="This is the same persisted mission you completed in BORESLAY."
              />
              <article className="csm-hero-card">
                <Building2 />
                <div>
                  <small>{mission.account.accountType}</small>
                  <h2>{mission.account.name}</h2>
                  <p>{mission.account.address}</p>
                </div>
                <strong>
                  {annualValue}
                  <small>EST. ANNUAL VALUE</small>
                </strong>
              </article>
              <div className="csm-facts">
                <article>
                  <UserRound />
                  <span>
                    <small>ASK FOR</small>
                    <b>
                      {mission.account.decisionMaker.name ??
                        "Decision-maker not yet identified"}
                    </b>
                    <em>
                      {mission.account.decisionMaker.title ??
                        "Confirm the right contact"}
                    </em>
                  </span>
                </article>
                <article>
                  <Sparkles />
                  <span>
                    <small>WHY NOW</small>
                    <b>{mission.opportunity.primarySignal}</b>
                    <em>
                      {mission.opportunity.estimateConfidence} confidence
                      estimate
                    </em>
                  </span>
                </article>
                <article>
                  <ShieldCheck />
                  <span>
                    <small>BEST ANGLE</small>
                    <b>{mission.brief.salesAngle}</b>
                    <em>
                      Use sourced facts and confirm assumptions in person.
                    </em>
                  </span>
                </article>
              </div>
              <ActionButton
                disabled={busy}
                onClick={() =>
                  void mutate(
                    () =>
                      startPreparation.mutateAsync({
                        missionId,
                        expectedMissionVersion: mission.version,
                        requestId: requestId(),
                      }),
                    adoptState
                  )
                }
              >
                Start mission preparation <ArrowRight />
              </ActionButton>
            </>
          ) : null}

          {mission.status === "preparing" && state.field ? (
            <>
              <SectionHeader
                eyebrow="PREPARE"
                title="Walk in ready."
                body="Every check is persisted. Required items must be complete before departure."
              />
              <div className="csm-checklist">
                {state.checklist.map(item => (
                  <button
                    type="button"
                    key={item.itemKey}
                    className={item.status === "completed" ? "is-complete" : ""}
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        () =>
                          checklistMutation.mutateAsync({
                            missionId,
                            expectedFieldVersion: state.field!.version,
                            itemKey: item.itemKey,
                            status:
                              item.status === "completed"
                                ? "pending"
                                : "completed",
                            requestId: requestId(),
                          }),
                        adoptState
                      )
                    }
                  >
                    <span>
                      <FileText />
                    </span>
                    <span>
                      <b>
                        {item.label}
                        {item.required ? " *" : ""}
                      </b>
                      <small>{item.detail}</small>
                    </span>
                    <i>{item.status === "completed" ? <Check /> : null}</i>
                  </button>
                ))}
              </div>
              <div className="csm-collateral-note">
                <FileText />
                <div>
                  <b>Proposal & collateral</b>
                  <p>
                    The approved version and print status attach here in the
                    proposal production stack. DayForge will never display demo
                    collateral as ready.
                  </p>
                </div>
              </div>
              <ActionButton
                disabled={busy || !allRequiredReady}
                onClick={() =>
                  void mutate(
                    () =>
                      departMutation.mutateAsync({
                        missionId,
                        expectedMissionVersion: mission.version,
                        expectedFieldVersion: state.field!.version,
                        requestId: requestId(),
                      }),
                    next => next && adoptState(next)
                  )
                }
              >
                Depart for account <Navigation />
              </ActionButton>
            </>
          ) : null}

          {mission.status === "en_route" && state.field ? (
            <>
              <SectionHeader
                eyebrow="EN ROUTE"
                title="Finish the mission in the real world."
                body="Navigation opens outside DayForge. Return here to check in."
              />
              <div className="csm-route-card">
                <MapPin />
                <div>
                  <small>DESTINATION</small>
                  <h2>{mission.account.name}</h2>
                  <p>{mission.account.address}</p>
                </div>
              </div>
              <a
                className="csm-action"
                href={state.navigationUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open navigation <Navigation />
              </a>
              <ActionButton disabled={busy} onClick={arriveWithLocation}>
                <LocateFixed /> Check in with location
              </ActionButton>
              <ActionButton
                secondary
                disabled={busy}
                onClick={() =>
                  void mutate(
                    () =>
                      arriveMutation.mutateAsync({
                        missionId,
                        expectedMissionVersion: mission.version,
                        expectedFieldVersion: state.field!.version,
                        requestId: requestId(),
                        checkInMethod: "manual",
                      }),
                    next => next && adoptState(next)
                  )
                }
              >
                Manual check-in
              </ActionButton>
              <p className="csm-privacy">
                Location is optional. DayForge stores coordinates only when you
                explicitly choose location check-in.
              </p>
            </>
          ) : null}

          {mission.status === "arrived" && state.field ? (
            <>
              <SectionHeader
                eyebrow="ARRIVED"
                title="Walk in with the opener ready."
                body="Confirm what you learn. Do not treat estimates as facts."
              />
              <div className="csm-script">
                <small>OPENING LINE</small>
                <blockquote>“{mission.brief.openingLine}”</blockquote>
                <small>BEST ANGLE</small>
                <p>{mission.brief.salesAngle}</p>
              </div>
              <div className="csm-question-list">
                <h3>DISCOVERY QUESTIONS</h3>
                {mission.brief.discoveryQuestions.map(question => (
                  <p key={question}>{question}</p>
                ))}
              </div>
              <label className="csm-notes">
                <span>VISIT NOTES</span>
                <textarea
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  rows={5}
                  placeholder="Record only what happened and what was said…"
                />
              </label>
              <ActionButton
                secondary
                disabled={busy || notes === state.field.notes}
                onClick={() =>
                  void mutate(
                    () =>
                      notesMutation.mutateAsync({
                        missionId,
                        expectedFieldVersion: state.field!.version,
                        notes,
                        requestId: requestId(),
                      }),
                    next => next && adoptState(next)
                  )
                }
              >
                Save notes
              </ActionButton>
              <div className="csm-visit-facts">
                <label>
                  Decision-maker
                  <select
                    value={decisionMakerStatus}
                    onChange={event =>
                      setDecisionMakerStatus(
                        event.target.value as typeof decisionMakerStatus
                      )
                    }
                  >
                    <option value="not_recorded">Not recorded</option>
                    <option value="met">Met</option>
                    <option value="unavailable">Unavailable</option>
                  </select>
                </label>
                {[
                  [
                    "Collateral delivered",
                    collateralDelivered,
                    setCollateralDelivered,
                  ],
                  ["Quote requested", quoteRequested, setQuoteRequested],
                  ["Pilot requested", pilotRequested, setPilotRequested],
                  [
                    "Follow-up requested",
                    followUpRequested,
                    setFollowUpRequested,
                  ],
                ].map(([label, checked, setter]) => (
                  <label key={String(label)}>
                    <input
                      type="checkbox"
                      checked={Boolean(checked)}
                      onChange={event =>
                        (setter as (value: boolean) => void)(
                          event.target.checked
                        )
                      }
                    />{" "}
                    {String(label)}
                  </label>
                ))}
              </div>
              <label className="csm-followup">
                Follow-up date
                <input
                  type="datetime-local"
                  value={followUpAt}
                  onChange={event => setFollowUpAt(event.target.value)}
                />
              </label>
              <label className="csm-followup">
                Lost reason
                <select
                  value={reason}
                  onChange={event =>
                    setReason(event.target.value as FieldOutcomeReason)
                  }
                >
                  {FIELD_OUTCOME_REASONS.map(value => (
                    <option key={value} value={value}>
                      {value.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <div className="csm-outcomes">
                <ActionButton
                  disabled={busy || !notes.trim()}
                  onClick={() => submitOutcome("won")}
                >
                  <CheckCircle2 /> Account won
                </ActionButton>
                <ActionButton
                  secondary
                  disabled={busy || !notes.trim() || !followUpAt}
                  onClick={() => submitOutcome("follow_up")}
                >
                  <Clock3 /> Follow-up needed
                </ActionButton>
                <ActionButton
                  secondary
                  disabled={busy || !notes.trim()}
                  onClick={() => submitOutcome("lost")}
                >
                  Not a fit
                </ActionButton>
              </div>
            </>
          ) : null}

          {["follow_up", "won", "lost"].includes(mission.status) ? (
            <div
              className={`csm-complete${mission.status === "won" ? " is-won" : ""}`}
            >
              <span>
                {mission.status === "won" ? <CheckCircle2 /> : <Clock3 />}
              </span>
              <small>{mission.code}</small>
              <h1>
                {mission.status === "won"
                  ? "Account won."
                  : mission.status === "follow_up"
                    ? "Follow-up recorded."
                    : "Mission learned from."}
              </h1>
              <p>{mission.account.name}</p>
              {mission.status === "won" ? (
                <strong>
                  <CircleDollarSign /> {annualValue} estimated contract value
                </strong>
              ) : null}
              <div className="csm-summary">
                <small>REALIZED REVENUE</small>
                <b>$0 until a paid order is attributed</b>
                <small>VISIT NOTES</small>
                <b>{state.visitOutcome?.notes || "No notes recorded"}</b>
              </div>
            </div>
          ) : null}
        </section>
        <footer className="csm-footer">
          <span>
            <Sparkles /> Same mission on every device
          </span>
          <small>
            ID {mission.id} · v{mission.version}
          </small>
        </footer>
      </div>
    </main>
  );
}
