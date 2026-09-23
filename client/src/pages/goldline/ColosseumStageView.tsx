import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ColosseumFx, fxResolution, type FxFrame } from "./colosseumFx";
import {
  STAGE_ART,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  cameraFrame,
  damp,
  stageScaleFor,
  type StagePoint,
} from "./colosseumStage";

/**
 * The phone as a camera into a larger stage (WORLD_BIBLE §3).
 *
 * Owns the viewport, the painting, the effects canvas and the camera. The
 * scene that mounts it owns the simulation and calls `tick` once per frame;
 * camera motion and shake are written straight to the DOM as compositor
 * transforms so they never cost a React render.
 */

export type StageHandle = {
  fx: ColosseumFx;
  /** Add camera trauma, 0..1. Ignored under reduced motion. */
  shake: (amount: number) => void;
  tick: (
    dtMs: number,
    frame: {
      focus: StagePoint;
      zoom: number;
      fx: FxFrame | null;
      /** Pixels of HUD covering the top and bottom; the camera centres the
          subject in what is left, where the painting has room to move. */
      insets?: { top: number; bottom: number };
    }
  ) => void;
  /** Snap the camera to its target (after a teleport or on first frame). */
  snap: () => void;
};

/**
 * Once the painting has decoded in this session, later stages (the prologue
 * handing over to the arena, say) start ready instead of flashing the
 * loading screen for a frame.
 */
let paintingDecoded = false;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type Props = {
  className?: string;
  /** Tint the whole stage (RECOIL drains colour; a Borrowed Minute cools it). */
  tone?: "normal" | "drained" | "rewind";
  /**
   * Called once the painting has actually loaded and decoded. Scenes hold
   * their cinematic timelines until then, so a slow connection never plays
   * the reveal against an empty stage.
   */
  onReady?: () => void;
  children?: ReactNode;
  overlay?: ReactNode;
};

