import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { PackageOpen, X } from "lucide-react";
import {
  CUSTODY_LOCATION_ORDER,
  CUSTODY_LOCATIONS,
  type CustodyLocationKey,
} from "@shared/custodyLocations";
import { trpc } from "@/lib/trpc";
import { CustodyLocationCarousel } from "./CustodyLocationCarousel";
import { CustodyTransferSheet } from "./CustodyTransferSheet";
import { cargoDisplayName, GarmentBagSprite } from "./GarmentBagSprite";
import "./vehicle-cargo.css";

export type VehicleCargoItem = {
  id: number | string;
  source?: "order" | "field";
  fieldCargoId?: string;
  firstName?: string | null;
  lastName?: string | null;
  address?: string | null;
  customerDisplayName?: string;
  itemDescription?: string;
  quantity?: number | null;
  serviceType?: "wash_fold" | "dry_cleaning" | null;
  processingState?: "unknown" | "unprocessed" | "processed";
  notes?: string | null;
  linkedOrderId?: number | null;
  unlinked?: boolean;
  /** Real payment truth from `orders`, order-sourced cargo only (see
   *  server/goldlineCargo/cargoService.ts listCargo/listAtProcessor). Absent
   *  for field cargo, which has no linked order to charge. */
  paid?: boolean;
  total?: number | null;
  paidAt?: string | null;
  state: "IN_VEHICLE_UNPROCESSED" | "IN_VEHICLE_PROCESSED";
  custodyLocation?: CustodyLocationKey;
  appearance: {
    kind: "paper_bag" | "garment_bag";
    condition: string;
    next: string;
  };
};
const ASSET = "/assets/goldline/vehicle-cargo/v1";
const CAR_ASSET =
  "/assets/goldline/vehicle-cargo/v2/car-topdown-neutral.png?v=20260909";
const CAR_FALLBACK =
  "/assets/goldline/vehicle-cargo/v1/car-inactive-glow-neutral.jpg";
const SLOTS = [
  { left: "30%", top: "56%" },
  { left: "66%", top: "56%" },
  { left: "30%", top: "72%" },
  { left: "66%", top: "72%" },
] as const;

export function cargoSprite(item: VehicleCargoItem) {
  const variant =
    typeof item.id === "number"
      ? item.id
      : item.id
          .split("")
          .reduce((sum, character) => sum + character.charCodeAt(0), 0);
  if (item.state === "IN_VEHICLE_PROCESSED")
    return variant % 2
      ? `${ASSET}/cargo-processed-hanging-garments.jpg`
      : `${ASSET}/cargo-processed-folded-package.jpg`;
  return variant % 2
    ? `${ASSET}/cargo-unprocessed-paper-bag-a.jpg`
    : `${ASSET}/cargo-unprocessed-paper-bag-b.jpg`;
}
/** True only for order-linked cargo whose real order is confirmed unpaid.
 *  Field cargo has no linked order and never shows a charge badge. */
export function needsCharge(item: VehicleCargoItem): boolean {
  return item.source === "order" && item.paid === false;
}
export function visibleCargo(cargo: VehicleCargoItem[], maxSlots = SLOTS.length) {
  return {
    visible: cargo.slice(0, maxSlots),
    overflow: Math.max(0, cargo.length - maxSlots),
  };
}

export function groupCargoByLocation(
  items: VehicleCargoItem[]
): Record<CustodyLocationKey, VehicleCargoItem[]> {
  const board = Object.fromEntries(
    CUSTODY_LOCATION_ORDER.map(key => [key, [] as VehicleCargoItem[]])
  ) as Record<CustodyLocationKey, VehicleCargoItem[]>;
  for (const item of items) {
    board[item.custodyLocation ?? "vehicle"].push(item);
  }
  return board;
}

export function totalCargoCount(
  byLocation: Record<CustodyLocationKey, VehicleCargoItem[]>
) {
  return CUSTODY_LOCATION_ORDER.reduce(
    (sum, key) => sum + byLocation[key].length,
    0
  );
}

/** Editable field set for an existing field-cargo entry — the same shape
 *  the add flow already captures, minus vehicleAction/vehicleState which
 *  don't apply to editing an item already in the vehicle. */
