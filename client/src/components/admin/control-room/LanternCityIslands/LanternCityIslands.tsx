import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  canonicalLanternTerritory,
  isLiveLanternCustomer,
  lanternMappingState,
  type GeographicCustomer,
} from "../customerGeography";
import { normalizeTerritoryName } from "@shared/lanternTerritories";
import type { LanternReportWindowDays } from "@shared/lanternTerritoryReport";
import LanternReportPanel from "./LanternReportPanel";
import { createIslandBoard, type IslandBoard, type IslandInfo, type IslandIntroPhase } from "./islandBoard";
import TowerFloors from "./TowerFloors";
import { buildingsWithResidents } from "./towerStack";
import ObjectiveMarksLayer from "./ObjectiveMarksLayer";
import type { DriverCurrentStop } from "./objectiveMarksView";
import { devSampleCustomers } from "./devSample";
import styles from "./lantern-city-islands.module.css";
import { openSilverLake3D } from "@/pages/goldline/silverLake3d/silverLakeEntry";
import { openBeverlyHills3D } from "@/pages/goldline/beverlyHills3d/beverlyHillsEntry";

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
/** What the account home may ask of the camera. Both are safe to call before the board is ready. */
export type LanternStage = {
  /** A short approach to tonight's destination; resolves at once with reduced motion or no destination. */
  focusDestination(): Promise<void>;
  /** Back to the home framing. */
  returnHome(): void;
  destinationScreen(): { x: number; y: number; visible: boolean } | null;
};

