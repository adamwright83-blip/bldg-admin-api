import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  CUSTODY_LOCATION_ORDER,
  CUSTODY_LOCATIONS,
  nextCustodyLocation,
  previousCustodyLocation,
  type CustodyLocationKey,
} from "@shared/custodyLocations";
import { GarmentBagSprite } from "./GarmentBagSprite";
import { visibleCargo, type VehicleCargoItem } from "./VehicleCargo";

const CAR_FALLBACK =
  "/assets/goldline/vehicle-cargo/v1/car-inactive-glow-neutral.jpg";

export function CustodyLocationCarousel({
  byLocation,
  hasCargo,
  location,
  onLocationChange,
  onSelectItem,
  onAddToLocation,
}: {
  byLocation: Record<CustodyLocationKey, VehicleCargoItem[]>;
  hasCargo: boolean;
  location: CustodyLocationKey;
  onLocationChange: (location: CustodyLocationKey) => void;
  onSelectItem: (item: VehicleCargoItem, location: CustodyLocationKey) => void;
  onAddToLocation?: (location: CustodyLocationKey) => void;
}) {
  const gesture = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [dragX, setDragX] = useState(0);
  const def = CUSTODY_LOCATIONS[location];
  const items = byLocation[location] ?? [];
  const projection = visibleCargo(items, def.slots.length);
  const totalCount = CUSTODY_LOCATION_ORDER.reduce(
    (sum, key) => sum + (byLocation[key]?.length ?? 0),
    0
  );

  function finishSwipe(deltaX: number) {
    // Thumb flick right advances: car → coast → paragon → closet → car.
    if (deltaX >= 48) onLocationChange(nextCustodyLocation(location));
    else if (deltaX <= -48) onLocationChange(previousCustodyLocation(location));
    setDragX(0);
  }

  return (
    <div className="gl-custody-carousel">
      <div
        className={`gl-cargo-hero-art gl-custody-carousel-art ${hasCargo ? "has-cargo" : "is-empty"}`}
        aria-label={`${def.label} custody board`}
        onPointerDown={event => {
          if (event.button !== 0) return;
          gesture.current = {
            x: event.clientX,
            y: event.clientY,
            moved: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (!gesture.current) return;
          if (Math.abs(event.clientY - gesture.current.y) > 28) {
            gesture.current = null;
            setDragX(0);
            return;
          }
          const deltaX = event.clientX - gesture.current.x;
          if (Math.abs(deltaX) > 6) gesture.current.moved = true;
          setDragX(deltaX);
        }}
        onPointerUp={event => {
          if (!gesture.current) return;
          const deltaX = event.clientX - gesture.current.x;
          if (gesture.current.moved) finishSwipe(deltaX);
          gesture.current = null;
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setDragX(0);
        }}
        style={{
          transform: dragX ? `translateX(${dragX * 0.35}px)` : undefined,
        }}
      >
        {location === "vehicle" ? (
          <div className="gl-cargo-ambient-glow" aria-hidden="true" />
        ) : null}
        <img
          className={`gl-cargo-car ${location === "vehicle" ? "" : "is-location"}`}
          src={def.asset}
          alt={def.label}
          onError={event => {
            if (location !== "vehicle") return;
            if (event.currentTarget.src.endsWith(CAR_FALLBACK)) return;
            event.currentTarget.src = CAR_FALLBACK;
          }}
        />
        {location === "vehicle" ? (
          <div className="gl-cargo-sheen" aria-hidden="true" />
        ) : null}
        <div className="gl-cargo-garments">
          {projection.visible.map((item, index) => (
            <GarmentBagSprite
              key={item.id}
              item={item}
              style={def.slots[index]}
              editable={item.source === "field"}
              onSelect={selected => onSelectItem(selected, location)}
            />
          ))}
        </div>
        {projection.overflow > 0 ? (
          <strong className="gl-cargo-overflow">+{projection.overflow} MORE</strong>
        ) : null}
        {onAddToLocation ? (
          <button
            type="button"
            className="gl-custody-add-btn"
            aria-label={`Add item to ${def.label}`}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              onAddToLocation(location);
            }}
          >
            <Plus aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="gl-custody-carousel-meta">
        <p className="gl-custody-carousel-label">
          <strong>{def.label}</strong>
          <span>
            {items.length
              ? `${items.length} ${items.length === 1 ? "item" : "items"}`
              : "Empty"}
          </span>
        </p>
        <div
          className="gl-custody-carousel-dots"
          role="tablist"
          aria-label="Custody locations"
        >
          {CUSTODY_LOCATION_ORDER.map(key => {
            const count = byLocation[key]?.length ?? 0;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={key === location}
                aria-label={`${CUSTODY_LOCATIONS[key].label}${count ? `, ${count} items` : ""}`}
                className={key === location ? "is-active" : undefined}
                onClick={() => onLocationChange(key)}
              >
                <i />
                {count > 0 ? <b>{count}</b> : null}
              </button>
            );
          })}
        </div>
        <p className="gl-custody-carousel-hint">
          Flick right for next stop · {totalCount} total in custody
        </p>
      </div>
    </div>
  );
}
