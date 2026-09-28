import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarClock,
  Check,
  ChevronRight,
  Compass,
  FileText,
  Footprints,
  Loader2,
  MapPin,
  Package,
  Radar,
  Radio,
  Route,
  X,
} from "lucide-react";
import type { PlayableMission } from "../state/GameState";
import { RealActionBridge } from "../encounters/RealActionBridge";
import type { GoldlineActionDescriptor } from "./actionRegistry";
import type {
  GoldlineActionServices,
  GoldlineVisitContext,
  VisitOutcomeRequest,
} from "./actionServices";
import type { ClairePreVisitIntel } from "../../../../shared/missionSalesBrief";
import type { MissionLinkedDebriefState } from "../../../../shared/missionLinkedDebrief";
import { useAuthoritativeActionResume } from "./useAuthoritativeActionResume";

type SurfaceProps = {
  action: GoldlineActionDescriptor;
  mission: PlayableMission;
  requestId: string | null;
  services: GoldlineActionServices;
  onPersisted: () => void;
  onClose: () => void;
};

function SurfaceFrame(props: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  closeDisabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`goldline-action-surface${props.className ? ` ${props.className}` : ""}`}
      aria-label={`${props.eyebrow} action`}
    >
      <header>
        <span>
          <small>{props.eyebrow}</small>
          <b>{props.title}</b>
        </span>
        <button
          onClick={props.onClose}
          aria-label="Close action"
          disabled={props.closeDisabled}
        >
          <X />
        </button>
      </header>
      <div className="goldline-action-surface__body">{props.children}</div>
    </section>
  );
}

const TOWER_ENCOUNTER_SKINS = [
  { key: "mirror", codename: "THE MIRROR SHAFT" },
  { key: "lift", codename: "THE ENDLESS LIFT" },
  { key: "signal", codename: "THE SIGNAL FLOOR" },
  { key: "brass", codename: "THE BRASS ATRIUM" },
  { key: "glass", codename: "THE GLASS MAZE" },
  { key: "switchboard", codename: "THE SWITCHBOARD" },
] as const;

function towerEncounterSkin(missionId: number) {
  return TOWER_ENCOUNTER_SKINS[Math.abs(missionId) % TOWER_ENCOUNTER_SKINS.length];
}

function useMountedRef() {
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );
  return mounted;
}

