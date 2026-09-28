import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { GeographicCustomer } from "../customerGeography";
import {
  createLanternWorld,
  type LanternInput,
  type LanternWorld,
  type Mission,
  type WorldStats,
} from "./lanternWorld";
import styles from "./lantern-city-v7.module.css";

/**
 * Lantern City v7: the neighbourhoods we serve (and the ones between them) as one fog-of-war
 * board. Customer buildings are the lanterns; land around them is charted; everything else is fog.
 * Real customers come from the same geographic truth the old scene used.
 */

// Dev-only: the local visual-test build has no database, so it shows sample customers instead of
// an empty board. Never used in a production build.
function devSampleCustomers(): GeographicCustomer[] {
  if (!import.meta.env.DEV) return [];
  const spots: [number, number, number][] = [
    [34.0906, -118.2766, 5], [34.0851, -118.2703, 3], [34.0985, -118.3265, 4], [34.1012, -118.3389, 2],
    [34.059, -118.4145, 1], [34.0612, -118.3009, 3], [34.0578, -118.2963, 2], [34.088, -118.298, 1], [34.1052, -118.2885, 1],
    [34.0874, -118.3697, 1], [34.0654, -118.4006, 1],
  ];
  let n = 0, seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out: GeographicCustomer[] = [];
  for (const [lat, lng, count] of spots) {
    for (let i = 0; i < count; i++) {
      n++;
      const state = rnd() < 0.7 ? "active" : rnd() < 0.6 ? "dimming" : "dark";
      out.push({
        identityKey: `dev-sample-${n}`,
        displayName: `Sample Customer ${n}`,
        phone: null,
        totalOrders: 1 + Math.floor(rnd() * 30),
        totalSpendCents: Math.round((60 + rnd() * 4800) * 100),
        lastOrderAt: new Date(Date.now() - rnd() * 60 * 86400000).toISOString(),
        cadence: { state, daysSinceLastOrder: Math.floor(rnd() * 60) },
        location: { latitude: lat + (rnd() - 0.5) * 0.004, longitude: lng + (rnd() - 0.5) * 0.005, x: 0, y: 0, outOfBounds: false, canonicalAddress: `Sample address ${n}` },
      });
    }
  }
  return out;
}

