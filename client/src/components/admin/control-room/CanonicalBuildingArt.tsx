/**
 * The one composition of a building, used at every camera distance.
 *
 * Home, Lantern City and Tower Wars all render a building through this component, so
 * a building cannot change identity, architecture or weapon merely because the camera
 * layer changed.
 *
 * The per-building scale lives on the CONTAINER, not on the plate image. Every layer
 * — plate, scars, wounds, weapon — is a child, so they inherit one transform and can
 * never drift apart. (They previously could: the OPUS plate carried scale(1.12) while
 * an overlay did not, leaving the two boxes 301x517 against 269x462.)
 */
import { FacadeScarLayer } from "./FacadeScarLayer";
import { FreshDamageLayer } from "./FreshDamageLayer";
import { ART_SPACE, BUILDING_ART, type CanonicalBuildingId } from "./buildingArt";
import type { SettledStratum } from "./facadeScars";

export function CanonicalBuildingArt({
  buildingId,
  businessDate = "",
  strata = [],
  incomingToday = 0,
  strikesRevealed,
  showWeapon = true,
  charge = 0,
  children,
}: {
  buildingId: CanonicalBuildingId;
  /** Seeds today's wound placement. Unused while `incomingToday` is 0. */
  businessDate?: string;
  /** Prior settled days — permanent scars. */
  strata?: readonly SettledStratum[];
  /** Strikes absorbed TODAY. Drives the fresh-damage layer. */
  incomingToday?: number;
  /** Replay prefix: show damage only through event N. */
  strikesRevealed?: number;
  showWeapon?: boolean;
  /**
   * 0..1 toward the next strike. Makes the $50 threshold physical instead of a
   * line of text, so an order that charges without firing still visibly resolves.
   */
  charge?: number;
  /** Arena-only chrome (projectile, vfx) that must share the same transform. */
  children?: React.ReactNode;
}) {
  const art = BUILDING_ART[buildingId];
  return (
    <div className={`cb-art is-${buildingId}`}>
      <img
        className="cb-plate"
        src={art.plate}
        alt={`${art.displayName}, ${
          incomingToday > 0 ? `${incomingToday} strikes taken today` : "undamaged today"
        }`}
      />
      <FacadeScarLayer
        strata={strata}
        buildingId={buildingId}
        buildingName={art.displayName}
      />
      <FreshDamageLayer
        buildingId={buildingId}
        buildingName={art.displayName}
        businessDate={businessDate}
        incomingToday={incomingToday}
        strikesRevealed={strikesRevealed}
      />
      {showWeapon ? (
        <span
          className={`cb-weapon is-${buildingId}`}
          aria-label={
            buildingId === "opus_la"
              ? "Giant architectural golf driver, addressing the ball"
              : "Rooftop valet bazooka"
          }
        />
      ) : null}
      {showWeapon ? (
        <WeaponChargeLayer buildingId={buildingId} charge={charge} />
      ) : null}
      {children}
    </div>
  );
}

/**
 * The charge meter, drawn at the weapon's own mount in the 800x1200 art space so it
 * letterboxes exactly like every other layer. A CSS-percentage version floated above
 * the building, because the weapon element fills the piece box while the art does not.
 */
function WeaponChargeLayer({
  buildingId,
  charge,
}: {
  buildingId: CanonicalBuildingId;
  charge: number;
}) {
  const value = Math.max(0, Math.min(1, charge));
  if (value <= 0) return null;
  const { pivot } = BUILDING_ART[buildingId].weaponGeometry;
  const W = 150;
  const H = 26;
  const x = pivot.x - W / 2;
  const y = pivot.y - H / 2;
  return (
    <svg
      className={`cb-charge-layer ${value >= 1 ? "is-full" : ""}`}
      viewBox={`0 0 ${ART_SPACE.width} ${ART_SPACE.height}`}
      preserveAspectRatio="xMidYMax meet"
      role="img"
      aria-label={
        value >= 1
          ? "Weapon armed"
          : `Weapon ${Math.round(value * 100)} percent charged`
      }
    >
      <rect className="cb-charge-track" x={x} y={y} width={W} height={H} rx={H / 2} />
      <rect
        className="cb-charge-fill"
        x={x + 3}
        y={y + 3}
        width={Math.max(0, (W - 6) * value)}
        height={H - 6}
        rx={(H - 6) / 2}
      />
    </svg>
  );
}
