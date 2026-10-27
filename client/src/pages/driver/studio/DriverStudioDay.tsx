import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChevronRight, MapPinned, Menu, Plus, RotateCcw, Check, Package, Moon, Sun, X } from "lucide-react";
import type { PickupCounts } from "@shared/cleancloudPickup";
import type { DayPlanStop } from "../goldlineDayPlanModel";
import {
  canHoldToComplete,
  findVisit,
  formatJobKind,
  groupRouteVisits,
  HOLD_TO_CONFIRM_MS,
  isVisitDone,
  jobTruth,
  artFor,
  visitPeriod,
  visitTitle,
  type DriverSceneId,
  type SceneArt,
  type RouteVisit,
} from "./driverStudioModel";
import { ClaireTether, type ClaireCallState } from "./ClaireTether";
import "./driver-studio.css";

type StudioProps = {
  businessDate: string;
  stops: DayPlanStop[];
  isLoading?: boolean;
  loadError?: string | null;
  onResolveStop?: (stop: DayPlanStop, counts?: PickupCounts) => Promise<boolean>;
  onRetryPickup?: (stop: DayPlanStop) => Promise<void>;
  onOriginalStop: (stop: DayPlanStop) => void;
  onOpenNewOrder: () => void;
  onEnterWorld: (trackedStopId?: string) => void;
  onOpenClaireComposer: () => void;
  onCallClaire: () => Promise<void>;
  onSwitchToLegacy?: () => void;
  /** Claire's and Daphne's existing Day Line cards (follow-up question, carried work, Day Line details). */
  briefing?: ReactNode;
  /** The Day Line's existing destinations (journal, week, build mission, overworld…), same handlers as the previous Day Line's menu. */
  navigation?: Array<{ label: string; onSelect: () => void }>;
};

/** An intent-confirmation control. Releasing early does not write to the server. */
function HoldRing({ label, disabled, onCommit }: {
  label: string;
  disabled?: boolean;
  onCommit: () => Promise<boolean>;
}) {
  const [phase, setPhase] = useState<"idle" | "holding" | "saving" | "complete" | "error">("idle");
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  // One write at a time, whatever the DOM does with a fast second press.
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const busy = phase === "saving" || phase === "complete";
  const cancel = () => {
    held.current = false;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setPhase(p => p === "holding" ? "idle" : p);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      held.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const begin = () => {
    if (disabled || busy || held.current || inFlight.current) return;
    held.current = true;
    setPhase("holding");
    timer.current = window.setTimeout(async () => {
      timer.current = null;
      if (!held.current || inFlight.current) return;
      held.current = false;
      inFlight.current = true;
      setPhase("saving");
      let recorded = false;
      try {
        recorded = await onCommit();
      } catch {
        recorded = false;
      } finally {
        inFlight.current = false;
      }
      if (mounted.current) setPhase(recorded ? "complete" : "error");
    }, HOLD_TO_CONFIRM_MS);
  };
  const word = phase === "holding" ? "HOLDING" : phase === "saving" ? "SAVING" : phase === "complete" ? "SAVED" : phase === "error" ? "RETRY" : "HOLD";
  return (
    <button
      type="button"
      className={`lc-hold lc-hold--${phase}`}
      aria-label={`Hold to ${label}`}
      aria-describedby="lc-hold-help"
      aria-disabled={disabled || busy}
      disabled={disabled || busy}
      data-phase={phase}
      onPointerDown={e => { if (e.pointerType !== "mouse" || e.button === 0) { e.currentTarget.setPointerCapture(e.pointerId); begin(); } }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onContextMenu={e => e.preventDefault()}
      onKeyDown={e => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); begin(); } }}
      onKeyUp={e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); cancel(); } }}
      onBlur={cancel}
      data-testid="driver-studio-hold"
    >
      <span className="lc-hold__inner">
        {phase === "complete" ? <Check size={25} /> : phase === "error" ? <RotateCcw size={22} /> : <Package size={25} />}
        <strong>{word}</strong>
      </span>
    </button>
  );
}

/**
 * The scene's authored art, with a stage sized exactly like `object-fit: cover`
 * so local reactions sit on the art's own features at any crop.
 */
