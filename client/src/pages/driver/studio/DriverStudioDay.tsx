import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronRight, MapPinned, Plus, RotateCcw, Check, Package, Moon, Sun } from "lucide-react";
import type { PickupCounts } from "@shared/cleancloudPickup";
import type { DayPlanStop } from "../goldlineDayPlanModel";
import {
  canHoldToComplete,
  formatJobKind,
  groupRouteVisits,
  hasSavedJob,
  SCENES,
  timeOfStop,
  type DriverSceneId,
  type RouteVisit,
} from "./driverStudioModel";
import "./driver-studio.css";

type StudioProps = {
  businessDate: string;
  stops: DayPlanStop[];
  isLoading?: boolean;
  loadError?: string | null;
  onResolveStop?: (stop: DayPlanStop, counts?: PickupCounts) => Promise<boolean>;
  onOriginalStop: (stop: DayPlanStop) => void;
  onOpenNewOrder: () => void;
  onEnterWorld: (trackedStopId?: string) => void;
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
  const busy = phase === "saving" || phase === "complete";
  const cancel = () => {
    held.current = false;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setPhase(p => p === "holding" ? "idle" : p);
  };
  useEffect(() => () => {
    held.current = false;
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const begin = () => {
    if (disabled || busy || held.current) return;
    held.current = true;
    setPhase("holding");
    timer.current = window.setTimeout(async () => {
      if (!held.current) return;
      held.current = false;
      timer.current = null;
      setPhase("saving");
      try {
        const recorded = await onCommit();
        setPhase(recorded ? "complete" : "error");
      } catch {
        setPhase("error");
      }
    }, 1100);
  };
  return (
    <button
      type="button"
      className={`lc-hold lc-hold--${phase}`}
      aria-label={`Hold to ${label.toLowerCase()}`}
      aria-disabled={disabled || busy}
      disabled={disabled || busy}
      onPointerDown={e => { if (e.pointerType !== "mouse" || e.button === 0) { e.currentTarget.setPointerCapture(e.pointerId); begin(); } }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onContextMenu={e => e.preventDefault()}
      onKeyDown={e => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); begin(); } }}
      onKeyUp={e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); cancel(); } }}
      data-testid="driver-studio-hold"
    >
      <span className="lc-hold__inner">
        {phase === "complete" ? <Check size={25} /> : phase === "error" ? <RotateCcw size={22} /> : <Package size={25} />}
        <strong>{phase === "saving" ? "SAVING" : phase === "complete" ? "SAVED" : phase === "error" ? "RETRY" : "HOLD"}</strong>
      </span>
    </button>
  );
}

function SceneImage({ scene, effect, night }: { scene: DriverSceneId; effect: boolean; night: boolean }) {
  const entry = SCENES[scene];
  return (
    <div className={`lc-scene lc-scene--${scene} ${night ? "lc-scene--night" : ""} ${effect ? "lc-scene--react" : ""}`}
      role="img" aria-label={entry.label}
      data-testid="driver-studio-scene"
    >
      {entry.image ? (
        <img src={entry.image} alt="" style={{ objectPosition: entry.position }} />
      ) : (
        <div className="lc-scene__neutral"><span>{scene === "koreatown" ? "KOREATOWN" : scene === "hollywood" ? "HOLLYWOOD" : "YOUR NEXT STOP"}</span></div>
      )}
      {scene === "silver-lake" && <img className="lc-scene__fox" src="/assets/lantern-villager-outreach/villagers/animations/fox-wave.png" alt="" />}
      {scene === "century-park-east" && <div className="lc-scene__cpe-signal" aria-hidden="true"><span>RECORDED</span><b>✓</b></div>}
      {scene === "opus" && <>
        <div className="lc-scene__opus-light" aria-hidden="true"><span>✦</span></div>
        <div className="lc-scene__opus-basket" aria-hidden="true"><span className="lc-scene__opus-rope" /><span className="lc-scene__opus-carrier">▤</span></div>
      </>}
      {scene === "beverly-hills" && <div className="lc-scene__rodeo" aria-hidden="true">
        <span className="lc-scene__dog" /><span className="lc-scene__calf" />
      </div>}
      {scene === "koreatown" && <span className="lc-scene__boba" aria-hidden="true">✦</span>}
      <div className="lc-scene__flare" aria-hidden="true" />
    </div>
  );
}

