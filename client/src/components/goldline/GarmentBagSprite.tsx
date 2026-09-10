import type { CSSProperties } from "react";
import type { VehicleCargoItem } from "./VehicleCargo";

/**
 * The name a garment bag may show. Real data only — `firstName`/`lastName`
 * come from the joined `orders` row for order-sourced cargo, and
 * `customerDisplayName` is the free-text name captured for field cargo
 * (see server/goldlineCargo/cargoService.ts). When neither is present this
 * returns null; callers must not substitute a placeholder name.
 */
export function cargoDisplayName(item: VehicleCargoItem): string | null {
  const explicit = item.customerDisplayName?.trim();
  if (explicit) return explicit;
  const composed = `${item.firstName ?? ""} ${item.lastName ?? ""}`.trim();
  return composed || null;
}

/** One hanging garment bag sprite, positioned by the caller. */
export function GarmentBagSprite({
  item,
  style,
}: {
  item: VehicleCargoItem;
  style?: CSSProperties;
}) {
  const processed = item.state === "IN_VEHICLE_PROCESSED";
  const name = cargoDisplayName(item);
  return (
    <div
      className={`gl-cargo-garment ${processed ? "is-processed" : "is-unprocessed"}`}
      style={style}
      role="img"
      aria-label={`${name ?? "Customer"} cargo`}
    >
      <svg
        className="gl-cargo-garment-art"
        viewBox="0 0 100 150"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`bag-fill-${processed ? "p" : "u"}`} x2="0.3" y2="1">
            <stop offset="0" stopColor={processed ? "#123a4a" : "#0e2b34"} />
            <stop offset="1" stopColor={processed ? "#052027" : "#041519"} />
          </linearGradient>
        </defs>
        <path
          d="M46 8 Q50 2 54 8 L58 20 Q50 16 42 20 Z"
          fill="none"
          stroke={processed ? "#f2c766" : "#8a9a95"}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M50 20 L50 30"
          stroke={processed ? "#f2c766" : "#8a9a95"}
          strokeWidth="3"
        />
        <path
          d="M27 34 Q50 20 73 34 L86 66 Q90 108 78 138 Q50 148 22 138 Q10 108 14 66 Z"
          fill={`url(#bag-fill-${processed ? "p" : "u"})`}
          stroke={processed ? "#e0ac3e" : "#5c7269"}
          strokeWidth="2.5"
        />
        <path
          d="M32 40 Q50 30 68 40"
          fill="none"
          stroke={processed ? "#ffe19a" : "#7c8f89"}
          strokeWidth="1.4"
          opacity="0.6"
        />
        <path
          d="M24 55 L30 130 M76 55 L70 130"
          stroke="#ffffff"
          strokeWidth="2"
          opacity="0.08"
          strokeLinecap="round"
        />
      </svg>
      {name ? (
        <span className="gl-cargo-garment-name" title={name}>
          {name}
        </span>
      ) : null}
    </div>
  );
}
