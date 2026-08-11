import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronRight, DoorClosed, Route, X } from "lucide-react";
import { ArmoryLoadout } from "../ArmoryLoadout";
import {
  ARCHETYPE_COPY,
  CHANNEL_LABEL,
  type ArmoryWeapon,
  type EncounterProps,
} from "../EncounterTypes";

/**
 * Gatekeeper: a checkpoint, not a boss.
 *
 * The mechanic is ROUTING, deliberately unlike the Anchor's weak-point tap.
 * Three gates are open; the player picks a move and then drags the signal from
 * the entry node to the gate that move is actually trying to open. Choosing a
 * move and routing it somewhere it does not lead is a miss.
 *
 * Nothing here decides a business fact. Routing cleanly means the player made
 * the right approach — whether a name, a time, or a route actually exists is
 * settled by the real record, in the business-resolution gate below.
 */
type GateKey = "name" | "timing" | "route";

const GATES: Array<{ key: GateKey; label: string; detail: string }> = [
  { key: "name", label: "WHO DECIDES", detail: "Reach the decision maker" },
  { key: "timing", label: "WHEN", detail: "Find a real callback window" },
  { key: "route", label: "ANOTHER WAY", detail: "Email, referral, or corporate" },
];

/** Maps a move's stated objective to the gate it actually opens. */
function gateForWeapon(weapon: ArmoryWeapon): GateKey {
  const family = weapon.responseFamily.toLowerCase();
  const text = `${weapon.title} ${weapon.discoveryQuestion ?? ""}`.toLowerCase();
  if (/time|timing|callback|when|window/.test(`${family} ${text}`)) {
    return "timing";
  }
  if (/route|alternate|email|referral|corporate|another/.test(`${family} ${text}`)) {
    return "route";
  }
  return "name";
}

export function GatekeeperEncounter(props: EncounterProps) {
  const [selected, setSelected] = useState<ArmoryWeapon | null>(null);
  const [routedGate, setRoutedGate] = useState<GateKey | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const gateRefs = useRef<Partial<Record<GateKey, HTMLDivElement | null>>>({});

  const copy = ARCHETYPE_COPY.GATEKEEPER;
  const targetGate = selected ? gateForWeapon(selected) : null;

  function beginRoute(event: ReactPointerEvent<HTMLDivElement>) {
    if (!selected || resolved) return;
    dragOrigin.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function completeRoute(event: ReactPointerEvent<HTMLDivElement>) {
    if (!selected || resolved || !dragOrigin.current) return;
    const origin = dragOrigin.current;
    dragOrigin.current = null;

    const travelled = Math.hypot(
      event.clientX - origin.x,
      event.clientY - origin.y
    );
    // A tap is not a route; the player has to actually carry the signal across.
    if (travelled < 40) {
      setFeedback("NO ROUTE — DRAG THE SIGNAL TO A GATE");
      return;
    }

    const landed = (Object.keys(gateRefs.current) as GateKey[]).find(key => {
      const node = gateRefs.current[key];
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );
    });

    if (!landed) {
      setRoutedGate(null);
      setFeedback("SIGNAL LOST — THE CHECKPOINT HELD");
      setResolved(true);
      props.onResolved({
        performance: "missed",
        feedback: "Signal did not reach a gate",
      });
      return;
    }

    setRoutedGate(landed);
    setResolved(true);
    if (landed === targetGate) {
      setFeedback(`ROUTE OPEN · ${GATES.find(g => g.key === landed)!.label}`);
      props.onResolved({
        performance: "clean",
        feedback: `Routed cleanly to ${landed}`,
      });
    } else {
      setFeedback("WRONG GATE — THAT MOVE DOESN'T OPEN THIS ONE");
      props.onResolved({
        performance: "partial",
        feedback: `Routed to ${landed}, which this move does not open`,
      });
    }
  }

  return (
    <section className="encounter gatekeeper-encounter" aria-label="Gatekeeper encounter">
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
        className={`gate-field${selected ? " is-armed" : ""}`}
        onPointerDown={beginRoute}
        onPointerUp={completeRoute}
      >
        <div className="gate-origin" aria-hidden="true">
          <DoorClosed />
          <span>YOU</span>
        </div>
        <div className="gate-row">
          {GATES.map(gate => (
            <div
              key={gate.key}
              ref={node => {
                gateRefs.current[gate.key] = node;
              }}
              className={`gate-node${routedGate === gate.key ? " is-routed" : ""}${
                resolved && targetGate === gate.key ? " is-target" : ""
              }`}
            >
              <Route />
              <b>{gate.label}</b>
              <small>{gate.detail}</small>
            </div>
          ))}
        </div>
        {resolved ? null : (
          <p className="gate-hint">
            {selected
              ? "DRAG THE SIGNAL FROM YOU TO THE GATE THIS MOVE OPENS"
              : "CHOOSE A MOVE FIRST"}
          </p>
        )}
        {feedback ? (
          <div className="encounter-feedback">{feedback}</div>
        ) : null}
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
          <b>GAME RESULT ≠ ACCESS GRANTED</b>
          <small>
            Access, a name, a callback time, or a contact method only exist once
            they are recorded against the account. Log what actually happened.
          </small>
          <button onClick={props.onOpenBusinessAction}>
            RECORD WHAT YOU LEARNED <ChevronRight />
          </button>
        </div>
      ) : null}
    </section>
  );
}

export default GatekeeperEncounter;