export const ColosseumStageView = forwardRef<StageHandle, Props>(function ColosseumStageView(
  { className = "", tone = "normal", onReady, children, overlay },
  ref
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const artRef = useRef<HTMLImageElement>(null);
  const readyFired = useRef(false);
  const [ready, setReady] = useState(paintingDecoded);
  // Scenes pass an inline callback and re-render every frame; keep the
  // identity stable so the fallback timer below is armed exactly once.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const markReady = useCallback(() => {
    if (readyFired.current) return;
    readyFired.current = true;
    paintingDecoded = true;
    setReady(true);
    onReadyRef.current?.();
  }, []);

  useEffect(() => {
    const art = artRef.current;
    if (!art) return;
    if (art.complete && art.naturalWidth > 0) {
      void (art.decode?.() ?? Promise.resolve()).catch(() => undefined).then(markReady);
    }
    // Never hold the scene hostage to a failed image: play on after a while.
    const fallback = window.setTimeout(markReady, 6000);
    return () => window.clearTimeout(fallback);
  }, [markReady]);
  const [viewport, setViewport] = useState({ width: 412, height: 915 });
  const reduced = useMemo(prefersReducedMotion, []);
  const fx = useMemo(() => new ColosseumFx(reduced), [reduced]);
  const camera = useRef({ x: 50, y: STAGE_HEIGHT * 0.6, zoom: 1, snapped: false });
  const trauma = useRef(0);
  const clock = useRef(0);
  const resolution = useRef(1);

  const baseScale = stageScaleFor(viewport.width, viewport.height);
  const stageWidthPx = STAGE_WIDTH * baseScale;
  const stageHeightPx = STAGE_HEIGHT * baseScale;

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewport(current =>
          Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
            ? current
            : { width: rect.width, height: rect.height }
        );
      }
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = fxResolution(stageWidthPx, stageHeightPx, window.devicePixelRatio || 1);
    resolution.current = ratio;
    canvas.width = Math.round(stageWidthPx * ratio);
    canvas.height = Math.round(stageHeightPx * ratio);
  }, [stageWidthPx, stageHeightPx]);

  const applyCamera = useCallback(
    (dtMs: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      const frame = cameraFrame({
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        focus: camera.current,
        zoom: camera.current.zoom,
      });
      clock.current += dtMs;
      let shakeX = 0;
      let shakeY = 0;
      if (!reduced && trauma.current > 0.001) {
        const power = trauma.current * trauma.current;
        const t = clock.current / 1000;
        shakeX = 11 * power * Math.sin(t * 47.3) * Math.cos(t * 13.1);
        shakeY = 8 * power * Math.sin(t * 39.7 + 1.3);
        trauma.current = Math.max(0, trauma.current - (dtMs / 1000) * 1.9);
      }
      const zoom = camera.current.zoom;
      stage.style.transform = `translate3d(${(frame.x + shakeX).toFixed(2)}px, ${(frame.y + shakeY).toFixed(2)}px, 0) scale(${zoom.toFixed(4)})`;
    },
    [reduced, viewport.height, viewport.width]
  );

  useImperativeHandle(
    ref,
    () => ({
      fx,
      shake(amount: number) {
        if (reduced) return;
        trauma.current = Math.min(1, trauma.current + amount);
      },
      snap() {
        camera.current.snapped = false;
      },
      tick(dtMs, frame) {
        const insetShift = frame.insets
          ? (frame.insets.bottom - frame.insets.top) / 2 / (baseScale * frame.zoom)
          : 0;
        const target = { x: frame.focus.x, y: frame.focus.y + insetShift };
        const dt = Math.min(0.05, dtMs / 1000);
        if (!camera.current.snapped) {
          camera.current = { x: target.x, y: target.y, zoom: frame.zoom, snapped: true };
        } else {
          camera.current.x = damp(camera.current.x, target.x, reduced ? 30 : 5.5, dt);
          camera.current.y = damp(camera.current.y, target.y, reduced ? 30 : 4.5, dt);
          camera.current.zoom = damp(camera.current.zoom, frame.zoom, reduced ? 30 : 4, dt);
        }
        applyCamera(dtMs);

        fx.update(dtMs);
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        if (!frame.fx) return;
        const unit = baseScale * resolution.current;
        context.setTransform(unit, 0, 0, unit, 0, 0);
        fx.draw(context, frame.fx);
      },
    }),
    [applyCamera, baseScale, fx, reduced]
  );

  useLayoutEffect(() => {
    applyCamera(0);
  }, [applyCamera]);

  return (
    <div
      ref={viewportRef}
      className={`cstage-viewport is-${tone}${ready ? " is-ready" : ""} ${className}`}
    >
      <div
        className="cstage-backdrop"
        style={{ backgroundImage: `url(${STAGE_ART.src})` }}
        aria-hidden="true"
      />
      <div
        ref={stageRef}
        className="cstage"
        style={{
          width: `${stageWidthPx}px`,
          height: `${stageHeightPx}px`,
          // Stage-unit sizing for children that want pixels (e.g. rims).
          ["--stage-unit" as string]: `${baseScale}px`,
        }}
      >
        <img
          ref={artRef}
          className="cstage-art"
          src={STAGE_ART.src}
          alt=""
          draggable={false}
          onLoad={event => {
            void (event.currentTarget.decode?.() ?? Promise.resolve())
              .catch(() => undefined)
              .then(markReady);
          }}
          onError={markReady}
        />
        <div className="cstage-world">{children}</div>
        <canvas ref={canvasRef} className="cstage-fx" aria-hidden="true" />
        <div className="cstage-grade" aria-hidden="true" />
      </div>
      {overlay}
      {!ready && (
        <div className="colosseum-loading cstage-loading" aria-label="Entering the Colosseum">
          <div className="colosseum-loading-mark">GOLDLINE</div>
          <div className="colosseum-loading-copy">ENTERING THE COLOSSEUM</div>
        </div>
      )}
    </div>
  );
});
