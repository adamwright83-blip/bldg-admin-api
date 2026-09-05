import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { EconomicWorldReaction } from "@/components/goldline/EconomicWorldReaction";
import { MapPinOff, RefreshCw, Search, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { WorldGeographySurface } from "./WorldGeographySurface";
import type { GeographicEntity } from "./GoogleMapsRealityLayer";
import { WorldDayPhaseIndicator } from "./WorldDayPhase";
import { clusterGeographicCustomers, clustersAsGoogleEntities, fanOutAtlasCollisions } from "./customerGeography";
import type { CustomerLocationCluster } from "./customerGeography";
import { WorldEntityInspector } from "./WorldEntityInspector";
import { WorldObligationTether } from "./WorldObligationTether";
import { useArcadeWorld } from "./useArcadeWorld";
import { describeWorldPresentation, orderByProminence } from "@shared/goldlineWorldPresentation";
import type { CityWorldEntity } from "../../../../../server/goldlineWorld/cityWorldService";
import { projectCustomerWindows } from "@shared/goldlineCustomerWindows";
import { TerritoryChrome, TerritoryWorldLayer, useReducedMotionFlag } from "@/components/goldline/TerritoryWorldLayer";
import { CampaignChrome, CampaignChronicleList, CampaignWorldLayer } from "@/components/goldline/CampaignWorldLayer";
import { CRITICAL_COMBAT_ASSETS } from "./lanternCityCombat";
import { WorldVeilLayer } from "@/components/goldline/board/WorldVeilLayer";
import { GuardianActor } from "@/components/goldline/GuardianActor";
import { guardianById } from "@shared/goldlineGuardians";
import type { NeighbourhoodVeil } from "@shared/neighbourhoodVeil";

export {
  inferCustomerCadence,
  projectLatLngToLanternAtlas,
} from "@shared/lanternCity";

export function classifyLanternCustomer(customer: { recencyStatus: string }) {
  if (customer.recencyStatus === "lapsed") return "dark" as const;
  if (customer.recencyStatus === "cooling") return "dimming" as const;
  return "active" as const;
}

/**
 * The atmosphere a place is wearing, drawn onto the building itself rather than
 * beside it. Everything here is decorative to a screen reader — the same facts
 * reach assistive technology through `markerLabel()`, because uncertainty that
 * can only be seen is uncertainty that some users never get.
 */
function WorldMarkerAtmosphere({ entity }: { entity: CityWorldEntity | null }) {
  const presentation = entity?.presentation;
  if (!presentation) return null;
  return (
    <>
      {presentation.veil !== "none" ? (
        <span className={`lc-veil veil-${presentation.veil}`} aria-hidden />
      ) : null}
      {presentation.marks.length ? (
        <span className="lc-marks" aria-hidden>
          {presentation.marks.map(mark => (
            <i key={mark.semantic} data-mark={mark.semantic}>
              {mark.count > 1 ? mark.count : null}
            </i>
          ))}
        </span>
      ) : null}
    </>
  );
}

/**
 * Attention is allowed to make a place louder and nothing else. The tier lands
 * on the marker as emphasis; it never touches the record's stage, revenue or
 * position.
 */
function worldMarkerClass(
  base: string,
  entity: CityWorldEntity | null,
  revealing = false,
  selected = false
) {
  /*
    Selection is a property of the OBJECT, not only of the panel that opened.
    Before this, clicking a lantern changed a side panel while the thing you
    clicked looked identical to its neighbours — so the world could not answer
    "which one am I looking at?" once your eye left the panel.

    Applied outside the presentation check on purpose: an entity with no world
    presentation can still be selected, and must still show it.
  */
  const selectedClass = selected ? " is-selected" : "";
  const presentation = entity?.presentation;
  if (!presentation) return `${base}${selectedClass}`;
  return `${base} has-world veil-${presentation.veil} attention-${presentation.prominenceTier}${revealing ? " is-revealing" : ""}${selectedClass}`;
}

function markerLabel(base: string, entity: CityWorldEntity | null) {
  if (!entity) return base;
  return describeWorldPresentation(base, entity.presentation);
}

/**
 * The playable body layered over a real building.
 *
 * Everything here is transient presentation: a transform wrapper, the weapon
 * rigged to its attachment point, and overlays for damage, scorch and debris.
 * The published tower art underneath is never modified — it is wrapped and
 * restored, which is what lets a building look wrecked without anything real
 * having happened to it.
 */
function ArcadeBodyLayer({
  body,
  weapon,
  idle,
}: {
  body: import("@shared/goldlineArcade").ArcadeBody | undefined;
  weapon: import("@shared/goldlineArcade").WeaponArchetype;
  idle: "flourish" | "practice" | "machinery" | null;
}) {
  const phase = body?.phase ?? "idle";
  const damage = body?.damage ?? 0;
  return (
    <span
      className={`lc-arcade is-${phase}${idle ? ` lc-idle-${idle}` : ""}`}
      style={{
        transform: body ? `rotate(${body.lean}deg)` : undefined,
      }}
      aria-hidden
    >
      <span className={`lc-weapon-${weapon}`} />
      {weapon === "valet_bazooka" ? <span className="lc-projectile" /> : null}
      <span className="lc-arcade-damage" style={{ opacity: Math.min(0.85, damage) }} />
      <span className="lc-arcade-scorch" style={{ opacity: Math.min(0.7, damage * 0.8) }} />
      <span className="lc-arcade-debris">
        {Array.from({ length: Math.min(8, body?.debris ?? 0) }).map((_, index) => (
          <i
            key={index}
            style={
              {
                "--dx": `${(index % 4) * 12 - 18}px`,
                "--dy": `${-14 - index * 4}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </span>
    </span>
  );
}

/**
 * A stable per-lantern animation offset, in seconds.
 *
 * Deterministic from the cluster key so the same location always breathes on
 * the same beat — a reload must not reshuffle the city's rhythm, and two
 * lanterns must not drift into lockstep. Presentation only; nothing here
 * touches customer state.
 */
function lanternPhaseSeconds(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 100000;
  }
  // Spread across the breathing cycle rather than a fixed set of buckets.
  return (hash % 700) / 100;
}

function FrontierBriefing({
  neighbourhood,
  onClose,
}: {
  neighbourhood: NeighbourhoodVeil;
  onClose: () => void;
}) {
  const guardian = guardianById(neighbourhood.guardianId!);
  const intelligence = trpc.system.goldlineWorld.frontierIntelligence.useQuery({
    neighbourhood: neighbourhood.name,
    latitude: neighbourhood.latitude,
    longitude: neighbourhood.longitude,
  }, { staleTime: 60 * 60 * 1000, retry: false });
  const salons = intelligence.data?.salons ?? [];
  const streets = intelligence.data?.streets ?? [];
  return (
    <div className="lc-frontier-scrim" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="lc-frontier-briefing"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lc-frontier-title"
      >
        <button className="lc-frontier-close" type="button" onClick={onClose} aria-label="Return to Lantern City">
          <X aria-hidden />
        </button>
        <div className="lc-frontier-guardian" aria-hidden>
          <GuardianActor guardianId={guardian.id} phase="notice" />
        </div>
        <div className="lc-frontier-copy">
          <p className="lc-frontier-kicker">Territory counsel · unconquered</p>
          <h2 id="lc-frontier-title">{neighbourhood.name} is under guard</h2>
          <p className="lc-frontier-sage">
            “To defeat {guardian.name}, hit them where it hurts: put Goldline in
            front of the people most likely to place the first order here.”
          </p>
          <div className="lc-frontier-objectives" aria-label="Conquest plan">
            <article><b>01</b><span><strong>Win the trade</strong><small>Deliver salon-specific flyers to {salons.length || 10} high-fit salons.</small></span></article>
            {salons.length ? <ol className="lc-frontier-targets">
              {salons.map(salon => <li key={salon.placeId}>
                <a href={salon.sourceUrl} target="_blank" rel="noreferrer">{salon.businessName}</a>
                <span>{salon.address}{salon.rating ? ` · ${salon.rating}★` : ""}</span>
              </li>)}
            </ol> : null}
            <article><b>02</b><span><strong>Take the blocks</strong><small>Hang 100 door cards on high-potential residential streets.</small></span></article>
            {streets.length ? <ol className="lc-frontier-targets is-streets">
              {streets.map(street => <li key={street.name}><strong>{street.name}</strong><span>{street.rationale}</span></li>)}
            </ol> : null}
            <article><b>03</b><span><strong>Light the first lantern</strong><small>Convert one verified resident order in {neighbourhood.name}.</small></span></article>
          </div>
          <p className="lc-frontier-intel">
            {intelligence.isLoading
              ? "Sage is ranking live Google Places and residential candidates…"
              : intelligence.error
                ? "Territory intelligence is temporarily unavailable. Try this guardian again."
                : intelligence.data?.note}
          </p>
          <button type="button" className="lc-frontier-return" onClick={onClose}>Return to the city</button>
        </div>
      </section>
    </div>
  );
}

export default function LanternCityAtlas({
  onOpenCustomer,
  onNavigate,
}: {
  onOpenCustomer: (phone: string) => void;
  onNavigate: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedCluster, setSelectedCluster] = useState<CustomerLocationCluster | null>(null);
  const [selectedPursuit, setSelectedPursuit] = useState<
    NonNullable<ReturnType<typeof useAtlasData>>["pursued"][number] | null
  >(null);

  const atlas = trpc.system.geographicTruth.atlas.useQuery(undefined, {
    staleTime: 30_000, refetchInterval: 15_000,
  });
  const cityWorld = trpc.system.goldlineWorld.cityEntities.useQuery(undefined, { staleTime: 5_000, refetchInterval: 5_000 });
  /*
    THE ONLY DAMAGE SOURCE THE CITY IS ALLOWED.

    `towerWars.today` compiles the battle from collected orders on the server.
    Lantern City reads it and hands the result down to the towers; it never
    derives, caches or adjusts a damage value of its own, so a building cannot
    look wrecked here and intact one click later inside Tower Wars.

    `evidenceSufficient` gates the whole thing: when the server could not reach
    the evidence, every building's damage stays UNDEFINED (unknown), which the
    art layer renders as the clean plate labelled "damage unknown" rather than
    as pristine.
  */
  const towerWarsToday = trpc.system.towerWars.today.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const buildingDamage = useMemo(() => {
    const data = towerWarsToday.data;
    if (!data || data.evidenceSufficient !== true) return undefined;
    return {
      century_park_east: data.state.buildings.century_park_east.damage,
      opus_la: data.state.buildings.opus_la.damage,
    };
  }, [towerWarsToday.data]);
  /*
    Attacks each tower actually launched today, gated by the same
    `evidenceSufficient` check. This is the sole permission slip for drawing a
    valet car or a golf ball in the city.
  */
  const buildingAttacks = useMemo(() => {
    const data = towerWarsToday.data;
    if (!data || data.evidenceSufficient !== true) return undefined;
    return {
      century_park_east: data.state.buildings.century_park_east.attackCount,
      opus_la: data.state.buildings.opus_la.attackCount,
    };
  }, [towerWarsToday.data]);
  const geocode = trpc.system.geographicTruth.geocodePending.useMutation({
    onSuccess: () => atlas.refetch(),
  });

  const data = atlas.data;
  const normalized = query.trim().toLowerCase();
  const customers = data?.customers ?? [];
  const pursued = data?.pursued ?? [];

  const visibleCustomers = useMemo(
    () =>
      customers.filter(
        customer =>
          customer.location &&
          (!normalized ||
            `${customer.displayName} ${customer.address} ${customer.location.canonicalAddress ?? ""}`
              .toLowerCase()
              .includes(normalized))
      ),
    [customers, normalized]
  );

  const visiblePursuits = useMemo(
    () =>
      pursued.filter(
        item =>
          item.location &&
          (!normalized ||
            `${item.name} ${item.address} ${item.stage}`
              .toLowerCase()
              .includes(normalized))
      ),
    [pursued, normalized]
  );

  /*
    The two combat plates are the composition. Warm them in the browser cache
    before the map has finished settling so the combatants are standing there
    on first paint rather than arriving late over a finished city.
  */
  useEffect(() => {
    for (const href of CRITICAL_COMBAT_ASSETS) {
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = href;
      document.head.appendChild(link);
    }
  }, []);

  const [googleVisible, setGoogleVisible] = useState(false);
  const [guardianLocked, setGuardianLocked] = useState(false);
  const [frontierBriefing, setFrontierBriefing] = useState<NeighbourhoodVeil | null>(null);
  const reducedMotion = useReducedMotionFlag();
  /*
    One scheduler drives every playable building. Only the places actually
    drawn are handed to it, so offscreen towers cost nothing.
  */
  const visibleEntityIds = useMemo(
    () => (cityWorld.data ?? []).map(entity => entity.id),
    [cityWorld.data]
  );
  const arcade = useArcadeWorld({ visibleIds: visibleEntityIds });
  const customerClusters = useMemo(() => clusterGeographicCustomers(visibleCustomers as any), [visibleCustomers]);

  /*
    Buildings are matched on the server, against the same normaliser the
    identity resolver uses. The browser only has to look the answer up, so a
    building cannot be one entity here and a different one there.
  */
  const entityByAccountId = useMemo(() => {
    const map = new Map<number, CityWorldEntity>();
    for (const entity of cityWorld.data ?? []) {
      if (entity.pursuit) map.set(entity.pursuit.accountId, entity);
    }
    return map;
  }, [cityWorld.data]);

  const entityByResident = useMemo(() => {
    const map = new Map<string, CityWorldEntity>();
    for (const entity of cityWorld.data ?? []) {
      for (const resident of entity.residents) map.set(resident.identityKey, entity);
    }
    return map;
  }, [cityWorld.data]);

  const entityForPursuit = (accountId: number) => entityByAccountId.get(accountId) ?? null;
  const entityForCluster = (cluster: CustomerLocationCluster) => {
    for (const customer of cluster.customers) {
      const entity = entityByResident.get(customer.identityKey);
      if (entity) return entity;
    }
    return null;
  };

  const requestedEntityId = new URLSearchParams(window.location.search).get("entity");
  const requestedEntity = cityWorld.data?.find(entity => entity.id === requestedEntityId) ?? null;
  /*
    ONE PHYSICAL PLACE, ONE PRIMARY WORLD OBJECT.

    A pursued building and a customer lantern can describe the SAME canonical
    place, and both were drawn at the same coordinate as competing clickable
    markers — the building sitting on the lantern and swallowing its clicks.
    Raising one above the other only picks a winner; it leaves two primary
    objects claiming one place, which contradicts the one-world architecture
    the inspector states out loud.

    The building wins, because a building is what is actually there. The
    lantern's cadence is not lost: it is layered onto the building below as
    state, so the place still reads as active/dimming/dormant.
  */
  function pursuitCoversCluster(cluster: CustomerLocationCluster): boolean {
    return visiblePursuits.some(
      pursuit =>
        pursuit.location != null &&
        Math.abs(pursuit.location.x - cluster.x) < 1.2 &&
        Math.abs(pursuit.location.y - cluster.y) < 1.2
    );
  }

  const selectedEntity = selectedPursuit ? entityForPursuit(selectedPursuit.accountId) : selectedCluster ? entityForCluster(selectedCluster) : requestedEntity;
  const selectedFocusPoint = selectedPursuit?.location
    ? { x: selectedPursuit.location.x, y: selectedPursuit.location.y }
    : selectedCluster
      ? { x: selectedCluster.x, y: selectedCluster.y }
      : requestedEntity?.location
        ? { x: requestedEntity.location.x, y: requestedEntity.location.y }
        : null;

  /*
    A place arriving by deep link is revealed rather than merely selected: the
    city moves to the building that was already there. Focus follows so the
    reveal is not purely visual.
  */
  const revealRef = useRef<HTMLButtonElement | null>(null);
  const [revealing, setRevealing] = useState(false);
  useEffect(() => {
    if (!requestedEntity) return;
    const target = revealRef.current;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
    setRevealing(true);
    // The veil lifting is a moment, not a permanent state.
    const timer = window.setTimeout(() => setRevealing(false), 2200);
    return () => window.clearTimeout(timer);
  }, [requestedEntity?.id]);

  /**
   * The loudest real signals, in order. `orderByProminence` only reorders — the
   * entities it ranks are handed back untouched.
   */
  const attentionRecommendations = useMemo(
    () =>
      orderByProminence(
        (cityWorld.data ?? []).filter(
          entity => entity.presentation.attentionSummary !== null
        ),
        entity => entity.presentation
      ).slice(0, 4),
    [cityWorld.data]
  );

  /** Selecting a recommendation lands on the same building, in the same place. */
  const revealEntity = (entity: CityWorldEntity) => {
    const pursuit = visiblePursuits.find(
      item => item.accountId === entity.pursuit?.accountId
    );
    if (pursuit) {
      setSelectedCluster(null);
      setSelectedPursuit(pursuit);
      return;
    }
    const cluster = customerClusters.find(item =>
      item.customers.some(customer => entityByResident.get(customer.identityKey)?.id === entity.id)
    );
    if (cluster) {
      setSelectedPursuit(null);
      setSelectedCluster(cluster);
    }
  };

  /**
   * The same visible records, addressed by the real coordinate the atlas
   * projection was derived from. Only records with a successful geocode carry
   * a location at all, so nothing here is estimated or back-filled.
   */
  const googleEntities: GeographicEntity[] = useMemo(
    () => [
      ...clustersAsGoogleEntities(customerClusters, cluster => {
        setSelectedPursuit(null);
        setSelectedCluster(cluster);
      }),
      ...visiblePursuits.map(item => ({
        id: `pursued:${item.pipelineId}`,
        latitude: item.location!.latitude,
        longitude: item.location!.longitude,
        label: item.name,
        kind: "pursued" as const,
        onSelect: () => {
          setSelectedCluster(null);
          setSelectedPursuit(item);
        },
      })),
    ],
    [customerClusters, visiblePursuits]
  );

  const counts = customers.reduce(
    (acc, customer) => ({
      ...acc,
      [customer.cadence.state]: acc[customer.cadence.state] + 1,
    }),
    { active: 0, dimming: 0, dark: 0 }
  );

  const unmappedCustomers = customers.filter(customer => !customer.location).length;
  const unmappedPursuits = pursued.filter(item => !item.location).length;

  return (
    <main className="lc-page">
      <header className="lc-page-header">
        <div>
          <span className="lc-spark">✦</span>
          <h1>Lantern City Atlas — Los Angeles</h1>
          <p>Real customer geography · {data?.businessDate ?? "Today"}</p>
        </div>
        <div className="lc-header-controls">
          <WorldDayPhaseIndicator />
          <label className="lc-search">
            <Search aria-hidden />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search customers and opportunities…"
              aria-label="Search Lantern City"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <X />
              </button>
            ) : null}
          </label>
        </div>
      </header>

      <section
        className="lc-status-grid"
        aria-label="Customer relationship counts"
      >
        {(["active", "dimming", "dark"] as const).map(state => (
          <article key={state} className={`lc-status-card state-${state}`}>
            <span className="lc-status-icon" />
            <div>
              <small>{state === "dark" ? "Dormant" : state}</small>
              <strong>
                {atlas.isLoading || atlas.isError ? "—" : counts[state]}
              </strong>
              <p>Customer-specific order cadence</p>
            </div>
          </article>
        ))}
        <article className="lc-status-card state-pursued">
          <span className="lc-status-icon"><i className="lc-mini-building" aria-hidden /></span>
          <div>
            <small>Pursued</small>
            <strong>
              {atlas.isLoading || atlas.isError ? "—" : pursued.length}
            </strong>
            <p>Active persisted opportunities</p>
          </div>
        </article>
      </section>

      <section className="lc-map" aria-label="Customer relationship atlas">
        <WorldGeographySurface
          mode="lantern_atlas"
          onNavigate={onNavigate}
          showNeighborhoods={true}
          showOpportunityLayer={true}
          onGoogleVisibilityChange={setGoogleVisible}
          geographicEntities={googleEntities}
          focusPoint={selectedFocusPoint}
          gesturesDisabled={guardianLocked}
          combatPresentation
          buildingDamage={buildingDamage}
          buildingAttacks={buildingAttacks}
        >
          {/*
            Lanterns and pursuit flames are positioned with the atlas x/y
            percentages that `projectLatLngToLanternAtlas()` produced for the
            illustrated map. Those percentages describe a spot on the painting,
            not a place, so they are not drawn over real geography — the same
            records are handed to the renderer as coordinates instead. Each
            record already carries the latitude/longitude the atlas projection
            was derived from, so nothing is estimated to do this.
          */}
          {!googleVisible && fanOutAtlasCollisions(customerClusters.filter(cluster => !cluster.outsideAtlas && !pursuitCoversCluster(cluster))).map(({ cluster, fanSlot }) => (
            <Fragment key={cluster.key}>
              {fanSlot > 0 ? (
                <>
                  <span className="lc-anchor" style={{ left: `${cluster.x}%`, top: `${cluster.y}%` }} aria-hidden />
                  <span className={`lc-stem fan-${fanSlot}`} style={{ left: `${cluster.x}%`, top: `${cluster.y}%` }} aria-hidden />
                </>
              ) : null}
              <button
                type="button"
                ref={entityForCluster(cluster)?.id === requestedEntityId ? revealRef : undefined}
                className={worldMarkerClass(
                  `lc-lantern state-${cluster.dark === cluster.total ? "dark" : cluster.dimming > 0 || cluster.dark > 0 ? "dimming" : "active"}${fanSlot > 0 ? ` fan-${fanSlot}` : ""}`,
                  entityForCluster(cluster),
                  revealing && entityForCluster(cluster)?.id === requestedEntityId,
                  selectedCluster?.key === cluster.key
                )}
                style={{
                  left: `${cluster.x}%`,
                  top: `${cluster.y}%`,
                  // Every lantern breathes on its own phase. Synchronised
                  // flicker reads as a screensaver; staggered, it reads as a
                  // city where separate lives are running. Hashed from the
                  // cluster key so a lantern keeps its rhythm across reloads
                  // rather than reshuffling on every render.
                  ["--lc-phase" as string]: `${-lanternPhaseSeconds(cluster.key)}s`,
                }}
                onClick={() => {
                  setSelectedPursuit(null);
                  setSelectedCluster(cluster);
                }}
                aria-label={markerLabel(
                  `${cluster.total} customer${cluster.total === 1 ? "" : "s"} at this location`,
                  entityForCluster(cluster)
                )}
              >
                <span className="lc-lantern-handle" />
                <span className="lc-lantern-body">
                  {(() => {
                    const windows = projectCustomerWindows(cluster.customers);
                    return windows.mode === "individual" ? (
                      <span className="lc-customer-windows is-individual" data-active={windows.active} data-dormant={windows.dormant}>
                        {windows.windows.map(window => <i key={window.identityKey} className={`is-${window.state}`} />)}
                      </span>
                    ) : (
                      <span className="lc-customer-windows is-aggregate" data-total={windows.total} data-active={windows.active} data-dormant={windows.dormant}>
                        {windows.bands.map((state, index) => <i key={index} className={`is-${state}`} />)}
                      </span>
                    );
                  })()}
                </span>
                <span className="lc-lantern-base" />
                {cluster.total > 1 ? <b>{cluster.total}</b> : null}
                <WorldMarkerAtmosphere entity={entityForCluster(cluster)} />
                <WorldObligationTether
                  obligations={entityForCluster(cluster)?.obligations}
                  buildingName={`${cluster.total} customer${cluster.total === 1 ? "" : "s"} here`}
                />
                {/* Every real building is a playable body, not just pursued ones. */}
                {entityForCluster(cluster) ? (
                  <ArcadeBodyLayer
                    body={arcade.world.bodies[entityForCluster(cluster)!.id]}
                    weapon={
                      arcade.weaponFor({
                        displayName: entityForCluster(cluster)!.displayName,
                      }).archetype
                    }
                    idle={
                      arcade.idle.find(
                        i => i.physicalEntityId === entityForCluster(cluster)!.id
                      )?.kind ?? null
                    }
                  />
                ) : null}
              </button>
            </Fragment>
          ))}

          {!googleVisible && visiblePursuits.map(item => {
            const worldEntity = entityForPursuit(item.accountId);
            return (
            <button
              type="button"
              key={item.pipelineId}
              ref={worldEntity?.id === requestedEntityId ? revealRef : undefined}
                className={worldMarkerClass(
                  `lc-pursued-building${worldEntity?.canonicalAsset?.assetUrl ? " has-published-art" : ""}${
                    /*
                      The suppressed lantern's cadence, carried onto the
                      building that replaced it, so the place still reads as
                      active / dimming / dormant.
                    */
                    (() => {
                      const covered = customerClusters.find(
                        c =>
                          item.location != null &&
                          Math.abs(item.location.x - c.x) < 1.2 &&
                          Math.abs(item.location.y - c.y) < 1.2
                      );
                      if (!covered) return "";
                      return covered.dark === covered.total
                        ? " cadence-dark"
                        : covered.dimming > 0 || covered.dark > 0
                          ? " cadence-dimming"
                          : " cadence-active";
                    })()
                  }`,
                  worldEntity,
                  revealing && worldEntity?.id === requestedEntityId,
                  selectedPursuit?.pipelineId === item.pipelineId
                )}
                data-world-entity-id={worldEntity?.id}
                style={{
                  left: `${item.location!.x}%`,
                  top: `${item.location!.y}%`,
                }}
              onClick={() => {
                setSelectedCluster(null);
                setSelectedPursuit(item);
              }}
              /*
                The building is the control. A plain click inspects it; holding
                Alt fires its own weapon at another tower, which is play and
                touches nothing real.
              */
              onPointerDown={event => {
                if (guardianLocked) return;
                if (!event.altKey || !worldEntity) return;
                event.preventDefault();
                event.stopPropagation();
                /*
                  Fire at another building that is actually drawn, so the
                  damage lands somewhere the player can see. With nothing else
                  on screen the tower takes its own shot, which is funnier and
                  still visible.
                */
                const target =
                  (cityWorld.data ?? []).find(
                    e => e.id !== worldEntity.id && e.location
                  ) ?? worldEntity;
                arcade.fireAt({
                  shooterId: worldEntity.id,
                  targetId: target.id,
                  weapon: arcade.weaponFor({ displayName: item.name }).archetype,
                });
              }}
              aria-label={markerLabel(`Pursued: ${item.name}`, worldEntity)}
            >
              {worldEntity?.canonicalAsset?.assetUrl ? <img src={worldEntity.canonicalAsset.assetUrl} alt="" /> : <span aria-hidden><i/><i/><i/></span>}
              <b>{item.name}</b>
              <WorldMarkerAtmosphere entity={worldEntity} />
              <WorldObligationTether
                obligations={worldEntity?.obligations}
                buildingName={item.name}
              />
              {worldEntity ? (
                <ArcadeBodyLayer
                  body={arcade.world.bodies[worldEntity.id]}
                  weapon={arcade.weaponFor({ displayName: item.name }).archetype}
                  idle={arcade.idle.find(i => i.physicalEntityId === worldEntity.id)?.kind ?? null}
                />
              ) : null}
            </button>
          )})}

          {!atlas.isLoading &&
          visibleCustomers.length + visiblePursuits.length === 0 ? (
            <div className="lc-map-empty">
              <strong>
                {atlas.isError
                  ? "Geographic truth unavailable"
                  : "No geocoded records match this view"}
              </strong>
              <span>
                Records without successful provider coordinates remain outside the
                illustrated map.
              </span>
            </div>
          ) : null}
          {/*
            The unknown, drawn as weather. Mounted before the reacting world so
            it sits under every piece that stands on the ground — see
            WorldVeilLayer for why a hole is always a real fact.
          */}
          <WorldVeilLayer
            clusters={customerClusters}
            totalCustomers={customers.length}
            atlasReady={!atlas.isLoading && !atlas.isError}
            onConfront={neighbourhood => {
              setSelectedCluster(null);
              setSelectedPursuit(null);
              setFrontierBriefing(neighbourhood);
              setGuardianLocked(true);
            }}
          />
          <EconomicWorldReaction entities={cityWorld.data ?? []} />
          <TerritoryWorldLayer
            entities={cityWorld.data ?? []}
            googleVisible={googleVisible}
            interactionLocked={guardianLocked}
            onInteractionLock={setGuardianLocked}
            reducedMotion={reducedMotion}
          />
          <CampaignWorldLayer
            entities={cityWorld.data ?? []}
            googleVisible={googleVisible}
          />
        </WorldGeographySurface>
        {frontierBriefing ? (
          <FrontierBriefing
            neighbourhood={frontierBriefing}
            onClose={() => {
              setFrontierBriefing(null);
              setGuardianLocked(false);
            }}
          />
        ) : null}
        <TerritoryChrome />
        {selectedCluster || selectedPursuit || requestedEntity ? null : <CampaignChrome />}
      </section>

      {attentionRecommendations.length ? (
        <section className="lc-attention-row" aria-label="Where Goldline suggests looking">
          <h2>Where Goldline suggests looking</h2>
          <p className="lc-attention-note">
            Ranked by real derived signals. Nothing here changes a stage, a
            revenue figure or a deadline — it only changes what is easy to find.
          </p>
          <div>
            {attentionRecommendations.map(entity => (
              <button
                key={entity.id}
                type="button"
                className={`lc-attention-card attention-${entity.presentation.prominenceTier}`}
                onClick={() => revealEntity(entity)}
              >
                <strong>{entity.displayName}</strong>
                <span>{entity.presentation.attentionSummary}</span>
                <small>{entity.projection.attentionReasons[0]?.sourceEvidenceReference}</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="lc-utility-row">
        <article className="lc-legend">
          <h2>Lantern legend</h2>
          {(["active", "dimming", "dark"] as const).map(state => (
            <span key={state}>
              <i className={`lc-mini-lantern state-${state}`} />
              <strong>{state === "dark" ? "Dormant" : state}</strong>
            </span>
          ))}
          <span>
            <i className="lc-mini-building" aria-hidden />
            <strong>Pursued building</strong>
          </span>
        </article>

        <article className="lc-unmapped">
          <MapPinOff aria-hidden />
          <div>
            <h2>Geographic Truth</h2>
            <strong>{unmappedCustomers + unmappedPursuits}</strong>
            <p>
              {data?.provider.status === "unconfigured"
                ? "Geographic provider not configured. Credential-independent records and statuses remain operational."
                : `${unmappedCustomers} customers and ${unmappedPursuits} pursuits need location.`}
            </p>
            <small>
              {Object.entries(data?.statusCounts ?? {})
                .map(([status, value]) => `${status}: ${value}`)
                .join(" · ")}
            </small>
            <button
              type="button"
              disabled={geocode.isPending}
              onClick={() => geocode.mutate({ batchSize: 20 })}
            >
              <RefreshCw className={geocode.isPending ? "animate-spin" : ""} />
              {geocode.isPending
                ? "Geocoding bounded batch…"
                : "Geocode pending locations"}
            </button>
          </div>
        </article>
      </section>

      <CampaignChronicleList />

      {selectedCluster || selectedPursuit || requestedEntity ? <WorldEntityInspector entity={selectedEntity} cluster={selectedCluster} pursuit={selectedPursuit} onClose={() => { setSelectedCluster(null); setSelectedPursuit(null); if (requestedEntityId) window.history.replaceState({}, "", "/growth/lantern-city"); }} onOpenCustomer={onOpenCustomer} /> : null}
    </main>
  );
}

function useAtlasData() {
  return trpc.system.geographicTruth.atlas.useQuery().data;
}
