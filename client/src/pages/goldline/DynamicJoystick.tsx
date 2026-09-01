import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

export function DynamicJoystick({
  disabled,
  onInput,
}: {
  disabled: boolean;
  onInput: (x: number, y: number) => void;
}) {
  const pointerRef = useRef<number | null>(null);
  const originRef = useRef({ x: 0, y: 0 });
  const [visible, setVisible] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const radius = 48;

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const dx = event.clientX - originRef.current.x;
    const dy = event.clientY - originRef.current.y;
    const magnitude = Math.hypot(dx, dy);
    const scale = magnitude > radius ? radius / magnitude : 1;
    setKnob({ x: dx * scale, y: dy * scale });
    onInput((dx * scale) / radius, (dy * scale) / radius);
  }

  function release(event?: ReactPointerEvent<HTMLDivElement>) {
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerRef.current = null;
    setVisible(false);
    setKnob({ x: 0, y: 0 });
    onInput(0, 0);
  }

  useEffect(() => {
    if (!disabled) return;
    pointerRef.current = null;
    setVisible(false);
    setKnob({ x: 0, y: 0 });
    onInput(0, 0);
  }, [disabled, onInput]);

  return (
    <div
      className="overworld-joystick-zone"
      aria-label="Touch and drag to move Trailblazer"
      onPointerDown={event => {
        if (disabled || pointerRef.current !== null) return;
        pointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        originRef.current = { x: event.clientX, y: event.clientY };
        setOrigin(originRef.current);
        setVisible(true);
        move(event);
      }}
      onPointerMove={event => {
        if (pointerRef.current === event.pointerId) move(event);
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      {visible ? (
        <div
          className="overworld-joystick"
          style={{ left: origin.x, top: origin.y }}
          aria-hidden="true"
        >
          <i style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
        </div>
      ) : (
        <span className="overworld-move-hint">TOUCH + DRAG TO MOVE</span>
      )}
    </div>
  );
}
