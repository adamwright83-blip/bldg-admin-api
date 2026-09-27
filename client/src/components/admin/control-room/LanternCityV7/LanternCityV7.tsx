import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  clusterGeographicCustomers,
  type CustomerLocationCluster,
  type GeographicCustomer,
} from "../customerGeography";
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

// Dev-only: the local visual-test build has no database, so it shows a handful of sample
// buildings instead of an empty board. Never used in a production build.
const DEV_SAMPLE: CustomerLocationCluster[] = import.meta.env.DEV
  ? [
      [34.0906, -118.2766, "Sample · Silver Lake", 6, 5, 1, 0],
      [34.0975, -118.2915, "Sample · East Hollywood", 3, 2, 0, 1],
      [34.1052, -118.2885, "Sample · Los Feliz", 4, 3, 1, 0],
      [34.0985, -118.3265, "Sample · Hollywood", 5, 4, 0, 1],
      [34.0874, -118.3697, "Sample · West Hollywood", 3, 1, 2, 0],
      [34.0654, -118.4006, "Sample · Beverly Hills", 2, 2, 0, 0],
      [34.0590, -118.4145, "Sample · Century City", 7, 6, 1, 0],
      [34.0612, -118.3009, "Sample · Koreatown", 8, 6, 1, 1],
      [34.0905, -118.3432, "Sample · La Brea", 4, 3, 1, 0],
    ].map(([latitude, longitude, label, total, active, dimming, dark], i) => ({
      key: `dev-sample-${i}`,
      latitude: latitude as number,
      longitude: longitude as number,
      x: 0,
      y: 0,
      outsideAtlas: false,
      canonicalAddress: label as string,
      customers: [],
      total: total as number,
      active: active as number,
      dimming: dimming as number,
      dark: dark as number,
    }))
  : [];

function clusterLabel(c: CustomerLocationCluster) {
  const addr = c.canonicalAddress?.split(",")[0];
  if (addr) return addr;
  return c.total === 1 ? c.customers[0]?.displayName ?? "1 customer" : `${c.total} customers`;
}

export default function LanternCityV7({
  onOpenCustomer,
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
  const [selected, setSelected] = useState<string | null>(null);

  const atlas = trpc.system.geographicTruth.atlas.useQuery(undefined, { staleTime: 60_000, retry: 1 });
  const usingSample = import.meta.env.DEV && atlas.isError;
  const clusters = useMemo<CustomerLocationCluster[]>(() => {
    if (usingSample) return DEV_SAMPLE;
    return clusterGeographicCustomers((atlas.data?.customers ?? []) as GeographicCustomer[]);
  }, [atlas.data, usingSample]);
  const byKey = useMemo(() => new Map(clusters.map(c => [c.key, c])), [clusters]);

  useEffect(() => {
    if (!host.current) return;
    const w = createLanternWorld(host.current, {
      onReady: () => setReady(true),
      onStats: setStats,
      onMission: setMission,
      onSelect: setSelected,
      onError: e => {
        console.error("Lantern City failed to load", e);
        setFailed(true);
      },
    });
    world.current = w;
    if (import.meta.env.DEV) (window as unknown as { __lanternV7?: LanternWorld }).__lanternV7 = w;
    return () => {
      w.dispose();
      world.current = null;
    };
  }, []);

  useEffect(() => {
    const inputs: LanternInput[] = clusters.map(c => ({
      key: c.key,
      latitude: c.latitude,
      longitude: c.longitude,
      label: clusterLabel(c),
      total: c.total,
      active: c.active,
      dimming: c.dimming,
      dark: c.dark,
    }));
    world.current?.setLanterns(inputs);
  }, [clusters, ready]);

  const sel = selected ? byKey.get(selected) : undefined;

  return (
    <div className={styles.scene}>
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

      {sel ? (
        <section className={styles.card} aria-label="Lantern">
          <div className={styles.who}>
            <i />
            Lantern
          </div>
          <h2>{clusterLabel(sel)}</h2>
          <p>
            {sel.total} customer{sel.total === 1 ? "" : "s"} · {sel.active} active
            {sel.dimming ? ` · ${sel.dimming} dimming` : ""}
            {sel.dark ? ` · ${sel.dark} gone dark` : ""}
          </p>
          <ul className={styles.people}>
            {sel.customers.slice(0, 8).map(c => (
              <li key={c.identityKey}>
                <span className={styles[c.cadence.state]} />
                <span className={styles.name}>{c.displayName}</span>
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
            Uncharted
          </div>
          <h2>{mission.title}</h2>
          <p>
            {mission.hood
              ? `Win one building ${mission.where} and all of ${mission.hood} comes out of the fog.`
              : "Win one building here and the neighbourhood comes out of the fog."}
          </p>
          <div className={styles.meta}>
            <div>
              <b>~{mission.doors.toLocaleString()}</b> <span>doors to win</span>
            </div>
            <div>
              <b>{mission.miles.toFixed(1)} mi</b> <span>from your light</span>
            </div>
          </div>
          <div className={styles.row}>
            <button type="button" className={styles.go} onClick={() => world.current?.focusPoint(mission.x, mission.z)}>
              Show me
            </button>
          </div>
        </section>
      ) : null}

      {stats && stats.outside > 0 ? (
        <div className={styles.outside}>{stats.outside} customer location{stats.outside === 1 ? "" : "s"} outside the map</div>
      ) : null}
      <div className={styles.hint}>
        Drag to pan · pinch or scroll to zoom · tap a lantern
        <br />
        Map data © OpenStreetMap contributors · Neighbourhoods: Mapping L.A.
      </div>
      {!ready && !failed ? <div className={styles.loading}>Lifting the fog…</div> : null}
      {failed ? <div className={styles.loading}>Lantern City could not load its map. Reload to try again.</div> : null}
    </div>
  );
}
