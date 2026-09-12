import {
  CUSTODY_LOCATION_ORDER,
  CUSTODY_LOCATIONS,
  type CustodyLocationKey,
} from "@shared/custodyLocations";
import { cargoDisplayName } from "./GarmentBagSprite";
import type { VehicleCargoItem } from "./VehicleCargo";

export function CustodyTransferSheet({
  item,
  currentLocation,
  pending,
  error,
  onClose,
  onTransfer,
}: {
  item: VehicleCargoItem;
  currentLocation: CustodyLocationKey;
  pending?: boolean;
  error?: string | null;
  onClose: () => void;
  onTransfer: (location: CustodyLocationKey) => void;
}) {
  const name = cargoDisplayName(item) ?? "Customer cargo";
  return (
    <div
      className="gl-custody-transfer-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <section
        className="gl-custody-transfer-sheet"
        role="dialog"
        aria-label={`Transfer ${name}`}
        onClick={event => event.stopPropagation()}
      >
        <header>
          <div>
            <p>MOVE CUSTODY</p>
            <h3>{name}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close transfer">
            ×
          </button>
        </header>
        <p className="gl-custody-transfer-copy">
          Tap where this order is right now.
        </p>
        <div className="gl-custody-transfer-actions">
          {CUSTODY_LOCATION_ORDER.map(location => {
            const def = CUSTODY_LOCATIONS[location];
            const active = location === currentLocation;
            return (
              <button
                key={location}
                type="button"
                className={active ? "is-current" : undefined}
                disabled={pending || active}
                onClick={() => onTransfer(location)}
              >
                <strong>{def.shortLabel}</strong>
                <small>{def.label}</small>
              </button>
            );
          })}
        </div>
        {error ? (
          <p role="alert" className="gl-custody-transfer-error">{error}</p>
        ) : null}
      </section>
    </div>
  );
}
