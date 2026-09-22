import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { DynamicJoystick } from "./DynamicJoystick";
import type { AvatarInput } from "./colosseumAvatar";

/**
 * Colosseum input: a thumbstick that appears wherever the left thumb lands,
 * an action cluster under the right thumb, and full keyboard parity.
 *
 *   move    WASD / arrows          guard (hold)  L / E
 *   strike  J / Space              dodge         K / Shift
 *   return  Q / R                  take shield   F
 */

export type ColosseumInputSource = {
  /** Read this frame's input; one-shot presses are cleared as they are read. */
  consume: () => AvatarInput & { takeShield?: boolean };
  press: (action: "strike" | "dodge" | "returnWave" | "takeShield") => void;
  setGuard: (held: boolean) => void;
  setStick: (x: number, y: number) => void;
  reset: () => void;
};

export function useColosseumInput(enabled: boolean): ColosseumInputSource {
  const stick = useRef({ x: 0, y: 0 });
  const keys = useRef(new Set<string>());
  const guardHeld = useRef({ pointer: false, key: false });
  const presses = useRef({ strike: false, dodge: false, returnWave: false, takeShield: false });

  const keyStick = () => {
    const held = keys.current;
    const x = Number(held.has("d") || held.has("arrowright")) - Number(held.has("a") || held.has("arrowleft"));
    const y = Number(held.has("s") || held.has("arrowdown")) - Number(held.has("w") || held.has("arrowup"));
    return { x, y };
  };

  const reset = useCallback(() => {
    stick.current = { x: 0, y: 0 };
    keys.current.clear();
    guardHeld.current = { pointer: false, key: false };
    presses.current = { strike: false, dodge: false, returnWave: false, takeShield: false };
  }, []);

  useEffect(() => {
    if (!enabled) {
      reset();
      return;
    }
    const down = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input,textarea,select")) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
      const movement = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"];
      if (movement.includes(key)) {
        event.preventDefault();
        keys.current.add(key);
        return;
      }
      if (event.repeat) return;
      if (key === " " && target instanceof HTMLElement && target.closest("button")) return;
      if (key === "j" || key === " ") presses.current.strike = true;
      else if (key === "k" || key === "shift") presses.current.dodge = true;
      else if (key === "q" || key === "r") presses.current.returnWave = true;
      else if (key === "f") presses.current.takeShield = true;
      else if (key === "l" || key === "e") guardHeld.current.key = true;
      else return;
      event.preventDefault();
    };
    const up = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      keys.current.delete(key);
      if (key === "l" || key === "e") guardHeld.current.key = false;
    };
    const blur = () => reset();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [enabled, reset]);

  const consume = useCallback(() => {
    const fromKeys = keyStick();
    const x = fromKeys.x !== 0 ? fromKeys.x : stick.current.x;
    const y = fromKeys.y !== 0 ? fromKeys.y : stick.current.y;
    const snapshot = {
      x,
      y,
      guard: guardHeld.current.pointer || guardHeld.current.key,
      ...presses.current,
    };
    presses.current = { strike: false, dodge: false, returnWave: false, takeShield: false };
    return snapshot;
  }, []);

  const press = useCallback((action: "strike" | "dodge" | "returnWave" | "takeShield") => {
    presses.current[action] = true;
  }, []);

  const setGuard = useCallback((held: boolean) => {
    guardHeld.current.pointer = held;
  }, []);

  const setStick = useCallback((x: number, y: number) => {
    stick.current = { x, y };
  }, []);

  return useMemo(
    () => ({ consume, press, setGuard, setStick, reset }),
    [consume, press, setGuard, setStick, reset]
  );
}

function StrikeIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <path d="M8 32 L14 26" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M12 24 L16 28" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M16 24 C 22 16 27 11 34 6" stroke="#fff6cf" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d="M16 24 C 22 16 27 11 34 6" stroke="#ffd36b" strokeWidth="6" strokeOpacity="0.35" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function GuardIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="13" fill="none" stroke="currentColor" strokeWidth="3.2" />
      <path d="M27 14 A 9 9 0 1 1 15 13" fill="none" stroke="#fff3c8" strokeWidth="2" strokeLinecap="round" />
      <circle cx="20" cy="20" r="2.4" fill="currentColor" />
    </svg>
  );
}

function DodgeIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <path d="M9 12 L17 20 L9 28" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 12 L27 20 L19 28" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      <path d="M29 12 L37 20 L29 28" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
    </svg>
  );
}

function ReturnIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="6" fill="#fff6cf" />
      <circle cx="20" cy="20" r="11.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 3" />
    </svg>
  );
}

type ControlsProps = {
  input: ColosseumInputSource;
  disabled: boolean;
  /** Before the shield is taken there is nothing to guard with. */
  showActions: boolean;
  canGuard: boolean;
  returnReady: boolean;
  dodgeReady: boolean;
  strikeHot?: boolean;
};

export function ColosseumControls({
  input,
  disabled,
  showActions,
  canGuard,
  returnReady,
  dodgeReady,
  strikeHot = false,
}: ControlsProps) {
  const onStick = useCallback((x: number, y: number) => input.setStick(x, y), [input]);

  useEffect(() => {
    if (disabled) input.setGuard(false);
  }, [disabled, input]);

  const guardDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || !canGuard) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    input.setGuard(true);
  };
  const guardUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    input.setGuard(false);
  };
  const tap =
    (action: "strike" | "dodge" | "returnWave") => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (disabled) return;
      event.preventDefault();
      input.press(action);
    };
  // Enter/Space on a focused button arrives as a click with no pointer.
  const keyed =
    (action: "strike" | "dodge" | "returnWave") => (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      if (!disabled && event.detail === 0) input.press(action);
    };

  return (
    <div className={`cz-controls${disabled ? " is-disabled" : ""}`}>
      <DynamicJoystick disabled={disabled} onInput={onStick} />
      {showActions && (
        <div className="cz-actions" role="group" aria-label="Combat actions">
          <button
            type="button"
            className={`cz-action cz-action--strike${strikeHot ? " is-hot" : ""}`}
            onPointerDown={tap("strike")}
            onClick={keyed("strike")}
            disabled={disabled}
            aria-label="Strike with the Lineblade"
            data-testid="colosseum-strike"
          >
            <StrikeIcon />
            <span>STRIKE</span>
          </button>
          <button
            type="button"
            className="cz-action cz-action--guard"
            onPointerDown={guardDown}
            onPointerUp={guardUp}
            onPointerCancel={guardUp}
            onLostPointerCapture={() => input.setGuard(false)}
            onContextMenu={event => event.preventDefault()}
            disabled={disabled || !canGuard}
            aria-label="Hold to guard"
            data-testid="colosseum-guard"
          >
            <GuardIcon />
            <span>GUARD</span>
          </button>
          <button
            type="button"
            className={`cz-action cz-action--dodge${dodgeReady ? "" : " is-cooling"}`}
            onPointerDown={tap("dodge")}
            onClick={keyed("dodge")}
            disabled={disabled}
            aria-label="Dodge"
            data-testid="colosseum-dodge"
          >
            <DodgeIcon />
            <span>DODGE</span>
          </button>
          <button
            type="button"
            className={`cz-action cz-action--return${returnReady ? " is-ready" : ""}`}
            onPointerDown={tap("returnWave")}
            onClick={keyed("returnWave")}
            disabled={disabled || !returnReady}
            aria-hidden={!returnReady}
            tabIndex={returnReady ? 0 : -1}
            aria-label="Release RETURN"
            data-testid="colosseum-return"
          >
            <ReturnIcon />
            <span>RETURN</span>
          </button>
        </div>
      )}
    </div>
  );
}
