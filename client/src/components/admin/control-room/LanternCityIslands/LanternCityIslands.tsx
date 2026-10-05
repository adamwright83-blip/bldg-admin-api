import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  canonicalLanternTerritory,
  isLiveLanternCustomer,
  type GeographicCustomer,
} from "../customerGeography";
import { createIslandBoard, type IslandBoard, type IslandInfo } from "./islandBoard";
import TowerFloors from "./TowerFloors";
import ObjectiveMarksLayer from "./ObjectiveMarksLayer";
import { devSampleCustomers } from "./devSample";
import styles from "./lantern-city-islands.module.css";

// Small Comforts: the playable Tin Can House in Hollywood (zoom to the island, click the house).
const SmallComforts = lazy(() => import("../SmallComforts/SmallComforts"));

// Fonts load as their own <link> (a failed @import would take the lazy chunk's CSS down with it)
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap";
if (typeof document !== "undefined" && !document.querySelector(`link[href="${FONTS_HREF}"]`)) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = FONTS_HREF;
  document.head.appendChild(link);
}

const money = (c?: number) => (c == null ? "—" : `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const day = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(+d) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

/**
 * Lantern City as the island board: every neighbourhood we serve an island in its real place.
 * Islands open only on real customers from the geographic-truth atlas; a customer's home burns
 * gold; islands with none yet sit under cloud. OPUS LA and Century Park East open floor by floor.
 */
export default function LanternCityIslands({
  onOpenCustomer,
  onNavigate,
  showUtilityDock = true,
  showBrand = true,
}: {
  onOpenCustomer: (phone: string) => void;
  onNavigate?: (path: string) => void;
  /** Commercial members get the world without Laundry Butler admin shortcuts. */
  showUtilityDock?: boolean;
  /** The admin world shell owns all top-left scene chrome when this board is embedded there. */
  showBrand?: boolean;
}) {
  const { user } = useAuth();
  const host = useRef<HTMLDivElement>(null);
  const board = useRef<IslandBoard | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stats, setStats] = useState<{ islands: number; open: number; lanterns: number } | null>(null);
  const [island, setIsland] = useState<IslandInfo | null>(null);
  const [hover, setHover] = useState<{ keys: string[]; x: number; y: number; tower?: string } | null>(null);
  const [tower, setTower] = useState<string | null>(null);
  const [inSuitcase, setInSuitcase] = useState(false);
  const [operationsHubTip, setOperationsHubTip] = useState<{ x: number; y: number } | null>(null);
  const [suitcaseTip, setSuitcaseTip] = useState<{ x: number; y: number } | null>(null);

  const isPlatformAdmin = user?.role === "admin";
  const adminAtlas = trpc.system.geographicTruth.atlas.useQuery(undefined, {
    enabled: isPlatformAdmin,
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: 1,
  });
  const memberAtlas = trpc.system.geographicTruth.myAtlas.useQuery(undefined, {
    enabled: !isPlatformAdmin,
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: 1,
  });
  const atlas = isPlatformAdmin ? adminAtlas : memberAtlas;
  const usingSample = import.meta.env.DEV && atlas.isError;
  const allCustomers = useMemo<GeographicCustomer[]>(
    () =>
      usingSample
        ? devSampleCustomers()
        : ((atlas.data?.customers ?? []) as GeographicCustomer[]),
    [atlas.data, usingSample],
  );
  const customers = useMemo(() => allCustomers.filter(isLiveLanternCustomer), [allCustomers]);
  const byKey = useMemo(() => new Map(customers.map(c => [c.identityKey, c])), [customers]);

  useEffect(() => {
    if (!host.current) return;
    let b: IslandBoard;
    try {
      b = createIslandBoard(host.current, {
        onReady: () => setReady(true),
        onError: e => { console.error("Lantern City failed to load", e); setFailed(true); },
        onStats: setStats,
        onIsland: setIsland,
        onHover: setHover,
        onTower: setTower,
        onOperationsHub: () => window.location.assign("/operations/floor"),
        onOperationsHubHover: setOperationsHubTip,
        onSuitcase: () => setInSuitcase(true),
        onSuitcaseHover: setSuitcaseTip,
      });
    } catch (e) {
      // no WebGL (old browser, locked-down device): say so instead of a blank screen
      console.warn("Lantern City needs WebGL", e);
      setFailed(true);
      return;
    }
    board.current = b;
    return () => { b.dispose(); board.current = null; };
  }, []);

  useEffect(() => {
    // Current business truth only: historical/dormant customers stay in history,
    // but only active located customers light Lantern City. Territory ownership
    // comes from canonical geography, never nearest-island presentation geometry.
    board.current?.setLanterns(customers.map(c => {
      const territory = canonicalLanternTerritory(c);
      return {
        key: c.identityKey,
        latitude: c.location!.latitude,
        longitude: c.location!.longitude,
        name: c.displayName,
        territoryName: territory?.name,
      };
    }));
  }, [customers]);

  useEffect(() => { board.current?.setPaused(inSuitcase); }, [inSuitcase]);
  const leaveSuitcase = () => {
    setInSuitcase(false);
    board.current?.focusIsland("Hollywood");
  };

  const hovered = (hover?.keys ?? []).map(k => byKey.get(k)).filter((c): c is GeographicCustomer => !!c);

  return (
    <div className={styles.scene} data-lantern-city="islands">
      <div ref={host} className={styles.stage} aria-label="Lantern City island board" />
      {showBrand ? (
        <>
          <header className={styles.top}>
            <div className={styles.brand}>
              <div className={styles.mark}>LANTERN CITY</div>
              <div className={styles.sub}>Joystick</div>
            </div>
            {stats ? (
              <div className={styles.stats}>
                <div className={styles.pill}><i className={styles.dot} /><b>{stats.lanterns}</b>&nbsp;lanterns</div>
                <div className={styles.pill}>Islands open&nbsp;<b>{stats.open} of {stats.islands}</b></div>
              </div>
            ) : null}
          </header>
          <div className={styles.towers}>
            <button type="button" onClick={() => setTower("opus_la")}>OPUS LA floors</button>
            <button type="button" onClick={() => setTower("century_park_east")}>Century Park East floors</button>
          </div>
        </>
      ) : null}
      <ObjectiveMarksLayer board={board} ready={ready} onNavigate={onNavigate} />

      {island ? (
        <section className={styles.card} aria-label={island.name}>
          <h2>{island.name}</h2>
          <p>
            {island.lanterns
              ? `${island.lanterns} lantern${island.lanterns === 1 ? "" : "s"} lit here: every customer's home burns gold.`
              : "Still under cloud. The first customer here clears the island."}
          </p>
          <button type="button" onClick={() => { setIsland(null); board.current?.board(); }}>Back to the board</button>
        </section>
      ) : null}

      {hover && (hovered.length || hover.tower) ? (
        <div className={styles.tip} style={{ left: Math.min(hover.x + 16, window.innerWidth - 280), top: Math.max(hover.y - 80, 8) }}>
          {hovered.slice(0, 4).map(c => (
            <div key={c.identityKey} className={styles.tipRow}>
              <b>{c.displayName}</b>
              <span>{c.location?.canonicalAddress?.split(",")[0] ?? ""}</span>
              <span>{money(c.totalSpendCents)} lifetime · last order {day(c.lastOrderAt)}</span>
            </div>
          ))}
          {hovered.length > 4 ? <span>+{hovered.length - 4} more here</span> : null}
          {hover.tower ? <span className={styles.tipHint}>Click to open every floor</span> : null}
        </div>
      ) : null}

      {operationsHubTip ? (
        <div className={styles.tip} style={{ left: Math.min(operationsHubTip.x + 16, window.innerWidth - 300), top: Math.max(operationsHubTip.y - 60, 8) }}>
          <b>Laundry Farm · Operations Hub</b>
          <span className={styles.tipHint}>Click to enter Operations Command</span>
        </div>
      ) : null}
      {suitcaseTip ? (
        <div className={styles.tip} style={{ left: Math.min(suitcaseTip.x + 16, window.innerWidth - 280), top: Math.max(suitcaseTip.y - 60, 8) }}>
          <b>Tin Can House · Small Comforts</b>
          <span className={styles.tipHint}>Click to enter</span>
        </div>
      ) : null}
      {inSuitcase ? (
        <Suspense fallback={null}>
          <SmallComforts onExit={leaveSuitcase} />
        </Suspense>
      ) : null}

      {tower ? (
        <TowerFloors buildingId={tower} customers={allCustomers} onClose={() => setTower(null)} onOpenCustomer={phone => onOpenCustomer(phone)} />
      ) : null}

      {usingSample ? <div className={styles.sample}>Sample customers · dev build, no database</div> : null}
      {showUtilityDock && !inSuitcase ? (
        <nav className={styles.dock} aria-label="Actions">
          <button type="button" className={styles.primary} onClick={() => onNavigate?.("/new-order")}>New order</button>
          <button type="button" onClick={() => onNavigate?.("/customers")}>Customers <b className={styles.count}>{customers.length}</b></button>
          <button type="button" onClick={() => onNavigate?.("/operations")}>Active orders</button>
        </nav>
      ) : null}
      {!ready && !failed ? <div className={styles.loading} data-lantern-state="loading">Raising the islands…</div> : null}
      {failed ? <div className={styles.loading} data-lantern-state="failed">Lantern City could not load its map. Reload to try again.</div> : null}
    </div>
  );
}
