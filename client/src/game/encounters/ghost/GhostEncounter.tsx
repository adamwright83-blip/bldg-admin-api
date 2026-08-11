import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronRight, Radio, X } from "lucide-react";
import { ArmoryLoadout } from "../ArmoryLoadout";
import {
  ARCHETYPE_COPY,
  CHANNEL_LABEL,
  type ArmoryWeapon,
  type EncounterProps,
} from "../EncounterTypes";

const LOCK_REQUIRED_MS = 1_600;
const SIGNAL_LIFETIME_MS = 9_000;

/**
 * Ghost: tracking a fading signal.
 *
 * The mechanic is SUSTAINED TRACKING — the player must keep contact with a
 * drifting beacon, rather than landing one tap. It is the opposite feel to the
 * Anchor's single decisive strike, which is the point: re-establishing contact
 * is patience, not force.
 *
 * A perfect lock proves the player tracked well. It cannot and does not mean
 * the prospect replied — only a real inbound response can say that, so the
 * encounter always ends at the business gate.
 */
export function GhostEncounter(props: EncounterProps) {
  const [selected, setSelected] = useState<ArmoryWeapon | null>(null);
  const [lockMs, setLockMs] = useState(0);
  const [remainingMs, setRemainingMs] = useState(SIGNAL_LIFETIME_MS);
  const [resolved, setResolved] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [beacon, setBeacon] = useState({ x: 50, y: 50 });

  const tracking = useRef(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const resolvedRef = useRef(false);
  const onResolvedRef = useRef(props.onResolved);
  onResolvedRef.current = props.onResolved;

  const armed = Boolean(selected) && !resolved;

  // Beacon drift. Paused while the tab is hidden so a backgrounded game never
  // burns the player's signal window.
  useEffect(() => {
    if (!armed) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      if (document.hidden) {
        last = now;
        frame = requestAnimationFrame(tick);
        return;
      }
      const delta = now - last;
      last = now;

      setBeacon(current => ({
        x: 50 + Math.sin(now / 900) * 30,
        y: 50 + Math.cos(now / 1_300) * 26,
      }));

      if (tracking.current) {
        setLockMs(value => {
          const next = value + delta;
          if (next >= LOCK_REQUIRED_MS && !resolvedRef.current) {
            resolvedRef.current = true;
            queueMicrotask(() => {
              setResolved(true);
              setFeedback("SIGNAL LOCKED — CONTACT ROUTE HELD");
              onResolvedRef.current({
                performance: "clean",
                feedback: "Signal tracked and locked",
              });
            });
          }
          return next;
        });
      }

      setRemainingMs(value => {
        const next = Math.max(0, value - delta);
        if (next === 0 && !resolvedRef.current) {
          resolvedRef.current = true;
          queueMicrotask(() => {
            setResolved(true);
            setFeedback("SIGNAL FADED — THE TRAIL WENT COLD");
            onResolvedRef.current({
              performance: "missed",
              feedback: "Signal faded before lock",
            });
          });
        }
        return next;
      });

      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [armed]);

  function updateTracking(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = fieldRef.current?.getBoundingClientRect();
    if (!rect) return;
    const percentX = ((event.clientX - rect.left) / rect.width) * 100;
    const percentY = ((event.clientY - rect.top) / rect.height) * 100;
    const distance = Math.hypot(percentX - beacon.x, percentY - beacon.y);
    tracking.current = distance < 16;
  }

  const lockPercent = Math.min(100, (lockMs / LOCK_REQUIRED_MS) * 100);
  const copy = ARCHETYPE_COPY.GHOST;

  return (
    <section className="encounter ghost-encounter" aria-label="Ghost encounter">
      <header>
        <div>
          <small>
            {copy.label} · {CHANNEL_LABEL[props.channel]}
          </small>
          <b>{copy.situation}</b>
          <em>{copy.objective}</em>
        </div>
        <button
          className="encounter-close"
          onClick={props.onClose}
          aria-label="Leave encounter"
        >
          <X />
        </button>
      </header>

      <div
        ref={fieldRef}
        className={`signal-field${armed ? " is-armed" : ""}`}
        onPointerDown={event => {
          if (!armed) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateTracking(event);
        }}
        onPointerMove={event => {
          if (!armed) return;
          updateTracking(event);
        }}
        onPointerUp={() => {
          tracking.current = false;
        }}
        onPointerCancel={() => {
          tracking.current = false;
        }}
      >
        <div
          className={`ghost-beacon${tracking.current ? " is-held" : ""}`}
          style={{ left: `${beacon.x}%`, top: `${beacon.y}%` }}
          aria-hidden="true"
        >
          <Radio />
        </div>
        <div className="signal-lock-meter" aria-label="Signal lock progress">
          <i style={{ width: `${lockPercent}%` }} />
          <b>
            {resolved
              ? "SIGNAL RESOLVED"
              : `HOLD THE SIGNAL · ${(remainingMs / 1000).toFixed(1)}s`}
          </b>
        </div>
        <p className="signal-hint">
          {armed
            ? "KEEP CONTACT WITH THE BEACON UNTIL THE LOCK COMPLETES"
            : "CHOOSE A RE-CONTACT MOVE FIRST"}
        </p>
        {feedback ? <div className="encounter-feedback">{feedback}</div> : null}
      </div>

      <ArmoryLoadout
        weapons={props.weapons}
        isLoading={props.isLoadingWeapons}
        trainerIntelligenceAvailable={props.trainerIntelligenceAvailable}
        selectedId={selected?.id ?? null}
        disabled={resolved}
        onSelect={weapon => {
          if (resolved) return;
          setSelected(weapon);
          setFeedback(null);
          props.onSelectWeapon(weapon);
        }}
      />

      {resolved ? (
        <div className="business-resolution-gate">
          <b>A PERFECT LOCK IS NOT A REPLY</b>
          <small>
            Tracking the signal means you sent the right move on the right
            channel. Whether they respond is theirs to decide, and only a real
            reply or a real follow-up can change this account.
          </small>
          <button onClick={props.onOpenBusinessAction}>
            LOG THE REAL ATTEMPT <ChevronRight />
          </button>
        </div>
      ) : null}
    </section>
  );
}

export default GhostEncounter;
