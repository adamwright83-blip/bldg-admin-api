import { useEffect, useMemo, useState } from "react";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";
import { challengeSummary, type PresentedTerritory } from "@shared/goldlineTerritories";
import { guardianById } from "@shared/goldlineGuardians";
import { buildVeilGeometry, pointInPolygon } from "@shared/goldlineTerritoryGeometry";
import { trpc } from "@/lib/trpc";
import type { CityWorldEntity } from "../../../../server/goldlineWorld/cityWorldService";
import { TerritoryVeilLayer } from "./TerritoryVeilLayer";
import { GuardianActor } from "./GuardianActor";
import { GuardianEncounter } from "./GuardianEncounter";
import "./goldline-territories.css";

export function TerritoryWorldLayer({
  entities,
  googleVisible,
  interactionLocked,
  onInteractionLock,
  reducedMotion,
}: {
  entities: readonly CityWorldEntity[];
  googleVisible: boolean;
  interactionLocked: boolean;
  onInteractionLock: (locked: boolean) => void;
  reducedMotion: boolean;
}) {
  const territories = trpc.system.goldlineWorld.territories.useQuery(undefined, {
    staleTime: 10_000,
  });
  const defeat = trpc.system.goldlineWorld.recordGuardianDefeat.useMutation();
  const utils = trpc.useUtils();
  const campaign = trpc.system.goldlineWorld.campaign.useQuery(undefined, {
    staleTime: 15_000,
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [noticedId, setNoticedId] = useState<string | null>(null);
  const presented = territories.data ?? [];

  if (googleVisible) return null;

  return (
    <>
      {presented.map(item => (
        <TerritoryOnAtlas
          key={item.definition.id}
          item={item}
          entities={entities}
          active={activeId === item.definition.id}
          noticed={noticedId === item.definition.id && activeId !== item.definition.id}
          reducedMotion={reducedMotion}
          onNotice={() => setNoticedId(item.definition.id)}
          onEnter={() => {
            setActiveId(item.definition.id);
            onInteractionLock(true);
          }}
          onClose={() => {
            setActiveId(null);
            onInteractionLock(false);
          }}
          onDefeat={() => {
            if (!item.state.confrontationReady) return;
            const finale = campaign.data?.campaign.chapters.find(
              chapter =>
                chapter.chapterKind === "guardian_finale" &&
                chapter.territoryId === item.definition.id
            );
            defeat.mutate(
              {
                territoryId: item.definition.id,
                guardianId: item.definition.guardianId,
                confrontationReady: true,
                campaignChapterId: finale?.stableChapterId,
              },
              {
                onSettled: () => {
                  void utils.system.goldlineWorld.territories.invalidate();
                  void utils.system.goldlineWorld.campaign.invalidate();
                },
              }
            );
          }}
        />
      ))}
    </>
  );
}

function TerritoryOnAtlas({
  item,
  entities,
  active,
  noticed,
  reducedMotion,
  onNotice,
  onEnter,
  onClose,
  onDefeat,
}: {
  item: PresentedTerritory;
  entities: readonly CityWorldEntity[];
  active: boolean;
  noticed: boolean;
  reducedMotion: boolean;
  onNotice: () => void;
  onEnter: () => void;
  onClose: () => void;
  onDefeat: () => void;
}) {
  const guardian = guardianById(item.definition.guardianId);
  const members = item.definition.members.flatMap(member => {
    const entity = entities.find(row => row.id === member.physicalEntityId);
    const latitude = entity?.location?.latitude;
    const longitude = entity?.location?.longitude;
    if (typeof latitude !== "number" || typeof longitude !== "number") return [];
    const atlas = projectLatLngToLanternAtlas({ latitude, longitude });
    if (atlas.outOfBounds) return [];
    return [{ physicalEntityId: member.physicalEntityId, atlas: { x: atlas.x, y: atlas.y } }];
  });
  const geometry = members.length
    ? buildVeilGeometry({ mode: item.definition.geometryMode, members })
    : null;
  const obligationPresent = item.definition.members.some(member =>
    Boolean(entities.find(entity => entity.id === member.physicalEntityId)?.obligations?.count)
  );

  useEffect(() => {
    if (active || !geometry) return;
    const onMove = (event: PointerEvent) => {
      const space = document.querySelector(".cr-world-space");
      if (!(space instanceof HTMLElement)) return;
      const rect = space.getBoundingClientRect();
      const point = {
        x: ((event.clientX - rect.left) / rect.width) * 100,
        y: ((event.clientY - rect.top) / rect.height) * 100,
      };
      if (pointInPolygon(point, geometry.polygon)) onNotice();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [active, geometry, onNotice]);

  if (!geometry) return null;
  const ghost = item.state.cleared;

  return (
    <>
      <TerritoryVeilLayer
        definition={item.definition}
        state={item.state}
        entities={entities}
        reducedMotion={reducedMotion}
      />
      {ghost && !active ? (
        <div
          className="gl-guardian is-ghost"
          style={{ left: `${geometry.centroid.x}%`, top: `${geometry.centroid.y}%` }}
        >
          <GuardianActor
            guardianId={guardian.id}
            phase="ghost"
            clearedGhost
            reducedMotion={reducedMotion}
            scale={0.4}
          />
        </div>
      ) : null}
      {active ? (
        <GuardianEncounter
          definition={item.definition}
          state={item.state}
          centroid={geometry.centroid}
          reducedMotion={reducedMotion}
          obligationPresent={obligationPresent}
          onDefeat={onDefeat}
          onClose={onClose}
        />
      ) : (
        <div
          className="gl-guardian-anchor"
          style={{ left: `${geometry.centroid.x}%`, top: `${Math.max(10, geometry.centroid.y - 8)}%` }}
        >
          <GuardianActor
            guardianId={guardian.id}
            phase={noticed ? "notice" : "idle"}
            reducedMotion={reducedMotion}
          />
          <button
            type="button"
            className="gl-guardian-hit"
            onClick={onEnter}
            aria-label={`${guardian.name} over ${item.definition.fantasyTitle}`}
          />
        </div>
      )}
    </>
  );
}

export function TerritoryChrome() {
  const territories = trpc.system.goldlineWorld.territories.useQuery(undefined, {
    staleTime: 10_000,
  });
  const item = territories.data?.find(row => !row.state.cleared) ?? territories.data?.[0] ?? null;
  if (!item) return null;
  const guardian = guardianById(item.definition.guardianId);
  return (
    <aside className="gl-territory-chrome" aria-live="polite">
      <strong>
        {item.definition.fantasyTitle}
        {item.definition.realGeographyLabel ? ` · ${item.definition.realGeographyLabel}` : ""}
      </strong>
      <p>
        {guardian.name} — {guardian.epithet}
      </p>
      <p>{challengeSummary({ definition: item.definition, state: item.state })}</p>
    </aside>
  );
}

export function useReducedMotionFlag() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function presentedCentroid(
  item: PresentedTerritory,
  entities: readonly CityWorldEntity[]
) {
  const members = item.definition.members.flatMap(member => {
    const entity = entities.find(row => row.id === member.physicalEntityId);
    const latitude = entity?.location?.latitude;
    const longitude = entity?.location?.longitude;
    if (typeof latitude !== "number" || typeof longitude !== "number") return [];
    const atlas = projectLatLngToLanternAtlas({ latitude, longitude });
    return atlas.outOfBounds ? [] : [{ physicalEntityId: member.physicalEntityId, atlas: { x: atlas.x, y: atlas.y } }];
  });
  return members.length
    ? buildVeilGeometry({ mode: item.definition.geometryMode, members }).centroid
    : null;
}

export function firstPresented(items: readonly PresentedTerritory[]) {
  return items[0] ?? null;
}

export function useTerritoryFocus(items: readonly PresentedTerritory[]) {
  return useMemo(() => items.find(item => !item.state.cleared) ?? items[0] ?? null, [items]);
}
