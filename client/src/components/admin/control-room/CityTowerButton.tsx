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

export function CityTowerButton({
  buildingId,
  className,
  subtitle,
  onNavigate,
  returnPath = "/",
  style,
  vitality,
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
}) {
  const artRef = useRef<HTMLDivElement>(null);
  const { begin, approaching, arrive } = useWorldTransition();
  const art = BUILDING_ART[buildingId];
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
        <CanonicalBuildingArt buildingId={buildingId} />
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