function VisitSurface(
  props: SurfaceProps & {
    action: Extract<GoldlineActionDescriptor, { kind: "VISIT" }>;
    requestId: string;
  }
) {
  const [context, setContext] = useState<GoldlineVisitContext | null>(null);
  const [preVisitIntel, setPreVisitIntel] =
    useState<ClairePreVisitIntel | null>(null);
  const [intelLoading, setIntelLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [clerkText, setClerkText] = useState("");
  const [outcome, setOutcome] =
    useState<VisitOutcomeRequest["outcome"]>("no_decision");
  const [followUpAt, setFollowUpAt] = useState("");
  const [decisionMakerStatus, setDecisionMakerStatus] =
    useState<VisitOutcomeRequest["decisionMakerStatus"]>("not_recorded");
  const [collateralDelivered, setCollateralDelivered] = useState(false);
  const [quoteRequested, setQuoteRequested] = useState(false);
  const [pilotRequested, setPilotRequested] = useState(false);
  const [followUpRequested, setFollowUpRequested] = useState(false);
  const [missionDebrief, setMissionDebrief] =
    useState<MissionLinkedDebriefState | null>(null);
  const [debriefAnswer, setDebriefAnswer] = useState("");
  const [debriefAdditionalAnswer, setDebriefAdditionalAnswer] = useState("");
  const [showAdditionalQuestion, setShowAdditionalQuestion] = useState(false);
  const mounted = useMountedRef();
  const towerSkin = towerEncounterSkin(props.action.missionId!);

  async function refresh() {
    const next = await props.services.loadVisit(props.action.missionId!);
    await props.services.refetchAuthoritativeTruth(props.action.missionId);
    if (mounted.current) setContext(next);
  }

  useEffect(() => {
    void refresh().catch(cause => {
      if (mounted.current)
        setError(
          cause instanceof Error ? cause.message : "Visit state is unavailable."
        );
    });
    const loadPreVisitIntel = props.services.loadPreVisitIntel;
    if (!loadPreVisitIntel) {
      setIntelLoading(false);
      return;
    }
    void loadPreVisitIntel(props.action.missionId!)
      .then(intel => {
        if (mounted.current) setPreVisitIntel(intel);
      })
      .catch(() => {
        // Sales coaching is optional guidance. It can never block the real visit.
      })
      .finally(() => {
        if (mounted.current) setIntelLoading(false);
      });
  }, []);

  useEffect(() => {
    const loadMissionDebrief = props.services.loadMissionDebrief;
    if (
      !loadMissionDebrief ||
      context?.mission.status !== "arrived" ||
      context.visitOutcome
    ) return;

    let active = true;
    const poll = async () => {
      try {
        const next = await loadMissionDebrief(props.action.missionId!);
        if (active && mounted.current) setMissionDebrief(next);
      } catch (cause) {
        if (active && mounted.current) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Claire could not read the debrief state."
          );
        }
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 1_250);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [context?.mission.status, context?.visitOutcome, props.action.missionId]);

  const armResume = useAuthoritativeActionResume(refresh);

  async function finalizeLinkedDebrief() {
    const finalize = props.services.finalizeMissionDebrief;
    if (!finalize || missionDebrief?.status !== "ready") return;
    setBusy(true);
    setError(null);
    try {
      const normalizeAnswer = (
        input: string,
        question: typeof missionDebrief.proposal.question
      ) => {
        const answer = input.trim();
        if (!answer) return undefined;
        if (question?.inputType !== "datetime-local") return answer;
        const parsed = new Date(answer);
        if (Number.isNaN(parsed.getTime())) {
          throw new Error("Enter the real follow-up time.");
        }
        return parsed.toISOString();
      };
      const answer = normalizeAnswer(
        debriefAnswer,
        missionDebrief.proposal.question
      );
      const additionalAnswer = normalizeAnswer(
        debriefAdditionalAnswer,
        missionDebrief.proposal.additionalQuestion
      );
      const next = await finalize({
        missionId: props.action.missionId!,
        journalEntryId: missionDebrief.journalEntryId,
        requestId: props.requestId,
        ...(answer ? { answer } : {}),
        ...(additionalAnswer ? { additionalAnswer } : {}),
      });
      if (mounted.current) setMissionDebrief(next);
      await refresh();
      if (mounted.current) props.onPersisted();
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The debrief could not be confirmed."
        );
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function write(
    operation: () => Promise<GoldlineVisitContext>,
    final = false
  ) {
    setBusy(true);
    setError(null);
    try {
      const next = await operation();
      await props.services.refetchAuthoritativeTruth(props.action.missionId);
      if (mounted.current) {
        setContext(next);
        if (final) props.onPersisted();
      }
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "The visit action could not be recorded."
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const readyToDepart = Boolean(
    context?.mission.status === "preparing" &&
      context.field &&
      context.proposal &&
      context.checklist.some(item => item.required) &&
      context.checklist.every(
        item => !item.required || item.status === "completed"
      )
  );

  return (
    <SurfaceFrame
      eyebrow="VISIT · AUTHORITATIVE"
      title={props.mission.name}
      className="goldline-action-surface--tower"
      onClose={props.onClose}
      closeDisabled={busy}
    >
      <div className="action-world-cue">
        <MapPin />
        <span>
          <b>{props.action.address}</b>
          <small>
            Launching maps or returning does not complete this visit.
          </small>
        </span>
      </div>
      {!context ? (
        <p>
          <Loader2 /> READING FIELD STATE…
        </p>
      ) : null}
      {intelLoading && context && !context.visitOutcome ? (
        <div className="claire-tower-intel__loading" role="status">
          <Loader2 /> CLAIRE IS LOADING THE TOWER DOSSIER…
        </div>
      ) : null}
      {preVisitIntel && !context?.visitOutcome ? (
        <section
          className="claire-tower-intel"
          data-testid="claire-tower-intel"
          aria-label="Claire pre-visit sales intelligence"
          data-tower-skin={towerSkin.key}
        >
          <div className="claire-tower-intel__sigil" aria-hidden="true">
            <span />
            <i />
          </div>
          <div className="claire-tower-intel__heading">
            <small>CLAIRE // TOWER BOSS INTEL</small>
            <strong>THREE THINGS BEFORE YOU GO IN</strong>
            <span>
              {towerSkin.codename} · {preVisitIntel.accountName}
            </span>
          </div>
          <div className="claire-tower-intel__slots">
            {preVisitIntel.items.map((item, index) => (
              <article
                key={item.slot}
                className="claire-tower-intel__slot"
                data-slot={item.slot.toLowerCase()}
              >
                <div className="claire-tower-intel__index">
                  0{index + 1}
                </div>
                <div>
                  <small>{item.slot}</small>
                  <p>{item.line}</p>
                  <em>{item.why}</em>
                  <span>
                    {item.provenance.kind === "trainer_source"
                      ? `TRAINER SOURCE · ${item.provenance.creatorName ?? "REVIEWED INTEL"}`
                      : item.provenance.kind === "foundation"
                        ? "FOUNDATION · ARMORY"
                        : "MISSION BRIEF · CLAIRE"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {context?.mission.status === "phone_ready" ? (
        <button
          disabled={busy}
          onClick={() =>
            void write(() =>
              props.services.startVisitPreparation({
                missionId: props.action.missionId!,
                requestId: props.requestId,
              })
            )
          }
        >
          PREPARE VISIT <ChevronRight />
        </button>
      ) : null}
      {context?.mission.status === "preparing" && !readyToDepart ? (
        <div className="action-field-prep">
          <p className="action-field-prep-note">
            Complete required preparation before departure — genuine field
            prep, recorded the same as any other visit evidence.
          </p>
          <div className="action-field-prep-checklist">
            {context.checklist.map(item => (
              <button
                key={item.itemKey}
                type="button"
                disabled={busy}
                className={item.status === "completed" ? "is-complete" : ""}
                onClick={() =>
                  void write(() =>
                    props.services.updateChecklistItem({
                      missionId: props.action.missionId!,
                      itemKey: item.itemKey,
                      status:
                        item.status === "completed" ? "pending" : "completed",
                      requestId: props.requestId,
                    })
                  )
                }
              >
                <FileText />
                <span>
                  {item.label}
                  {item.required ? " *" : ""}
                </span>
                {item.status === "completed" ? <Check /> : null}
              </button>
            ))}
          </div>
          <p className="action-field-prep-note">
            {context.proposal
              ? "Approved proposal on file."
              : "No current approved proposal — required material is not ready."}
          </p>
        </div>
      ) : null}
      {readyToDepart ? (
        <button
          disabled={busy}
          onClick={() =>
            void write(() =>
              props.services.departVisit({
                missionId: props.action.missionId!,
                requestId: props.requestId,
              })
            )
          }
        >
          DEPART <Footprints />
        </button>
      ) : null}
      {context?.mission.status === "en_route" ? (
        <>
          <a
            href={props.action.navigationUrl}
            target="_blank"
            rel="noreferrer"
            onClick={armResume}
          >
            NAVIGATE <Compass />
          </a>
          <button
            disabled={busy}
            onClick={() =>
              void write(() =>
                props.services.arriveVisit({
                  missionId: props.action.missionId!,
                  requestId: props.requestId,
                })
              )
            }
          >
            ARRIVED · RECORD VISIT <MapPin />
          </button>
        </>
      ) : null}
      {context?.mission.status === "arrived" &&
      props.services.openMissionDebrief &&
      props.services.loadMissionDebrief &&
      props.services.finalizeMissionDebrief ? (
        <section
          className="tower-debrief"
          data-testid="mission-linked-debrief"
          aria-label="Mission-linked visit debrief"
          data-tower-skin={towerSkin.key}
        >
          <div className="tower-debrief__mechanism" aria-hidden="true">
            <span className="tower-debrief__door tower-debrief__door--left" />
            <span className="tower-debrief__door tower-debrief__door--right" />
            <span className="tower-debrief__signal" />
          </div>
          <div className="tower-debrief__copy">
            <small>{towerSkin.codename} // AFTER-ACTION CHANNEL</small>
            <h3>WHAT HAPPENED?</h3>
            <p>
              {props.mission.name} is already locked to this mission. Tell Claire
              the encounter once; she will structure the evidence without asking
              you which tower you were in.
            </p>
          </div>

          {!missionDebrief || missionDebrief.status === "not_started" ? (
            <button
              type="button"
              data-testid="open-mission-debrief"
              disabled={busy}
              onClick={() =>
                props.services.openMissionDebrief?.({
                  missionId: props.action.missionId!,
                  buildingName: props.mission.name,
                })
              }
            >
              OPEN CLAIRE COMMS <Radio />
            </button>
          ) : null}

          {missionDebrief?.status === "processing" ? (
            <div className="tower-debrief__processing" role="status">
              <Loader2 className="animate-spin" />
              <span>
                <b>RAW RECORDING SECURED</b>
                Claire is decoding the encounter. No outcome has been written.
              </span>
            </div>
          ) : null}

          {missionDebrief?.status === "failed" ? (
            <div className="tower-debrief__processing" role="alert">
              <span>
                <b>THE RECORDING IS SAFE</b>
                {missionDebrief.message}
              </span>
              <button
                type="button"
                onClick={() =>
                  props.services.openMissionDebrief?.({
                    missionId: props.action.missionId!,
                    buildingName: props.mission.name,
                  })
                }
              >
                RECORD A CORRECTION
              </button>
            </div>
          ) : null}

          {missionDebrief?.status === "ready" ? (
            <div className="tower-debrief__verdict">
              <div className="tower-debrief__readout">
                <small>CLAIRE'S READ // NOT YET BUSINESS TRUTH</small>
                <strong>
                  {missionDebrief.proposal.outcome.replaceAll("_", " ").toUpperCase()}
                </strong>
                <p>{missionDebrief.proposal.summary}</p>
              </div>
              {!showAdditionalQuestion && missionDebrief.proposal.question ? (
                <label className="tower-debrief__question">
                  <span>{missionDebrief.proposal.question.prompt}</span>
                  <input
                    data-testid="mission-debrief-answer"
                    type={missionDebrief.proposal.question.inputType}
                    value={debriefAnswer}
                    onChange={event => setDebriefAnswer(event.target.value)}
                  />
                </label>
              ) : null}
              {showAdditionalQuestion && missionDebrief.proposal.additionalQuestion ? (
                <label className="tower-debrief__question">
                  <span>{missionDebrief.proposal.additionalQuestion.prompt}</span>
                  <input
                    data-testid="mission-debrief-additional-answer"
                    type={missionDebrief.proposal.additionalQuestion.inputType}
                    value={debriefAdditionalAnswer}
                    onChange={event => setDebriefAdditionalAnswer(event.target.value)}
                  />
                </label>
              ) : null}
              {missionDebrief.proposal.emailDraft ? (
                <p className="tower-debrief__draft-note">
                  Claire can prepare the requested email as a draft. Nothing is
                  sent from this debrief.
                </p>
              ) : null}
              {missionDebrief.proposal.additionalQuestion && !showAdditionalQuestion ? (
                <button
                  type="button"
                  data-testid="continue-mission-debrief"
                  disabled={busy || !debriefAnswer.trim()}
                  onClick={() => setShowAdditionalQuestion(true)}
                >
                  NEXT QUESTION
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="confirm-mission-debrief"
                  disabled={
                    busy ||
                    Boolean(
                      missionDebrief.proposal.question && !debriefAnswer.trim()
                    ) ||
                    Boolean(
                      missionDebrief.proposal.additionalQuestion &&
                        !debriefAdditionalAnswer.trim()
                    )
                  }
                  onClick={() => void finalizeLinkedDebrief()}
                >
                  {busy ? "LOCKING THE RECORD…" : "CONFIRM WHAT HAPPENED"}
                </button>
              )}
              <button
                type="button"
                data-testid="correct-mission-debrief"
                disabled={busy}
                onClick={() => {
                  setDebriefAnswer("");
                  setDebriefAdditionalAnswer("");
                  setShowAdditionalQuestion(false);
                  props.services.openMissionDebrief?.({
                    missionId: props.action.missionId!,
                    buildingName: props.mission.name,
                  });
                }}
              >
                CLAIRE GOT SOMETHING WRONG · RECORD A CORRECTION
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {context?.mission.status === "arrived" &&
      !(
        props.services.openMissionDebrief &&
        props.services.loadMissionDebrief &&
        props.services.finalizeMissionDebrief
      ) ? (
        <div className="visit-outcome-fields">
          <label>
            REAL VISIT RESULT
            <select
              data-testid="visit-outcome-select"
              value={outcome}
              onChange={event =>
                setOutcome(event.target.value as VisitOutcomeRequest["outcome"])
              }
            >
              <option value="no_contact">Decision maker unavailable</option>
              <option value="no_decision">Spoke — no decision</option>
              <option value="follow_up">Follow-up agreed</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </label>
          {outcome === "follow_up" ? (
            <label>
              AGREED FOLLOW-UP DATE
              <input
                data-testid="visit-follow-up-at"
                type="datetime-local"
                value={followUpAt}
                onChange={event => setFollowUpAt(event.target.value)}
              />
            </label>
          ) : null}
          <label>
            DECISION MAKER
            <select
              data-testid="visit-decision-maker-select"
              value={outcome === "no_contact" ? "unavailable" : decisionMakerStatus}
              disabled={outcome === "no_contact"}
              onChange={event =>
                setDecisionMakerStatus(
                  event.target.value as VisitOutcomeRequest["decisionMakerStatus"]
                )
              }
            >
              <option value="not_recorded">Not recorded</option>
              <option value="unavailable">Unavailable</option>
              <option value="met">Met</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={collateralDelivered}
              onChange={event => setCollateralDelivered(event.target.checked)}
            />
            Collateral delivered
          </label>
          <label>
            <input
              type="checkbox"
              checked={quoteRequested}
              disabled={outcome === "no_contact"}
              onChange={event => setQuoteRequested(event.target.checked)}
            />
            Pricing / quote requested
          </label>
          <label>
            <input
              type="checkbox"
              checked={pilotRequested}
              disabled={outcome === "no_contact"}
              onChange={event => setPilotRequested(event.target.checked)}
            />
            Pilot requested
          </label>
          <label>
            <input
              type="checkbox"
              checked={followUpRequested || outcome === "follow_up"}
              disabled={outcome === "follow_up"}
              onChange={event => setFollowUpRequested(event.target.checked)}
            />
            Follow-up requested
          </label>
          <label>
            WHAT HAPPENED
            <textarea
              rows={3}
              value={notes}
              onChange={event => setNotes(event.target.value)}
            />
          </label>
          <button
            disabled={
              busy || !notes.trim() || (outcome === "follow_up" && !followUpAt)
            }
            onClick={() =>
              void write(
                () =>
                  props.services.recordVisitOutcome({
                    missionId: props.action.missionId!,
                    requestId: props.requestId,
                    outcome,
                    notes: notes.trim(),
                    followUpAt:
                      outcome === "follow_up"
                        ? new Date(followUpAt)
                        : undefined,
                    decisionMakerStatus:
                      outcome === "no_contact"
                        ? "unavailable"
                        : decisionMakerStatus,
                    collateralDelivered,
                    quoteRequested:
                      outcome === "no_contact" ? false : quoteRequested,
                    pilotRequested:
                      outcome === "no_contact" ? false : pilotRequested,
                    followUpRequested:
                      outcome === "follow_up" || followUpRequested,
                    reason: outcome === "lost" ? "other" : undefined,
                  }),
                false
              )
            }
          >
            RECORD VISIT RESULT
          </button>
        </div>
      ) : null}
      {context?.visitOutcome && !context.parkingLotClerkObservation &&
      !props.services.openMissionDebrief ? (
        <div
          className="visit-outcome-fields"
          data-testid="parking-lot-clerk-prompt"
        >
          <p className="action-field-prep-note">
            PARKING-LOT CLERK · OPERATOR-REPORTED
          </p>
          <label>
            WHAT DID THEY ACTUALLY SAY?
            <textarea
              data-testid="parking-lot-clerk-text"
              rows={4}
              value={clerkText}
              placeholder="Nobody home. Left a card. She said call next week."
              onChange={event => setClerkText(event.target.value)}
            />
          </label>
          <p className="action-field-prep-note">
            This preserves your report about the completed visit. It is not
            independent verification of what another person said, and it does
            not create a sale, booking, approval, or other business outcome.
          </p>
          <button
            data-testid="parking-lot-clerk-save"
            disabled={busy || !clerkText.trim()}
            onClick={() =>
              void write(
                () =>
                  props.services.recordParkingLotClerkObservation({
                    missionId: props.action.missionId!,
                    requestId: props.requestId,
                    text: clerkText,
                  }),
                true
              )
            }
          >
            SAVE WHAT THEY SAID
          </button>
        </div>
      ) : null}
      {!props.services.openMissionDebrief && context?.parkingLotClerkObservation ? (
        <p data-testid="parking-lot-clerk-recorded" className="action-field-prep-note">
          Clerk note recorded as operator-reported testimony.
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </SurfaceFrame>
  );
}

function FollowUpSurface(
  props: SurfaceProps & {
    action: Extract<GoldlineActionDescriptor, { kind: "FOLLOW_UP" }>;
    requestId: string;
  }
) {
  const [dueAt, setDueAt] = useState("");
  const [result, setResult] = useState<"" | "no_contact" | "contacted_no_decision" | "won" | "lost">("");
  const [resultNotes, setResultNotes] = useState("");
  const [nextFollowUpAt, setNextFollowUpAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMountedRef();
  const armResume = useAuthoritativeActionResume(() =>
    props.services.refetchAuthoritativeTruth(props.action.missionId)
  );
  async function perform(operation: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await props.services.refetchAuthoritativeTruth(props.action.missionId);
      if (mounted.current) props.onPersisted();
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "The follow-up could not be recorded."
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <SurfaceFrame
      eyebrow="FOLLOW-UP · AUTHORITATIVE"
      title={props.mission.name}
      onClose={props.onClose}
      closeDisabled={busy}
    >
      <div className="action-world-cue">
        <CalendarClock />
        <span>
          <small>REAL DATE ON RECORD</small>
          <b>{new Date(props.action.followUp.dueAt).toLocaleString()}</b>
          <small>
            {props.action.followUp.channel.toUpperCase()} ·{" "}
            {props.action.followUp.note ?? "No note recorded"}
          </small>
        </span>
      </div>
      {props.action.phoneUrl ? (
        <a href={props.action.phoneUrl} onClick={armResume}>
          FOLLOW UP
        </a>
      ) : null}
      <label>
        WHAT HAPPENED
        <select
          data-testid="followup-result-select"
          value={result}
          onChange={event =>
            setResult(
              event.target.value as typeof result
            )
          }
        >
          <option value="">Choose real result</option>
          <option value="no_contact">No contact</option>
          <option value="contacted_no_decision">Contacted — no decision</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>
      </label>
      <label>
        RESULT NOTES
        <textarea
          data-testid="followup-result-notes"
          rows={3}
          value={resultNotes}
          onChange={event => setResultNotes(event.target.value)}
        />
      </label>
      {result && result !== "won" && result !== "lost" ? (
        <label>
          EXPLICIT NEW FOLLOW-UP · OPTIONAL
          <input
            data-testid="followup-next-at"
            type="datetime-local"
            value={nextFollowUpAt}
            onChange={event => setNextFollowUpAt(event.target.value)}
          />
        </label>
      ) : null}
      <button
        disabled={
          busy ||
          !result ||
          !resultNotes.trim() ||
          (!!nextFollowUpAt && new Date(nextFollowUpAt).getTime() <= Date.now())
        }
        onClick={() =>
          void perform(() =>
            props.services.completeFollowUp({
              followUp: props.action.followUp,
              requestId: props.requestId,
              outcome: result as "no_contact" | "contacted_no_decision" | "won" | "lost",
              notes: resultNotes.trim(),
              nextFollowUpAt:
                nextFollowUpAt && result !== "won" && result !== "lost"
                  ? new Date(nextFollowUpAt)
                  : undefined,
            })
          )
        }
      >
        RECORD FOLLOW-UP RESULT
      </button>
      <label>
        MOVE THIS FOLLOW-UP WITHOUT RECORDING AN ATTEMPT
        <input
          data-testid="followup-reschedule-at"
          type="datetime-local"
          value={dueAt}
          onChange={event => setDueAt(event.target.value)}
        />
      </label>
      <button
        disabled={busy || !dueAt || new Date(dueAt).getTime() <= Date.now()}
        onClick={() =>
          void perform(() =>
            props.services.rescheduleFollowUp({
              followUp: props.action.followUp,
              requestId: props.requestId,
              dueAt: new Date(dueAt),
            })
          )
        }
      >
        SCHEDULE
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </SurfaceFrame>
  );
}

function SimpleWriteSurface(
  props: SurfaceProps & {
    action: Extract<GoldlineActionDescriptor, { kind: "RECOVER" | "SCOUT" }>;
    requestId: string;
  }
) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useMountedRef();
  async function perform() {
    setBusy(true);
    try {
      if (props.action.kind === "RECOVER") {
        await props.services.recover({
          missionId: props.action.missionId!,
          requestId: props.requestId,
        });
      } else {
        const report = await props.services.scout({
          requestId: props.requestId,
        });
        if (mounted.current)
          setMessage(
            report.discoveries.length
              ? `${report.discoveries.length} sourced routes returned.`
              : "Scout returned zero new discoveries."
          );
      }
      await props.services.refetchAuthoritativeTruth(props.action.missionId);
      if (mounted.current && props.action.kind === "RECOVER")
        props.onPersisted();
    } catch (cause) {
      if (mounted.current)
        setMessage(
          cause instanceof Error ? cause.message : "Action unavailable."
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <SurfaceFrame
      eyebrow={`${props.action.kind} · AUTHORITATIVE`}
      title={props.mission.name}
      onClose={props.onClose}
      closeDisabled={busy}
    >
      <div className="action-world-cue">
        {props.action.kind === "RECOVER" ? <Route /> : <Radar />}
        <span>
          <b>{props.action.label}</b>
          <small>
            {props.action.kind === "RECOVER"
              ? "Server-supported recovery path only."
              : "Only sourced server discoveries enter the world."}
          </small>
        </span>
      </div>
      <button disabled={busy} onClick={() => void perform()}>
        {busy ? "CHECKING REALITY…" : props.action.label}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </SurfaceFrame>
  );
}

/**
 * A genuine pickup or delivery, staged in-canvas exactly like VISIT/RECOVER —
 * never a redirect to conventional dispatch UI. Records real completion
 * through the same tenant-scoped `system.field.orders.updateStatus` mutation
 * the Driver field board uses (`services.resolveOrder`) —
 * no new order-truth store, no fabricated evidence (no scan/signature/photo
 * requirement — none exist in the real business process this represents).
 * A payment-blocked delivery renders truthfully blocked; fiction cannot
 * bypass that real business rule.
 */
function OrderSurface(
  props: SurfaceProps & {
    action: Extract<GoldlineActionDescriptor, { kind: "PICKUP" | "DELIVERY" }>;
  }
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMountedRef();
  const isDelivery = props.action.kind === "DELIVERY";
  const blocked = props.action.kind === "DELIVERY" && !props.action.paid;

  async function perform() {
    setBusy(true);
    setError(null);
    try {
      const success = await props.services.resolveOrder({
        orderId: props.action.orderId,
        status: isDelivery ? "delivered" : "collected",
      });
      if (!success) {
        if (mounted.current)
          setError(
            "The order could not be recorded — real business state may have changed."
          );
        return;
      }
      if (mounted.current) props.onPersisted();
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error ? cause.message : "The order could not be recorded."
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <SurfaceFrame
      eyebrow={`${isDelivery ? "DELIVERY" : "PICKUP"} · AUTHORITATIVE`}
      title={props.mission.name}
      onClose={props.onClose}
      closeDisabled={busy}
    >
      <div className="action-world-cue">
        <Package />
        <span>
          <b>{props.action.address ?? "No address on record"}</b>
          <small>
            Launching maps or returning does not complete this{" "}
            {isDelivery ? "delivery" : "pickup"}.
          </small>
        </span>
      </div>
      {props.action.navigationUrl ? (
        <a
          href={props.action.navigationUrl}
          target="_blank"
          rel="noreferrer"
        >
          NAVIGATE <Compass />
        </a>
      ) : null}
      {blocked ? (
        <div className="action-field-prep">
          <p className="action-field-prep-note">
            Payment has not cleared for this order — real business truth
            blocks completion here, the same as everywhere else in the
            system. This cannot be bypassed in-game.
          </p>
        </div>
      ) : !props.action.withinInteractionZone ? (
        <div className="action-field-prep">
          <p className="action-field-prep-note">
            Move Trailblazer to the {isDelivery ? "handoff" : "retrieval"}{" "}
            point in the world before completing this {isDelivery ? "delivery" : "pickup"}.
          </p>
        </div>
      ) : (
        <button disabled={busy} onClick={() => void perform()}>
          {busy
            ? "RECORDING…"
            : isDelivery
              ? "HAND OFF"
              : "RETRIEVE"}
        </button>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </SurfaceFrame>
  );
}

export default function GoldlineActionSurface(props: SurfaceProps) {
  if (props.action.kind === "CALL" && props.requestId) {
    return (
      <RealActionBridge
        missionName={props.mission.name}
        missionId={props.action.missionId!}
        requestId={props.requestId}
        phoneUrl={props.action.phoneUrl}
        onPersist={props.services.recordCall}
        onPersisted={props.onPersisted}
        onClose={props.onClose}
      />
    );
  }
  if (props.action.kind === "VISIT" && props.requestId)
    return (
      <VisitSurface
        {...props}
        action={props.action}
        requestId={props.requestId}
      />
    );
  if (props.action.kind === "FOLLOW_UP" && props.requestId)
    return (
      <FollowUpSurface
        {...props}
        action={props.action}
        requestId={props.requestId}
      />
    );
  if (
    (props.action.kind === "RECOVER" || props.action.kind === "SCOUT") &&
    props.requestId
  )
    return (
      <SimpleWriteSurface
        {...props}
        action={props.action}
        requestId={props.requestId}
      />
    );
  if (props.action.kind === "PICKUP" || props.action.kind === "DELIVERY")
    return <OrderSurface {...props} action={props.action} />;
  return (
    <SurfaceFrame
      eyebrow={`${props.action.kind} · READ ONLY`}
      title={props.mission.name}
      onClose={props.onClose}
    >
      {props.action.kind === "WAIT" ? (
        <>
          <CalendarClock />
          <b>NO BUSINESS ACTION IS DUE</b>
          <p>
            {props.action.dueAt
              ? `Next real date: ${new Date(props.action.dueAt).toLocaleString()}`
              : "Server state exposes no action window."}
          </p>
        </>
      ) : (
        <>
          <Radar />
          <b>MISSION INTELLIGENCE</b>
          <p>{props.mission.address ?? "No address recorded"}</p>
          <p>
            {props.mission.confidence.toUpperCase()} CONFIDENCE ·{" "}
            {props.mission.state.replaceAll("_", " ").toUpperCase()}
          </p>
        </>
      )}
    </SurfaceFrame>
  );
}