const money = (c?: number) => (c == null ? "—" : `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const day = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(+d) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const Icon = {
  order: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" />
    </svg>
  ),
  people: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      <circle cx="9" cy="8" r="3.4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M2.8 19.5c.6-3.4 3.2-5.3 6.2-5.3s5.6 1.9 6.2 5.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="17" cy="9" r="2.6" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M16.4 14.3c2.6.1 4.3 1.8 4.8 4.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  box: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z M3.5 7.5 12 12l8.5-4.5M12 12v9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  ),
};

export default function LanternCityV7({
  onOpenCustomer,
  onNavigate,
}: {
  onOpenCustomer: (phone: string) => void;
  onNavigate?: (path: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<LanternWorld | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stats, setStats] = useState<WorldStats | null>(null);
  const [mission, setMission] = useState<Mission | null>(null);
  const [selected, setSelected] = useState<string[] | null>(null);

  const atlas = trpc.system.geographicTruth.atlas.useQuery(undefined, { staleTime: 60_000, retry: 1 });
  const usingSample = import.meta.env.DEV && atlas.isError;
  // every customer is their own lantern
  const customers = useMemo<GeographicCustomer[]>(() => {
    if (usingSample) return devSampleCustomers();
    return ((atlas.data?.customers ?? []) as GeographicCustomer[]).filter(c => c.location);
  }, [atlas.data, usingSample]);
  const byKey = useMemo(() => new Map(customers.map(c => [c.identityKey, c])), [customers]);

  useEffect(() => {
    if (!host.current) return;
    let w: LanternWorld;
    try {
      w = createLanternWorld(host.current, {
      onReady: () => setReady(true),
      onStats: setStats,
      onMission: setMission,
      onSelect: setSelected,
      onError: e => {
        console.error("Lantern City failed to load", e);
        setFailed(true);
      },
    });
    } catch (e) {
      // no WebGL (old browser, locked-down device): say so instead of a blank screen
      console.warn("Lantern City needs WebGL", e);
      setFailed(true);
      return;
    }
    world.current = w;
    if (import.meta.env.DEV) (window as unknown as { __lanternV7?: LanternWorld }).__lanternV7 = w;
    return () => {
      w.dispose();
      world.current = null;
    };
  }, []);

  useEffect(() => {
    const inputs: LanternInput[] = customers.map(c => ({
      key: c.identityKey,
      latitude: c.location!.latitude,
      longitude: c.location!.longitude,
      label: c.location!.canonicalAddress ?? "",
      name: c.displayName,
      spendCents: c.totalSpendCents,
      lastOrderAt: c.lastOrderAt,
      total: 1,
      active: c.cadence.state === "active" ? 1 : 0,
      dimming: c.cadence.state === "dimming" ? 1 : 0,
      dark: c.cadence.state === "dark" ? 1 : 0,
    }));
    world.current?.setLanterns(inputs);
  }, [customers, ready]);

  const sel = (selected ?? []).map(k => byKey.get(k)).filter((c): c is GeographicCustomer => !!c);

  return (
    <div className={styles.scene} data-lantern-city="v7">
      <div ref={host} className={styles.stage} aria-label="Lantern City map" />
      <div className={styles.frame} aria-hidden />
      <header className={styles.top}>
        <div className={styles.brand}>
          <div className={styles.mark}>
            <i />
            JOYSTICK
          </div>
          <div className={styles.sub}>Lantern City</div>
        </div>
        {stats ? (
          <div className={styles.stats}>
            <div className={styles.pill}>
              <span className={styles.dot} />
              <b>{stats.lanterns}</b>&nbsp;lanterns
            </div>
            <div className={styles.pill}>
              <span className={styles.fogDot} />
              <b>{stats.chartedPct}%</b>&nbsp;charted
            </div>
            <div className={`${styles.pill} ${styles.wide}`}>
              <b>{stats.doorsInLight.toLocaleString()}</b>&nbsp;doors in your light
            </div>
          </div>
        ) : null}
      </header>

      {usingSample ? <div className={styles.sample}>Sample lanterns · dev build, no database</div> : null}

      {sel.length ? (
        <section className={styles.card} aria-label="Lantern">
          <div className={styles.who}>
            <i />
            {sel[0].location?.canonicalAddress?.split(",")[0] ?? "Lantern"}
          </div>
          <ul className={styles.people}>
            {sel.map(c => (
              <li key={c.identityKey}>
                <span className={styles[c.cadence.state]} />
                <span className={styles.name}>
                  <b>{c.displayName}</b>
                  <br />
                  <small>
                    {money(c.totalSpendCents)} lifetime · {c.totalOrders ?? 0} orders · last {day(c.lastOrderAt)}
                  </small>
                </span>
                {c.phone ? (
                  <button type="button" onClick={() => onOpenCustomer(c.phone!)}>
                    Open
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <div className={styles.row}>
            <button type="button" className={styles.ghost} onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        </section>
      ) : mission ? (
        <section className={styles.card} aria-label="Uncharted land">
          <div className={styles.who}>
            <i />
            Next move
          </div>
          <div className={styles.kind}>{mission.kind === "run" ? "Door-hanger run" : "Uncharted neighbourhood"}</div>
          <h2>{mission.title}</h2>
          <p>{mission.body}</p>
          <div className={styles.meta}>
            <div>
              <b>~{mission.doors.toLocaleString()}</b> <span>doors to win</span>
            </div>
            {mission.kind === "uncharted" ? (
              <div>
                <b>{mission.miles.toFixed(1)} mi</b> <span>from your light</span>
              </div>
            ) : null}
          </div>
          <div className={styles.row}>
            <button type="button" className={styles.go} onClick={() => world.current?.focusPoint(mission.x, mission.z, mission.radius ? mission.radius * 4 : 1600)}>
              {mission.kind === "run" ? "Show me the run" : "Show me"}
            </button>
          </div>
        </section>
      ) : null}

      {stats && stats.outside > 0 ? (
        <div className={styles.outside}>{stats.outside} customer location{stats.outside === 1 ? "" : "s"} outside the map</div>
      ) : null}
      {/* the three things you do from here, one clear dock */}
      <nav className={styles.dock} aria-label="Actions">
        <button type="button" className={styles.primary} onClick={() => onNavigate?.("/new-order")}>
          {Icon.order}
          <span>New order</span>
        </button>
        <button type="button" onClick={() => onNavigate?.("/customers")}>
          {Icon.people}
          <span>Customers</span>
          <b className={styles.count}>{customers.length}</b>
        </button>
        <button type="button" onClick={() => onNavigate?.("/operations")}>
          {Icon.box}
          <span>Active orders</span>
        </button>
      </nav>

      {/* what you are looking at */}
      <aside className={styles.legend} aria-label="Map key">
        <div><i className={styles.kLantern} /> A customer. Hover for details.</div>
        <div><i className={styles.kRun} /> Door-hanger run. One more customer lights the neighbourhood.</div>
        <div><i className={styles.kFog} /> Uncharted. Win a first customer to break it open.</div>
        <small>Map data © OpenStreetMap contributors · Neighbourhoods: Mapping L.A.</small>
      </aside>
      {!ready && !failed ? <div className={styles.loading} data-lantern-state="loading">Lifting the fog…</div> : null}
      {failed ? <div className={styles.loading} data-lantern-state="failed">Lantern City could not load its map. Reload to try again.</div> : null}
    </div>
  );
}