function SceneImage({ scene, art, reaction, night, variant = "hero" }: { scene: DriverSceneId; art: SceneArt; reaction: number; night: boolean; variant?: "hero" | "thumb" }) {
  const entry = art;
  const [fx, fy] = entry.focus.split(" ").map(v => (v === "center" ? 50 : parseFloat(v)) / 100);
  const stageStyle = {
    "--ar": entry.size[0] / entry.size[1],
    "--fx": Number.isFinite(fx) ? fx : 0.5,
    "--fy": Number.isFinite(fy) ? fy : 0.5,
  } as CSSProperties;
  const reacting = reaction > 0;
  if (variant === "thumb") {
    return entry.image
      ? <img src={entry.image} alt="" style={{ objectPosition: entry.focus }} />
      : <span>{scene === "hollywood" ? "HW" : "•"}</span>;
  }
  return (
    <div
      className={`lc-scene lc-scene--${scene}${night ? " lc-scene--night" : ""}${reacting ? " lc-scene--react" : ""}`}
      role="img"
      aria-label={entry.label}
      data-testid="driver-studio-scene"
      data-reacting={reacting ? "true" : "false"}
    >
      {entry.image ? (
        <div className="lc-scene__stage" style={stageStyle}>
          <img className="lc-scene__art" src={entry.image} alt="" draggable={false} />
          {reacting && <div className="lc-fx-layer" key={reaction}>
          {scene === "century-park-east" && (
            <div aria-hidden="true">
              <span className="lc-fx lc-cpe-floor lc-cpe-floor--1" />
              <span className="lc-fx lc-cpe-floor lc-cpe-floor--2" />
              <span className="lc-fx lc-cpe-floor lc-cpe-floor--3" />
            </div>
          )}
          {scene === "opus" && (
            <div aria-hidden="true">
              <span className="lc-fx lc-opus-fill lc-opus-fill--wilshire" />
              <span className="lc-fx lc-opus-fill lc-opus-fill--sixth" />
            </div>
          )}
          {scene === "beverly-hills" && !entry.territory && <span className="lc-fx lc-rodeo-calf" aria-hidden="true" />}
          {(entry.territory || entry.placeholder) && <span className="lc-fx lc-lantern-glow" aria-hidden="true" />}
          {scene === "koreatown" && (
            <div aria-hidden="true">
              <span className="lc-fx lc-kt-bulb lc-kt-bulb--left" />
              <span className="lc-fx lc-kt-bulb lc-kt-bulb--right" />
              <span className="lc-fx lc-kt-pearl lc-kt-pearl--1" />
              <span className="lc-fx lc-kt-pearl lc-kt-pearl--2" />
              <span className="lc-fx lc-kt-pearl lc-kt-pearl--3" />
            </div>
          )}
          </div>}
        </div>
      ) : (
        <div className="lc-scene__neutral"><span>{scene === "hollywood" ? "HOLLYWOOD" : "YOUR NEXT STOP"}</span></div>
      )}
      {scene === "silver-lake" && reacting && (
        <div className="lc-villagers" aria-hidden="true" key={`v${reaction}`}>
          <img className="lc-fx lc-villager lc-villager--fox" src="/assets/lantern-villager-outreach/villagers/animations/fox-wave.png" alt="" />
          <img className="lc-fx lc-villager lc-villager--bunny" src="/assets/lantern-villager-outreach/villagers/animations/bunny-wave.png" alt="" />
        </div>
      )}
      {scene === "beverly-hills" && reacting && (
        <img key={`t${reaction}`} className="lc-fx lc-rodeo-reaction" src="/joystick/driver-studio/rodeo-terrier-delighted.png" alt="" aria-hidden="true" />
      )}
      {entry.concept && <span className="lc-scene__concept">CONCEPT ART · NOT LIVE GAMEPLAY</span>}
      {entry.territory && <span className="lc-scene__concept">{entry.label.toUpperCase()}</span>}
    </div>
  );
}