export type CargoEditFields = {
  customerDisplayName: string;
  itemDescription: string;
  quantity: number | null;
  serviceType: "wash_fold" | "dry_cleaning" | null;
  processingState: "unknown" | "unprocessed" | "processed";
  notes: string | null;
};
type EditDraft = {
  customerDisplayName: string;
  itemDescription: string;
  quantity: string;
  serviceType: "" | "wash_fold" | "dry_cleaning";
  processingState: "unknown" | "unprocessed" | "processed";
  notes: string;
};
const draftFor = (item: VehicleCargoItem): EditDraft => ({
  customerDisplayName: cargoDisplayName(item) ?? "",
  itemDescription: item.itemDescription ?? "",
  quantity: item.quantity != null ? String(item.quantity) : "",
  serviceType: item.serviceType ?? "",
  processingState: item.processingState ?? "unknown",
  notes: item.notes ?? "",
});

export function VehicleCargo({
  mode = "floating",
  fixtureCargo,
  onFixtureCargoUpdated,
  onFixtureLocationTransfer,
  onFixtureDelivered,
  onAddToLocation,
  onActiveLocationChange,
}: {
  mode?: "floating" | "hero";
  fixtureCargo?: VehicleCargoItem[];
  /** Fixture/harness mode only — real mode saves through the update
   *  mutation instead. Mirrors VehicleCargoCapture's onFixtureConfirmed. */
  onFixtureCargoUpdated?: (
    item: VehicleCargoItem,
    fields: CargoEditFields
  ) => void;
  onFixtureLocationTransfer?: (
    item: VehicleCargoItem,
    toLocation: CustodyLocationKey
  ) => void;
  onFixtureDelivered?: (item: VehicleCargoItem) => void;
  onAddToLocation?: (location: CustodyLocationKey) => void;
  onActiveLocationChange?: (location: CustodyLocationKey) => void;
}) {
  const [activeLocation, setActiveLocation] =
    useState<CustodyLocationKey>("vehicle");
  const [open, setOpen] = useState(false);
  const [transferItem, setTransferItem] = useState<{
    item: VehicleCargoItem;
    location: CustodyLocationKey;
  } | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [deliverError, setDeliverError] = useState<string | null>(null);
  const [fixtureDeliveryCount, setFixtureDeliveryCount] = useState(0);
  const [focusItemId, setFocusItemId] = useState<VehicleCargoItem["id"] | null>(
    null
  );
  const [editingId, setEditingId] = useState<VehicleCargoItem["id"] | null>(
    null
  );
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const articleRefs = useRef(new Map<VehicleCargoItem["id"], HTMLElement>());
  const onboarding = trpc.system.goldlineOnboarding.state.useQuery(undefined, {
    enabled: fixtureCargo === undefined,
    retry: false,
  });
  const state = trpc.system.goldlineCargo.state.useQuery(undefined, {
    enabled: fixtureCargo === undefined,
    refetchInterval: 15_000,
    retry: false,
  });
  const utils = trpc.useUtils();
  const transfer = trpc.system.goldlineCargo.transfer.useMutation({
    onSuccess: () => utils.system.goldlineCargo.state.invalidate(),
  });
  const transferLocation = trpc.system.goldlineCargo.transferLocation.useMutation({
    onSuccess: () => {
      utils.system.goldlineCargo.state.invalidate();
      setTransferItem(null);
      setTransferError(null);
    },
    onError: cause => {
      setTransferError(
        cause instanceof Error ? cause.message : "Could not move this cargo."
      );
    },
  });
  const update = trpc.system.goldlineCargo.update.useMutation({
    onSuccess: () => utils.system.goldlineCargo.state.invalidate(),
  });
  const deliver = trpc.system.goldlineCargo.deliver.useMutation({
    onSuccess: () => {
      utils.system.goldlineCargo.state.invalidate();
      setTransferItem(null);
      setDeliverError(null);
    },
    onError: cause => {
      setDeliverError(
        cause instanceof Error ? cause.message : "Could not record delivery."
      );
    },
  });
  useEffect(() => {
    onActiveLocationChange?.(activeLocation);
  }, [activeLocation, onActiveLocationChange]);
  useEffect(() => {
    if (!open || focusItemId == null) return;
    const frame = requestAnimationFrame(() => {
      articleRefs.current
        .get(focusItemId)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, focusItemId]);
  const cargo = (fixtureCargo ?? state.data?.cargo ?? []) as VehicleCargoItem[];
  const byLocation = useMemo(() => {
    if (fixtureCargo !== undefined) return groupCargoByLocation(fixtureCargo);
    if (state.data?.byLocation) {
      return state.data.byLocation as Record<
        CustodyLocationKey,
        VehicleCargoItem[]
      >;
    }
    return groupCargoByLocation(cargo);
  }, [cargo, fixtureCargo, state.data?.byLocation]);
  const custodyTotal = totalCargoCount(byLocation);
  const deliveryCount =
    fixtureCargo !== undefined
      ? fixtureDeliveryCount
      : (state.data?.deliveryStats?.total ?? 0);
  const unassigned = state.data?.unassigned ?? [],
    atProcessor = state.data?.atProcessor ?? [];
  const relevant =
    onboarding.data?.session?.interpretation?.profile
      .transportsCustomerProperty === true ||
    custodyTotal > 0 ||
    unassigned.length > 0 ||
    atProcessor.length > 0;
  if (
    mode === "floating" &&
    state.isSuccess &&
    onboarding.isSuccess &&
    !relevant
  )
    return null;
  const allCargo = CUSTODY_LOCATION_ORDER.flatMap(key => byLocation[key]);
  /** Hero kanban: tap a bag to move custody. Detail dialog: open the record. */
  function openTransfer(
    item: VehicleCargoItem,
    location: CustodyLocationKey
  ) {
    setTransferError(null);
    setTransferItem({ item, location });
  }
  function selectItem(item: VehicleCargoItem) {
    setEditError(null);
    setOpen(true);
    setFocusItemId(item.id);
    if (item.source === "field") {
      setEditingId(item.id);
      setEditDraft(draftFor(item));
    } else {
      setEditingId(null);
      setEditDraft(null);
    }
  }
  async function deliverItem(item: VehicleCargoItem) {
    setDeliverError(null);
    if (fixtureCargo !== undefined) {
      onFixtureDelivered?.(item);
      setFixtureDeliveryCount(count => count + 1);
      setTransferItem(null);
      return;
    }
    await deliver.mutateAsync({
      orderId: typeof item.id === "number" ? item.id : undefined,
      fieldCargoId:
        item.source === "field"
          ? item.fieldCargoId ?? String(item.id).replace(/^field:/, "")
          : undefined,
      confirmed: true,
    });
  }
  async function moveToLocation(toLocation: CustodyLocationKey) {
    if (!transferItem) return;
    const { item } = transferItem;
    setTransferError(null);
    if (fixtureCargo !== undefined) {
      onFixtureLocationTransfer?.(item, toLocation);
      setTransferItem(null);
      return;
    }
    await transferLocation.mutateAsync({
      orderId: typeof item.id === "number" ? item.id : undefined,
      fieldCargoId:
        item.source === "field"
          ? item.fieldCargoId ?? String(item.id).replace(/^field:/, "")
          : undefined,
      toLocation,
      confirmed: true,
    });
  }
  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
    setEditError(null);
  }
  async function saveEdit(item: VehicleCargoItem) {
    if (!editDraft) return;
    const customerDisplayName = editDraft.customerDisplayName.trim();
    const itemDescription = editDraft.itemDescription.trim();
    if (!customerDisplayName || !itemDescription) {
      setEditError("Name and item are required.");
      return;
    }
    const fields: CargoEditFields = {
      customerDisplayName,
      itemDescription,
      quantity: editDraft.quantity.trim() ? Number(editDraft.quantity) : null,
      serviceType: editDraft.serviceType || null,
      processingState: editDraft.processingState,
      notes: editDraft.notes.trim() || null,
    };
    setEditError(null);
    if (fixtureCargo !== undefined) {
      onFixtureCargoUpdated?.(item, fields);
      cancelEdit();
      return;
    }
    try {
      await update.mutateAsync({
        fieldCargoId: item.fieldCargoId ?? String(item.id).replace(/^field:/, ""),
        fields,
      });
      cancelEdit();
    } catch (cause) {
      setEditError(
        cause instanceof Error ? cause.message : "Could not save this edit."
      );
    }
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) {
          setFocusItemId(null);
          cancelEdit();
        }
      }}
    >
      {mode === "hero" ? (
        <div
          data-testid="vehicle-cargo-cta"
          className={`gl-cargo-cta gl-cargo-cta--${mode} ${custodyTotal ? "has-cargo" : "is-empty"}`}
        >
          <CustodyLocationCarousel
            byLocation={byLocation}
            hasCargo={custodyTotal > 0}
            location={activeLocation}
            onLocationChange={setActiveLocation}
            onSelectItem={openTransfer}
            onAddToLocation={onAddToLocation}
          />
          <button
            type="button"
            className="gl-cargo-detail-trigger"
            onClick={() => {
              setFocusItemId(null);
              setOpen(true);
            }}
          >
            <strong>CUSTODY BOARD</strong>
            <small>
              {state.isLoading && fixtureCargo === undefined
                ? "READING CUSTODY…"
                : custodyTotal
                  ? `${custodyTotal} ${custodyTotal === 1 ? "ITEM" : "ITEMS"} ACROSS ${CUSTODY_LOCATION_ORDER.filter(key => byLocation[key].length > 0).length || 0} LOCATIONS`
                  : unassigned.length
                    ? `${unassigned.length} PICKED UP · VEHICLE UNCONFIRMED`
                    : "ALL LOCATIONS EMPTY"}
              {deliveryCount > 0 ? (
                <span className="gl-custody-delivery-stats">
                  {deliveryCount} DELIVERED TO CUSTOMER
                  {deliveryCount === 1 ? "" : " (ALL TIME)"}
                </span>
              ) : null}
            </small>
          </button>
          {transferItem ? (
            <CustodyTransferSheet
              item={transferItem.item}
              currentLocation={transferItem.location}
              pending={transferLocation.isPending}
              deliverPending={deliver.isPending}
              error={transferError ?? transferLocation.error?.message ?? null}
              deliverError={deliverError ?? deliver.error?.message ?? null}
              onClose={() => {
                setTransferItem(null);
                setTransferError(null);
                setDeliverError(null);
              }}
              onTransfer={location => void moveToLocation(location)}
              onDeliver={() =>
                transferItem ? void deliverItem(transferItem.item) : undefined
              }
            />
          ) : null}
        </div>
      ) : (
        <Dialog.Trigger asChild>
          <button
            data-testid="vehicle-cargo-cta"
            className={`gl-cargo-cta gl-cargo-cta--${mode} ${cargo.length ? "has-cargo" : "is-empty"}`}
            onClick={() => {
              setFocusItemId(null);
              setOpen(true);
            }}
          >
            <PackageOpen />
            <span>
              <strong>VEHICLE CARGO</strong>
              <small>
                {state.isLoading && fixtureCargo === undefined
                  ? "READING CUSTODY…"
                  : cargo.length
                    ? `${cargo.length} CARGO ${cargo.length === 1 ? "ITEM" : "ITEMS"} IN VEHICLE`
                    : unassigned.length
                      ? `${unassigned.length} PICKED UP · VEHICLE UNCONFIRMED`
                      : "VEHICLE EMPTY"}
              </small>
            </span>
          </button>
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Content className="gl-cargo-view">
          <header>
            <div>
              <p>DRIVER · AUTHORITATIVE CUSTODY</p>
              <Dialog.Title>CUSTODY BOARD</Dialog.Title>
            </div>
            <button
              onClick={() => {
                setOpen(false);
                setFocusItemId(null);
                cancelEdit();
              }}
              aria-label="Close cargo"
            >
              <X />
            </button>
          </header>
          <Dialog.Description className="gl-cargo-question">
            Where is every customer order right now — car, cleaner, or closet?
          </Dialog.Description>
          <section className="gl-cargo-list">
            {allCargo.map(item => {
              const location = item.custodyLocation ?? "vehicle";
              const isEditing = editingId === item.id && editDraft;
              return (
                <article
                  key={item.id}
                  ref={el => {
                    if (el) articleRefs.current.set(item.id, el);
                    else articleRefs.current.delete(item.id);
                  }}
                  className={
                    focusItemId === item.id ? "is-focused-entry" : undefined
                  }
                >
                  <img src={cargoSprite(item)} alt="" />
                  {isEditing && editDraft ? (
                    <form
                      className="gl-cargo-edit-form"
                      onSubmit={event => {
                        event.preventDefault();
                        void saveEdit(item);
                      }}
                    >
                      <label>
                        NAME
                        <input
                          value={editDraft.customerDisplayName}
                          onChange={event =>
                            setEditDraft({
                              ...editDraft,
                              customerDisplayName: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        ITEM
                        <input
                          value={editDraft.itemDescription}
                          onChange={event =>
                            setEditDraft({
                              ...editDraft,
                              itemDescription: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        QUANTITY
                        <input
                          inputMode="numeric"
                          value={editDraft.quantity}
                          onChange={event =>
                            setEditDraft({
                              ...editDraft,
                              quantity: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        SERVICE
                        <select
                          value={editDraft.serviceType}
                          onChange={event =>
                            setEditDraft({
                              ...editDraft,
                              serviceType: event.target
                                .value as EditDraft["serviceType"],
                            })
                          }
                        >
                          <option value="">UNKNOWN</option>
                          <option value="dry_cleaning">DRY CLEANING</option>
                          <option value="wash_fold">WASH &amp; FOLD</option>
                        </select>
                      </label>
                      <label>
                        STATE
                        <select
                          value={editDraft.processingState}
                          onChange={event =>
                            setEditDraft({
                              ...editDraft,
                              processingState: event.target
                                .value as EditDraft["processingState"],
                            })
                          }
                        >
                          <option value="unknown">UNKNOWN</option>
                          <option value="unprocessed">UNPROCESSED</option>
                          <option value="processed">PROCESSED</option>
                        </select>
                      </label>
                      <label className="is-wide">
                        NOTES
                        <input
                          value={editDraft.notes}
                          onChange={event =>
                            setEditDraft({
                              ...editDraft,
                              notes: event.target.value,
                            })
                          }
                        />
                      </label>
                      {editError ? (
                        <p role="alert" className="gl-cargo-edit-error">
                          {editError}
                        </p>
                      ) : null}
                      <div className="gl-cargo-edit-actions">
                        <button type="button" onClick={cancelEdit}>
                          CANCEL
                        </button>
                        <button
                          type="submit"
                          className="is-primary"
                          disabled={update.isPending}
                        >
                          SAVE
                        </button>
                      </div>
                    </form>
                  ) : (
                    <span>
                      <strong>
                        {item.customerDisplayName ??
                          `${item.firstName ?? ""} ${item.lastName ?? ""}`.trim()}
                      </strong>
                      <em>
                        {item.quantity ? `${item.quantity} ` : ""}
                        {item.itemDescription ?? item.appearance.condition}
                      </em>
                      <small className="gl-cargo-location-pill">
                        {CUSTODY_LOCATIONS[location].label}
                      </small>
                      {item.serviceType ? (
                        <small>
                          {item.serviceType === "dry_cleaning"
                            ? "DRY CLEANING"
                            : "WASH & FOLD"}
                        </small>
                      ) : null}
                      {item.notes ? <small>{item.notes}</small> : null}
                      {item.unlinked ? (
                        <b className="gl-cargo-unlinked">
                          UNLINKED FIELD CARGO
                        </b>
                      ) : null}
                      {needsCharge(item) ? (
                        <b className="gl-cargo-charge-due">
                          READY TO CHARGE
                          {typeof item.total === "number" && item.total > 0
                            ? ` · $${item.total.toFixed(2)}`
                            : ""}
                        </b>
                      ) : null}
                      <small>{item.appearance.next}</small>
                    </span>
                  )}
                  {!isEditing && item.source === "field" ? (
                    <button
                      className="gl-cargo-edit-trigger"
                      onClick={() => {
                        setEditError(null);
                        setEditingId(item.id);
                        setEditDraft(draftFor(item));
                      }}
                    >
                      EDIT
                    </button>
                  ) : null}
                  {!isEditing ? (
                    <button
                      className="gl-cargo-move-trigger"
                      disabled={transferLocation.isPending || deliver.isPending}
                      onClick={() => openTransfer(item, location)}
                    >
                      MOVE
                    </button>
                  ) : null}
                  {!isEditing && !needsCharge(item) ? (
                    <button
                      className="gl-cargo-deliver-trigger"
                      disabled={transferLocation.isPending || deliver.isPending}
                      onClick={() => void deliverItem(item)}
                    >
                      DELIVERED
                    </button>
                  ) : null}
                  {!isEditing &&
                  item.source !== "field" &&
                  typeof item.id === "number" &&
                  item.state === "IN_VEHICLE_UNPROCESSED" ? (
                    <button
                      disabled={transfer.isPending}
                      onClick={() =>
                        transfer.mutate({
                          orderId: Number(item.id),
                          to: "AT_PROCESSOR",
                          confirmed: true,
                        })
                      }
                    >
                      CONFIRM PROCESSOR HANDOFF
                    </button>
                  ) : null}
                  {!isEditing && needsCharge(item) ? (
                    <a
                      className="gl-cargo-charge-cta"
                      href={`/intake?orderId=${item.id}`}
                    >
                      CHARGE THIS ORDER
                    </a>
                  ) : null}
                </article>
              );
            })}
            {!allCargo.length ? (
              <p>NO CUSTOMER PROPERTY RECORDED IN CUSTODY</p>
            ) : null}
          </section>
          {unassigned.length ? (
            <section className="gl-unassigned">
              <h2>Picked up · vehicle not yet confirmed</h2>
              {unassigned.map((item: any) => (
                <article key={item.orderId}>
                  <span>
                    <strong>{item.customer}</strong>
                    <small>{item.address}</small>
                  </span>
                  <button
                    disabled={transfer.isPending}
                    onClick={() =>
                      transfer.mutate({
                        orderId: item.orderId,
                        to: "IN_VEHICLE_UNPROCESSED",
                        confirmed: true,
                      })
                    }
                  >
                    I LOADED THIS VEHICLE
                  </button>
                </article>
              ))}
            </section>
          ) : null}
          {atProcessor.length ? (
            <section className="gl-unassigned">
              <h2>At processor</h2>
              {atProcessor.map((item: any) => (
                <article key={item.id}>
                  <span>
                    <strong>
                      {item.firstName} {item.lastName}
                    </strong>
                    <small>
                      {item.status === "ready"
                        ? "Ready for return"
                        : "Processor still has custody"}
                    </small>
                  </span>
                  {item.status === "ready" ? (
                    <button
                      disabled={transfer.isPending}
                      onClick={() =>
                        transfer.mutate({
                          orderId: item.id,
                          to: "IN_VEHICLE_PROCESSED",
                          confirmed: true,
                        })
                      }
                    >
                      LOADED PROCESSED CARGO
                    </button>
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}
          {transfer.error ? <p role="alert">{transfer.error.message}</p> : null}
          {transferLocation.error ? (
            <p role="alert">{transferLocation.error.message}</p>
          ) : null}
          {transferItem && open ? (
            <CustodyTransferSheet
              item={transferItem.item}
              currentLocation={transferItem.location}
              pending={transferLocation.isPending}
              deliverPending={deliver.isPending}
              error={transferError ?? transferLocation.error?.message ?? null}
              deliverError={deliverError ?? deliver.error?.message ?? null}
              onClose={() => {
                setTransferItem(null);
                setTransferError(null);
                setDeliverError(null);
              }}
              onTransfer={location => void moveToLocation(location)}
              onDeliver={() =>
                transferItem ? void deliverItem(transferItem.item) : undefined
              }
            />
          ) : null}
          <footer>
            GPS may prompt a transfer, but never performs one. Cargo remains
            until explicit custody evidence or delivery.
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
