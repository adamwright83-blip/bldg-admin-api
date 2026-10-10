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
import TowerFloors from "../LanternCityIslands/TowerFloors";
import { devSampleCustomers } from "../LanternCityIslands/devSample";

// Fonts load as their own <link>, not an @import in the CSS module: a blocked or failed font
// request fails the lazy chunk's CSS preload, which took the whole board down to the error page.
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap";
if (typeof document !== "undefined" && !document.querySelector(`link[href="${FONTS_HREF}"]`)) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = FONTS_HREF;
  document.head.appendChild(link);
}

/**
 * Lantern City v7: the neighbourhoods we serve (and the ones between them) as one fog-of-war
 * board. Customer buildings are the lanterns; land around them is charted; everything else is fog.
 * Real customers come from the same geographic truth the old scene used.
 */

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
  const [tower, setTower] = useState<string | null>(null);

  const atlas = trpc.system.geographicTruth.myAtlas.useQuery(undefined, { staleTime: 10_000, refetchInterval: 15_000, retry: 1 });
  const usingSample = import.meta.env.DEV && atlas.isError;
  // every customer is their own lantern; the tower view also counts residents not yet on the map
  const allCustomers = useMemo<GeographicCustomer[]>(
    () => (usingSample ? devSampleCustomers() : ((atlas.data?.customers ?? []) as GeographicCustomer[])),
    [atlas.data, usingSample],
  );
  const customers = useMemo(() => allCustomers.filter(c => c.location), [allCustomers]);
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
      onTower: setTower,
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
        <div className={styles.towerBtns}>
          <button type="button" onClick={() => setTower("opus_la")}>OPUS LA floors</button>
          <button type="button" onClick={() => setTower("century_park_east")}>Century Park East floors</button>
        </div>
      </header>

      {tower ? (
        <TowerFloors
          buildingId={tower}
          customers={allCustomers}
          onClose={() => setTower(null)}
          onOpenCustomer={phone => onOpenCustomer(phone)}
        />
      ) : null}

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