function JobCard({ stop, recorded, onSaved, onFallback }: {
  stop: DayPlanStop;
  recorded: boolean;
  onSaved: (stop: DayPlanStop, counts?: PickupCounts) => Promise<boolean>;
  onFallback: () => void;
}) {
  const [bags, setBags] = useState(String(stop.pickupBridge?.bagCount ?? ""));
  const [garments, setGarments] = useState(String(stop.pickupBridge?.garmentCount ?? ""));
  const [error, setError] = useState<string | null>(null);
  const canHold = canHoldToComplete(stop);
  const isBridge = stop.kind === "pickup" && !!stop.pickupBridge;
  const complete = recorded || stop.status === "completed";
  const statusText = complete
    ? stop.pickupBridge?.state === "synced" ? "CLEANCLOUD SYNCED" : "SAVED"
    : stop.status === "blocked" ? "BLOCKED" : "READY";

  const commit = async (): Promise<boolean> => {
    let counts: PickupCounts | undefined;
    if (isBridge) {
      const bagCount = Number(bags);
      const garmentCount = Number(garments);
      if (!Number.isInteger(bagCount) || !Number.isInteger(garmentCount) || bagCount < 0 || garmentCount < 0 ||
        bagCount > 999 || garmentCount > 9999 || bagCount + garmentCount === 0) {
        setError("Enter a valid bag or garment count before completing.");
        return false;
      }
      counts = { bagCount, garmentCount };
    }
    setError(null);
    const ok = await onSaved(stop, counts);
    if (!ok) setError("Nothing was saved. Try again or open the full stop.");
    return ok;
  };
  return (
    <section className={`lc-job ${complete ? "lc-job--done" : ""}`} data-testid={`driver-studio-job-${stop.id}`}>
      <div className="lc-job__details">
        <div className="lc-job__labels"><b>{formatJobKind(stop.kind)}</b><span>{statusText}</span></div>
        <strong>{stop.title}</strong>
        {stop.displayDetail && <small>{stop.displayDetail}</small>}
        {isBridge && !complete && (
          <div className="lc-job__counts">
            <label>BAGS<input type="number" min={0} max={999} inputMode="numeric" value={bags} onChange={e => setBags(e.target.value)} /></label>
            <label>GARMENTS<input type="number" min={0} max={9999} inputMode="numeric" value={garments} onChange={e => setGarments(e.target.value)} /></label>
          </div>
        )}
        {error && <small className="lc-job__error" role="alert">{error}</small>}
        {!canHold && !complete && <button className="lc-job__fallback" type="button" onClick={onFallback}>OPEN FULL STOP <ChevronRight size={16} /></button>}
      </div>
      {complete ? <span className="lc-job__check" aria-label="Job saved"><Check size={28} /></span> : canHold ? (
        <HoldRing key={stop.id} label={stop.kind === "dropoff" ? "record delivery" : "record pickup"} onCommit={commit} />
      ) : null}
    </section>
  );
}