export default function LanternCityIslands({
  onOpenCustomer,
  onNavigate,
  onReviewCustomers,
  showUtilityDock = true,
  showBrand = true,
  driverCurrentStop = null,
  intro = false,
  onIntroPhase,
  homeChrome = false,
  insetLeft = 0,
  skyBoard = false,
  storyLocation,
  storyAnomaly,
  onEmbeddedChange,
  onStage,
  onDestination,
}: {
  onOpenCustomer: (phone: string) => void;
  onNavigate?: (path: string) => void;
  /** Product shells may route to their own customer destination. */
  onReviewCustomers?: () => void;
  /** Commercial members get the world without Laundry Butler admin shortcuts. */
  showUtilityDock?: boolean;
  /** The admin world shell owns all top-left scene chrome when this board is embedded there. */
  showBrand?: boolean;
  /** Set by Home when the driver line has a current stop. Other boards omit it. */
  driverCurrentStop?: DriverCurrentStop | null;
  /** Play the opening sequence (everything under cloud, the city brightens, customers' islands clear). Read once, at mount. */
  intro?: boolean;
  /** The opening sequence moved on. */
  onIntroPhase?: (phase: IslandIntroPhase) => void;
  /** The account home draws its own chrome over the board: hide the Explore/Report switch too. */
  homeChrome?: boolean;
  /** Pixels on the left covered by the page's own cards; the board centres in the space to their right. */
  insetLeft?: number;
  /** The account home: the glass game board loops over the city and the camera sits lower, showing the sky. Read once, at mount. */
  skyBoard?: boolean;
  storyLocation?: import("@shared/story").StoryLocation;
  storyAnomaly?: import("@shared/story").StoryAnomaly;
  /** A full-screen view opened from the board (a tower's floors, Small Comforts) opened or closed. */
  onEmbeddedChange?: (open: boolean) => void;
  /** The account home's handle on the camera for entering tonight's chapter and coming back; null once the board is gone. */
  onStage?: (stage: LanternStage | null) => void;
  /** The account home: tonight's chapter can be played, and a click on its destination tower plays it. */
  onDestination?: () => void;
}) {
  const { user } = useAuth();
  const host = useRef<HTMLDivElement>(null);
  const board = useRef<IslandBoard | null>(null);
  const [ready, setReady] = useState(false);
  // islands are up and clickable before every building has risen; don't hold people behind a full-screen card
  const [interactive, setInteractive] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stats, setStats] = useState<{ islands: number; open: number; lanterns: number } | null>(null);
  const [island, setIsland] = useState<IslandInfo | null>(null);
  const [hover, setHover] = useState<{ keys: string[]; x: number; y: number; tower?: string } | null>(null);
  // `?tower=century_park_east` opens straight into that tower (the way back out of its game)
  const [tower, setTower] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const id = new URLSearchParams(window.location.search).get("tower");
    return id && /^[a-z_]+$/.test(id) ? id : null;
  });
  const [inSuitcase, setInSuitcase] = useState(false);
  const [operationsHubTip, setOperationsHubTip] = useState<{ x: number; y: number } | null>(null);
  const [suitcaseTip, setSuitcaseTip] = useState<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<"explore" | "report">("explore");
  const [windowDays, setWindowDays] = useState<LanternReportWindowDays>(30);
  const [selectedTerritoryId, setSelectedTerritoryId] = useState<string | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const introPhaseRef = useRef(onIntroPhase);
  introPhaseRef.current = onIntroPhase;
  const introAtMount = useRef(intro);
  const skyBoardAtMount = useRef(skyBoard);
  const storyLocationRef = useRef(storyLocation);
  storyLocationRef.current = storyLocation;
  const stageRef = useRef(onStage);
  stageRef.current = onStage;
  const destinationRef = useRef(onDestination);
  destinationRef.current = onDestination;
  const insetAtMount = useRef(insetLeft);
  insetAtMount.current = insetLeft;

  // The normal world always reads the authenticated tenant, never platform support authority.
  const atlas = trpc.system.geographicTruth.myAtlas.useQuery(undefined, {
    enabled: Boolean(user),
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: 1,
  });
  const territoryReport = trpc.system.geographicTruth.territoryReport.useQuery(
    { windowDays },
    { enabled: Boolean(user) && mode === "report", staleTime: 15_000, retry: 1 }
  );
  const usingSample = import.meta.env.DEV && atlas.isError;
  const allCustomers = useMemo<GeographicCustomer[]>(
    () =>
      usingSample
        ? devSampleCustomers()
        : ((atlas.data?.customers ?? []) as GeographicCustomer[]),
    [atlas.data, usingSample],
  );
  const customers = useMemo(() => allCustomers.filter(isLiveLanternCustomer), [allCustomers]);
  const mapping = lanternMappingState({
    loading: !usingSample && !atlas.data,
    error: atlas.isError && !usingSample,
    customers: allCustomers,
  });
  // Floor buttons only for buildings this business has customers in, not the owner's towers for everyone.
  const ownBuildings = useMemo(
    () => buildingsWithResidents(allCustomers.map(c => c.address ?? c.location?.canonicalAddress ?? "").filter(Boolean)),
    [allCustomers],
  );
  const byKey = useMemo(() => new Map(customers.map(c => [c.identityKey, c])), [customers]);

  useEffect(() => {
    if (!host.current) return;
    let b: IslandBoard;
    try {
      b = createIslandBoard(host.current, {
        onReady: () => { setInteractive(true); setReady(true); },
        onInteractive: () => setInteractive(true),
        onError: e => { console.error("Lantern City failed to load", e); setFailed(true); },
        onStats: setStats,
        onIntro: phase => introPhaseRef.current?.(phase),
        onIsland: info => {
          // Silver Lake is a place you can walk into: clicking it opens the 3D courtyard
          if (modeRef.current === "explore" && info?.name === "Silver Lake") {
            openSilverLake3D("silver-lake");
            return;
          }
          // Beverly Hills: The Other Rodeo, a painted animal adventure with a real outreach journal.
          if (modeRef.current === "explore" && info?.name === "Beverly Hills") {
            openBeverlyHills3D();
            return;
          }
          setIsland(info);
          if (modeRef.current === "report" && info?.name) setSelectedTerritoryId(normalizeTerritoryName(info.name));
        },
        onHover: setHover,
        onTower: towerId => {
          if (skyBoardAtMount.current && towerId === storyLocationRef.current && destinationRef.current) { setHover(null); destinationRef.current(); return; }
          if (modeRef.current === "explore") setTower(towerId);
        },
        onOperationsHub: () => { if (modeRef.current === "explore") window.location.assign("/operations/floor"); },
        onOperationsHubHover: setOperationsHubTip,
        onSuitcase: () => { if (modeRef.current === "explore") setInSuitcase(true); },
        onSuitcaseHover: setSuitcaseTip,
      }, { intro: introAtMount.current, skyBoard: skyBoardAtMount.current, storyLocation: storyLocationRef.current, storyAnomaly });
    } catch (e) {
      // no WebGL (old browser, locked-down device): say so instead of a blank screen
      console.warn("Lantern City needs WebGL", e);
      setFailed(true);
      return;
    }
    board.current = b;
    b.setInsetLeft(insetAtMount.current);
    stageRef.current?.({ focusDestination: () => b.focusDestination(), returnHome: () => b.board(), destinationScreen: () => b.destinationScreen() });
    // read-only screen lookups so browser tests can click an island the way a person does
    const probe = {
      islandScreen: (name: string) => b.islandScreen(name),
      islandLabelScreen: (name: string) => b.islandLabelScreen(name),
      hubScreen: () => b.hubScreen(),
      // camera read/write for visual checks (dev and visual-test builds only)
      ...(import.meta.env.DEV || import.meta.env.VITE_ADMIN_VISUAL_TEST
        ? { cam: () => b.cam(), homeInfo: () => b.homeInfo(), jump: (x: number, z: number, d: number, pitch?: number, yaw?: number) => b.jump(x, z, d, pitch, yaw) }
        : {}),
    };
    (window as unknown as { __lanternIslands?: typeof probe }).__lanternIslands = probe;
    return () => {
      stageRef.current?.(null);
      b.dispose();
      board.current = null;
      const w = window as unknown as { __lanternIslands?: typeof probe };
      if (w.__lanternIslands === probe) delete w.__lanternIslands;
    };
  }, []);

  useEffect(() => {
    // Every canonically located customer remains represented; cadence is independent. Territory ownership
    // comes from canonical geography, never nearest-island presentation geometry.
    if ((!atlas.data && !usingSample) || atlas.isError && !usingSample) return;
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
  }, [customers, atlas.data, atlas.isError, usingSample]);

  useEffect(() => { board.current?.setPaused(inSuitcase); }, [inSuitcase]);
  const embeddedRef = useRef(onEmbeddedChange);
  embeddedRef.current = onEmbeddedChange;
  useEffect(() => { embeddedRef.current?.(tower !== null || inSuitcase); }, [tower, inSuitcase]);
  useEffect(() => { board.current?.setInsetLeft(insetLeft); }, [insetLeft]);
  useEffect(() => { board.current?.setStoryLocation(storyLocation); }, [storyLocation]);
  useEffect(() => {
    if (mode !== "report" || !territoryReport.data) return;
    if (selectedTerritoryId && territoryReport.data.territories.some(territory => territory.id === selectedTerritoryId)) return;
    const fromIsland = island ? normalizeTerritoryName(island.name) : null;
    const match = territoryReport.data.territories.find(territory => territory.id === fromIsland);
    setSelectedTerritoryId(match?.id ?? territoryReport.data.territories[0]?.id ?? null);
  }, [mode, territoryReport.data, island, selectedTerritoryId]);
  const chooseMode = (next: "explore" | "report") => {
    setMode(next);
    if (next === "report") setInSuitcase(false);
  };
  const leaveSuitcase = () => {
    setInSuitcase(false);
    board.current?.focusIsland("Hollywood");
  };

  const hovered = (hover?.keys ?? []).map(k => byKey.get(k)).filter((c): c is GeographicCustomer => !!c);

  return (
    <div className={styles.scene} data-lantern-city="islands">
      <div ref={host} className={styles.stage} aria-label="Lantern City island board" />
      {homeChrome ? null : (
        <div className={styles.modeSwitch} role="tablist" aria-label="Lantern City mode" data-lantern-mode={mode}>
          <button type="button" role="tab" aria-selected={mode === "explore"} onClick={() => chooseMode("explore")}>Explore</button>
          <button type="button" role="tab" aria-selected={mode === "report"} onClick={() => chooseMode("report")}>Report</button>
        </div>
      )}
      {showBrand ? (
        <>
          <header className={styles.top}>
            <div className={styles.brand}>
              <div className={styles.mark}>LANTERN CITY</div>
              <div className={styles.sub}>Joystick</div>
            </div>
            {stats && atlas.data && !atlas.isError ? (
              <div className={styles.stats}>
                <div className={styles.pill}><i className={styles.dot} /><b>{stats.lanterns}</b>&nbsp;mapped lanterns</div>
                {mapping.kind === "no_customers" ? null : (
                  <div className={styles.pill}>
                    {allCustomers.length} {allCustomers.length === 1 ? "customer" : "customers"} · {customers.length} located · {Math.max(0, customers.length - stats.lanterns)} outside mapped islands
                  </div>
                )}
                <div className={styles.pill}>Islands open&nbsp;<b>{stats.open} of {stats.islands}</b></div>
              </div>
            ) : null}
          </header>
          {mode === "explore" ? (
            <div className={styles.towers}>
              {ownBuildings.map(building => (
                <button key={building.id} type="button" onClick={() => setTower(building.id)}>{building.name} floors</button>
              ))}
              {/* the marketing game: a tiny TV station whose one commercial is a real ad */}
              <button type="button" onClick={() => window.location.assign("/growth/lantern-city?level=channel-382")} data-testid="lantern-channel-382">📺 CHANNEL 382</button>
            </div>
          ) : null}
        </>
      ) : null}
      {mode === "explore" && !skyBoard ? (
        <ObjectiveMarksLayer
          board={board}
          ready={ready}
          onNavigate={onNavigate}
          driverCurrentStop={driverCurrentStop}
        />
      ) : null}

      {mode === "explore" && island ? (
        <section className={styles.card} aria-label={island.name}>
          <h2>{island.name}</h2>
          <p>
            {island.lanterns
              ? `${island.lanterns} lantern${island.lanterns === 1 ? "" : "s"} lit here: every customer's home burns gold.`
              : "Still under cloud. The first customer here clears the island."}
          </p>
          {island.name === "Hollywood" ? (
            <button type="button" className={styles.tinCanEntry} onClick={() => board.current?.enterSmallComforts()}>
              <img src="/assets/joystick-home/tin-can-house.webp" alt="" width="80" height="54" />
              <span>Tin Can House · Small Comforts</span>
            </button>
          ) : null}
          <button type="button" onClick={() => { setIsland(null); board.current?.board(); }}>Back to the board</button>
        </section>
      ) : null}

      {hover?.tower && skyBoard && onDestination && hover.tower === storyLocation ? (
        // below the pointer, so the tip never sits over the floor it points at
        <div className={styles.tip} data-lantern-tip style={{ left: Math.min(hover.x + 16, window.innerWidth - 280), top: hover.y + 24 }}>
          <span className={styles.tipHint}>Tonight's chapter · click to play</span>
        </div>
      ) : hover && (hovered.length || hover.tower) ? (
        <div className={styles.tip} data-lantern-tip style={{ left: Math.min(hover.x + 16, window.innerWidth - 280), top: Math.max(hover.y - 80, 8) }}>
          {hovered.slice(0, 4).map(c => (
            <div key={c.identityKey} className={styles.tipRow}>
              <b>{c.displayName}</b>
              <span>{c.location?.canonicalAddress?.split(",")[0] ?? ""}</span>
              <span>{c.totalOrders ?? 0} historical orders · last order {day(c.lastOrderAt)}</span>
            </div>
          ))}
          {hovered.length > 4 ? <span>+{hovered.length - 4} more here</span> : null}
          {hover.tower ? <span className={styles.tipHint}>Click to open every floor</span> : null}
        </div>
      ) : null}

      {operationsHubTip ? (
        <div className={styles.tip} data-lantern-tip style={{ left: Math.min(operationsHubTip.x + 16, window.innerWidth - 300), top: Math.max(operationsHubTip.y - 60, 8) }}>
          <b>Laundry Farm · Operations Hub</b>
          <span className={styles.tipHint}>Click to enter Operations Command</span>
        </div>
      ) : null}
      {suitcaseTip ? (
        <div className={styles.tip} data-lantern-tip style={{ left: Math.min(suitcaseTip.x + 16, window.innerWidth - 280), top: Math.max(suitcaseTip.y - 60, 8) }}>
          <b>Tin Can House · Small Comforts</b>
          <span className={styles.tipHint}>Click to enter</span>
        </div>
      ) : null}
      {mode === "report" ? (
        <LanternReportPanel
          report={territoryReport.data}
          isLoading={territoryReport.isLoading}
          isError={territoryReport.isError}
          windowDays={windowDays}
          onWindowDays={setWindowDays}
          selectedId={selectedTerritoryId}
          onSelect={territoryId => {
            setSelectedTerritoryId(territoryId);
            const territory = territoryReport.data?.territories.find(item => item.id === territoryId);
            if (territory) board.current?.focusIsland(territory.name);
          }}
          onOpenCustomer={onOpenCustomer}
          onRetry={() => { void territoryReport.refetch(); }}
        />
      ) : null}

      {mode === "explore" && inSuitcase ? (
        <Suspense fallback={<div className={styles.loading} role="status">Opening Small Comforts…</div>}>
          <SmallComforts onExit={leaveSuitcase} />
        </Suspense>
      ) : null}

      {mode === "explore" && tower ? (
        <TowerFloors buildingId={tower} customers={allCustomers} onClose={() => setTower(null)} onOpenCustomer={phone => onOpenCustomer(phone)} />
      ) : null}

      {usingSample ? <div className={styles.sample} data-lantern-state="sample">Sample customers · dev build, no database</div> : null}
      {showUtilityDock && mode === "explore" && !inSuitcase ? (
        <nav className={styles.dock} aria-label="Actions">
          <button type="button" className={styles.primary} onClick={() => onNavigate?.("/new-order")}>New order</button>
          <button type="button" onClick={() => onNavigate?.("/customers")}>{mapping.kind === "unmapped" || mapping.kind === "partial" ? "Customers" : "Located customers"} <b className={styles.count}>{mapping.kind === "unmapped" || mapping.kind === "partial" ? allCustomers.length : customers.length}</b></button>
          <button type="button" onClick={() => onNavigate?.("/operations")}>Active orders</button>
        </nav>
      ) : null}
      {(!interactive || !atlas.data && !usingSample) && !failed && !atlas.isError ? <div className={styles.loading} data-lantern-state="loading">Loading Lantern City…</div> : null}
      {interactive && !ready && !failed ? <div className={styles.building} role="status" data-lantern-state="building">Raising the buildings…</div> : null}
      {atlas.isError && !usingSample ? (
        <div className={styles.loading} role="alert" data-lantern-state="atlas-unavailable">
          <div>Customer geography is unavailable. Your world could not be loaded.
            <button type="button" onClick={() => void atlas.refetch()}>Try again</button>
          </div>
        </div>
      ) : null}
      {mapping.kind === "unmapped" || mapping.kind === "partial" && !skyBoard ? (
        <div className={styles.mappingNotice} role="status" data-lantern-state={`mapping-${mapping.kind}`}>
          <div>
            {mapping.kind === "unmapped"
              ? `${mapping.total} ${mapping.total === 1 ? "customer is" : "customers are"} on record, but none has a map location yet, so no island can open. This is a mapping gap, not an empty business.`
              : `${mapping.unlocated} of ${mapping.total} customers have no map location yet and are not shown.`}
            {" "}
            <button type="button" onClick={() => onReviewCustomers ? onReviewCustomers() : onNavigate?.("/customers")}>Review customers</button>
          </div>
        </div>
      ) : null}
      {failed ? <div className={styles.loading} data-lantern-state="failed">Lantern City could not load its map. Reload to try again.</div> : null}
    </div>
  );
}
