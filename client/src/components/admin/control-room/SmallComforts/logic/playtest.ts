/**
 * Cold-playtest recording for the signal-mirror probe. Test-only: nothing here is wired to the normal game.
 * Two layers, deliberately separate:
 *   - `events`: the raw action timeline, append-only, no interpretation
 *   - `deriveMetrics(events)`: a pure function that reads the timeline and counts things; it never feeds back
 */

export type PlaytestMode = "mirror-cold" | "mirror-hinted";

export interface PtEvent {
  /** wall-clock milliseconds since session start */
  t: number;
  /** game-clock seconds when it happened (differs from wall time only when the game is stepped by hand) */
  gt: number;
  type: string;
  [k: string]: unknown;
}

export interface PtMeta {
  mode: PlaytestMode;
  buildSha: string;
  sessionId: string;
  startedAtIso: string;
  viewport: { w: number; h: number; dpr: number; portrait: boolean };
  userAgent: string;
  touchCapable: boolean;
  /** pointer types actually seen in the session, in order of first appearance */
  pointerTypes: string[];
  /** the base game's auto-assist is disabled in every playtest mode, so this is always null */
  assistSeconds: null;
  hintDelaySeconds: number | null;
}

export interface PtDerived {
  /** seconds since session start; null = never happened */
  tFirstIntentionalMove: number | null;
  tButtonPickup: number | null;
  tButtonHome: number | null;
  tFirstPressOnButton: number | null;
  dragAttempts: number;
  outcomeSequence: { t: number; outcome: string }[];
  secondsInPlacement: number | null;
  installed: boolean;
  /** true when the session ended or was hidden before the mirror was installed */
  leftBeforeInstall: boolean;
  installedMirrorTouchesAfter: number;
  otherInteractionsAfterInstall: { t: number; what: string }[];
  otherPickupsBeforeButton: string[];
  assistFired: boolean;
  hintCueShown: boolean;
  /** every piece of on-screen text shown between placement start and install (empty = no text at all) */
  textShownDuringPlacement: { t: number; channel: string; text: string }[];
  /** the same, but any text at all before placement (walking/pickup copy from the base game) */
  textShownBeforePlacement: { t: number; channel: string; text: string }[];
}

const first = (events: PtEvent[], pred: (e: PtEvent) => boolean) => events.find(pred);
const sec = (ms: number) => Math.round(ms) / 1000;

export function deriveMetrics(events: PtEvent[], clock: "t" | "gt" = "t"): PtDerived {
  const at = (e: PtEvent) => (clock === "t" ? sec(e.t) : Math.round((e.gt as number) * 1000) / 1000);
  const start = events.find(e => e.type === "session_start");
  const base = start ? at(start) : 0;
  const rel = (e: PtEvent) => Math.round((at(e) - base) * 1000) / 1000;

  const move = first(events, e => e.type === "walk_start");
  const pickup = first(events, e => e.type === "pickup" && e.id === "brass_button");
  const home = first(events, e => e.type === "placing_start");
  const installedEv = first(events, e => e.type === "installed");
  const homeIdx = home ? events.indexOf(home) : -1;
  const endIdx = installedEv ? events.indexOf(installedEv) : events.length;

  const placingEvents = homeIdx >= 0 ? events.slice(homeIdx, endIdx) : [];
  const presses = placingEvents.filter(e => e.type === "press");
  const outcomes: { t: number; outcome: string }[] = [];
  for (const e of placingEvents) {
    if (e.type !== "outcome") continue;
    if (outcomes.length && outcomes[outcomes.length - 1].outcome === e.outcome) continue;
    outcomes.push({ t: rel(e), outcome: String(e.outcome) });
  }

  const lastEvent = events[events.length - 1];
  const hidden = events.some(e => e.type === "visibility" && e.state === "hidden") || events.some(e => e.type === "left");
  const after = installedEv ? events.slice(endIdx + 1) : [];
  const interactive = after.filter(e => e.type === "canvas_down" || e.type === "ui_click");
  const mirrorTouches = interactive.filter(e => e.type === "canvas_down" && e.hit === "installed_mirror");
  const others = interactive.filter(e => !(e.type === "canvas_down" && e.hit === "installed_mirror"))
    .map(e => ({ t: rel(e), what: e.type === "ui_click" ? `ui:${String(e.id)}` : `${String(e.phase)}:${String(e.hit)}` }));
  const pickupIdx = pickup ? events.indexOf(pickup) : events.length;
  const otherPickups = events.slice(0, pickupIdx).filter(e => e.type === "pickup" && e.id !== "brass_button").map(e => String(e.id));
  const texts = (from: number, to: number) => events.slice(Math.max(0, from), to).filter(e => e.type === "text_shown")
    .map(e => ({ t: rel(e), channel: String(e.channel), text: String(e.text) }));

  return {
    tFirstIntentionalMove: move ? rel(move) : null,
    tButtonPickup: pickup ? rel(pickup) : null,
    tButtonHome: home ? rel(home) : null,
    tFirstPressOnButton: presses.length ? rel(presses[0]) : null,
    dragAttempts: presses.length,
    outcomeSequence: outcomes,
    secondsInPlacement: home ? Math.round(((installedEv ? at(installedEv) : lastEvent ? at(lastEvent) : at(home)) - at(home)) * 1000) / 1000 : null,
    installed: !!installedEv,
    leftBeforeInstall: !installedEv && hidden,
    installedMirrorTouchesAfter: mirrorTouches.length,
    otherInteractionsAfterInstall: others,
    otherPickupsBeforeButton: otherPickups,
    assistFired: events.some(e => e.type === "assist_fired"),
    hintCueShown: events.some(e => e.type === "hint_cue"),
    textShownDuringPlacement: homeIdx >= 0 ? texts(homeIdx, endIdx) : [],
    textShownBeforePlacement: texts(0, homeIdx >= 0 ? homeIdx : events.length),
  };
}

export function newSessionId(): string {
  return `pt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function modeFromSearch(search: string): PlaytestMode | null {
  const v = new URLSearchParams(search).get("playtest");
  return v === "mirror-cold" || v === "mirror-hinted" ? v : null;
}

/** how long a tester can fail to touch the button, in placement, before the hinted mode gives its one cue */
export const HINT_DELAY_SECONDS = 20;
