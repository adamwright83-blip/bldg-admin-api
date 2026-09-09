import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { EconomicWorldReaction } from "@/components/goldline/EconomicWorldReaction";
import { RefreshCw, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { WorldGeographySurface } from "./WorldGeographySurface";
import type { GeographicEntity } from "./GoogleMapsRealityLayer";
import {
  clusterGeographicCustomers,
  clustersAsGoogleEntities,
  fanOutAtlasCollisions,
  clusterCoveredByAtlasPoint,
  clusterAtCanonicalAddress,
  lanternDensityClass,
  mergeClusters,
} from "./customerGeography";
import type { CustomerLocationCluster } from "./customerGeography";
import { WorldEntityInspector } from "./WorldEntityInspector";
import { WorldObligationTether } from "./WorldObligationTether";
import { useArcadeWorld } from "./useArcadeWorld";
import {
  describeWorldPresentation,
  orderByProminence,
} from "@shared/goldlineWorldPresentation";
import type { CityWorldEntity } from "../../../../../server/goldlineWorld/cityWorldService";
import { TerritoryChrome } from "@/components/goldline/TerritoryWorldLayer";
import {
  CampaignChronicleList,
  CampaignWorldLayer,
} from "@/components/goldline/CampaignWorldLayer";
import { CRITICAL_COMBAT_ASSETS } from "./lanternCityCombat";
import { WorldVeilLayer } from "@/components/goldline/board/WorldVeilLayer";
import { frontierAssetSrc, frontierKindForTerritory } from "@/components/goldline/lanternCityV5Assets";
import { LanternCityHud } from "./LanternCityHud";
import {
  LanternCommandDeck,
  LanternGameRoom,
  LanternMapLegend,
  type LanternCommandId,
} from "./LanternCommandDeck";
import {
  RekindlingArsenal,
  RekindlingEmptyState,
  type RekindlingToolId,
} from "./RekindlingArsenal";
import {
  clusterLanternState,
  deriveTransientLanternEvidence,
  lanternAssetForClusterState,
  lanternNeedsRekindling,
  transientLanternOverlay,
} from "./lanternCustomerPresentation";
import {
  LanternBuildingsRoom,
  LanternConquestRoom,
} from "./LanternCommandRooms";
import { LANTERN_CITY_V5_ASSETS } from "@/components/goldline/lanternCityV5Assets";
import {
  deriveTerritoryOccupancy,
  territoryByName,
  territoryCenter,
  type TerritoryOccupancy,
} from "@shared/lanternTerritories";
import { CANONICAL_BUILDING_GEOGRAPHY } from "@shared/canonicalGeography";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";
import { TowerAttachedCustomerLantern } from "./TowerAttachedCustomerLantern";

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
      <span
        className="lc-arcade-damage"
        style={{ opacity: Math.min(0.85, damage) }}
      />
      <span
        className="lc-arcade-scorch"
        style={{ opacity: Math.min(0.7, damage * 0.8) }}
      />
      <span className="lc-arcade-debris">
        {Array.from({ length: Math.min(8, body?.debris ?? 0) }).map(
          (_, index) => (
            <i
              key={index}
              style={
                {
                  "--dx": `${(index % 4) * 12 - 18}px`,
                  "--dy": `${-14 - index * 4}px`,
                } as React.CSSProperties
              }
            />
          )
        )}
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
  neighbourhood: TerritoryOccupancy;
  onClose: () => void;
}) {
  const territory = neighbourhood.territory;
  const freedomAssetKind = frontierKindForTerritory(territory.id);
  const freedomAssetSrc = frontierAssetSrc(freedomAssetKind);
  const center = territoryCenter(territory);
  const intelligence = trpc.system.goldlineWorld.frontierIntelligence.useQuery(
    {
      territoryId: territory.id,
      neighbourhood: territory.name,
      latitude: center.latitude,
      longitude: center.longitude,
    },
    { staleTime: 60 * 60 * 1000, retry: false }
  );
  const salons = intelligence.data?.salons ?? [];
  const streets = intelligence.data?.streets ?? [];
  return (
    <div
      className="lc-frontier-scrim"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="lc-frontier-briefing"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lc-frontier-title"
      >
        <button
          className="lc-frontier-close"
          type="button"
          onClick={onClose}
          aria-label="Return to Lantern City"
        >
          <X aria-hidden />
        </button>
        <div className="lc-frontier-guardian" aria-hidden>
          {freedomAssetSrc ? <img src={freedomAssetSrc} alt="" /> : null}
        </div>
        <div className="lc-frontier-copy">
          <p className="lc-frontier-kicker">Freedom frontier · dormant</p>
          <h2 id="lc-frontier-title">Awaken {territory.name}</h2>
          <p className="lc-frontier-sage">
            “This adventure starts with one real customer. Put Goldline in front
            of the people most likely to place the first order here.”
          </p>
          <div className="lc-frontier-objectives" aria-label="Freedom plan">
            <article>
              <b>01</b>
              <span>
                <strong>Win the trade</strong>
                <small>
                  Deliver salon-specific flyers to {salons.length || 10}{" "}
                  high-fit salons.
                </small>
              </span>
            </article>
            {salons.length ? (
              <ol className="lc-frontier-targets">
                {salons.map(salon => (
                  <li key={salon.placeId}>
                    <a href={salon.sourceUrl} target="_blank" rel="noreferrer">
                      {salon.businessName}
                    </a>
                    <span>
                      {salon.address}
                      {salon.rating ? ` · ${salon.rating}★` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
            <article>
              <b>02</b>
              <span>
                <strong>Take the blocks</strong>
                <small>
                  Hang 100 door cards on high-potential residential streets.
                </small>
              </span>
            </article>
            {streets.length ? (
              <ol className="lc-frontier-targets is-streets">
                {streets.map(street => (
                  <li key={street.name}>
                    <strong>{street.name}</strong>
                    <span>{street.rationale}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            <article>
              <b>03</b>
              <span>
                <strong>Light the first lantern</strong>
                <small>
                  Convert one verified resident order in {territory.name}.
                </small>
              </span>
            </article>
          </div>
          <p className="lc-frontier-intel">
            {intelligence.isLoading
              ? "Sage is ranking live Google Places and residential candidates…"
              : intelligence.error
                ? "Territory intelligence is temporarily unavailable. Try this guardian again."
                : intelligence.data?.note}
          </p>
          <button
            type="button"
            className="lc-frontier-return"
            onClick={onClose}
          >
            Return to the city
          </button>
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeCommand, setActiveCommand] = useState<LanternCommandId>("map");
  const [rekindlingCluster, setRekindlingCluster] =
    useState<CustomerLocationCluster | null>(null);
  const [showInspector, setShowInspector] = useState(false);
  const [selectedCluster, setSelectedCluster] =
    useState<CustomerLocationCluster | null>(null);
  const [selectedPursuit, setSelectedPursuit] = useState<
    NonNullable<ReturnType<typeof useAtlasData>>["pursued"][number] | null
  >(null);

  const atlas = trpc.system.geographicTruth.atlas.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 15_000,
  });
  const cityWorld = trpc.system.goldlineWorld.cityEntities.useQuery(undefined, {
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
  const territoryWorld = trpc.system.goldlineWorld.territories.useQuery(
    undefined,
    { staleTime: 30_000 }
  );
  const conqueredTerritoryIds = useMemo(
    () =>
      new Set(
        (territoryWorld.data ?? []).flatMap(item => {
          if (!item.state.cleared || item.state.pressureReturned) return [];
          const territory = territoryByName(
            item.definition.realGeographyLabel ?? ""
          );
          return territory ? [territory.id] : [];
        })
      ),
    [territoryWorld.data]
  );
  const lostGroundTerritoryIds = useMemo(
    () =>
      new Set(
        (territoryWorld.data ?? []).flatMap(item => {
          if (!item.state.cleared || !item.state.pressureReturned) return [];
          const territory = territoryByName(
            item.definition.realGeographyLabel ?? ""
          );
          return territory ? [territory.id] : [];
        })
      ),
    [territoryWorld.data]
  );
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
  const campaign = trpc.system.goldlineWorld.campaign.useQuery(undefined, {
    staleTime: 15_000,
  });
  const currentChapter = campaign.data?.campaign.chapters.find(
    chapter => chapter.stableChapterId === campaign.data?.campaign.currentChapterId
  );
  const geocode = trpc.system.geographicTruth.geocodePending.useMutation({
    onSuccess: () => atlas.refetch(),
  });

  const data = atlas.data;
  const normalized = query.trim().toLowerCase();
  const customers = data?.customers ?? [];
  const pursued = data?.pursued ?? [];
  const customerLocations = useMemo(
    () =>
      customers.flatMap(customer =>
        customer.location
          ? [
              {
                latitude: customer.location.latitude,
                longitude: customer.location.longitude,
              },
            ]
          : []
      ),
    [customers]
  );
  const frontierObjectives = useMemo(() => {
    const occupancy = deriveTerritoryOccupancy({
      customers: customerLocations,
      totalCustomers: customers.length,
      atlasReady: !atlas.isLoading && !atlas.isError,
      conqueredTerritoryIds,
    });
    if (occupancy.suppressed) return [] as TerritoryOccupancy[];
    return occupancy.territories.filter(row => row.guarded).slice(0, 5);
  }, [
    customerLocations,
    customers.length,
    atlas.isLoading,
    atlas.isError,
    conqueredTerritoryIds,
  ]);

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

  /**
   * Several pipelines can sit on one real address. Presentation-only fan-out
   * so they read as a row of prospects instead of one block drawn four times;
   * the recorded location is untouched.
   */
  const pursuitFanOffset = useMemo(() => {
    const groups = new Map<string, number[]>();
    for (const item of visiblePursuits) {
      // ~1% of the atlas ≈ one prospect block width at desktop scale.
      const key = `${Math.round(item.location!.x)}:${Math.round(item.location!.y)}`;
      const list = groups.get(key) ?? [];
      list.push(item.pipelineId);
      groups.set(key, list);
    }
    const offsets = new Map<number, number>();
    groups.forEach(ids => {
      ids.forEach((id, index) => {
        offsets.set(id, (index - (ids.length - 1) / 2) * 2.1);
      });
    });
    return offsets;
  }, [visiblePursuits]);

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
  const [frontierBriefing, setFrontierBriefing] =
    useState<TerritoryOccupancy | null>(null);
  /*
    One scheduler drives every playable building. Only the places actually
    drawn are handed to it, so offscreen towers cost nothing.
  */
  const visibleEntityIds = useMemo(
    () => (cityWorld.data ?? []).map(entity => entity.id),
    [cityWorld.data]
  );
  const arcade = useArcadeWorld({ visibleIds: visibleEntityIds });
  const customerClusters = useMemo(
    () => clusterGeographicCustomers(visibleCustomers as any),
    [visibleCustomers]
  );

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
      for (const resident of entity.residents)
        map.set(resident.identityKey, entity);
    }
    return map;
  }, [cityWorld.data]);

  const entityForPursuit = (accountId: number) =>
    entityByAccountId.get(accountId) ?? null;
  const entityForCluster = (cluster: CustomerLocationCluster) => {
    for (const customer of cluster.customers) {
      const entity = entityByResident.get(customer.identityKey);
      if (entity) return entity;
    }
    return null;
  };

  const requestedEntityId = new URLSearchParams(window.location.search).get(
    "entity"
  );
  const requestedEntity =
    cityWorld.data?.find(entity => entity.id === requestedEntityId) ?? null;
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
  function clusterAtPoint(point: { x: number; y: number }) {
    return (
      customerClusters.find(cluster =>
        clusterCoveredByAtlasPoint(cluster, point)
      ) ?? null
    );
  }

  const canonicalTowerPoints = useMemo(
    () =>
      (["opus_la", "century_park_east"] as const).map(id => ({
        id,
        address: CANONICAL_BUILDING_GEOGRAPHY[id].address,
        ...projectLatLngToLanternAtlas(CANONICAL_BUILDING_GEOGRAPHY[id]),
      })),
    []
  );

  /*
    A stronghold carries a cluster's light when the cluster sits on the
    tower's projected point OR lives at the tower's own street address. The
    canonical tower coordinate and the provider's parcel geocode for the same
    address can differ by a few hundred metres; the address is the identity.
  */
  function towerCarriesCluster(
    tower: (typeof canonicalTowerPoints)[number],
    cluster: CustomerLocationCluster
  ): boolean {
    return (
      clusterCoveredByAtlasPoint(cluster, tower) ||
      clusterAtCanonicalAddress(cluster, tower.address)
    );
  }

  const towerAttachedClusters = useMemo(() => {
    const map = new Map<
      (typeof canonicalTowerPoints)[number]["id"],
      CustomerLocationCluster
    >();
    for (const tower of canonicalTowerPoints) {
      // Every cluster the tower carries is folded into one light with one
      // count; an address variant must never make a customer vanish.
      const carried = customerClusters.filter(
        cluster => !cluster.outsideAtlas && towerCarriesCluster(tower, cluster)
      );
      if (carried.length) map.set(tower.id, mergeClusters(carried));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalTowerPoints, customerClusters]);

  function primaryObjectCoversCluster(cluster: CustomerLocationCluster): boolean {
    if (
      visiblePursuits.some(
        pursuit =>
          pursuit.location != null &&
          clusterCoveredByAtlasPoint(cluster, pursuit.location)
      )
    ) {
      return true;
    }
    return canonicalTowerPoints.some(tower =>
      towerCarriesCluster(tower, cluster)
    );
  }

  const selectedEntity = selectedPursuit
    ? entityForPursuit(selectedPursuit.accountId)
    : selectedCluster
      ? entityForCluster(selectedCluster)
      : requestedEntity;
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
      item.customers.some(
        customer => entityByResident.get(customer.identityKey)?.id === entity.id
      )
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

  const worldTruthMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("worldTruth") === "1";

  const unmappedCustomers = customers.filter(
    customer => !customer.location
  ).length;
  const unmappedPursuits = pursued.filter(item => !item.location).length;

  return (
    <main className="lc-page lc-v5-game">
      <LanternCityHud
        businessDate={data?.businessDate ?? "Today"}
        questTitle={
          campaign.data?.campaign.title ??
          currentChapter?.fictionalTreatment ??
          attentionRecommendations[0]?.displayName ??
          ""
        }
        questBody={
          currentChapter?.fictionalTreatment ??
          attentionRecommendations[0]?.presentation.attentionSummary ??
          ""
        }
        questEmpty={!currentChapter && attentionRecommendations.length === 0}
        query={query}
        onQueryChange={setQuery}
        searchOpen={searchOpen}
        onToggleSearch={() => setSearchOpen(current => !current)}
      />
      <LanternMapLegend />

      <section className="lc-map" aria-label="Lantern City world">
        <WorldGeographySurface
          mode="lantern_atlas"
          onNavigate={onNavigate}
          /* Territory nameplates (LanternTerritoryStateLayer) carry name +
             state at the real centroid; the landmark captions would double up. */
          showNeighborhoods={false}
          showOpportunityLayer={true}
          onGoogleVisibilityChange={setGoogleVisible}
          geographicEntities={googleEntities}
          focusPoint={selectedFocusPoint}
          gesturesDisabled={guardianLocked}
          combatPresentation
          buildingDamage={buildingDamage}
          buildingAttacks={buildingAttacks}
          territoryCustomers={visibleCustomers as any}
          businessDate={data?.businessDate ?? ""}
          conqueredTerritoryIds={conqueredTerritoryIds}
          lostGroundTerritoryIds={lostGroundTerritoryIds}
          towerAttachedClusters={towerAttachedClusters}
          worldTruthMode={worldTruthMode}
          atlasReady={!atlas.isLoading && !atlas.isError}
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
          {!googleVisible &&
            fanOutAtlasCollisions(
              customerClusters.filter(
                cluster =>
                  !cluster.outsideAtlas && !primaryObjectCoversCluster(cluster)
              )
            ).map(({ cluster, fanSlot }) => {
              const lanternState = clusterLanternState(cluster);
              const lanternArt = lanternAssetForClusterState(lanternState);
              const entity = entityForCluster(cluster);
              const transientArt = transientLanternOverlay(
                deriveTransientLanternEvidence(entity?.projection)
              );
              return (
              <Fragment key={cluster.key}>
                {fanSlot > 0 ? (
                  <>
                    <span
                      className="lc-anchor"
                      style={{ left: `${cluster.x}%`, top: `${cluster.y}%` }}
                      aria-hidden
                    />
                    <span
                      className={`lc-stem fan-${fanSlot}`}
                      style={{ left: `${cluster.x}%`, top: `${cluster.y}%` }}
                      aria-hidden
                    />
                  </>
                ) : null}
                <button
                  type="button"
                  ref={
                    entityForCluster(cluster)?.id === requestedEntityId
                      ? revealRef
                      : undefined
                  }
                  className={worldMarkerClass(
                    `lc-v5-lantern lc-lantern ${lanternDensityClass(cluster.total)} state-${lanternState}${fanSlot > 0 ? ` fan-${fanSlot}` : ""}`,
                    entityForCluster(cluster),
                    revealing &&
                      entityForCluster(cluster)?.id === requestedEntityId,
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
                    if (lanternNeedsRekindling(lanternState)) {
                      setRekindlingCluster(cluster);
                      setShowInspector(false);
                    } else {
                      setRekindlingCluster(null);
                      setShowInspector(true);
                    }
                  }}
                  aria-label={markerLabel(
                    `${cluster.total} customer${cluster.total === 1 ? "" : "s"} at this location`,
                    entityForCluster(cluster)
                  )}
                >
                  <img className="lc-v5-lantern-art" src={lanternArt} alt="" />
                  {transientArt ? (
                    <img
                      className="lc-v5-lantern-transient"
                      src={transientArt}
                      alt=""
                    />
                  ) : null}
                  {cluster.total > 1 ? (
                    <b className="lc-v5-lantern-count">{cluster.total}</b>
                  ) : null}
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
                          i =>
                            i.physicalEntityId === entityForCluster(cluster)!.id
                        )?.kind ?? null
                      }
                    />
                  ) : null}
                </button>
              </Fragment>
            );
            })}

          {!googleVisible &&
            visiblePursuits.map(item => {
              const worldEntity = entityForPursuit(item.accountId);
              const attachedCluster =
                item.location != null ? clusterAtPoint(item.location) : null;
              return (
                <button
                  type="button"
                  key={item.pipelineId}
                  ref={
                    worldEntity?.id === requestedEntityId
                      ? revealRef
                      : undefined
                  }
                  className={worldMarkerClass(
                    `lc-pursued-building${worldEntity?.canonicalAsset?.assetUrl ? " has-published-art" : ""}${
                      /*
                      The suppressed lantern's cadence, carried onto the
                      building that replaced it, so the place still reads as
                      active / dimming / dormant.
                    */
                      (() => {
                        const covered = attachedCluster;
                        if (!covered) return "";
                        return covered.dark === covered.total
                          ? " cadence-dark"
                          : covered.dimming > 0 || covered.dark > 0
                            ? " cadence-dimming"
                            : " cadence-active";
                      })()
                    }${attachedCluster ? " has-attached-customers" : ""}`,
                    worldEntity,
                    revealing && worldEntity?.id === requestedEntityId,
                    selectedPursuit?.pipelineId === item.pipelineId
                  )}
                  data-world-entity-id={worldEntity?.id}
                  style={{
                    left: `${item.location!.x + (pursuitFanOffset.get(item.pipelineId) ?? 0)}%`,
                    top: `${item.location!.y}%`,
                  }}
                  onClick={() => {
                    setSelectedCluster(null);
                    setSelectedPursuit(item);
                  }}
                  onPointerDown={event => {
                    if (guardianLocked) return;
                    if (!event.altKey || !worldEntity) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const target =
                      (cityWorld.data ?? []).find(
                        e => e.id !== worldEntity.id && e.location
                      ) ?? worldEntity;
                    arcade.fireAt({
                      shooterId: worldEntity.id,
                      targetId: target.id,
                      weapon: arcade.weaponFor({ displayName: item.name })
                        .archetype,
                    });
                  }}
                  aria-label={markerLabel(`Pursued: ${item.name}`, worldEntity)}
                >
                  {attachedCluster ? (
                    <TowerAttachedCustomerLantern cluster={attachedCluster} />
                  ) : null}
                  {worldEntity?.canonicalAsset?.assetUrl ? (
                    <img src={worldEntity.canonicalAsset.assetUrl} alt="" />
                  ) : (
                    <span aria-hidden>
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                  <b>{item.name}</b>
                  <WorldMarkerAtmosphere entity={worldEntity} />
                  <WorldObligationTether
                    obligations={worldEntity?.obligations}
                    buildingName={item.name}
                  />
                  {worldEntity ? (
                    <ArcadeBodyLayer
                      body={arcade.world.bodies[worldEntity.id]}
                      weapon={
                        arcade.weaponFor({ displayName: item.name }).archetype
                      }
                      idle={
                        arcade.idle.find(
                          i => i.physicalEntityId === worldEntity.id
                        )?.kind ?? null
                      }
                    />
                  ) : null}
                </button>
              );
            })}

          {!atlas.isLoading &&
          visibleCustomers.length + visiblePursuits.length === 0 ? (
            <div className="lc-map-empty">
              <strong>
                {atlas.isError
                  ? "Geographic truth unavailable"
                  : "No geocoded records match this view"}
              </strong>
              <span>
                Records without successful provider coordinates remain outside
                the illustrated map.
              </span>
            </div>
          ) : null}
          {/*
            The unknown, drawn as weather. Mounted before the reacting world so
            it sits under every piece that stands on the ground — see
            WorldVeilLayer for why a hole is always a real fact.
          */}
          <WorldVeilLayer
            customerLocations={customerLocations}
            totalCustomers={customers.length}
            atlasReady={!atlas.isLoading && !atlas.isError}
            conqueredTerritoryIds={conqueredTerritoryIds}
            lostGroundTerritoryIds={lostGroundTerritoryIds}
            onConfront={neighbourhood => {
              setSelectedCluster(null);
              setSelectedPursuit(null);
              setFrontierBriefing(neighbourhood);
              setGuardianLocked(true);
            }}
          />
          <EconomicWorldReaction entities={cityWorld.data ?? []} />
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
      </section>

      {rekindlingCluster ? (
        <RekindlingArsenal
          customerLabel={`${rekindlingCluster.total} customer${rekindlingCluster.total === 1 ? "" : "s"} here`}
          onClose={() => setRekindlingCluster(null)}
          onInspect={() => {
            setShowInspector(true);
            setRekindlingCluster(null);
          }}
          onSelectTool={(tool: RekindlingToolId) => {
            setShowInspector(true);
            setRekindlingCluster(null);
            if (tool === "signal" || tool === "bell" || tool === "courier" || tool === "seal") {
              /* real workflows live in WorldEntityInspector RecoveryPath */
            }
          }}
        />
      ) : null}

      <LanternGameRoom
        command={activeCommand}
        onClose={() => setActiveCommand("map")}
      >
        {activeCommand === "missions" ? (
          <div className="lc-v5-game-room-body">
            <h2>Missions</h2>
            {currentChapter ? (
              <>
                <strong>{campaign.data?.campaign.title ?? "Current chapter"}</strong>
                <p>{currentChapter.fictionalTreatment}</p>
              </>
            ) : (
              <p>No active campaign chapter right now.</p>
            )}
            <CampaignChronicleList />
          </div>
        ) : null}
        {activeCommand === "companions" ? (
          <div className="lc-v5-game-room-body">
            <h2>Companions</h2>
            <p>No companion roster is configured yet. The city still runs on real customer evidence.</p>
          </div>
        ) : null}
        {activeCommand === "arsenal" ? (
          rekindlingCluster || selectedCluster ? (
            <RekindlingEmptyState onClose={() => setActiveCommand("map")} />
          ) : (
            <RekindlingEmptyState onClose={() => setActiveCommand("map")} />
          )
        ) : null}
        {activeCommand === "buildings" ? (
          <LanternBuildingsRoom onNavigate={onNavigate} />
        ) : null}
        {activeCommand === "conquest" ? (
          <LanternConquestRoom
            frontierObjectives={frontierObjectives}
            onSelect={occupation => {
              setActiveCommand("map");
              setFrontierBriefing(occupation);
              setGuardianLocked(true);
            }}
          />
        ) : null}
      </LanternGameRoom>

      {worldTruthMode ? (
      <details className="lc-v5-drawer">
        <summary>Map tools & geographic truth</summary>
        <p>
          {unmappedCustomers + unmappedPursuits} records need location ·{" "}
          {Object.entries(data?.statusCounts ?? {})
            .map(([status, value]) => `${status}: ${value}`)
            .join(" · ")}
        </p>
        <button
          type="button"
          disabled={geocode.isPending}
          onClick={() => geocode.mutate({ batchSize: 20 })}
        >
          <RefreshCw className={geocode.isPending ? "animate-spin" : ""} />
          {geocode.isPending ? "Geocoding…" : "Geocode pending locations"}
        </button>
      </details>
      ) : null}

      <LanternCommandDeck
        active={activeCommand}
        onSelect={command => {
          setActiveCommand(command);
          if (command === "map") {
            setSelectedCluster(null);
            setSelectedPursuit(null);
            setRekindlingCluster(null);
          }
          if (command === "arsenal" && selectedCluster) {
            const state = clusterLanternState(selectedCluster);
            if (lanternNeedsRekindling(state)) setRekindlingCluster(selectedCluster);
          }
        }}
      />

      {(showInspector || requestedEntity) &&
      (selectedCluster || selectedPursuit || requestedEntity) ? (
        <WorldEntityInspector
          entity={selectedEntity}
          cluster={
            selectedCluster ??
            (selectedPursuit?.location
              ? clusterAtPoint(selectedPursuit.location)
              : null)
          }
          pursuit={selectedPursuit}
          onClose={() => {
            setSelectedCluster(null);
            setSelectedPursuit(null);
            setShowInspector(false);
            if (requestedEntityId)
              window.history.replaceState({}, "", "/growth/lantern-city");
          }}
          onOpenCustomer={onOpenCustomer}
        />
      ) : null}
    </main>
  );
}

function useAtlasData() {
  return trpc.system.geographicTruth.atlas.useQuery().data;
}
