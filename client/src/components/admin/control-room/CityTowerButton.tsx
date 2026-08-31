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
import { useRef } from "react";
import { CanonicalBuildingArt } from "./CanonicalBuildingArt";
import { useWorldTransition } from "./WorldTransitionProvider";
import { BUILDING_ART, type CanonicalBuildingId } from "./buildingArt";

export function CityTowerButton({
  buildingId,
  className,
  subtitle,
  onNavigate,
  returnPath = "/",
}: {
  buildingId: CanonicalBuildingId;
  className: string;
  subtitle: React.ReactNode;
  onNavigate: (path: string) => void;
  returnPath?: string;
}) {
  const artRef = useRef<HTMLSpanElement>(null);
  const { begin } = useWorldTransition();
  const art = BUILDING_ART[buildingId];

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        begin({
          entityId: buildingId,
          from: "city",
          to: "building",
          sourceEl: artRef.current,
          returnPath,
        });
        // State commits first: navigate immediately, camera follows.
        onNavigate(`/growth/tower-wars?building=${buildingId}`);
      }}
      aria-label={`Enter ${art.displayName}`}
    >
      <span className="pwc-building-canon" ref={artRef}>
        <CanonicalBuildingArt buildingId={buildingId} />
      </span>
      <strong>{art.displayName}</strong>
      <small>{subtitle}</small>
    </button>
  );
}
