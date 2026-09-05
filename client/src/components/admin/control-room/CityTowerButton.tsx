/**
 * A building as it appears at city camera distance.
 *
 * Clicking it is not navigation to a page — it is a claim that the camera is moving
 * toward THIS canonical entity. So it does three things a plain link cannot:
 * it measures where the building currently sits, it carries the entity's identity to
 * the destination, and it records where to return to.
 *
 * Both Home towers previously navigated to the same path with no payload, so the
 * destination could not tell which building had been chosen.
 */
import { useLayoutEffect, useRef } from "react";
import { CanonicalBuildingArt } from "./CanonicalBuildingArt";
import { useWorldTransition } from "./WorldTransitionProvider";
import { BUILDING_ART, type CanonicalBuildingId } from "./buildingArt";
import type { BuildingVitality } from "./lanternVitality";
import { combatTowerArtFor, COMBAT_TOWER_ART } from "./lanternCityCombat";
import type { TowerDamageState } from "@shared/towerWars";

export function CityTowerButton({
  buildingId,
  className,
  subtitle,
  onNavigate,
  returnPath = "/",
  style,
  vitality,
  combat = false,
  damage = null,
  attacksToday = null,
}: {
  buildingId: CanonicalBuildingId;
  className: string;
  subtitle: React.ReactNode;
  onNavigate: (path: string) => void;
  returnPath?: string;
  style?: React.CSSProperties;
  /**
   * How this building's customers are doing. Optional: the button is used in
   * places that have no customer data, and there it simply renders as it always
   * did rather than inventing a state.
   */
  vitality?: BuildingVitality;
  /**
   * Draw the building as a COMBATANT rather than as a map marker.
   *
   * Lantern City is a 1v1 overworld and its towers are the fighters, so there
   * the button renders the supplied combat plate — building and integrated
   * weapon as one authored object. Everywhere else (the small Home overview
   * frame, where the tower is a locator at 80px) it keeps the layered canonical
   * composition it has always used, because a 900px hero plate in a 128px box
   * is illegible and would cost the whole overview its clarity.
   */
  combat?: boolean;
  /**
   * The authoritative Tower Wars damage state for this building.
   *
   * Passed down rather than fetched here so the button cannot become a second,
   * quieter source of damage truth. `undefined` means the caller has no answer,
   * which `combatTowerArtFor` treats as unknown — never as pristine.
   */
  damage?: TowerDamageState | null;
  /**
   * How many attacks this building has genuinely LAUNCHED today, from the same
   * authoritative `towerWars.today` state as `damage`.
   *
   * This is the only thing that puts a projectile on screen. Lantern City never
   * flies a car or a golf ball for atmosphere: a visible round means the tower
   * really fired today, and zero (or unknown) means nothing is drawn. The
   * animated exchange itself belongs to Tower Wars, one click away — the city
   * only shows that the shot happened.
   */
  attacksToday?: number | null;
}) {
  const artRef = useRef<HTMLDivElement>(null);
  const { begin, approaching, arrive } = useWorldTransition();
  const art = BUILDING_ART[buildingId];
  const combatArt = combatTowerArtFor(buildingId, damage);
  const firedToday = combat && attacksToday !== null && attacksToday > 0;
  useLayoutEffect(() => {
    if (approaching === buildingId) arrive(buildingId, artRef.current);
  }, [approaching, arrive, buildingId]);

  /*
    Windows are driven by a CSS variable rather than by rendering N window
    elements: the building art is a single image, and the lit share is a
    property of the whole facade. `null` (nothing known) stays absent so the
    stylesheet can distinguish it from a genuine zero — an unknown building must
    not render identically to a fully dormant one.
  */
  const litStyle =
    vitality && vitality.litFraction !== null
      ? ({ "--lc-lit": String(vitality.litFraction) } as React.CSSProperties)
      : undefined;

  return (
    <button
      type="button"
      className={className}
      data-vitality={vitality ? (vitality.litFraction === null ? "unknown" : "known") : undefined}
      data-ribbon={vitality?.ribbonActive ? "true" : undefined}
      data-faction={combat ? combatArt.faction : undefined}
      data-combat={combat ? "true" : undefined}
      data-damaged={combat && combatArt.showingDamage ? "true" : undefined}
      style={litStyle ? { ...style, ...litStyle } : style}
      onClick={() => {
        begin({
          entityId: buildingId,
          from: "city",
          to: "building",
          sourceEl: artRef.current,
          returnPath,
          kind: "traversal",
        });
        // State commits first: navigate immediately, camera follows.
        onNavigate(`/growth/tower-wars?building=${buildingId}`);
      }}
      aria-label={`Enter ${art.displayName}`}
    >
      <div className="pwc-building-canon" ref={artRef}>
        {combat ? (
          <img
            className="pwc-combat-plate"
            src={combatArt.src}
            alt={`${art.displayName}, ${art.id === "opus_la" ? "giant architectural golf driver" : "rooftop valet bazooka"}, ${combatArt.description}`}
            /*
              Eager and high priority: these two plates ARE the composition, and
              a tower that fades in after the map has settled reads as a bug
              rather than as a combatant standing there.
            */
            loading="eager"
            fetchPriority="high"
            decoding="async"
            draggable={false}
          />
        ) : (
          <CanonicalBuildingArt buildingId={buildingId} />
        )}
        {/*
          The round this building actually threw. Rendered from real attack
          evidence only, and rendered STILL — a permanently looping projectile
          would be decoration claiming to be an event.
        */}
        {firedToday ? (
          <img
            className="pwc-combat-round"
            src={COMBAT_TOWER_ART[buildingId].projectile}
            alt={`${art.displayName} fired ${attacksToday} time${attacksToday === 1 ? "" : "s"} today`}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : null}
      </div>
      <strong>{art.displayName}</strong>
      <small>{subtitle}</small>
      {/*
        The plain-language status. Always rendered when vitality is known, so
        colour and motion are never the only channel carrying the state — a
        reader who cannot distinguish a warm facade from a quiet one still gets
        the fact in words.
      */}
      {vitality ? (
        <small className="pwc-building-status" data-testid={`tower-status-${buildingId}`}>
          {vitality.statusLine}
        </small>
      ) : null}
    </button>
  );
}
