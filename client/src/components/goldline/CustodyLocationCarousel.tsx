import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  CUSTODY_LOCATION_ORDER,
  CUSTODY_LOCATIONS,
  nextCustodyLocation,
  previousCustodyLocation,
  type CustodyLocationKey,
} from "@shared/custodyLocations";
import {
  isCarouselTap,
  resolveCarouselSwipe,
} from "@shared/custodySwipe";
import { GarmentBagSprite } from "./GarmentBagSprite";
import { visibleCargo, type VehicleCargoItem } from "./VehicleCargo";

const CAR_FALLBACK =
  "/assets/goldline/vehicle-cargo/v1/car-inactive-glow-neutral.jpg";

type GestureTarget =
  | { kind: "bag"; item: VehicleCargoItem }
  | { kind: "add" }
  | null;

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
  const gesture = useRef<{
    x: number;
    y: number;
    startTime: number;
    moved: boolean;
    target: GestureTarget;
  } | null>(null);
  const [dragX, setDragX] = useState(0);
  const def = CUSTODY_LOCATIONS[location];
  const items = byLocation[location] ?? [];
  const projection = visibleCargo(items, def.slots.length);
  const totalCount = CUSTODY_LOCATION_ORDER.reduce(
    (sum, key) => sum + (byLocation[key]?.length ?? 0),
    0
  );

  function advance(direction: "next" | "prev") {
    onLocationChange(
      direction === "next"
        ? nextCustodyLocation(location)
        : previousCustodyLocation(location)
    );
  }

  function resolveGestureTarget(node: EventTarget | null): GestureTarget {
    if (!(node instanceof Element)) return null;
    const bag = node.closest<HTMLElement>("[data-custody-bag-id]");
    if (bag) {
      const item = projection.visible.find(
        entry => String(entry.id) === bag.dataset.custodyBagId
      );
      return item ? { kind: "bag", item } : null;
    }
    if (node.closest(".gl-custody-add-btn")) return { kind: "add" };
    return null;
  }

  function finishGesture(clientX: number, clientY: number) {
    const active = gesture.current;
    gesture.current = null;
    setDragX(0);
    if (!active) return;

    const deltaX = clientX - active.x;
    const deltaY = clientY - active.y;
    const elapsedMs = Date.now() - active.startTime;
    const swipe = resolveCarouselSwipe({ deltaX, deltaY, elapsedMs });

    if (swipe) {
      advance(swipe);
      return;
    }

    if (!active.moved && isCarouselTap(deltaX, deltaY)) {
      if (active.target?.kind === "bag")
        onSelectItem(active.target.item, location);
    }
  }

  return (
    <div className="gl-custody-carousel">
      <div
        className={`gl-cargo-hero-art gl-custody-carousel-art ${hasCargo ? "has-cargo" : "is-empty"}`}
        aria-label={`${def.label} custody board`}
        onPointerDownCapture={event => {
          if (event.button !== 0) return;
          gesture.current = {
            x: event.clientX,
            y: event.clientY,
            startTime: Date.now(),
            moved: false,
            target: resolveGestureTarget(event.target),
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (!gesture.current) return;
          const deltaX = event.clientX - gesture.current.x;
          const deltaY = event.clientY - gesture.current.y;
          if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8)
            gesture.current.moved = true;
          if (
            resolveCarouselSwipe({
              deltaX,
              deltaY,
              elapsedMs: Date.now() - gesture.current.startTime,
            }) ||
            Math.abs(deltaX) > Math.abs(deltaY)
          ) {
            setDragX(deltaX);
          }
        }}
        onPointerUp={event => finishGesture(event.clientX, event.clientY)}
        onPointerCancel={() => {
          gesture.current = null;
          setDragX(0);
        }}
        style={{
          transform: dragX ? `translateX(${dragX * 0.35}px)` : undefined,
        }}
      >
        <button
          type="button"
          className="gl-custody-carousel-nav is-prev"
          aria-label="Previous custody location"
          onPointerDown={event => event.stopPropagation()}
          onClick={() => advance("prev")}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          className="gl-custody-carousel-nav is-next"
          aria-label="Next custody location"
          onPointerDown={event => event.stopPropagation()}
          onClick={() => advance("next")}
        >
          <ChevronRight aria-hidden="true" />
        </button>
        {location === "vehicle" ? (
          <div className="gl-cargo-ambient-glow" aria-hidden="true" />
        ) : null}
        <img
          className={`gl-cargo-car ${location === "vehicle" ? "" : "is-location"}`}
          src={def.asset}
          alt={def.label}
          draggable={false}
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
          Swipe or tap arrows for next stop · {totalCount} total in custody
        </p>
      </div>
    </div>
  );
}
