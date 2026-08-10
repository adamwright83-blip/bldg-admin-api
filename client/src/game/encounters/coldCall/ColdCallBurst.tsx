import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Phone,
  Radio,
  X,
} from "lucide-react";
import type {
  ColdCallBatch,
  ColdCallTarget,
} from "../../../../../shared/coldCallBurst";

const OUTCOMES = [
  ["no_answer", "No answer"],
  ["left_voicemail", "Left voicemail"],
  ["spoke", "Spoke"],
  ["visit_booked", "Visit booked"],
  ["not_a_fit", "Not a fit"],
  ["contact_unavailable", "Contact unavailable"],
] as const;

function ChainWindow(props: {
  targets: ColdCallTarget[];
  onSelect: (target: ColdCallTarget) => Promise<void>;
  onExpired: () => Promise<void>;
}) {
  const [remaining, setRemaining] = useState(6_000);
  const expired = useRef(false);
  const selecting = useRef(false);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const onExpiredRef = useRef(props.onExpired);
  onExpiredRef.current = props.onExpired;

  useEffect(() => {
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
      setRemaining(current => {
        const next = Math.max(0, current - delta);
        if (next === 0 && !expired.current) {
          expired.current = true;
          queueMicrotask(() => void onExpiredRef.current());
        }
        return next;
      });
      if (expired.current) return;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  function selectTarget(target: ColdCallTarget) {
    if (selecting.current || expired.current) return;
    selecting.current = true;
    expired.current = true;
    void props.onSelect(target);
  }

  function chooseFromGesture(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    gesture.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) < 34) return;
    const index = dx < 0 || dy < 0 ? 0 : Math.min(1, props.targets.length - 1);
    const target = props.targets[index];
    if (target) selectTarget(target);
  }

  return (
    <div
      className="cold-call-chain-window"
      onPointerDown={event => {
        if ((event.target as Element).closest("button")) return;
        gesture.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={chooseFromGesture}
    >
      <div className="cold-call-chain-meter">
        <span style={{ transform: `scaleX(${remaining / 6_000})` }} />
      </div>
      <header>
        <Radio />
        <span>
          <b>CHAIN TARGET</b>
          <small>6s game window · zero business penalty</small>
        </span>
        <strong>{(remaining / 1_000).toFixed(1)}</strong>
      </header>
      <div className="cold-call-chain-targets">
        {props.targets.slice(0, 2).map((target, index) => (
          <button key={target.id} onClick={() => selectTarget(target)}>
            {index === 0 ? <ChevronLeft /> : <ChevronRight />}
            <span>
              <b>{target.companyName}</b>
              <small>FLICK {index === 0 ? "LEFT" : "RIGHT"}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ColdCallBurst(props: {
  batch: ColdCallBatch;
  onClose: () => void;
  onStart: (target: ColdCallTarget) => Promise<ColdCallBatch>;
  onComplete: (input: {
    target: ColdCallTarget;
    outcome: (typeof OUTCOMES)[number][0];
    notes: string;
  }) => Promise<ColdCallBatch>;
  onSelectChain: (target: ColdCallTarget) => Promise<ColdCallBatch>;
  onBreakCombo: () => Promise<ColdCallBatch>;
}) {
  const [batch, setBatch] = useState(props.batch);
  const [mode, setMode] = useState<
    "ready" | "live" | "outcome" | "chain" | "break" | "complete"
  >(props.batch.status === "completed" ? "complete" : "ready");
  const [outcome, setOutcome] =
    useState<(typeof OUTCOMES)[number][0]>("no_answer");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const activeTarget = useMemo(
    () =>
      batch.targets.find(target => target.status === "live") ??
      batch.targets.find(target => target.status === "selected") ??
      batch.targets.find(target => target.status === "pending") ??
      null,
    [batch]
  );
  const pending = batch.targets.filter(target => target.status === "pending");
  const remaining = batch.targets.filter(
    target => target.status !== "completed"
  ).length;
  const combo = Math.max(batch.combo, batch.completedCount > 0 ? 1 : 0);

  async function startCall() {
    if (!activeTarget || busy) return;
    setBusy(true);
    try {
      const next = await props.onStart(activeTarget);
      setBatch(next);
      setMode("live");
      window.location.href = `tel:${activeTarget.phoneNumber}`;
    } finally {
      setBusy(false);
    }
  }

  async function saveOutcome() {
    if (!activeTarget || !notes.trim() || busy) return;
    setBusy(true);
    try {
      const next = await props.onComplete({
        target: activeTarget,
        outcome,
        notes,
      });
      setBatch(next);
      setNotes("");
      if (next.status === "completed") setMode("complete");
      else setMode("chain");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cold-call-burst" aria-label="Cold Call Burst">
      <button
        className="cold-call-close"
        onClick={props.onClose}
        aria-label="Close Cold Call Burst"
      >
        <X />
      </button>
      <header className="cold-call-combo">
        <small>PRIMARY GAME METER</small>
        <h1>COMBO ×{combo}</h1>
        <div>
          <span>
            CALLS {remaining}/{batch.totalTargets} LEFT
          </span>
          <span>
            LOGGED {batch.completedCount}/{batch.totalTargets}
          </span>
        </div>
      </header>

      {mode === "complete" ? (
        <div className="cold-call-sweep-complete">
          <Check />
          <h2>SWEEP COMPLETE</h2>
          <p>
            Every eligible real target in this batch has a durable call outcome.
          </p>
          <button onClick={props.onClose}>RETURN TO WORLD</button>
        </div>
      ) : null}

      {mode === "break" ? (
        <div className="cold-call-combo-break">
          <h2>COMBO BREAK</h2>
          <p>
            Momentum reset only. No lead was lost, deleted, cooled down, or
            penalized.
          </p>
          <button onClick={() => setMode("ready")}>CALL NEXT TARGET</button>
        </div>
      ) : null}

      {mode === "chain" ? (
        <ChainWindow
          targets={pending}
          onSelect={async target => {
            const next = await props.onSelectChain(target);
            setBatch(next);
            setMode("ready");
          }}
          onExpired={async () => {
            const next = await props.onBreakCombo();
            setBatch(next);
            setMode("break");
          }}
        />
      ) : null}

      {activeTarget && ["ready", "live", "outcome"].includes(mode) ? (
        <div className="cold-call-target-card">
          <small>
            TARGET {activeTarget.position + 1} · REAL SOURCED CONTACT
          </small>
          <h2>{activeTarget.companyName}</h2>
          <p>{activeTarget.reason}</p>
          <div className="cold-call-coaching">
            <small>
              TALK TRACK COACHING · {activeTarget.coaching.provenance}
            </small>
            <blockquote>{activeTarget.coaching.openingLine}</blockquote>
          </div>
          {mode === "ready" ? (
            <button
              className="cold-call-phone"
              disabled={busy}
              onClick={() => void startCall()}
            >
              <Phone /> CALL REAL NUMBER
            </button>
          ) : null}
          {mode === "live" ? (
            <div className="cold-call-live">
              <Radio />
              <h3>LIVE CALL · NO GAME TIMER</h3>
              <p>
                Listen and sell. Combo timing is paused until the real
                conversation ends.
              </p>
              <button onClick={() => setMode("outcome")}>
                CALL ENDED — LOG REAL OUTCOME
              </button>
            </div>
          ) : null}
          {mode === "outcome" ? (
            <div className="cold-call-outcome">
              <label>
                REAL OUTCOME
                <select
                  value={outcome}
                  onChange={event =>
                    setOutcome(event.target.value as typeof outcome)
                  }
                >
                  {OUTCOMES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                NOTES
                <textarea
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  placeholder="What actually happened?"
                />
              </label>
              <button
                disabled={!notes.trim() || busy}
                onClick={() => void saveOutcome()}
              >
                SAVE OUTCOME — THEN RESUME GAME
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
