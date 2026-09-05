/**
 * THE WAR TABLE.
 *
 * Territories drawn as discrete board pieces — authored island silhouettes with
 * bridges between them — laid over real Los Angeles.
 *
 * WHERE THE PIECES SIT IS NOT A DESIGN CHOICE
 *
 * Every island is anchored on its territory's own centroid, which
 * `buildVeilGeometry` computes from the real latitude/longitude of that
 * territory's real members. Real coordinates remain the authoritative spatial
 * substrate for Places, routing, Street View and customer placement; the
 * fantasy terrain is a geographically ALIGNED game layer over the top of it and
 * is allowed to cover real streets. Nothing here moves a real coordinate, and
 * if a future entity lands awkwardly inside the terrain the terrain is what
 * adapts.
 *
 * WHAT THE BOARD IS ALLOWED TO SAY ABOUT OWNERSHIP
 *
 * There is no per-district faction in the data model, and this layer does not
 * invent one. A district is not owned by Century Park East or by OPUS — gold and
 * violet stay on the two strongholds, where the rivalry actually is.
 *
 * What a territory DOES have is `readiness`, derived from real evidence, and
 * that is what the board colours:
 *
 *   veiled              nothing known here yet          dark, fogged, unreadable
 *   in_progress         real evidence is accumulating   lit, neutral stone
 *   confrontation_ready a guardian is standing          contested, pressure
 *   cleared             you took it, permanently        gold, warm, settled
 *
 * That answers "what's mine / what's dark / where is the pressure" from evidence
 * that already exists, instead of from a conquest model nobody is keeping.
 */
import { useMemo } from "react";
import {
  buildVeilGeometry,
  type AtlasPoint,
} from "@shared/goldlineTerritoryGeometry";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";
import type { PresentedTerritory, TerritoryReadiness } from "@shared/goldlineTerritories";
import {
  BOARD_OVERLAYS,
  BRIDGE_MODULES,
  assignIslands,
  bridgeAxisBetween,
  type BoardPlacement,
} from "@shared/goldlineBoardKit";
import type { CityWorldEntity } from "../../../../../server/goldlineWorld/cityWorldService";

/** How the board renders each readiness state. Presentation only. */
const READINESS_PRESENTATION: Record<
  TerritoryReadiness,
  { tone: string; label: string }
> = {
  veiled: { tone: "veiled", label: "Unknown" },
  in_progress: { tone: "active", label: "In progress" },
  confrontation_ready: { tone: "contested", label: "Guardian standing" },
  cleared: { tone: "held", label: "Cleared" },
};

export type BoardNode = {
  territory: PresentedTerritory;
  placement: BoardPlacement;
  centroid: AtlasPoint;
  readiness: TerritoryReadiness;
};

/**
 * Turn presented territories into board nodes.
 *
 * A territory whose members have no successful geocode has no centroid, so it
 * has no island — the same discipline the lanterns already follow. It is
 * dropped from the board rather than parked at a default position, because an
 * island at (50,50) is a claim that something is there.
 */
export function buildBoardNodes(
  territories: readonly PresentedTerritory[],
  entities: readonly CityWorldEntity[]
): BoardNode[] {
  const located = territories.flatMap(territory => {
    const members = territory.definition.members.flatMap(member => {
      const entity = entities.find(row => row.id === member.physicalEntityId);
      const latitude = entity?.location?.latitude;
      const longitude = entity?.location?.longitude;
      if (typeof latitude !== "number" || typeof longitude !== "number") return [];
      const atlas = projectLatLngToLanternAtlas({ latitude, longitude });
      if (atlas.outOfBounds) return [];
      return [
        {
          physicalEntityId: member.physicalEntityId,
          atlas: { x: atlas.x, y: atlas.y },
        },
      ];
    });
    if (!members.length) return [];
    const geometry = buildVeilGeometry({
      mode: territory.definition.geometryMode,
      members,
    });
    return [{ territory, centroid: geometry.centroid }];
  });

  const placements = assignIslands(
    located.map(item => ({
      stableKey: item.territory.definition.stableKey,
      position: item.centroid,
    }))
  );
  const byKey = new Map(placements.map(p => [p.stableKey, p]));

  return located.flatMap(item => {
    const placement = byKey.get(item.territory.definition.stableKey);
    if (!placement) return [];
    return [
      {
        territory: item.territory,
        placement,
        centroid: item.centroid,
        readiness: item.territory.state.readiness,
      },
    ];
  });
}

/**
 * Which islands get a bridge between them.
 *
 * Nearest-neighbour, one link per node, deduplicated — enough to make the board
 * read as a connected network rather than as scattered tiles, without drawing a
 * mesh nobody can parse. A bridge is a visual adjacency between two game
 * pieces; it asserts no road, no route and no travel time.
 */
