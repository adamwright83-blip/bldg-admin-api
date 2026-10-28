import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { StoryGameProps } from "../types";
import { CAMS, LOBBY, createDesk, formatClock, readDeskSettings, type Desk, type DeskStatus, type Verdict } from "./deskMachine";
import { THUMB_ASPECT, ZOOM_FOV, createDeskScene, type DeskScene, type WallLayout } from "./deskScene";
import { createDeskSounds } from "./deskSounds";
import "./monitorDesk.css";

/**
 * The monitor desk (`cpe.monitor-desk`): a night shift at Century Park East's camera wall. Motion alerts teach the
 * wall (pull a feed, follow it, zoom, take a still); then the indicator lights and one still has to hold the figure and
 * the indicator together before it is gone. The night is won with that still and lost without it.
 *
 * It sees only its config and `onFinish`. Every word of the story is the host's; the labels here are the desk's own.
 */

const CAST_BASE = "/assets/goldline/beverly-hills-3d/cast/";
/** Once a shift has reached the window on this page, a retry starts half a minute before it instead of at the top. */
let rehearsed = false;
const TEST_HOOK = import.meta.env.DEV || import.meta.env.VITE_ADMIN_VISUAL_TEST === "1";
const WIN_HOLD_MS = 2600;
const LOSE_HOLD_MS = 2400;

const VERDICT_TEXT: Partial<Record<Verdict, string>> = {
  logged: "Still logged.",
  figure: "Still logged.",
  nothing: "Nothing moving on this camera.",
  cropped: "Half out of frame.",
  too_wide: "Too far away. Zoom in.",
  no_indicator: "Get the indicator in the frame too.",
  no_signal: "No signal. Wait for the picture.",
  printing: "Printing…",
};

function wallLayout(width: number): WallLayout {
  if (width < 640) {
    const gap = 6;
    const main = { x: 0, y: 0, w: width, h: Math.round(width * 0.75) };
    const tw = (width - gap * 2) / 3, th = tw / THUMB_ASPECT;
    const thumbs = CAMS.map((_, i) => ({ x: (i % 3) * (tw + gap), y: main.h + gap + Math.floor(i / 3) * (th + gap), w: tw, h: th }));
    return { width, height: Math.ceil(main.h + gap + th * 2 + gap), main, thumbs };
  }
  const gap = 10;
  const mw = Math.round(width * 0.66), mh = Math.round(mw / 1.45);
  const tw = (width - mw - gap * 2) / 2, th = tw / THUMB_ASPECT;
  const used = th * 3 + gap * 2;
  const top = Math.max(0, (mh - used) / 2);
  const thumbs = CAMS.map((_, i) => ({ x: mw + gap + (i % 2) * (tw + gap), y: top + Math.floor(i / 2) * (th + gap), w: tw, h: th }));
  return { width, height: Math.ceil(Math.max(mh, used)), main: { x: 0, y: 0, w: mw, h: mh }, thumbs };
}

const camName = (i: number) => `CAM ${i + 1}`;
const pct = (n: number, of: number) => `${(n / of) * 100}%`;

type Ended = { outcome: "win" | "lose"; at: number } | null;

