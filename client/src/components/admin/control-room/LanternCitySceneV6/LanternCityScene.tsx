import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { territoryByName, territoryCenter } from "@shared/lanternTerritories";
import { CANONICAL_BUILDING_GEOGRAPHY } from "@shared/canonicalGeography";
import type { GeographicCustomer } from "../customerGeography";
import { WorldEntityInspector } from "../WorldEntityInspector";
import { RekindlingArsenal } from "../RekindlingArsenal";
import { CampaignChronicleList } from "@/components/goldline/CampaignWorldLayer";
import { useWorldTransition } from "../WorldTransitionProvider";
import { composeLanternCityScene } from "./composeLanternCityScene";
import {
  LanternCitySceneRenderer,
  type SceneSelectTarget,
} from "./LanternCitySceneRenderer";
import {
  LanternCityHUD,
  type Command,
  type Dossier,
  type Overview,
} from "./LanternCityHUD";
import {
  DEFAULT_CONTROLS,
  type SceneObject,
  type TerritoryTruth,
} from "./sceneTypes";
import styles from "./lantern-city-v6.module.css";

function Room({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onCancel={onClose}
      aria-label={title}
    >
      <button
        className={styles.close}
        onClick={onClose}
        aria-label="Return to city"
      >
        ×
      </button>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
function TerritoryRoom({
  truth,
  onClose,
  onCustomers,
}: {
  truth: TerritoryTruth;
  onClose: () => void;
  onCustomers: () => void;
}) {
  const territory = truth.occupancy.territory;
  const center = territoryCenter(territory);
  const intelligence = trpc.system.goldlineWorld.frontierIntelligence.useQuery(
    {
      territoryId: territory.id,
      neighbourhood: territory.name,
      latitude: center.latitude,
      longitude: center.longitude,
    },
    { enabled: truth.occupancy.guarded, staleTime: 3600000, retry: false }
  );
  return (
    <Room title={territory.name} onClose={onClose}>
      <p>
        {truth.customers.length} real customers ·{" "}
        {truth.occupancy.guarded
          ? "Guarded frontier"
          : truth.occupancy.conquered
            ? "Conquered territory"
            : "Unclaimed territory"}
      </p>
      {truth.customers.length ? (
        <button onClick={onCustomers}>View customer records</button>
      ) : (
        <p>Light the first lantern with a verified customer order.</p>
      )}
      {truth.occupancy.guarded ? (
        <>
          <h3>What could be…</h3>
          <p>
            {intelligence.isLoading
              ? "Loading territory intelligence…"
              : intelligence.isError
                ? "Territory intelligence unavailable. Try again later."
                : intelligence.data?.note}
          </p>
          <ul>
            {intelligence.data?.salons.map(salon => (
              <li key={salon.placeId}>
                <a href={salon.sourceUrl} target="_blank" rel="noreferrer">
                  {salon.businessName}
                  <small>{salon.address}</small>
                </a>
              </li>
            ))}
          </ul>
          <ul>
            {intelligence.data?.streets.map(street => (
              <li key={street.name}>
                {street.name}
                <small>{street.rationale}</small>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Room>
  );
}
export default function LanternCityScene({
  onOpenCustomer,
  onNavigate,
}: {
  onOpenCustomer: (phone: string) => void;
  onNavigate: (path: string) => void;
}) {
  const root = useRef<HTMLElement>(null);
  const [viewport, setViewport] = useState({ width: 1440, height: 900 });
  const [controls, setControls] = useState(DEFAULT_CONTROLS);
  const [command, setCommand] = useState<Command>("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [territoryId, setTerritoryId] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<
    "district" | "second_light"
  >("district");
  const [inspect, setInspect] = useState(false);
  const [selectedClusterKey, setSelectedClusterKey] = useState<string | null>(
    null
  );
  const [rekindle, setRekindle] = useState(false);
  const [search, setSearch] = useState("");
  const transition = useWorldTransition();
  const atlas = trpc.system.geographicTruth.atlas.useQuery(undefined, {
    staleTime: 30000,
    refetchInterval: 15000,
  });
  const overview = trpc.system.goldlineWorld.lanternCityOverview.useQuery(
    undefined,
    {
      staleTime: 30000,
      refetchInterval: 30000,
    }
  );
  const world = trpc.system.goldlineWorld.cityEntities.useQuery(undefined, {
    staleTime: 5000,
    refetchInterval: 5000,
  });
  const territories = trpc.system.goldlineWorld.territories.useQuery(
    undefined,
    { staleTime: 15000, refetchInterval: 15000 }
  );
  const campaign = trpc.system.goldlineWorld.campaign.useQuery(undefined, {
    staleTime: 15000,
    refetchInterval: 15000,
  });
  const battle = trpc.system.towerWars.today.useQuery(undefined, {
    staleTime: 30000,
    refetchInterval: 30000,
    retry: false,
  });
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0)
        setViewport({
          width: Math.round(entry.contentRect.width),
          height: Math.round(entry.contentRect.height),
        });
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const conquest = useMemo(() => {
    const conquered = new Set<string>(),
      lost = new Set<string>();
    for (const item of territories.data ?? []) {
      const territory = territoryByName(
        item.definition.realGeographyLabel ?? ""
      );
      if (territory && item.state.cleared)
        (item.state.pressureReturned ? lost : conquered).add(territory.id);
    }
    return { conquered, lost };
  }, [territories.data]);
  const scene = useMemo(
    () =>
      composeLanternCityScene({
        customers: (atlas.data?.customers ?? []) as GeographicCustomer[],
        atlasReady:
          !!atlas.data &&
          !atlas.isError &&
          !territories.isLoading &&
          !territories.isError,
        viewport,
        controls,
        conqueredTerritoryIds: conquest.conquered,
        lostGroundTerritoryIds: conquest.lost,
        selectedTerritory: territoryId,
        secondLightTerritoryId:
          overview.data?.featuredOperation.secondLight?.status ===
          "waiting_for_reality"
            ? overview.data.featuredOperation.secondLight.territoryId
            : null,
        featuredOperationTerritoryId:
          overview.data?.featuredOperation.environment === "infested"
            ? overview.data.featuredOperation.territoryId
            : null,
        activeCampaignTerritoryId:
          overview.data?.featuredOperation.binding !== "recovery"
            ? overview.data?.featuredOperation.territoryId
            : null,
        prospects: (atlas.data?.pursued ?? []).flatMap(p =>
          p.location && !p.location.outOfBounds
            ? [
                {
                  id: p.pipelineId,
                  name: p.name,
                  worldAnchor: { x: p.location.x, y: p.location.y },
                  latitude: p.location.latitude,
                  longitude: p.location.longitude,
                },
              ]
            : []
        ),
      }),
    [
      atlas.data,
      atlas.isError,
      territories.isLoading,
      territories.isError,
      viewport,
      controls,
      conquest,
      territoryId,
      overview.data,
    ]
  );
  const selected = scene.objects.find(object => object.id === selectedId);
  const physicalCluster =
    selected?.sourceClusters?.find(c => c.key === selectedClusterKey) ??
    (selected?.sourceClusters?.length === 1
      ? selected.sourceClusters[0]
      : null);
  const rekindleIdentityKey = physicalCluster
    ? ([...physicalCluster.customers].sort(
        (left, right) =>
          ({ active: 2, dimming: 1, dark: 0 })[left.cadence.state] -
            { active: 2, dimming: 1, dark: 0 }[right.cadence.state] ||
          left.identityKey.localeCompare(right.identityKey)
      )[0]?.identityKey ?? null)
    : null;
  const needsAddressChoice =
    !!selected?.cluster &&
    (selected.sourceClusters?.length ?? 0) > 1 &&
    !physicalCluster;
  const selectedTerritory = scene.truth.find(
    t => t.occupancy.territory.id === territoryId
  );
  const activeTerritoryId =
    territoryId ?? overview.data?.featuredOperation.territoryId ?? null;
  const dossier = (overview.data?.territoryDossiers.find(
    item => item.territoryId === activeTerritoryId
  ) ?? null) as Dossier | null;
  const pursuit =
    atlas.data?.pursued.find(p => p.pipelineId === selected?.prospectId) ??
    null;
  const requestedEntityId = new URLSearchParams(window.location.search).get(
    "entity"
  );
  const entity =
    (world.data ?? []).find(e =>
      pursuit
        ? e.pursuit?.accountId === pursuit.accountId
        : physicalCluster
          ? e.residents.some(r =>
              physicalCluster.customers.some(
                c => c.identityKey === r.identityKey
              )
            )
          : e.id === requestedEntityId
    ) ?? null;
  const chapter = campaign.data?.campaign.chapters.find(
    c => c.stableChapterId === campaign.data?.campaign.currentChapterId
  );
  const counts = (atlas.data?.customers ?? []).reduce(
    (mix, c) => {
      mix[c.cadence.state]++;
      return mix;
    },
    { active: 0, dimming: 0, dark: 0 }
  );
  function reset() {
    setSelectedId(null);
    setTerritoryId(null);
    setInspect(false);
    setRekindle(false);
    setCommand("map");
    setControls(DEFAULT_CONTROLS);
  }
  function select(
    object: SceneObject,
    element: HTMLElement,
    target: SceneSelectTarget = "default"
  ) {
    setSelectedId(object.id);
    setSelectedClusterKey(null);
    setTerritoryId(object.territoryId);
    setSelectedTarget(
      object.kind === "second_light" ? "second_light" : "district"
    );
    // The stronghold tower and its attached live customer light are one
    // scene object but two interaction targets: the tower body enters
    // Tower Wars, the attached light opens the customer inspector.
    if (object.buildingId && target !== "light") {
      transition.begin({
        entityId: object.buildingId,
        from: "city",
        to: "building",
        sourceEl: element,
        returnPath: "/growth/lantern-city",
        kind: "traversal",
      });
      onNavigate(`/growth/tower-wars?building=${object.buildingId}`);
      return;
    }
    if (object.cluster || object.prospectId) {
      setInspect(true);
      setTerritoryId(object.territoryId);
    }
  }
  const damage = battle.data?.evidenceSufficient
    ? {
        opus_la: battle.data.state.buildings.opus_la.damage,
        century_park_east: battle.data.state.buildings.century_park_east.damage,
      }
    : undefined;
  return (
    <main
      ref={root}
      className={styles.scene}
      data-lantern-city="v6"
      data-art-acceptance={scene.artStatus}
    >
      <LanternCitySceneRenderer
        scene={scene}
        selectedId={selectedId}
        damage={damage}
        onSelect={select}
      />
      <LanternCityHUD
        scene={scene}
        overview={overview.data as Overview | undefined}
        overviewError={overview.isError}
        dossier={dossier}
        selectedTarget={selectedTarget}
        active={command}
        onCommand={setCommand}
        onLaunch={() =>
          onNavigate(
            `/driver?lanternOperation=${encodeURIComponent(overview.data?.featuredOperation.id ?? "")}&lanternChapter=${encodeURIComponent(overview.data?.featuredOperation.id ?? "")}&lanternBinding=${overview.data?.featuredOperation.binding ?? "world_exploration"}&lanternHost=${overview.data?.featuredOperation.host ?? "overland"}&lanternSurface=${overview.data?.featuredOperation.surface ?? "overland"}`
          )
        }
        onKnownLight={identityKey => {
          const object = scene.objects.find(item =>
            item.cluster?.customers.some(
              customer => customer.identityKey === identityKey
            )
          );
          if (!object) return;
          setSelectedId(object.id);
          setSelectedClusterKey(
            object.sourceClusters?.find(cluster =>
              cluster.customers.some(
                customer => customer.identityKey === identityKey
              )
            )?.key ?? null
          );
          setInspect(true);
        }}
        onNewOrder={() => onNavigate("/new-order")}
      />
      {command !== "map" ? (
        <Room
          title={command[0].toUpperCase() + command.slice(1)}
          onClose={() => setCommand("map")}
        >
          {command === "missions" ? (
            <>
              <p>
                {chapter?.fictionalTreatment ?? "No active campaign chapter."}
              </p>
              <CampaignChronicleList />
            </>
          ) : null}
          {command === "customers" ? (
            <>
              <label>
                Find customers
                <input
                  aria-label="Find customers"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </label>
              <p>
                {atlas.data?.customers.length ?? 0} customers. Records without
                coordinates remain available here.
              </p>
              <ul>
                {atlas.data?.customers
                  .filter(c =>
                    `${c.displayName} ${c.address}`
                      .toLowerCase()
                      .includes(search.toLowerCase())
                  )
                  .map(c => (
                    <li key={c.identityKey}>
                      <button
                        disabled={!c.phone}
                        onClick={() => c.phone && onOpenCustomer(c.phone)}
                      >
                        {c.displayName}
                        <small>
                          {c.address} · {c.cadence.daysSinceLastOrder} days
                          since last order
                        </small>
                      </button>
                    </li>
                  ))}
              </ul>
            </>
          ) : null}
          {command === "buildings"
            ? Object.entries(CANONICAL_BUILDING_GEOGRAPHY).map(([id, geo]) => (
                <button
                  key={id}
                  onClick={() =>
                    onNavigate(`/growth/tower-wars?building=${id}`)
                  }
                >
                  {geo.name}
                  <small>{geo.address}</small>
                </button>
              ))
            : null}
          {command === "arsenal" ? (
            <>
              <p>
                Select a customer group to review cadence and open its real
                recovery workflow.
              </p>
              {scene.objects
                .filter(o => o.cluster && o.cluster.active < o.cluster.total)
                .map(o => (
                  <button
                    key={o.id}
                    onClick={() => {
                      setSelectedId(o.id);
                      setCommand("map");
                      setRekindle(true);
                    }}
                  >
                    {o.name} · {o.cluster!.total} customers
                  </button>
                ))}
              <button onClick={() => setCommand("customers")}>
                Browse all customers
              </button>
            </>
          ) : null}
          {command === "conquest"
            ? scene.truth
                .filter(t => t.occupancy.guarded)
                .map(t => (
                  <button
                    key={t.occupancy.territory.id}
                    onClick={() => {
                      setCommand("map");
                      setTerritoryId(t.occupancy.territory.id);
                    }}
                  >
                    {t.occupancy.territory.name} · What could be…
                  </button>
                ))
            : null}
        </Room>
      ) : null}
      {(inspect || rekindle) && needsAddressChoice && selected ? (
        <Room
          title={`Customers in ${selected.name}`}
          onClose={() => {
            setInspect(false);
            setRekindle(false);
          }}
        >
          <p>
            {selected.cluster!.total} customers across{" "}
            {selected.sourceClusters!.length} physical locations.
          </p>
          {selected.sourceClusters!.map(cluster => (
            <button
              key={cluster.key}
              onClick={() => setSelectedClusterKey(cluster.key)}
            >
              {cluster.canonicalAddress ??
                `${cluster.latitude.toFixed(5)}, ${cluster.longitude.toFixed(5)}`}
              <small>
                {cluster.total} customers · {cluster.active} active
              </small>
            </button>
          ))}
        </Room>
      ) : null}
      {rekindle && physicalCluster ? (
        <RekindlingArsenal
          customerLabel={
            physicalCluster.total === 1
              ? physicalCluster.customers[0]!.displayName
              : `${physicalCluster.total} customers`
          }
          customerIdentityKey={rekindleIdentityKey}
          rekindling={
            overview.data?.featuredOperation.rekindling.find(
              r => r.customerIdentityKey === rekindleIdentityKey
            ) ?? null
          }
          businessDate={
            overview.data?.businessDate ?? new Date().toISOString().slice(0, 10)
          }
          onClose={() => setRekindle(false)}
          onInspect={() => {
            setRekindle(false);
            setInspect(true);
          }}
          onSelectTool={() => {
            setRekindle(false);
            setInspect(true);
          }}
        />
      ) : null}
      {(inspect && selected && !needsAddressChoice) ||
      (requestedEntityId && entity) ? (
        <WorldEntityInspector
          entity={entity}
          cluster={physicalCluster}
          pursuit={pursuit}
          onOpenCustomer={onOpenCustomer}
          onClose={() => {
            setInspect(false);
            setSelectedId(null);
            if (requestedEntityId)
              window.history.replaceState({}, "", "/growth/lantern-city");
          }}
        />
      ) : null}
    </main>
  );
}
