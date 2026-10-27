import { useEffect, useRef, useState } from "react";
import { MessageCircle, Phone, X } from "lucide-react";
import { ClairePortrait } from "@/pages/goldline/ApprovedDaylineChrome";
import {
  classifyTether,
  headPosition,
  tetherHint,
  tetherPath,
  unlockLineY,
  type TetherGeometry,
  type TetherZone,
} from "./claireTetherModel";

export type ClaireCallState = "idle" | "calling" | "called" | "error";

type Drag = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastAt: number;
  velocityX: number;
  armedAtX: number | null;
  zone: TetherZone;
  geometry: TetherGeometry;
};

const HEAD = 58;

/**
 * Claire lives in the top-right corner of Driver Studio. Pull her head down to
 * open the typed line; keep pulling right to have her call. A tap (or Enter)
 * opens the same two choices as plain buttons.
 */
export function ClaireTether({
  onMessage,
  onCall,
  callState,
}: {
  onMessage: () => void;
  onCall: () => void;
  callState: ClaireCallState;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLButtonElement | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const frame = useRef<number | null>(null);
  const [zone, setZone] = useState<TetherZone>("rest");
  const [returning, setReturning] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lineY, setLineY] = useState<number | null>(null);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        headRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const measure = (): TetherGeometry | null => {
    const layer = layerRef.current;
    const head = headRef.current;
    if (!layer || !head) return null;
    // Layout offsets, not client rects: a new pull can start while the head is
    // still springing back, and its rest point must not move with it.
    return {
      width: layer.clientWidth,
      height: layer.clientHeight,
      restX: head.offsetLeft + head.offsetWidth / 2,
      restY: head.offsetTop + head.offsetHeight / 2,
      size: head.offsetWidth,
    };
  };

  const paint = (x: number, y: number, g: TetherGeometry) => {
    const head = headRef.current;
    if (head) head.style.transform = `translate3d(${(x - g.restX).toFixed(1)}px, ${(y - g.restY).toFixed(1)}px, 0)`;
    pathRef.current?.setAttribute("d", tetherPath(g, { x, y }));
  };

  const release = (commit: boolean) => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    const finalZone = current.zone;
    setReturning(true);
    const head = headRef.current;
    if (head) head.style.transform = "";
    pathRef.current?.setAttribute("d", "");
    setZone("rest");
    setLineY(null);
    if (!commit) return;
    if (finalZone === "message") {
      navigator.vibrate?.(8);
      onMessage();
    } else if (finalZone === "call") {
      navigator.vibrate?.([8, 40, 8]);
      onCall();
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const geometry = measure();
    if (!geometry) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    suppressClick.current = false;
    setReturning(false);
    // Grabbing the head mid-return catches it where it is drawn.
    const drawn = e.currentTarget.getBoundingClientRect();
    const layerBox = layerRef.current!.getBoundingClientRect();
    const offsetX = drawn.left - layerBox.left + drawn.width / 2 - geometry.restX;
    const offsetY = drawn.top - layerBox.top + drawn.height / 2 - geometry.restY;
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX - offsetX,
      startY: e.clientY - offsetY,
      lastX: e.clientX,
      lastAt: performance.now(),
      velocityX: 0,
      armedAtX: null,
      zone: "rest",
      geometry,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastAt) / 1000;
    d.velocityX = (e.clientX - d.lastX) / dt;
    d.lastX = e.clientX;
    d.lastAt = now;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const g = d.geometry;
    const pointerX = g.restX + dx;
    const probe = headPosition(g, d.zone, dx, dy);
    const next = classifyTether({
      geometry: g,
      previous: d.zone,
      dx,
      dy,
      headY: probe.y,
      armedAtX: d.armedAtX,
      pointerX,
      velocityX: d.velocityX,
    });
    if (next === "message" && d.armedAtX === null) {
      d.armedAtX = pointerX;
      navigator.vibrate?.(6);
    }
    if (next === "pulling" || next === "rest") d.armedAtX = null;
    if (next === "call" && d.zone !== "call") navigator.vibrate?.(6);
    if (next !== "rest") suppressClick.current = true;
    if (next !== d.zone) {
      d.zone = next;
      setZone(next);
    }
    if (lineY === null && next !== "rest") setLineY(unlockLineY(g));
    const pos = headPosition(g, next, dx, dy);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      paint(pos.x, pos.y, g);
    });
  };

  const pulling = zone !== "rest";
  const label =
    callState === "calling" ? "Claire is calling you…" :
    callState === "called" ? "Claire is calling your phone" :
    "Claire";

  return (
    <div ref={layerRef} className={`lc-claire${pulling ? " is-pulling" : ""}`} data-zone={zone}>
      <svg className="lc-claire__tether" aria-hidden="true">
        <path ref={pathRef} d="" />
      </svg>
      {lineY !== null && (
        <div className="lc-claire__line" style={{ top: lineY }} aria-hidden="true">
          <span className={zone === "message" ? "is-on" : ""}><MessageCircle size={15} /> MESSAGE</span>
          <span className={zone === "call" ? "is-on" : ""}>CALL <Phone size={15} /> →</span>
        </div>
      )}
      <button
        ref={headRef}
        type="button"
        className={`lc-claire__head${returning ? " is-returning" : ""} is-${callState}`}
        style={{ width: HEAD, height: HEAD }}
        aria-label={`${label}. Pull down to message, then slide right to call. Or press for options.`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-testid="driver-studio-claire"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => release(true)}
        onPointerCancel={() => release(false)}
        onLostPointerCapture={() => { if (drag.current) release(false); }}
        onTransitionEnd={() => setReturning(false)}
        onContextMenu={e => e.preventDefault()}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          setMenuOpen(open => !open);
        }}
      >
        <ClairePortrait className="lc-claire__face" />
      </button>
      {pulling && <p className="lc-claire__hint" role="status">{tetherHint(zone)}</p>}
      {!pulling && callState !== "idle" && (
        <p className={`lc-claire__hint lc-claire__hint--${callState}`} role="status">
          {callState === "calling" ? "Calling Claire…" : callState === "called" ? "Claire is calling your phone now." : "Claire could not place the call. Try again."}
        </p>
      )}
      {menuOpen && (
        <div className="lc-claire__menu" role="menu" aria-label="Claire">
          <button type="button" role="menuitem" autoFocus onClick={() => { setMenuOpen(false); onMessage(); }}>
            <MessageCircle size={18} /> MESSAGE CLAIRE
          </button>
          <button type="button" role="menuitem" disabled={callState === "calling"} onClick={() => { setMenuOpen(false); onCall(); }}>
            <Phone size={18} /> CALL ME NOW
          </button>
          <small>Tip: pull Claire down to message, then right to call.</small>
          <button type="button" className="lc-claire__menu-close" aria-label="Close Claire options" onClick={() => setMenuOpen(false)}><X size={16} /></button>
        </div>
      )}
    </div>
  );
}
