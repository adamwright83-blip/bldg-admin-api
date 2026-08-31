import { useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, FlaskConical, LockKeyhole } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { applyTowerWarsEvent, initialTowerWarsState } from "@shared/towerWars";
import type { SandboxScenario } from "@shared/sandboxScenarios";
import { CanonicalBuildingArt } from "./CanonicalBuildingArt";
import { SIGNAL_ART, SIGNAL_LABEL, type PsychSignalKind } from "./psychSignals";

const CREATURES: Array<{ kind: PsychSignalKind; appears: string; clears: string }> = [
  { kind: "ghost", appears: "Real outreach, material outcome, no new evidence", clears: "Reply, resolution, or explicit closure" },
  { kind: "goblins", appears: "Persistent ghost plus real stakes", clears: "Evidence, resolution, or completed legitimate action" },
  { kind: "fog", appears: "A response exists but its meaning is unclassified", clears: "Clarification or classification" },
  { kind: "vines", appears: "A real next action is overdue", clears: "Doing it or invalidating the path" },
  { kind: "clock", appears: "A real dated commitment exists", clears: "Action done or the window closes" },
  { kind: "ruinbound", appears: "A real mission is executing", clears: "The encounter or mission resolves" },
];

const DEGRADATIONS = ["Maps works / Places fails", "Places works / Weather fails", "Aerial unavailable for one building", "Street View unavailable", "Map Tiles timeout", "Geocoding quota error", "Aggregate has no coverage", "Google entirely unavailable"];

