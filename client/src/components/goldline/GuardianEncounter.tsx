/**
 * Guardian encounter in world space.
 *
 * Not a boss page. The guardian is already standing on the territory; this
 * layer is the fight/play surface that occupies that same region. Arcade tower
 * fire is the caller's job to disable while this is armed.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  dialogueContextFromState,
  selectDialogueClass,
  speakGuardian,
} from "@shared/goldlineGuardianDialogue";
import { guardianById, type GuardianId } from "@shared/goldlineGuardians";
import { canPermanentlyClear } from "@shared/goldlineGuardianEngine";
import type { TerritoryDefinition, TerritoryDerivedState } from "@shared/goldlineTerritories";
import { GuardianActor, guardianAriaLabel } from "./GuardianActor";
import { useGuardianEncounter } from "./useGuardianEncounter";
import { DynamicJoystick } from "../../pages/goldline/DynamicJoystick";

export function GuardianEncounter({
  definition,
  state,
  centroid,
  reducedMotion,
  obligationPresent,
  onDefeat,
  onClose,
}: {
  definition: TerritoryDefinition;
  state: TerritoryDerivedState;
  centroid: { x: number; y: number };
  reducedMotion: boolean;
  obligationPresent: boolean;
  onDefeat: () => void;
  onClose: () => void;
}) {
  const guardian = guardianById(definition.guardianId);
  const { world, dispatch } = useGuardianEncounter({
    guardianId: guardian.id,
    confrontationReady: state.confrontationReady,
    enabled: state.confrontationReady,
    reducedMotion,
  });
  const [line, setLine] = useState("");
  const [controlsHint] = useState(() => !window.matchMedia("(pointer: coarse)").matches);
  const pointer = useRef({ x: 0, y: 0 });
  const defeatedSent = useRef(false);

  useEffect(() => {
    dispatch({ type: "notice" });
    const context = dialogueContextFromState({
      grammar: definition.grammar,
      state,
      obligationPresent,
    });
    const lineClass = selectDialogueClass({
      noticedBefore: false,
      context,
    });
    setLine(speakGuardian({ guardianId: guardian.id as GuardianId, lineClass, context }));
  }, [definition.grammar, definition.id, dispatch, guardian.id, obligationPresent, state]);

  useEffect(() => {
    if (!canPermanentlyClear(world) || defeatedSent.current) return;
    defeatedSent.current = true;
    const context = dialogueContextFromState({ grammar: definition.grammar, state, obligationPresent });
    setLine(speakGuardian({
      guardianId: guardian.id as GuardianId,
      lineClass: "GUARDIAN_DEFEATED",
      context,
    }));
    onDefeat();
  }, [definition.grammar, guardian.id, obligationPresent, onDefeat, state, world]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (!state.confrontationReady) return;
      const map: Record<string, { x: number; y: number }> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
        a: { x: -1, y: 0 },
        d: { x: 1, y: 0 },
        w: { x: 0, y: -1 },
        s: { x: 0, y: 1 },
      };
      const move = map[event.key];
      if (move) {
        event.preventDefault();
        dispatch({ type: "move", ...move });
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        dispatch({ type: "counter" });
      }
      if (event.key === "Shift") dispatch({ type: "dodge" });
    };
    const onUp = (event: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "a", "d", "w", "s"].includes(event.key)) {
        dispatch({ type: "move", x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
    };
  }, [dispatch, onClose, state.confrontationReady]);

  const look = useMemo(() => {
    return {
      x: (pointer.current.x - 50) / 50,
      y: (pointer.current.y - 40) / 40,
    };
  }, [world.player.x, world.player.y]);

  return (
    <div
      className={`gl-guardian-encounter readiness-${state.readiness}${reducedMotion ? " is-reduced" : ""}`}
      style={{ left: `${centroid.x}%`, top: `${centroid.y}%` }}
      data-testid="goldline-guardian-encounter"
      data-interaction-mode="guardian_encounter"
      onPointerMove={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        pointer.current = {
          x: ((event.clientX - rect.left) / rect.width) * 100,
          y: ((event.clientY - rect.top) / rect.height) * 100,
        };
      }}
      onPointerDown={event => {
        event.stopPropagation();
        if (state.confrontationReady) dispatch({ type: "poke" });
      }}
      role="application"
      aria-label={guardianAriaLabel(guardian, world.phase)}
    >
      <GuardianActor
        guardianId={guardian.id}
        phase={world.defeated ? "defeated" : world.phase}
        lookX={look.x}
        lookY={look.y}
        reducedMotion={reducedMotion}
        defeated={world.defeated}
        scale={state.cleared && !state.pressureReturned ? 0.45 : 1}
      />
      <div className="gl-guardian-dialogue" aria-live="polite">
        <strong>{guardian.name}</strong>
        {state.pressureReturned ? <p>GUARDIAN RETURNED · Prior victory remains in the Chronicle.</p> : null}
        <p>{line || world.lastTell}</p>
      </div>
      <div className="gl-guardian-arena" aria-hidden>
        <span
          className="gl-guardian-player"
          style={{ left: `${world.player.x}%`, top: `${world.player.y}%` }}
          data-testid="goldline-guardian-player"
        />
        {world.projectiles.map(projectile => (
          <span
            key={projectile.id}
            className={`gl-guardian-shot is-${projectile.family}${projectile.huge ? " is-huge" : ""}${projectile.fizzled ? " is-fizzle" : ""}`}
            data-testid="goldline-guardian-projectile"
            style={{
              left: `${projectile.telegraphMs > projectile.liveMs ? projectile.impactAtX : projectile.x}%`,
              top: `${projectile.telegraphMs > projectile.liveMs ? projectile.impactAtY : projectile.y}%`,
            }}
          >
            <i />
          </span>
        ))}
      </div>
      <div className="gl-guardian-hud" aria-live="polite">
        <p className="gl-guardian-tell" data-testid="goldline-guardian-tell">{world.lastTell}</p>
        {state.confrontationReady ? (
          <p>
            Guardian {world.health}/{world.maxHealth} · You {world.playerHealth}/{world.playerMaxHealth}
          </p>
        ) : (
          <p>The lair is sealed. Complete the territory’s real evidence prerequisites to enter.</p>
        )}
        {controlsHint ? <p className="gl-guardian-keys">WASD move · Space / click counter · Shift dodge</p> : null}
        {world.retryAvailable ? (
          <button type="button" onClick={() => dispatch({ type: "retry" })}>
            Retry
          </button>
        ) : null}
      </div>
      <div className="gl-guardian-touch">
        <button type="button" onClick={onClose}>Return to city</button>
        <DynamicJoystick disabled={!state.confrontationReady} onInput={(x, y) => dispatch({ type: "move", x, y })} />
        <button
          type="button"
          disabled={!state.confrontationReady}
          className="gl-guardian-counter"
          data-testid="goldline-guardian-linehook"
          onPointerDown={event => {
            event.stopPropagation();
            dispatch({ type: "counter" });
          }}
        >
          Linehook
        </button>
      </div>
    </div>
  );
}
