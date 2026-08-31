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

export function CityTowerButton({
  buildingId,
  className,
  subtitle,
  onNavigate,
  returnPath = "/",
  style,
}: {
  buildingId: CanonicalBuildingId;
  className: string;
  subtitle: React.ReactNode;
  onNavigate: (path: string) => void;
  returnPath?: string;
  style?: React.CSSProperties;
}) {
  const artRef = useRef<HTMLDivElement>(null);
  const { begin, approaching, arrive } = useWorldTransition();
  const art = BUILDING_ART[buildingId];
  useLayoutEffect(() => {
    if (approaching === buildingId) arrive(buildingId, artRef.current);
  }, [approaching, arrive, buildingId]);

  return (
    <button
      type="button"
      className={className}
      style={style}
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
    </button>
  );
}