export default function MonitorDeskGame({ config, onFinish }: StoryGameProps) {
  const settings = useMemo(() => readDeskSettings(config), [config]);
  const calm = useMemo(() => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const coarse = useMemo(() => typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches, []);
  const desk = useMemo<Desk>(() => createDesk(settings, { rehearsed, seed: (Date.now() ^ 0x5bd1e995) >>> 0 }), [settings]);
  const sounds = useMemo(() => createDeskSounds(), []);
  const root = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<DeskScene | null>(null);
  const time = useRef(0);
  const panDir = useRef(0);
  const finish = useRef(onFinish);
  finish.current = onFinish;

  const [attemptKey, setAttemptKey] = useState(0);
  const [loading, setLoading] = useState<{ progress: number; failed: boolean }>({ progress: 0, failed: false });
  const [layout, setLayout] = useState<WallLayout | null>(null);
  const [status, setStatus] = useState<DeskStatus>(() => desk.status(0));
  const [selected, setSelected] = useState(LOBBY);
  const [zoom, setZoom] = useState(0);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "no" } | null>(null);
  const [ended, setEnded] = useState<Ended>(null);
  const [muted, setMuted] = useState(false);
  const endedRef = useRef<Ended>(null);

  // the wall's shape follows the stage's width
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      if (w > 0) setLayout(prev => (prev?.width === w ? prev : wallLayout(w)));
    };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useEffect(() => {
    if (layout) sceneRef.current?.setLayout(layout);
  }, [layout]);

  // the scene, and the night's loop
  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return;
    let cancelled = false;
    let raf = 0;
    setLoading({ progress: 0, failed: false });
    createDeskScene(host, { tl: desk.tl, castBase: CAST_BASE, calm, onProgress: f => !cancelled && setLoading({ progress: f, failed: false }) })
      .then(scene => {
        if (cancelled) return scene.dispose();
        sceneRef.current = scene;
        const el = root.current;
        if (el) scene.setLayout(wallLayout(Math.floor(el.clientWidth)));
        setLoading({ progress: 1, failed: false });
        let last = performance.now();
        let shown = "";
        let alertIds = "";
        const frame = (now: number) => {
          const dt = Math.min(0.1, (now - last) / 1000);
          last = now;
          time.current += dt;
          const t = time.current;
          if (panDir.current) scene.pan(panDir.current * dt * (4 - scene.zoomLevel() * 1.2));
          scene.render(t, dt);
          const s = desk.status(t);
          if (s.phase === "window") rehearsed = true;
          const ids = s.alerts.map(a => a.id).join(",");
          if (ids !== alertIds) {
            if (s.alerts.some(a => !alertIds.split(",").includes(String(a.id)))) sounds.blip();
            alertIds = ids;
          }
          sounds.hum(s.indicator.lit && !s.outcome);
          const key = [Math.floor(s.clock), s.phase, ids, s.logged.length, s.indicator.text, s.windowLeft === null ? "" : Math.ceil(s.windowLeft), s.outcome].join("|");
          if (key !== shown) {
            shown = key;
            setStatus(s);
          }
          if (s.outcome && !endedRef.current) {
            endedRef.current = { outcome: s.outcome, at: t };
            setEnded(endedRef.current);
            if (s.outcome === "lose") scene.hold(1e9);
            window.setTimeout(() => !cancelled && finish.current(s.outcome!), s.outcome === "win" ? WIN_HOLD_MS : LOSE_HOLD_MS);
          }
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
      })
      .catch(() => {
        if (!cancelled) setLoading({ progress: 0, failed: true });
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [desk, calm, sounds, attemptKey]);
  useEffect(() => () => sounds.dispose(), [sounds]);
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(null), 2200);
    return () => window.clearTimeout(id);
  }, [message]);

  const act = {
    select(i: number) {
      sounds.wake();
      if (endedRef.current) return;
      sceneRef.current?.select(i);
      setSelected(i);
      setZoom(sceneRef.current?.zoomLevel() ?? 0);
    },
    zoom(step: number) {
      sounds.wake();
      if (endedRef.current) return;
      sceneRef.current?.zoom(step);
      setZoom(sceneRef.current?.zoomLevel() ?? 0);
    },
    capture() {
      sounds.wake();
      const scene = sceneRef.current;
      if (!scene || endedRef.current) return;
      const verdict = desk.capture(time.current, scene.framing());
      if (verdict === "closed") return;
      if (verdict === "logged" || verdict === "figure") {
        scene.hold(verdict === "figure" ? 1e9 : 0.9);
        sounds.shutter();
      } else if (verdict !== "printing") sounds.refuse();
      setMessage({ text: VERDICT_TEXT[verdict] ?? "", tone: verdict === "logged" || verdict === "figure" ? "ok" : "no" });
    },
  };
  const actRef = useRef(act);
  actRef.current = act;

  // the keyboard: 1–6 pull a feed, arrows (or A/D, W/S) pan and zoom, Space takes the still
  useEffect(() => {
    const held = new Set<string>();
    const panFromHeld = () => {
      panDir.current = (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0);
    };
    const dirOf = (e: KeyboardEvent) =>
      e.key === "ArrowLeft" || e.key === "a" || e.key === "A" ? "left" : e.key === "ArrowRight" || e.key === "d" || e.key === "D" ? "right" : null;
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const dir = dirOf(e);
      if (dir) {
        e.preventDefault();
        held.add(dir);
        panFromHeld();
        return;
      }
      if (/^[1-6]$/.test(e.key)) {
        e.preventDefault();
        actRef.current.select(Number(e.key) - 1);
      } else if (e.key === "ArrowUp" || e.key === "w" || e.key === "W" || e.key === "+" || e.key === "=") {
        e.preventDefault();
        if (!e.repeat) actRef.current.zoom(1);
      } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S" || e.key === "-") {
        e.preventDefault();
        if (!e.repeat) actRef.current.zoom(-1);
      } else if (e.key === " ") {
        // Space is the shutter here, never a click on whichever button has focus
        e.preventDefault();
        if (!e.repeat) actRef.current.capture();
      }
    };
    const up = (e: KeyboardEvent) => {
      const dir = dirOf(e);
      if (dir) {
        held.delete(dir);
        panFromHeld();
      }
      if (e.key === " ") e.preventDefault();
    };
    const blur = () => {
      held.clear();
      panFromHeld();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // drag on the main monitor pans it
  const drag = useRef<{ id: number; x: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    sounds.wake();
    drag.current = { id: e.pointerId, x: e.clientX };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const scene = sceneRef.current;
    if (!d || d.id !== e.pointerId || !scene || endedRef.current) return;
    scene.pan(-(e.clientX - d.x) * scene.metresPerPixel());
    d.x = e.clientX;
  };
  const endDrag = () => {
    drag.current = null;
  };
  const holdPan = (dir: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      sounds.wake();
      e.currentTarget.setPointerCapture(e.pointerId);
      panDir.current = dir;
    },
    onPointerUp: () => (panDir.current = 0),
    onPointerCancel: () => (panDir.current = 0),
    onLostPointerCapture: () => (panDir.current = 0),
  });

  // the test hook a capture script drives (development and visual-test builds only)
  useEffect(() => {
    if (!TEST_HOOK) return;
    const w = window as unknown as { __storyMonitorDesk?: unknown };
    w.__storyMonitorDesk = {
      snapshot: () => ({ t: time.current, status: desk.status(time.current), timeline: desk.tl, selected: sceneRef.current?.selected(), zoom: sceneRef.current?.zoomLevel(), framing: sceneRef.current?.framing() }),
      jump: (to: number) => {
        time.current = Math.max(time.current, to);
      },
      pan: (metres: number) => sceneRef.current?.pan(metres),
    };
    return () => {
      delete w.__storyMonitorDesk;
    };
  }, [desk]);

  const hint = useMemo(() => {
    if (ended || loading.progress < 1) return null;
    const alert = status.alerts.find(a => !a.decoy);
    if (!alert || alert.id > 3) return null;
    if (selected !== alert.cam) return coarse ? `Motion on ${camName(alert.cam)}. Tap it to pull it up.` : `Motion on ${camName(alert.cam)}. Press ${alert.cam + 1} to pull it up.`;
    if (alert.id === 1) return coarse ? "Tap STILL." : "Press Space for a still.";
    if (alert.id === 2) return coarse ? "Zoom in, and drag to follow it." : "Zoom in (↑) and follow it (← →).";
    return "Closer.";
  }, [status.alerts, selected, ended, loading.progress, coarse]);

  const lit = status.indicator.lit;
  const windowFrac = status.windowLeft === null ? null : status.windowLeft / settings.windowSeconds;
  const alerting = new Set(status.alerts.map(a => a.cam));
  const line = ended
    ? ended.outcome === "win"
      ? "Still logged."
      : "No still."
    : message?.text || hint || (status.phase === "boot" ? "Switching on…" : status.roundTotal && status.phase === "rounds" ? `Logged ${status.logged.length} of ${status.roundTotal}.` : "");

  return (
    <div
      ref={root}
      className="md"
      data-testid="story-monitor-desk"
      data-phase={status.phase}
      data-outcome={ended?.outcome}
      data-lit={lit || undefined}
      data-calm={calm || undefined}
    >
      <div className="md-wall" style={{ height: layout?.height ?? 320 }}>
        <div ref={canvasHost} className="md-canvas" aria-hidden="true" />
        {layout ? (
          <>
            <div
              className="md-main"
              style={{ left: layout.main.x, top: layout.main.y, width: layout.main.w, height: layout.main.h }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              data-testid="story-monitor-main"
              data-cam={selected}
            >
              <span className="md-burn md-burn-tl">
                {camName(selected)} {CAMS[selected].label}
              </span>
              <span className="md-burn md-burn-tr">
                <i className="md-rec" aria-hidden="true" /> {formatClock(status.clock)}
              </span>
              <span className="md-burn md-burn-bl">{["1×", "2×", "3×"][zoom]}</span>
              <span className="md-guide" aria-hidden="true" />
              {windowFrac !== null && selected === LOBBY ? (
                <span className="md-window" aria-hidden="true">
                  <span style={{ width: pct(windowFrac, 1) }} />
                </span>
              ) : null}
              {ended ? (
                <span className={`md-stamp is-${ended.outcome}`} data-testid={`story-monitor-${ended.outcome}`}>
                  {ended.outcome === "win" ? "STILL 01 · SAVED" : "NO STILL"}
                </span>
              ) : null}
              {loading.progress < 1 ? (
                <span className="md-loading" role="status">
                  {loading.failed ? "The monitors won't start." : `Switching on the monitors… ${Math.round(loading.progress * 100)}%`}
                  {loading.failed ? (
                    <button type="button" className="md-retry" onClick={() => setAttemptKey(k => k + 1)}>
                      Try again
                    </button>
                  ) : null}
                </span>
              ) : null}
            </div>
            {layout.thumbs.map((r, i) => (
              <button
                key={i}
                type="button"
                className="md-thumb"
                style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
                onClick={() => act.select(i)}
                aria-pressed={selected === i}
                aria-label={`${camName(i)}, ${CAMS[i].label.toLowerCase()}${alerting.has(i) ? ", motion" : ""}`}
                data-selected={selected === i || undefined}
                data-alert={alerting.has(i) || undefined}
                data-testid={`story-monitor-cam-${i + 1}`}
              >
                <span className="md-thumb-label">
                  {i + 1} · {CAMS[i].label}
                </span>
                {alerting.has(i) ? <span className="md-thumb-alert">MOTION</span> : null}
              </button>
            ))}
          </>
        ) : null}
      </div>
      <div className="md-controls">
        <button type="button" className="md-key" aria-label="Pan left" {...holdPan(-1)}>
          ◀
        </button>
        <button type="button" className="md-key" aria-label="Zoom out" onClick={() => act.zoom(-1)} disabled={zoom === 0}>
          −
        </button>
        <button type="button" className="md-shutter" onClick={() => act.capture()} data-testid="story-monitor-still" disabled={!!ended || loading.progress < 1}>
          STILL
        </button>
        <button type="button" className="md-key" aria-label="Zoom in" onClick={() => act.zoom(1)} disabled={zoom === ZOOM_FOV.length - 1}>
          +
        </button>
        <button type="button" className="md-key" aria-label="Pan right" {...holdPan(1)}>
          ▶
        </button>
        <button
          type="button"
          className="md-mute"
          aria-label={muted ? "Sound on" : "Sound off"}
          aria-pressed={muted}
          onClick={() => {
            sounds.wake();
            sounds.setMuted(!muted);
            setMuted(!muted);
          }}
        >
          {muted ? "SOUND OFF" : "SOUND ON"}
        </button>
      </div>
      <p className={`md-line${message && !ended ? ` is-${message.tone}` : ""}`} aria-live="polite" data-testid="story-monitor-line">
        {line}
      </p>
      {!coarse ? <p className="md-keys">1–6 pull a feed · ← → pan · ↑ ↓ zoom · Space still</p> : null}
    </div>
  );
}