export default function SandboxMode({ onNavigate }: { onNavigate: (path: string) => void }) {
  const query = trpc.system.towerWars.sandbox.useQuery(undefined, { retry: false, staleTime: Infinity });
  const [selected, setSelected] = useState<SandboxScenario>("THREE_ORDER_BATTLE");
  const [cursor, setCursor] = useState(0);
  const [degradation, setDegradation] = useState<string | null>(null);
  const [replayDate, setReplayDate] = useState("");
  const [requestedReplayDate, setRequestedReplayDate] = useState("");
  const replay = trpc.system.towerWars.sandboxReplay.useQuery({ businessDate: requestedReplayDate }, { enabled: requestedReplayDate.length === 10, retry: false });
  const scenario = query.data?.scenarios.find(item => item.scenario === selected);
  const state = useMemo(() => {
    let next = initialTowerWarsState();
    for (const event of scenario?.fixture.events.slice(0, cursor) ?? []) next = applyTowerWarsEvent(next, event);
    return next;
  }, [scenario, cursor]);

  if (query.isLoading) return <main className="sb-page"><div className="sb-banner"><FlaskConical /> SANDBOX GATE CHECK</div></main>;
  if (!query.data) return <main className="sb-page"><div className="sb-denied"><LockKeyhole /><h1>Sandbox is server-disabled</h1><p>Set GOLDLINE_SANDBOX_ENABLED=true on an admin environment. No client switch can bypass this gate.</p></div></main>;

  return <main className="sb-page" data-animation-cursor={cursor} data-degradation={degradation ?? "none"}>
    <div className="sb-banner"><AlertTriangle /> {query.data.banner} <AlertTriangle /></div>
    <header className="sb-head"><div><small>Permanent development infrastructure</small><h1>One World Sandbox</h1><p>Deterministic fixtures enter the real Tower Wars compiler and settlement reducer. This route exposes no mutations.</p></div><label>Scenario<select value={selected} onChange={event => { setSelected(event.target.value as SandboxScenario); setCursor(0); }}>{query.data.scenarios.map(item => <option key={item.scenario}>{item.scenario}</option>)}</select></label></header>
    {scenario ? <>
      <section className="sb-battle"><div className="sb-tower"><CanonicalBuildingArt buildingId="opus_la" incomingToday={state.buildings.opus_la.incomingAttackCount} charge={state.buildings.opus_la.unspentValueCents / 5000}/><b>OPUS · ${(state.buildings.opus_la.revenueCents / 100).toFixed(0)}</b></div><div className="sb-cursor"><strong>{scenario.scenario}</strong><p>{scenario.description}</p><span>Deterministic event {cursor} / {scenario.fixture.events.length}</span><div><button type="button" onClick={() => setCursor(value => Math.max(0, value - 1))}><ChevronLeft /> Step back</button><button type="button" onClick={() => setCursor(value => Math.min(scenario.fixture.events.length, value + 1))}>Step event <ChevronRight /></button></div></div><div className="sb-tower"><CanonicalBuildingArt buildingId="century_park_east" incomingToday={state.buildings.century_park_east.incomingAttackCount} charge={state.buildings.century_park_east.unspentValueCents / 5000}/><b>CPE · ${(state.buildings.century_park_east.revenueCents / 100).toFixed(0)}</b></div></section>
      <section className="sb-math"><h2>Settled proof</h2>{(["opus_la", "century_park_east"] as const).map(id => { const day = scenario.settlement.buildings[id].today; return <article key={id}><b>{id}</b><span>${day.revenueCents / 100}</span><span>{day.outgoingAttacks} outgoing</span><span>{day.incomingAttacks} incoming</span><span>${day.unspentValueCents / 100} charge</span></article>; })}</section>
    </> : null}
    <section className="sb-actions"><h2>ACTION_ELIGIBILITY</h2><button disabled title="Sandbox never writes production truth">Mutating action disabled — sandbox cannot fulfill promises</button></section>
    <section className="sb-matrix"><h2>CREATURE_MATRIX</h2><div>{CREATURES.map(item => <article key={item.kind}><img src={SIGNAL_ART[item.kind]} alt=""/><b>{SIGNAL_LABEL[item.kind]}</b><span>Appears: {item.appears}</span><span>Clears only: {item.clears}</span></article>)}</div></section>
    <section className="sb-matrix"><h2>TRANSITION_MATRIX</h2><div className="sb-transition-buttons"><button onClick={() => onNavigate("/growth/lantern-city")}>City → tower</button><button onClick={() => onNavigate("/growth/tower-wars?building=opus_la")}>Direct-link OPUS</button><button onClick={() => onNavigate("/growth/tower-wars?building=century_park_east")}>Direct-link CPE</button><button onClick={() => history.back()}>Back / forward</button><button onClick={() => document.documentElement.classList.toggle("sandbox-reduced-motion")}>Reduced motion</button></div></section>
    <section className="sb-matrix"><h2>API_DEGRADATION</h2><p>Presentation faults never alter fixture truth.</p><div className="sb-degradation">{DEGRADATIONS.map(item => <button className={degradation === item ? "is-active" : ""} onClick={() => setDegradation(item)} key={item}>{item}</button>)}</div>{degradation ? <div className="sb-fallback">{degradation}: authored geography remains visible; external confidence is reduced; no canonical entity is removed.</div> : null}</section>
    <section className="sb-real-replay"><h2>REAL_DAY_REPLAY</h2><p>Completed dates only. Production settlement is read with an isolated sandbox cursor and cannot consume unseen live events or write history.</p><div><input type="date" value={replayDate} max={new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)} onChange={event => setReplayDate(event.target.value)}/><button type="button" disabled={replayDate.length !== 10} onClick={() => setRequestedReplayDate(replayDate)}>Load read-only day</button></div>{replay.data ? <p className="sb-replay-result">{replay.data.businessDate} · {replay.data.cursorScope} · OPUS ${replay.data.settlement.buildings.opus_la.today.revenueCents / 100} · CPE ${replay.data.settlement.buildings.century_park_east.today.revenueCents / 100}</p> : null}{replay.error ? <p className="sb-fallback">Replay unavailable: {replay.error.message}</p> : null}</section>
  </main>;
}