export function bridgeLinks(
  nodes: readonly BoardNode[]
): Array<{ key: string; from: AtlasPoint; to: AtlasPoint }> {
  const links = new Map<string, { key: string; from: AtlasPoint; to: AtlasPoint }>();
  for (const node of nodes) {
    let nearest: BoardNode | null = null;
    let best = Infinity;
    for (const other of nodes) {
      if (other === node) continue;
      const distance = Math.hypot(
        other.centroid.x - node.centroid.x,
        other.centroid.y - node.centroid.y
      );
      if (distance < best) {
        best = distance;
        nearest = other;
      }
    }
    if (!nearest) continue;
    // Sorted key so A->B and B->A are one bridge, not two stacked.
    const pair = [
      node.territory.definition.stableKey,
      nearest.territory.definition.stableKey,
    ].sort();
    const key = pair.join("|");
    if (links.has(key)) continue;
    links.set(key, { key, from: node.centroid, to: nearest.centroid });
  }
  return Array.from(links.values());
}

export function TerritoryBoardLayer({
  territories,
  entities,
  selectedKey = null,
  onSelect,
}: {
  territories: readonly PresentedTerritory[];
  entities: readonly CityWorldEntity[];
  selectedKey?: string | null;
  onSelect?: (territory: PresentedTerritory) => void;
}) {
  const nodes = useMemo(
    () => buildBoardNodes(territories, entities),
    [territories, entities]
  );
  const links = useMemo(() => bridgeLinks(nodes), [nodes]);

  if (!nodes.length) return null;

  /*
    Isometric depth: a piece lower on the board is nearer the viewer and must
    overlap the pieces behind it. Sorting by centroid y and letting DOM order
    do the stacking is cheaper and more reliable than a z-index per node.
  */
  const ordered = [...nodes].sort((a, b) => a.centroid.y - b.centroid.y);

  return (
    <div className="gl-board" aria-label="Territory board">
      {/* Bridges sit behind every island so a span always runs INTO landfall. */}
      <div className="gl-board-bridges" aria-hidden>
        {links.map(link => {
          const axis = bridgeAxisBetween(link.from, link.to);
          const midX = (link.from.x + link.to.x) / 2;
          const midY = (link.from.y + link.to.y) / 2;
          const span = Math.hypot(
            link.to.x - link.from.x,
            link.to.y - link.from.y
          );
          return (
            <img
              key={link.key}
              className="gl-board-bridge"
              src={BRIDGE_MODULES[axis]}
              alt=""
              style={{
                left: `${midX}%`,
                top: `${midY}%`,
                width: `${Math.max(6, span * 0.9)}%`,
              }}
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          );
        })}
      </div>

      {ordered.map(node => {
        const { placement, readiness } = node;
        const presentation = READINESS_PRESENTATION[readiness];
        const selected = selectedKey === node.territory.definition.stableKey;
        const transform = [
          "translate(-50%, -50%)",
          placement.rotation ? `rotate(${placement.rotation}deg)` : "",
          placement.mirrored ? "scaleX(-1)" : "",
          `scale(${placement.scale})`,
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <button
            type="button"
            key={node.territory.definition.stableKey}
            className={`gl-board-island tone-${presentation.tone}${selected ? " is-selected" : ""}`}
            data-variant={placement.variant.id}
            data-art={placement.variant.status}
            style={{ left: `${node.centroid.x}%`, top: `${node.centroid.y}%` }}
            onClick={() => onSelect?.(node.territory)}
            aria-label={`${node.territory.definition.fantasyTitle}: ${presentation.label}`}
          >
            {/*
              The piece itself. Rotation, mirroring and scale ride on this inner
              element so the label and the state ring stay upright and unmirrored
              no matter how the silhouette is dressed.
            */}
            <span className="gl-board-piece" style={{ transform }} aria-hidden>
              {placement.variant.overlaySlots.coastlineGlow ? (
                <img className="gl-board-coast" src={BOARD_OVERLAYS.coastlineGlow} alt="" loading="lazy" draggable={false} />
              ) : null}
              <img
                className="gl-board-tile"
                src={placement.variant.art}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
              />
              {/* Tint is dressing over an authored shape, never a substitute. */}
              <span className="gl-board-tint" />
              {readiness === "veiled" ? (
                <img className="gl-board-fog" src={BOARD_OVERLAYS.fog} alt="" loading="lazy" draggable={false} />
              ) : null}
            </span>

            <span className="gl-board-plate">
              <strong>{node.territory.definition.fantasyTitle}</strong>
              <small>{presentation.label}</small>
              {node.territory.definition.realGeographyLabel ? (
                <em>{node.territory.definition.realGeographyLabel}</em>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