function JobCard({ stop, savedLocally, onSaved, onFallback, onRetrySync }: {
  stop: DayPlanStop;
  savedLocally: boolean;
  onSaved: (stop: DayPlanStop, counts?: PickupCounts) => Promise<boolean>;
  onFallback: () => void;
  onRetrySync?: (stop: DayPlanStop) => Promise<void>;
}) {
  const [bags, setBags] = useState(stop.pickupBridge?.bagCount != null ? String(stop.pickupBridge.bagCount) : "");
  const [garments, setGarments] = useState(stop.pickupBridge?.garmentCount != null ? String(stop.pickupBridge.garmentCount) : "");
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const canHold = canHoldToComplete(stop);
  const isBridge = stop.kind === "pickup" && !!stop.pickupBridge;
  const complete = savedLocally || stop.status === "completed";
  const truth = jobTruth(stop, savedLocally);

  const commit = async (): Promise<boolean> => {
    let counts: PickupCounts | undefined;
    if (isBridge) {
      const bagCount = bags.trim() === "" ? 0 : Number(bags);
      const garmentCount = garments.trim() === "" ? 0 : Number(garments);
      if (!Number.isInteger(bagCount) || !Number.isInteger(garmentCount) || bagCount < 0 || garmentCount < 0 ||
        bagCount > 999 || garmentCount > 9999 || bagCount + garmentCount === 0) {
        setError("Enter at least one bag or garment before completing.");
        return false;
      }
      counts = { bagCount, garmentCount };
    }
    setError(null);
    try {
      const ok = await onSaved(stop, counts);
      if (!ok) setError("Nothing was saved. Try again or open the full stop.");
      return ok;
    } catch (e) {
      setError(e instanceof Error && e.message ? `Nothing was saved: ${e.message}` : "Nothing was saved. Try again or open the full stop.");
      return false;
    }
  };
  const holdLabel = stop.kind === "dropoff" ? "record this delivery" : "record this pickup";
  return (
    <section className={`lc-job ${complete ? "lc-job--done" : ""}`} data-testid={`driver-studio-job-${stop.id}`} data-truth={truth.tone} aria-label={`${formatJobKind(stop.kind)} · ${stop.title}`}>
      <div className="lc-job__details">
        <div className="lc-job__labels"><b>{formatJobKind(stop.kind)}</b><span className={`lc-truth lc-truth--${truth.tone}`}>{truth.label}</span></div>
        <strong>{stop.title}</strong>
        {stop.displayDetail && <small>{stop.displayDetail}</small>}
        {truth.detail && <small className={`lc-job__sync lc-job__sync--${truth.tone}`}>{truth.detail}</small>}
        {isBridge && !complete && canHold && (
          <div className="lc-job__counts">
            <label>BAGS<input type="number" min={0} max={999} step={1} inputMode="numeric" value={bags} onChange={e => setBags(e.target.value)} /></label>
            <label>GARMENTS<input type="number" min={0} max={9999} step={1} inputMode="numeric" value={garments} onChange={e => setGarments(e.target.value)} /></label>
          </div>
        )}
        {error && <small className="lc-job__error" role="alert">{error}</small>}
        {truth.canRetrySync && onRetrySync && (
          <button type="button" className="lc-job__fallback" disabled={retrying} onClick={async () => {
            setRetrying(true);
            try { await onRetrySync(stop); } catch (e) { setError(e instanceof Error ? e.message : "CleanCloud retry failed."); } finally { setRetrying(false); }
          }}>
            {retrying ? "RETRYING SYNC…" : "RETRY CLEANCLOUD SYNC"} <RotateCcw size={14} />
          </button>
        )}
        {!canHold && !complete && <button className="lc-job__fallback" type="button" onClick={onFallback}>OPEN FULL STOP <ChevronRight size={16} /></button>}
      </div>
      {complete ? <span className="lc-job__check" role="img" aria-label="Job saved"><Check size={28} /></span> : canHold ? (
        <HoldRing key={stop.id} label={holdLabel} onCommit={commit} />
      ) : null}
    </section>
  );
}

