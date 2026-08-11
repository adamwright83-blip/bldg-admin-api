import { useEffect, useRef, useState } from "react";
import { CalendarClock, ChevronRight, X } from "lucide-react";
import { ArmoryLoadout } from "../ArmoryLoadout";
import { getAudioManager } from "../../audio/AudioManager";
import { arcadeFeedback, missFeedback } from "../../audio/haptics";
import {
  ARCHETYPE_COPY,
  CHANNEL_LABEL,
  type ArmoryWeapon,
  type EncounterProps,
} from "../EncounterTypes";
import {
  DETERMINISTIC_ALIGNMENT,
  deterministicEncounters,
} from "../deterministicMode";

const WINDOW_HALF_WIDTH = 9;

/**
 * Staller: a mechanism that only opens on alignment.
 *
 * The mechanic is TIMING — a sweeping marker crosses a moving window and the
 * player commits at the moment they line up. Distinct from the Anchor's
 * spatial strike, the Gatekeeper's routing drag, and the Ghost's sustained
 * hold: this one is about choosing the moment.
 *
 * The countdown here is a game mechanic and is labelled as one. The real
 * follow-up clock is never invented: if the account has no committed date, the
 * encounter says so instead of showing a fabricated timer.
 */
export function StallerEncounter(props: EncounterProps) {
  const [selected, setSelected] = useState<ArmoryWeapon | null>(null);
  const [markerPosition, setMarkerPosition] = useState(0);
  const [windowCentre, setWindowCentre] = useState(50);
  const [resolved, setResolved] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState(3);

  const markerRef = useRef(0);
  const centreRef = useRef(50);
  const armed = Boolean(selected) && !resolved;

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
      last = now;
      // Marker sweeps; the window drifts, so the timing is never memorised.
      // The harness pins both so alignment can be asserted deterministically —
      // the tolerance check and every truth guard still run for real.
      const pinned = deterministicEncounters();
      const marker = pinned
        ? DETERMINISTIC_ALIGNMENT
        : (now / 12) % 200 > 100
          ? 200 - ((now / 12) % 200)
          : (now / 12) % 100;
      const centre = pinned
        ? DETERMINISTIC_ALIGNMENT
        : 50 + Math.sin(now / 1_700) * 26;
      markerRef.current = marker;
      centreRef.current = centre;
      setMarkerPosition(marker);
      setWindowCentre(centre);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [armed]);

  function commit() {
    if (!armed) return;
    const offset = Math.abs(markerRef.current - centreRef.current);
    if (offset <= WINDOW_HALF_WIDTH) {
      setResolved(true);
      setFeedback("ALIGNED — THE DELAY OPENED UP");
      getAudioManager().play("mechanism_align");
      arcadeFeedback();
      props.onResolved({
        performance: "clean",
        feedback: "Timing aligned with the window",
      });
      return;
    }
    const remaining = attemptsLeft - 1;
    setAttemptsLeft(remaining);
    if (remaining <= 0) {
      setResolved(true);
      setFeedback("MECHANISM HELD — THE DELAY DID NOT MOVE");
      missFeedback();
      props.onResolved({
        performance: "missed",
        feedback: "Never aligned with the window",
      });
      return;
    }
    setFeedback(`OFF THE WINDOW — ${remaining} ATTEMPT${remaining === 1 ? "" : "S"} LEFT`);
  }

  const copy = ARCHETYPE_COPY.STALLER;
  const hasRealCommitment = Boolean(props.mission.contestedUntil);

  return (
    <section className="encounter staller-encounter" aria-label="Staller encounter">
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

      <div className={`alignment-field${armed ? " is-armed" : ""}`}>
        <div className="alignment-track" aria-label="Alignment window">
          <i
            className="alignment-window"
            style={{
              left: `${Math.max(0, windowCentre - WINDOW_HALF_WIDTH)}%`,
              width: `${WINDOW_HALF_WIDTH * 2}%`,
            }}
          />
          <b className="alignment-marker" style={{ left: `${markerPosition}%` }} />
        </div>
        <button
          className="alignment-commit"
          disabled={!armed}
          onClick={commit}
        >
          COMMIT
        </button>
        {resolved ? null : (
          <p className="alignment-hint">
            {armed
              ? "COMMIT WHEN THE MARKER SITS INSIDE THE WINDOW"
              : "CHOOSE A MOVE FIRST"}
          </p>
        )}
        {feedback ? <div className="encounter-feedback">{feedback}</div> : null}
      </div>

      <div className="staller-real-clock">
        <CalendarClock />
        {hasRealCommitment ? (
          <span>
            <small>REAL COMMITMENT ON RECORD</small>
            <b>
              {new Date(props.mission.contestedUntil!).toLocaleString([], {
                weekday: "long",
                hour: "numeric",
                minute: "2-digit",
              })}
            </b>
          </span>
        ) : (
          <span>
            <small>NO COMMITTED DATE ON RECORD</small>
            <b>No countdown — a real date has to be agreed first</b>
          </span>
        )}
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
          <b>ALIGNMENT ≠ A COMMITTED DATE</b>
          <small>
            A watch window only appears once a real next date is recorded
            against the account. Without one, nothing here starts a countdown.
          </small>
          <button onClick={props.onOpenBusinessAction}>
            RECORD THE REAL NEXT STEP <ChevronRight />
          </button>
        </div>
      ) : null}
    </section>
  );
}

export default StallerEncounter;
