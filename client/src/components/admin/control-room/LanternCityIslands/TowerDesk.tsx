import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { residentsAsOf, type TowerDesk as Desk, type TowerDeskBuildingId } from "@shared/towerDesk";
import { buildTowerModel, darkFloors, type BuildingModel, type BuildingSpec, type Resident } from "./towerStack";
import styles from "./tower-desk.module.css";

/**
 * The front desk under a tower (shared/towerDesk.ts says what each monitor means). The desk, lamp,
 * brochure and bezels are drawing; every figure on a screen is read live, and a monitor with nothing
 * real behind it says "Not wired yet" instead of showing a number.
 */
const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;
const DAY_MS = 86_400_000;
const shortDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).toUpperCase();
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

function Monitor({ n, label, children, testId }: { n: number; label: string; children: React.ReactNode; testId: string }) {
  return (
    <section className={styles.monitor} data-testid={testId}>
      <h4 className={styles.tape}>{n}. {label}</h4>
      <div className={styles.screen}>{children}</div>
    </section>
  );
}

/** two little towers of windows: lit for a customer, dim for a quiet one, hollow on a floor with nobody */
function MiniTowers({ model, quietKeys, hollowDark }: { model: BuildingModel; quietKeys: ReadonlySet<string>; hollowDark: boolean }) {
  const cell = 7, gap = 2, towerGap = 26;
  const towers = model.towers.map(t => {
    const dark = new Set(darkFloors(t));
    const cells: { x: number; y: number; state: "lit" | "dim" | "off" | "hollow" }[] = [];
    for (let f = 0; f < t.spec.floors; f++) {
      // a resident whose door isn't known takes the first free window on their floor: the floor is fact, the spot isn't
      const floorOnly = [...t.floorOnly[f]];
      for (let s = 0; s < t.spec.unitsPerFloor; s++) {
        let here: Resident[] = t.floors[f][s];
        if (!here.length && floorOnly.length) here = [floorOnly.shift()!];
        const state = here.length
          ? (here.every(r => quietKeys.has(r.key)) ? "dim" : "lit")
          : hollowDark && dark.has(f + 1) ? "hollow" : "off";
        cells.push({ x: s * (cell + gap), y: (t.spec.floors - 1 - f) * (cell + gap), state });
      }
    }
    return { id: t.spec.id, w: t.spec.unitsPerFloor * (cell + gap), h: t.spec.floors * (cell + gap), cells };
  });
  const width = towers.reduce((n, t) => n + t.w, 0) + towerGap * (towers.length - 1);
  const height = Math.max(...towers.map(t => t.h)) + 14;
  let x0 = 0;
  return (
    <svg className={styles.mini} viewBox={`-4 -4 ${width + 8} ${height + 8}`} role="img" aria-label="Windows lit by customers">
      {towers.map(t => {
        const x = x0;
        x0 += t.w + towerGap;
        return (
          <g key={t.id} transform={`translate(${x} 0)`}>
            <text x={t.w / 2} y={height - 2} className={styles.miniLabel}>{t.id}</text>
            {t.cells.map((c, i) => (
              <rect key={i} x={c.x} y={c.y} width={cell} height={cell} rx={1} className={styles[c.state]} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function ThenNow({ desk, spec, rows }: { desk: Desk; spec: BuildingSpec; rows: Resident[] }) {
  const today = desk.generatedAt.slice(0, 10);
  const first = desk.firstOrderDay;
  const span = first ? Math.max(1, Math.round((Date.parse(today) - Date.parse(first)) / DAY_MS)) : 0;
  const [at, setAt] = useState(span);
  const [playing, setPlaying] = useState(false);
  useEffect(() => setAt(span), [span]);
  useEffect(() => {
    if (!playing) return;
    const step = Math.max(1, Math.round(span / 120));
    const id = window.setInterval(() => setAt(a => {
      if (a + step >= span) { setPlaying(false); return span; }
      return a + step;
    }), 40);
    return () => window.clearInterval(id);
  }, [playing, span]);

  const day = first ? addDays(first, at) : today;
  const frame = useMemo(() => residentsAsOf(desk.residents, day), [desk.residents, day]);
  const model = useMemo(() => {
    const keys = new Set(frame.map(f => f.key));
    return buildTowerModel(spec, rows.filter(r => keys.has(r.key)));
  }, [frame, rows, spec]);
  const quietKeys = useMemo(() => new Set(frame.filter(f => f.quiet).map(f => f.key)), [frame]);

  if (!first) return <p className={styles.notWired}>No orders here yet. The first one lights the first window.</p>;
  return (
    <>
      <MiniTowers model={model} quietKeys={quietKeys} hollowDark={false} />
      <div className={styles.scrub}>
        <button type="button" className={styles.play} onClick={() => { if (at >= span) setAt(0); setPlaying(p => !p); }} aria-label={playing ? "Pause" : "Play the building's history"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <input type="range" min={0} max={span} value={at} onChange={e => { setPlaying(false); setAt(Number(e.target.value)); }} aria-label="Scrub through the building's history" />
      </div>
      <div className={styles.scrubEnds}>
        <span>First order<br /><b>{shortDay(first)}</b></span>
        <span className={styles.scrubNow}>{frame.length} lit{frame.some(f => f.quiet) ? ` · ${frame.filter(f => f.quiet).length} dim` : ""}<br /><b>{at >= span ? "TODAY" : shortDay(day)}</b></span>
      </div>
    </>
  );
}

function Elevator({ desk }: { desk: Desk }) {
  const run = desk.revenue.last30Cents, goal = desk.goalMonthlyCents;
  const level = run !== null && goal ? Math.min(1, run / goal) : 0;
  return (
    <div className={styles.elevator}>
      <div className={styles.shaft} aria-hidden>
        {["PH", "20", "15", "10", "5", "L"].map(f => <span key={f}>{f}</span>)}
        <div className={styles.car} style={{ bottom: `calc(${level * 100}% * 0.86 + 2%)` }}>$</div>
      </div>
      <div className={styles.elevatorRead}>
        <small>Paid, last 30 days</small>
        {run !== null ? <b className={styles.bigMoney} data-testid="desk-run-rate">{money(run)}</b> : <b className={styles.notWiredBox}>Not wired yet</b>}
        {desk.revenue.status === "partial" ? <em>May be low: a sales source didn't load.</em> : null}
        <small>Goal (penthouse)</small>
        {goal ? <b className={styles.bigMoney}>{money(goal)}/mo</b> : <b className={styles.notWiredBox}>Goal needed</b>}
        {run !== null && goal ? <em>{Math.round(level * 100)}% of the way up</em> : null}
      </div>
    </div>
  );
}

const LOG_LABEL = { first_order: "First order", order: "Order placed", went_quiet: "Went quiet" } as const;

export default function TowerDesk({
  buildingId,
  spec,
  model,
  rows,
  onShowQuiet,
}: {
  buildingId: TowerDeskBuildingId;
  spec: BuildingSpec;
  model: BuildingModel;
  rows: Resident[];
  onShowQuiet: () => void;
}) {
  const q = trpc.system.towerDesk.read.useQuery({ buildingId }, { staleTime: 60_000, retry: 1 });
  const desk = q.data;
  const units = model.towers.reduce((n, t) => n + t.spec.floors * t.spec.unitsPerFloor, 0);
  const lit = model.towers.reduce((n, t) => n + t.lit, 0);
  const floors = model.towers.reduce((n, t) => n + t.spec.floors, 0);
  const litFloors = floors - model.towers.reduce((n, t) => n + darkFloors(t).length, 0);
  const quietKeys = useMemo(() => new Set(rows.filter(r => r.quiet).map(r => r.key)), [rows]);

  const pending = <p className={styles.notWired}>{q.isError ? "Not wired yet: the desk couldn't be read." : "Reading…"}</p>;

  return (
    <div className={styles.desk} data-testid="tower-desk">
      <aside className={styles.brochure} aria-label="Brochure">
        <p className={styles.brochureTitle}>JOYSTICK<br />RESIDENCES</p>
        <p className={styles.brochureSub}>at {spec.name}</p>
        <div className={styles.brochureNote}>
          <p>{lit} of {units}<br />homes in service.<br />{units - lit} available.</p>
          <p className={styles.brochureSmall}>Every window<br />is an opportunity.</p>
        </div>
      </aside>

      <div className={styles.wall}>
        <Monitor n={1} label="Then → Now" testId="desk-then-now">
          {desk ? <ThenNow desk={desk} spec={spec} rows={rows} /> : pending}
        </Monitor>

        <Monitor n={2} label="Where it needs to be" testId="desk-goal-floors">
          <MiniTowers model={model} quietKeys={quietKeys} hollowDark />
          <div className={styles.goalRow}>
            <p className={styles.caption}>
              <b>{litFloors} of {floors}</b> floors lit.<br />Goal: a light on every floor.
            </p>
            <div className={styles.sticky}>
              {desk?.revenue.perHomeMonthlyCents
                ? <>One more home<br />≈ {money(desk.revenue.perHomeMonthlyCents)}/mo<br /><small>today's average</small></>
                : <>Price per home<br /><small>not wired yet</small></>}
            </div>
          </div>
          <p className={styles.legend}><i className={styles.lit} /> customer <i className={styles.dim} /> quiet <i className={styles.hollow} /> floor with nobody</p>
        </Monitor>

        <Monitor n={3} label="Revenue elevator" testId="desk-elevator">
          {desk ? <Elevator desk={desk} /> : pending}
        </Monitor>

        <Monitor n={4} label="Money gone dim" testId="desk-gone-dim">
          {desk ? (
            <div className={styles.dimRead}>
              <p><b>{desk.dim.quietResidents}</b> resident{desk.dim.quietResidents === 1 ? "" : "s"} quiet 45+ days</p>
              {desk.dim.estMonthlyCents !== null
                ? <p><b className={styles.bigMoney}>{money(desk.dim.estMonthlyCents)}/mo</b><br /><small>what they used to spend a month (estimate)</small></p>
                : <p className={styles.notWiredBox}>Not wired yet</p>}
              {desk.dim.quietResidents ? <button type="button" className={styles.deskButton} onClick={onShowQuiet}>View quiet residents →</button> : null}
            </div>
          ) : pending}
        </Monitor>

        <Monitor n={5} label="Doorman's log" testId="desk-log">
          {desk ? (
            desk.log.length ? (
              <ol className={styles.log}>
                {desk.log.map((l, i) => (
                  <li key={i} className={styles[l.kind]}>
                    <time>{new Date(l.at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" }).toUpperCase()}</time>
                    <span>{l.unit ? `Unit ${l.unit}` : l.name}</span>
                    <span>{LOG_LABEL[l.kind]}</span>
                  </li>
                ))}
              </ol>
            ) : <p className={styles.notWired}>Nothing logged here yet.</p>
          ) : pending}
        </Monitor>

        <Monitor n={6} label="Who's bringing neighbors in" testId="desk-referrals">
          {!desk ? pending : desk.referrals.status === "unavailable" ? (
            <p className={styles.notWiredBox}>Not wired yet</p>
          ) : desk.referrals.freshness?.state === "never" ? (
            <p className={styles.notWired}><b className={styles.notWiredBox}>Not wired yet</b><br />CleanCloud's referral list hasn't been copied in.</p>
          ) : (
            <div className={styles.refRead}>
              <p><b>{desk.referrals.involving}</b> referral{desk.referrals.involving === 1 ? "" : "s"} involving residents here · <b>{desk.referrals.converted}</b> ordered</p>
              {desk.referrals.top.length ? (
                <ol>
                  {desk.referrals.top.map(t => (
                    <li key={t.name}>{t.unit ? `Unit ${t.unit}` : t.name} <span>{t.converted} of {t.sent} ordered</span></li>
                  ))}
                </ol>
              ) : <p className={styles.notWired}>No resident here has referred a neighbor yet.</p>}
              <small>
                Matched by name.
                {desk.referrals.freshness?.hoursAgo != null ? ` Copied from CleanCloud ${Math.round(desk.referrals.freshness.hoursAgo)}h ago${desk.referrals.freshness.state === "stale" ? " (stale)" : ""}.` : ""}
              </small>
            </div>
          )}
        </Monitor>
      </div>
    </div>
  );
}