function VisitDetail({ visit, savedIds, arrived, onArrive, onBack, onSave, onRetrySync, onOriginalStop, onNext, hasNext }: {
  visit: RouteVisit;
  savedIds: ReadonlySet<string>;
  arrived: boolean;
  onArrive: () => void;
  onBack: () => void;
  onSave: (s: DayPlanStop, counts?: PickupCounts) => Promise<boolean>;
  onRetrySync?: (s: DayPlanStop) => Promise<void>;
  onOriginalStop: (s: DayPlanStop) => void;
  onNext: () => void;
  hasNext: boolean;
}) {
  const [reaction, setReaction] = useState(0);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const allSaved = isVisitDone(visit, savedIds);
  // Turn-by-turn directions when any job carries them; every job here shares the address.
  const mapsUrl = visit.jobs.find(j => j.navigationUrl?.includes("/maps/dir/"))?.navigationUrl ?? visit.jobs.find(j => j.navigationUrl)?.navigationUrl ?? null;
  const night = visitPeriod(visit) === "evening";
  const art = artFor(visit);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => { headingRef.current?.focus(); }, [visit.id]);
  useEffect(() => {
    if (!reaction) return;
    const timeout = window.setTimeout(() => setReaction(0), 2300);
    return () => window.clearTimeout(timeout);
  }, [reaction]);
  const saved = async (s: DayPlanStop, counts?: PickupCounts) => {
    const ok = await onSave(s, counts);
    // Success only: a failed or refused write never plays the scene.
    if (ok) {
      setLastSaved(s.id);
      setReaction(n => n + 1);
    }
    return ok;
  };
  const savedJob = visit.jobs.find(j => j.id === lastSaved);
  return (
    <article className="lc-visit" data-testid="driver-studio-detail" data-visit-id={visit.id}>
      <div className="lc-visit__top">
        <button type="button" onClick={onBack} className="lc-ghost"><ArrowLeft size={18} /> ROUTE</button>
        <span className={`lc-state ${allSaved ? "lc-state--done" : arrived ? "lc-state--here" : ""}`} data-testid="driver-studio-visit-state">{allSaved ? "DONE" : arrived ? "ARRIVED" : "EN ROUTE"}</span>
      </div>
      <SceneImage scene={visit.scene} art={art} reaction={reaction} night={night && !art.placeholder} />
      <div className="lc-visit__body">
        <div className="lc-visit__meta">{art.label} · {visit.timeLabel}</div>
        <h2 ref={headingRef} tabIndex={-1}>{visitTitle(visit)}</h2>
        {visit.scene !== "plain" && visit.jobs.length === 1 && <p className="lc-visit__place">{visit.location}</p>}
        <p>{visit.address ?? "Address not provided"}</p>
        <div className="lc-visit__nav">
          {mapsUrl
            ? <a className="lc-primary" href={mapsUrl} target="_blank" rel="noopener noreferrer" data-testid="driver-studio-maps"><MapPinned size={19} /> OPEN GOOGLE MAPS</a>
            : <span className="lc-hint">No address to navigate to.</span>}
          {!allSaved && <button type="button" className="lc-secondary" onClick={onArrive} disabled={arrived} data-testid="driver-studio-arrived">{arrived ? "AT STOP" : "I'VE ARRIVED"}</button>}
        </div>
        {(arrived || allSaved) && (
          <div className="lc-visit__jobs">
            <p id="lc-hold-help" className="lc-hint">Press and hold each job for about a second. Letting go early saves nothing.</p>
            {visit.jobs.map(s => <JobCard key={s.id} stop={s} savedLocally={savedIds.has(s.id)} onSaved={saved} onRetrySync={onRetrySync} onFallback={() => onOriginalStop(s)} />)}
          </div>
        )}
        {!arrived && !allSaved && <p className="lc-hint">Tap I'VE ARRIVED when you are parked at the address. Jobs unlock there.</p>}
        <p className="lc-scene__message" role="status" aria-live="polite">
          {reaction > 0 && savedJob ? `${formatJobKind(savedJob.kind)} SAVED · ${art.effect}` : ""}
        </p>
        {allSaved && <button type="button" className="lc-primary lc-next" onClick={onNext} data-testid="driver-studio-next">{hasNext ? <>NEXT STOP <ArrowRight size={20}/></> : <>BACK TO ROUTE <ArrowRight size={20}/></>}</button>}
      </div>
    </article>
  );
}

type Remembered = { visitId: string | null; jobIds: string[]; arrived: string[] };

