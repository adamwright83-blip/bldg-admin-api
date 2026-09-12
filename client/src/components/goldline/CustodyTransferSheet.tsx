import {
  CUSTODY_LOCATION_ORDER,
  CUSTODY_LOCATIONS,
  type CustodyLocationKey,
} from "@shared/custodyLocations";
import { cargoDisplayName } from "./GarmentBagSprite";
import { needsCharge, type VehicleCargoItem } from "./VehicleCargo";

export function CustodyTransferSheet({
  item,
  currentLocation,
  pending,
  deliverPending,
  error,
  deliverError,
  onClose,
  onTransfer,
  onDeliver,
}: {
  item: VehicleCargoItem;
  currentLocation: CustodyLocationKey;
  pending?: boolean;
  deliverPending?: boolean;
  error?: string | null;
  deliverError?: string | null;
  onClose: () => void;
  onTransfer: (location: CustodyLocationKey) => void;
  onDeliver?: () => void;
}) {
  const name = cargoDisplayName(item) ?? "Customer cargo";
  const chargeDue = needsCharge(item);
  const canDeliver = Boolean(onDeliver) && !chargeDue;
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
                disabled={pending || deliverPending || active}
                onClick={() => onTransfer(location)}
              >
                <strong>{def.shortLabel}</strong>
                <small>{def.label}</small>
              </button>
            );
          })}
        </div>
        {canDeliver ? (
          <button
            type="button"
            className="gl-custody-deliver-btn"
            disabled={pending || deliverPending}
            onClick={() => onDeliver?.()}
          >
            {deliverPending ? "RECORDING DELIVERY…" : "DELIVERED TO CUSTOMER"}
          </button>
        ) : chargeDue ? (
          <p className="gl-custody-deliver-note">
            Charge this order before marking it delivered.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="gl-custody-transfer-error">{error}</p>
        ) : null}
        {deliverError ? (
          <p role="alert" className="gl-custody-transfer-error">{deliverError}</p>
        ) : null}
      </section>
    </div>
  );
}