function VisitDetail({ visit, savedIds, onBack, onSave, onOriginalStop, onNext }: {
  visit: RouteVisit;
  savedIds: ReadonlySet<string>;
  onBack: () => void;
  onSave: (s: DayPlanStop, counts?: PickupCounts) => Promise<boolean>;
  onOriginalStop: (s: DayPlanStop) => void;
  onNext: () => void;
}) {
  const [arrived, setArrived] = useState(false);
  const [lastEffect, setLastEffect] = useState(0);
  const allSaved = visit.jobs.every(s => hasSavedJob(s, savedIds));
  const first = visit.jobs[0];
  const night = (timeOfStop(first.timeLabel) ?? 0) >= 18 * 60;
  useEffect(() => { setArrived(visit.jobs.every(s => hasSavedJob(s, savedIds))); setLastEffect(0); }, [visit.id]); // switching visits
  useEffect(() => {
    if (!lastEffect) return;
    const timeout = window.setTimeout(() => setLastEffect(0), 1850);
    return () => window.clearTimeout(timeout);
  }, [lastEffect]);
  const saved = async (s: DayPlanStop, counts?: PickupCounts) => {
    const ok = await onSave(s, counts);
    if (ok) setLastEffect(n => n + 1);
    return ok;
  };
  return (
    <article className="lc-visit" data-testid="driver-studio-detail">
      <div className="lc-visit__top">
        <button type="button" onClick={onBack} className="lc-ghost"><ArrowLeft size={18} /> ROUTE</button>
        <span className={`lc-state ${allSaved ? "lc-state--done" : ""}`}>{allSaved ? "DONE" : arrived ? "ARRIVED" : "EN ROUTE"}</span>
      </div>
      <SceneImage key={visit.id} scene={visit.scene} effect={lastEffect > 0} night={night} />
      <div className="lc-visit__body">
        <div className="lc-visit__meta">{SCENES[visit.scene].label}</div>
        <h2>{visit.scene === "plain" ? visit.location : visit.scene === "century-park-east" ? "Century Park East" : visit.scene === "opus" ? "OPUS LA" : visit.scene === "silver-lake" ? "Silver Lake" : visit.scene === "beverly-hills" ? "Beverly Hills" : visit.scene === "koreatown" ? "Koreatown" : "Hollywood"}</h2>
        <p>{visit.address ?? "Address not provided"}</p>
        {first.displayDetail && <p className="lc-visit__notes">{first.displayDetail}</p>}
        <div className="lc-visit__nav">
          {first.navigationUrl && <a className="lc-primary" href={first.navigationUrl} target="_blank" rel="noopener noreferrer"><MapPinned size={19} /> OPEN GOOGLE MAPS</a>}
          {!allSaved && <button type="button" className="lc-secondary" onClick={() => setArrived(true)} disabled={arrived}>{arrived ? "AT STOP" : "I'VE ARRIVED"}</button>}
        </div>
        {(arrived || allSaved) && (
          <div className="lc-visit__jobs">
            {visit.jobs.map(s => <JobCard key={s.id} stop={s} recorded={hasSavedJob(s, savedIds)} onSaved={saved} onFallback={() => onOriginalStop(s)} />)}
          </div>
        )}
        {!arrived && !allSaved && <p className="lc-hint">Arrive at the address before completing the jobs. Please only interact while parked.</p>}
        {lastEffect > 0 && <p className="lc-scene__message" role="status">JOB SAVED · {SCENES[visit.scene].effect}</p>}
        {allSaved && <button type="button" className="lc-primary lc-next" onClick={onNext}>NEXT STOP <ArrowRight size={20}/></button>}
      </div>
    </article>
  );
}

