import type { Game } from "./game";
import { HINT_DELAY_SECONDS, deriveMetrics, newSessionId, type PlaytestMode, type PtEvent, type PtMeta } from "../logic/playtest";

declare const __SC_BUILD_SHA__: string | undefined;
const BUILD_SHA = typeof __SC_BUILD_SHA__ === "string" ? __SC_BUILD_SHA__ : "unknown";
const ASSIST_SECONDS = 40;
const KEY = "sc.playtest.sessions";

/**
 * Cold-playtest recorder. Exists only when the URL carries ?playtest=mirror-cold|mirror-hinted.
 * Records what the tester's hands and the game did, locally. No network, no SDK. Export is a JSON file.
 */
export class Playtest {
  readonly meta: PtMeta;
  readonly events: PtEvent[] = [];
  private t0 = 0;
  private started = false;
  private persistT = 0;
  private cleanups: (() => void)[] = [];
  private panel: HTMLElement | null = null;
  readonly observer: boolean;

  constructor(private g: Game, readonly mode: PlaytestMode) {
    const q = new URLSearchParams(location.search);
    this.observer = q.get("observer") === "1";
    this.meta = {
      mode,
      buildSha: BUILD_SHA,
      sessionId: newSessionId(),
      startedAtIso: new Date().toISOString(),
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1, portrait: innerHeight > innerWidth },
      userAgent: navigator.userAgent,
      touchCapable: "ontouchstart" in window || navigator.maxTouchPoints > 0,
      pointerTypes: [],
      assistSeconds: ASSIST_SECONDS,
      hintDelaySeconds: mode === "mirror-hinted" ? HINT_DELAY_SECONDS : null,
    };
  }

  get hinted() { return this.mode === "mirror-hinted"; }

  /** wall time starts when the tester first has control, not when the page loads */
  begin() {
    if (this.started) return;
    this.started = true;
    this.t0 = performance.now();
    this.rec("session_start");
    const ui = this.g.ui;
    const click = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest("button,[id]") as HTMLElement | null;
      this.rec("ui_click", { id: el?.id || el?.textContent?.trim().slice(0, 24) || "?" });
    };
    ui.addEventListener("click", click, true);
    this.cleanups.push(() => ui.removeEventListener("click", click, true));
    const vis = () => this.rec("visibility", { state: document.visibilityState });
    const left = () => { this.rec("left", { reason: "pagehide" }); this.persist(true); };
    document.addEventListener("visibilitychange", vis);
    addEventListener("pagehide", left);
    this.cleanups.push(() => { document.removeEventListener("visibilitychange", vis); removeEventListener("pagehide", left); });
    const key = (e: KeyboardEvent) => { if (e.shiftKey && e.key.toLowerCase() === "e") this.export(); };
    addEventListener("keydown", key);
    this.cleanups.push(() => removeEventListener("keydown", key));
    (window as unknown as { __playtest?: unknown }).__playtest = { export: () => this.export(), record: () => this.record(), meta: this.meta, events: this.events };
    if (this.observer) this.buildPanel();
  }

  rec(type: string, data: Record<string, unknown> = {}) {
    if (!this.started && type !== "session_start") return;
    this.events.push({ t: Math.round(performance.now() - this.t0), gt: Math.round(this.g.time * 1000) / 1000, type, ...data });
    this.persist();
  }

  text(channel: "toast" | "hint" | "story", text: string) { this.rec("text_shown", { channel, text }); }

  /** the first thing a pointer does; also unlocks audio, which browsers hold until a gesture */
  pointer(e: PointerEvent) {
    if (!this.meta.pointerTypes.includes(e.pointerType)) this.meta.pointerTypes.push(e.pointerType);
    this.g.sound.start();
  }

  /** every canvas press, classified by what was under it; the base game decides what (if anything) happens */
  canvasDown(e: PointerEvent) {
    this.pointer(e);
    const g = this.g;
    let hit = "none";
    g.raycaster.setFromCamera(g.ndcOf(e), g.world.camera);
    const mirror = g.fixtureWorks.group.children.find(c => c.name === "Fixture_signal_mirror");
    if (mirror && g.raycaster.intersectObject(mirror, true).length) hit = "installed_mirror";
    else if (g.phase === "furnish") {
      const id = g.itemUnder(e);
      hit = id !== null ? `item:${id}` : g.cellAt(e) ? "cell" : "none";
    } else if (g.phase === "outside") hit = "shelf";
    this.rec("canvas_down", { phase: g.phase, hit, pointerType: e.pointerType });
  }

  // ------------------------------------------------------------------ output
  record() {
    return { meta: this.meta, events: this.events, derived: deriveMetrics(this.events, "t"), derivedClock: "t (wall seconds since session_start)" };
  }

  export() {
    this.persist(true);
    const blob = new Blob([JSON.stringify(this.record(), null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${this.meta.sessionId}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  private persist(now = false) {
    const t = performance.now();
    if (!now && t - this.persistT < 700) return;
    this.persistT = t;
    try {
      const all = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, unknown>;
      all[this.meta.sessionId] = this.record();
      const ids = Object.keys(all);
      while (ids.length > 12) delete all[ids.shift()!];
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* storage unavailable: export still works */ }
  }

  /** observer-only (?observer=1): a quiet corner control for whoever is running the session */
  private buildPanel() {
    const p = document.createElement("div");
    p.style.cssText = "position:fixed;left:6px;bottom:6px;z-index:99999;display:flex;gap:6px;opacity:.55;font:600 12px system-ui";
    const mk = (label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.textContent = label; b.type = "button";
      b.style.cssText = "padding:6px 9px;border:1px solid #0006;border-radius:8px;background:#fffd;color:#222";
      b.addEventListener("click", e => { e.stopPropagation(); fn(); });
      b.addEventListener("pointerdown", e => e.stopPropagation());
      p.appendChild(b);
    };
    mk("Export session", () => this.export());
    mk("New session", () => { this.persist(true); location.reload(); });
    this.g.ui.appendChild(p);
    this.panel = p;
    this.cleanups.push(() => p.remove());
  }

  dispose() { this.rec("left", { reason: "dispose" }); this.persist(true); for (const f of this.cleanups) f(); this.cleanups = []; this.panel = null; }
}

