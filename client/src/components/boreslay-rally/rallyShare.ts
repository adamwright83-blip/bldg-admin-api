import { RALLY_CONFIG, FIXED_STEP_MS } from "./rallyConfig";
import type { RallyReplayRecord } from "./rallyEngine";
import { RallyParticlePool } from "./rallyParticles";
import { RallyRenderer } from "./rallyRenderer";
import { replayToTick } from "./rallyReplay";

export type RallyExportKind =
  | { kind: "video"; mimeType: "video/mp4" | "video/webm" }
  | { kind: "png"; mimeType: "image/png" };

export function selectRallyExportKind(
  recorder: Pick<typeof MediaRecorder, "isTypeSupported"> | undefined =
    typeof MediaRecorder === "undefined" ? undefined : MediaRecorder
): RallyExportKind {
  if (!recorder) return { kind: "png", mimeType: "image/png" };
  if (recorder.isTypeSupported("video/mp4")) return { kind: "video", mimeType: "video/mp4" };
  if (recorder.isTypeSupported("video/webm")) return { kind: "video", mimeType: "video/webm" };
  return { kind: "png", mimeType: "image/png" };
}

export function cleanupCapture(stream: MediaStream, recorder?: MediaRecorder) {
  if (recorder?.state === "recording") recorder.stop();
  for (const track of stream.getTracks()) track.stop();
}

const canvasBlob = (canvas: HTMLCanvasElement, mimeType: string) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Canvas export failed")), mimeType);
  });

export class RallyClipExporter {
  async cut(
    record: RallyReplayRecord,
    scoreTick: number,
    options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {}
  ) {
    const canvas = document.createElement("canvas") as HTMLCanvasElement & {
      rallyFocusX?: number;
      rallyFocusY?: number;
    };
    canvas.width = 1080;
    canvas.height = 1920;
    canvas.dataset.rallyReplay = "true";
    const renderer = new RallyRenderer();
    const particles = new RallyParticlePool();
    const exportKind = selectRallyExportKind();
    const totalMs =
      RALLY_CONFIG.replay.introCardMs +
      RALLY_CONFIG.replay.slowPreMs / RALLY_CONFIG.replay.slowScale +
      RALLY_CONFIG.replay.postMs +
      RALLY_CONFIG.replay.outroCardMs;
    const startTick = Math.max(
      0,
      scoreTick - Math.round(RALLY_CONFIG.replay.slowPreMs / FIXED_STEP_MS)
    );
    const drawFrame = (elapsedMs: number) => {
      const playElapsed = Math.max(0, elapsedMs - RALLY_CONFIG.replay.introCardMs);
      const slowRealMs = RALLY_CONFIG.replay.slowPreMs / RALLY_CONFIG.replay.slowScale;
      const simElapsedMs = playElapsed <= slowRealMs
        ? playElapsed * RALLY_CONFIG.replay.slowScale
        : RALLY_CONFIG.replay.slowPreMs + (playElapsed - slowRealMs);
      const targetTick = Math.min(
        scoreTick + Math.round(RALLY_CONFIG.replay.postMs / FIXED_STEP_MS),
        startTick + Math.round(simElapsedMs / FIXED_STEP_MS)
      );
      const { engine } = replayToTick(record, targetTick);
      if (targetTick >= scoreTick && engine.state.ceremony) {
        engine.advanceFrame(Math.max(0, simElapsedMs - RALLY_CONFIG.replay.slowPreMs));
      }
      const finalBias = targetTick >= scoreTick - Math.round(1000 / FIXED_STEP_MS);
      const target = engine.state.buttTargets.clockhead;
      canvas.rallyFocusX = finalBias ? (engine.state.excuse.x + target.x) / 2 : engine.state.excuse.x;
      canvas.rallyFocusY = finalBias ? (engine.state.excuse.y + target.y) / 2 : engine.state.excuse.y;
      renderer.render(canvas, engine.state, engine.interpolationAlpha, particles);
      this.drawOverlay(canvas, record, engine.state.sparkScore, engine.state.clockheadScore, elapsedMs, totalMs);
    };

    drawFrame(0);
    if (exportKind.kind === "png" || typeof canvas.captureStream !== "function") {
      return {
        blob: await canvasBlob(canvas, "image/png"),
        mimeType: "image/png" as const,
        extension: "png" as const,
      };
    }

    const stream = canvas.captureStream(RALLY_CONFIG.replay.captureFps);
    const recorder = new MediaRecorder(stream, { mimeType: exportKind.mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => { if (event.data.size > 0) chunks.push(event.data); };
    const finished = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("Clip recorder failed"));
    });
    let animationFrame = 0;
    const startedAt = performance.now();
    recorder.start();
    try {
      await new Promise<void>((resolve, reject) => {
        const render = (now: number) => {
          if (options.signal?.aborted) {
            reject(new DOMException("Clip cut canceled", "AbortError"));
            return;
          }
          const elapsed = Math.min(totalMs, now - startedAt);
          drawFrame(elapsed);
          options.onProgress?.(elapsed / totalMs);
          if (elapsed >= totalMs) { resolve(); return; }
          animationFrame = requestAnimationFrame(render);
        };
        animationFrame = requestAnimationFrame(render);
      });
      recorder.stop();
      await finished;
      return {
        blob: new Blob(chunks, { type: exportKind.mimeType }),
        mimeType: exportKind.mimeType,
        extension: exportKind.mimeType === "video/mp4" ? "mp4" as const : "webm" as const,
      };
    } finally {
      cancelAnimationFrame(animationFrame);
      cleanupCapture(stream, recorder);
    }
  }

  private drawOverlay(
    canvas: HTMLCanvasElement,
    record: RallyReplayRecord,
    sparkScore: number,
    clockheadScore: number,
    elapsedMs: number,
    totalMs: number
  ) {
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    const intro = elapsedMs < RALLY_CONFIG.replay.introCardMs;
    const outro = elapsedMs > totalMs - RALLY_CONFIG.replay.outroCardMs;
    context.fillStyle = "rgba(4,5,10,0.88)";
    context.fillRect(0, 0, canvas.width, RALLY_CONFIG.replay.scoreStripHeightPx);
    if (intro || outro) context.fillRect(0, 0, canvas.width, canvas.height);
    context.textAlign = "center";
    context.fillStyle = "#fff0bd";
    context.font = "900 76px Impact, sans-serif";
    context.fillText("BORESLAY", canvas.width / 2, intro || outro ? 820 : 106);
    context.fillStyle = "#ffad43";
    context.font = "900 44px Impact, sans-serif";
    const banner = record.scoringMode === "buttHybrid" ? "BUTT BASH!" : "REALITY GATE SHATTERED!";
    context.fillText(outro ? `${sparkScore} — ${clockheadScore}` : banner, canvas.width / 2, intro || outro ? 900 : 168);
  }
}