export default function DriverStudioDay({ businessDate, stops, isLoading, loadError, onResolveStop, onOriginalStop, onOpenNewOrder, onEnterWorld }: StudioProps) {
  const visits = useMemo(() => groupRouteVisits(stops), [stops]);
  const [selectedVisit, setSelectedVisit] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => { setSavedIds(new Set()); setSelectedVisit(null); }, [businessDate]);
  const [nightMode, setNightMode] = useState(false);
  const visit = visits.find(v => v.id === selectedVisit);
  const completedCount = visits.filter(v => v.jobs.every(s => hasSavedJob(s, savedIds))).length;
  const save = async (s: DayPlanStop, counts?: PickupCounts): Promise<boolean> => {
    if (!onResolveStop || !canHoldToComplete(s)) return false;
    const success = await onResolveStop(s, counts);
    if (success) setSavedIds(prev => new Set([...prev, s.id]));
    return success;
  };
  const nextStop = () => {
    const idx = visits.findIndex(v => v.id === selectedVisit);
    const candidate = visits.slice(idx + 1).find(v => !v.jobs.every(s => hasSavedJob(s, savedIds)));
    setSelectedVisit(candidate?.id ?? null);
  };
  const dateText = businessDate ? businessDate.split("-").reverse().join(".") : "TODAY";
  return (
    <main className={`lc-driver ${nightMode ? "lc-driver--dark" : ""}`} data-testid="driver-studio">
      {!visit ? (
        <>
          <header className="lc-driver__header">
            <div className="lc-driver__eyebrow">JOYSTICK · {dateText}</div>
            <div className="lc-driver__header-row"><h1>TODAY'S ROUTE</h1><button className="lc-night-toggle" onClick={() => setNightMode(v => !v)} type="button" aria-label={nightMode ? "Use light mode" : "Use dark mode"}>{nightMode ? <Sun size={19}/> : <Moon size={19}/>}</button></div>
            <p>{completedCount} OF {visits.length} VISITS COMPLETE</p>
            <button type="button" className="lc-out-of-town" onClick={() => onEnterWorld()}>ROAD OUT OF TOWN <ArrowRight size={14}/></button>
          </header>
          {loadError && <div role="alert" className="lc-error">{loadError}</div>}
          {isLoading && <p>Loading real stops…</p>}
          {!isLoading && visits.length === 0 && <p className="lc-empty">No scheduled visits. Add an order to get started.</p>}
          <div className="lc-visit-list">
            {visits.map((v, i) => {
              const done = v.jobs.every(s => hasSavedJob(s, savedIds));
              const next = !done && visits.slice(0, i).every(prior => prior.jobs.every(s => hasSavedJob(s, savedIds)));
              const category = (timeOfStop(v.timeLabel) ?? 0) >= 17 * 60 ? "EVENING DELIVERIES" : "DAYTIME VISITS";
              const prevCategory = i ? ((timeOfStop(visits[i-1].timeLabel) ?? 0) >= 17*60 ? "EVENING DELIVERIES" : "DAYTIME VISITS") : "";
              return (
                <div key={v.id}>
                  {category !== prevCategory && <h2 className="lc-section-label">{category}</h2>}
                  <button type="button" className={`lc-list-row ${next ? "lc-list-row--next" : ""}`} onClick={() => setSelectedVisit(v.id)}>
                    <span className={`lc-list-row__status ${done ? "is-done" : ""}`}>{done ? <Check size={14}/> : next ? "•" : ""}</span>
                    <span className="lc-list-row__time">{v.timeLabel}</span>
                    <span className="lc-list-row__copy">
                      <strong>{v.scene === "plain" ? v.location : v.scene === "century-park-east" ? "Century Park East" : v.scene === "opus" ? "OPUS LA" : v.scene === "silver-lake" ? "Silver Lake" : v.scene === "beverly-hills" ? "Beverly Hills" : v.scene === "koreatown" ? "Koreatown" : "Hollywood"}</strong>
                      <small>{v.jobs.map(s => formatJobKind(s.kind)).join(" · ")} · {v.jobs.length} {v.jobs.length === 1 ? "job" : "jobs"}</small>
                    </span>
                    <span className="lc-list-row__art">{SCENES[v.scene].image ? <img src={SCENES[v.scene].image!} alt="" style={{objectPosition:SCENES[v.scene].position}}/> : <span>{v.scene === "koreatown" ? "KT" : "•"}</span>}</span>
                    <ChevronRight size={18} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="lc-driver__bottom">
            <button type="button" className="lc-new-order" onClick={onOpenNewOrder}><Plus size={23} strokeWidth={2.8}/> NEW ORDER</button>
          </div>
        </>
      ) : (
        <VisitDetail key={visit.id} visit={visit} savedIds={savedIds} onBack={() => setSelectedVisit(null)}
          onSave={save} onOriginalStop={onOriginalStop} onNext={nextStop}/>
      )}
    </main>
  );
}
