import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CalendarClock,
  ChevronRight,
  Compass,
  Footprints,
  Loader2,
  MapPin,
  Radar,
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
  children: ReactNode;
}) {
  return (
    <section
      className="goldline-action-surface"
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] =
    useState<VisitOutcomeRequest["outcome"]>("follow_up");
  const [followUpAt, setFollowUpAt] = useState("");
  const mounted = useMountedRef();

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
  }, []);
  const armResume = useAuthoritativeActionResume(refresh);

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
        <a href={props.action.destinationPath}>
          REVIEW REQUIRED FIELD PREP <ChevronRight />
        </a>
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
      {context?.mission.status === "arrived" ? (
        <div className="visit-outcome-fields">
          <label>
            REAL VISIT RESULT
            <select
              value={outcome}
              onChange={event =>
                setOutcome(event.target.value as VisitOutcomeRequest["outcome"])
              }
            >
              <option value="follow_up">Follow-up agreed</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </label>
          {outcome === "follow_up" ? (
            <label>
              AGREED FOLLOW-UP DATE
              <input
                type="datetime-local"
                value={followUpAt}
                onChange={event => setFollowUpAt(event.target.value)}
              />
            </label>
          ) : null}
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
                    decisionMakerStatus: "not_recorded",
                    collateralDelivered: false,
                    quoteRequested: false,
                    pilotRequested: false,
                    followUpRequested: outcome === "follow_up",
                    reason: outcome === "lost" ? "other" : undefined,
                  }),
                true
              )
            }
          >
            RECORD VISIT RESULT
          </button>
        </div>
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
      <button
        disabled={busy}
        onClick={() =>
          void perform(() =>
            props.services.completeFollowUp({
              followUp: props.action.followUp,
              requestId: props.requestId,
            })
          )
        }
      >
        RECORD FOLLOW-UP COMPLETE
      </button>
      <label>
        SCHEDULE A REAL NEW TIME
        <input
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