function memoryKey(businessDate: string) {
  return `joystick:studio:${businessDate}`;
}
function readMemory(businessDate: string): Remembered {
  try {
    const raw = window.sessionStorage.getItem(memoryKey(businessDate));
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      return {
        visitId: typeof parsed.visitId === "string" ? parsed.visitId : null,
        jobIds: Array.isArray(parsed.jobIds) ? parsed.jobIds.filter((v: unknown) => typeof v === "string") : [],
        arrived: Array.isArray(parsed.arrived) ? parsed.arrived.filter((v: unknown) => typeof v === "string") : [],
      };
    }
  } catch {
    // Storage blocked: start at the route.
  }
  return { visitId: null, jobIds: [], arrived: [] };
}

export default function DriverStudioDay({ businessDate, stops, isLoading, loadError, onResolveStop, onRetryPickup, onOriginalStop, onOpenNewOrder, onEnterWorld, onOpenClaireComposer, onCallClaire, onSwitchToLegacy, briefing, navigation = [] }: StudioProps) {
  const visits = useMemo(() => groupRouteVisits(stops), [stops]);
  // Where the driver was, so coming back from Google Maps lands on the same stop. Never submits anything.
  const [memory, setMemory] = useState<Remembered>(() => readMemory(businessDate));
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  const [claireCall, setClaireCall] = useState<ClaireCallState>("idle");
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNavOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);
  const firstDate = useRef(businessDate);
  useEffect(() => {
    if (firstDate.current === businessDate) return;
    firstDate.current = businessDate;
    setSavedIds(new Set());
    setMemory(readMemory(businessDate));
  }, [businessDate]);
  useEffect(() => {
    try { window.sessionStorage.setItem(memoryKey(businessDate), JSON.stringify(memory)); } catch { /* storage blocked */ }
  }, [businessDate, memory]);
  useEffect(() => {
    if (claireCall !== "called" && claireCall !== "error") return;
    const t = window.setTimeout(() => setClaireCall("idle"), 6000);
    return () => window.clearTimeout(t);
  }, [claireCall]);
  // Studio carries Claire in its own corner, so the floating launcher steps out.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.claireDock = "studio";
    return () => { delete root.dataset.claireDock; };
  }, []);
  const [nightMode, setNightMode] = useState(() => {
    try {
      const stored = window.localStorage.getItem("joystick:studio:theme");
      if (stored === "dark") return true;
      if (stored === "light") return false;
    } catch { /* fall through to the clock */ }
    const hour = new Date().getHours();
    return hour >= 19 || hour < 6;
  });
  const toggleNight = () => setNightMode(v => {
    try { window.localStorage.setItem("joystick:studio:theme", v ? "light" : "dark"); } catch { /* not remembered */ }
    return !v;
  });

  const visit = findVisit(visits, memory.visitId, memory.jobIds);
  const completedCount = visits.filter(v => isVisitDone(v, savedIds)).length;
  const select = (v: RouteVisit | null) => {
    setMemory(m => ({ ...m, visitId: v?.id ?? null, jobIds: v ? v.jobs.map(j => j.id) : [] }));
    window.scrollTo({ top: 0 });
  };
  const save = async (s: DayPlanStop, counts?: PickupCounts): Promise<boolean> => {
    if (!onResolveStop || !canHoldToComplete(s) || savedIds.has(s.id)) return false;
    const success = await onResolveStop(s, counts);
    if (success) setSavedIds(prev => new Set([...prev, s.id]));
    return success;
  };
  const nextCandidate = (() => {
    if (!visit) return undefined;
    const idx = visits.findIndex(v => v.id === visit.id);
    return visits.slice(idx + 1).find(v => !isVisitDone(v, savedIds)) ?? visits.find(v => v.id !== visit.id && !isVisitDone(v, savedIds));
  })();
  const callClaire = async () => {
    if (claireCall === "calling") return;
    setClaireCall("calling");
    try {
      await onCallClaire();
      setClaireCall("called");
    } catch {
      setClaireCall("error");
    }
  };
  const [y, m, d] = businessDate.split("-").map(Number);
  const dateText = y && m && d
    ? new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).toUpperCase()
    : "TODAY";
  return (
    <main className={`lc-driver ${nightMode ? "lc-driver--dark" : ""}`} data-testid="driver-studio">
      <ClaireTether onMessage={onOpenClaireComposer} onCall={() => void callClaire()} callState={claireCall} />
      {!visit ? (
        <>
          <header className="lc-driver__header">
            <div className="lc-driver__eyebrow">JOYSTICK · {dateText}</div>
            <div className="lc-driver__header-row"><h1>TODAY'S ROUTE</h1>{navigation.length > 0 && <button className="lc-night-toggle" type="button" onClick={() => setNavOpen(v => !v)} aria-label="Open Navigation Menu" aria-expanded={navOpen} aria-controls="lc-driver-navigation">{navOpen ? <X size={19}/> : <Menu size={19}/>}</button>}<button className="lc-night-toggle" onClick={toggleNight} type="button" aria-label={nightMode ? "Use light mode" : "Use dark mode"} aria-pressed={nightMode}>{nightMode ? <Sun size={19}/> : <Moon size={19}/>}</button></div>
            {navOpen && (
              <nav id="lc-driver-navigation" className="lc-nav" aria-label="Day Line">
                {navigation.map(item => (
                  <button key={item.label} type="button" onClick={() => { setNavOpen(false); item.onSelect(); }}>{item.label}</button>
                ))}
              </nav>
            )}
            <p>{completedCount} OF {visits.length} VISITS COMPLETE</p>
            <button type="button" className="lc-out-of-town" onClick={() => onEnterWorld()}>ROAD OUT OF TOWN <ArrowRight size={14}/></button>
          </header>
          {briefing && <section className="lc-briefing" aria-label="From Claire">{briefing}</section>}
          {loadError && <div role="alert" className="lc-error">{loadError}</div>}
          {isLoading && <p className="lc-hint" role="status">Loading today's stops…</p>}
          {!isLoading && visits.length === 0 && <p className="lc-empty">No scheduled visits. Add an order to get started.</p>}
          <ol className="lc-visit-list" aria-label="Today's visits">
            {visits.map((v, i) => {
              const done = isVisitDone(v, savedIds);
              const next = !done && visits.slice(0, i).every(prior => isVisitDone(prior, savedIds));
              const period = visitPeriod(v);
              const prevPeriod = i ? visitPeriod(visits[i - 1]) : null;
              return (
                <li key={v.id}>
                  {period !== prevPeriod && <h2 className="lc-section-label">{period === "evening" ? "EVENING" : "DAYTIME"}</h2>}
                  <button type="button" className={`lc-list-row ${next ? "lc-list-row--next" : ""} ${done ? "lc-list-row--done" : ""}`} onClick={() => select(v)} data-testid={`driver-studio-visit-${v.id}`}>
                    <span className={`lc-list-row__status ${done ? "is-done" : ""}`} aria-hidden="true">{done ? <Check size={14}/> : next ? "•" : ""}</span>
                    <span className="lc-list-row__time">{v.timeLabel}</span>
                    <span className="lc-list-row__copy">
                      <strong>{visitTitle(v)}</strong>
                      <small>{v.jobs.map(s => formatJobKind(s.kind)).join(" · ")} · {v.jobs.length} {v.jobs.length === 1 ? "job" : "jobs"}{done ? " · done" : next ? " · next" : ""}</small>
                    </span>
                    <span className="lc-list-row__art" aria-hidden="true"><SceneImage scene={v.scene} art={artFor(v)} reaction={0} night={false} variant="thumb" /></span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ol>
          {onSwitchToLegacy && <button type="button" className="lc-legacy-link" onClick={onSwitchToLegacy}>Use the previous Day Line</button>}
          <div className="lc-driver__bottom">
            <button type="button" className="lc-new-order" onClick={onOpenNewOrder} data-testid="driver-studio-new-order"><Plus size={23} strokeWidth={2.8}/> NEW ORDER</button>
          </div>
        </>
      ) : (
        <VisitDetail key={visit.id} visit={visit} savedIds={savedIds}
          arrived={memory.arrived.includes(visit.id)}
          onArrive={() => setMemory(m => ({ ...m, arrived: m.arrived.includes(visit.id) ? m.arrived : [...m.arrived, visit.id] }))}
          onBack={() => select(null)}
          onSave={save} onRetrySync={onRetryPickup} onOriginalStop={onOriginalStop}
          onNext={() => select(nextCandidate ?? null)} hasNext={Boolean(nextCandidate)} />
      )}
    </main>
  );
}
