import { createRoot } from "react-dom/client";
import WaywardVoyage from "@/pages/goldline/wayward/WaywardVoyage";
import { rookAboard } from "@/pages/goldline/wayward/waywardParty";
import { createMasterBus, scheduleCue, type AudioCueId, type PlayOptions } from "@/game/audio/AudioManager";
import "@/index.css";

/**
 * Local-only Wayward harness (vite.wayward-preview.config.ts). Query parameters:
 *   ?start=deck|span|sail   where the voyage begins (default deck)
 *   &rook=0                 play it without Rook, as production does until the
 *                           server progression read is wired (fails closed)
 *   &cache=1                start with the hull cache's Tether Memory
 *
 * Rook comes aboard here through the explicit preview seam — never through
 * the same-device party cache or any production state.
 * QA hooks: window.__wayward (state, setTimeScale, teleport, skipTo) and
 * window.__renderCues(layers) for offline cue renders.
 */
const params = new URLSearchParams(window.location.search);
const start = (["deck", "span", "sail"] as const).find(value => value === params.get("start")) ?? "deck";
const withRook = params.get("rook") !== "0";
const progress: Record<string, unknown> = {};
(window as unknown as { __waywardProgress: typeof progress }).__waywardProgress = progress;

createRoot(document.getElementById("root")!).render(
  <WaywardVoyage
    rookAboard={rookAboard(withRook ? { kind: "preview", reason: "wayward-preview-harness" } : null)}
    start={start}
    cacheCollected={params.get("cache") === "1"}
    exposeTestApi
    onProgress={patch => Object.assign(progress, patch)}
    onReturn={() => window.location.reload()}
  />
);

(window as unknown as {
  __renderCues?: (layers: Array<{ cue: AudioCueId } & PlayOptions>, seconds?: number) => Promise<number[]>;
}).__renderCues = async (layers, seconds = 2) => {
  const sampleRate = 48_000;
  const ctx = new OfflineAudioContext(1, Math.ceil(sampleRate * seconds), sampleRate);
  const bus = createMasterBus(ctx);
  bus.output.connect(ctx.destination);
  for (const layer of layers) {
    scheduleCue(ctx, bus.input, layer.cue, { pitch: layer.pitch, startAt: 0.02 + (layer.delayMs ?? 0) / 1000 });
  }
  const buffer = await ctx.startRendering();
  return Array.from(buffer.getChannelData(0));
};
