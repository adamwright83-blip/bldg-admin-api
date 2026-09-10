import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { PackageOpen, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
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
  state: "IN_VEHICLE_UNPROCESSED" | "IN_VEHICLE_PROCESSED";
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
export function visibleCargo(cargo: VehicleCargoItem[]) {
  return {
    visible: cargo.slice(0, SLOTS.length),
    overflow: Math.max(0, cargo.length - SLOTS.length),
  };
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
}: {
  mode?: "floating" | "hero";
  fixtureCargo?: VehicleCargoItem[];
  /** Fixture/harness mode only — real mode saves through the update
   *  mutation instead. Mirrors VehicleCargoCapture's onFixtureConfirmed. */
  onFixtureCargoUpdated?: (
    item: VehicleCargoItem,
    fields: CargoEditFields
  ) => void;
}) {
  const [open, setOpen] = useState(false);
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
  const update = trpc.system.goldlineCargo.update.useMutation({
    onSuccess: () => utils.system.goldlineCargo.state.invalidate(),
  });
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
  const unassigned = state.data?.unassigned ?? [],
    atProcessor = state.data?.atProcessor ?? [];
  const relevant =
    onboarding.data?.session?.interpretation?.profile
      .transportsCustomerProperty === true ||
    cargo.length > 0 ||
    unassigned.length > 0 ||
    atProcessor.length > 0;
  if (
    mode === "floating" &&
    state.isSuccess &&
    onboarding.isSuccess &&
    !relevant
  )
    return null;
  const projection = visibleCargo(cargo);
  /** A bag on the car was tapped: open the cargo list already scrolled and
   *  focused on THAT exact record. Field cargo opens straight into edit;
   *  order-linked cargo has no free-text label of its own to edit, so it
   *  opens to its existing real detail + handoff action instead. */
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
      <Dialog.Trigger asChild>
        <button
          data-testid="vehicle-cargo-cta"
          className={`gl-cargo-cta gl-cargo-cta--${mode} ${cargo.length ? "has-cargo" : "is-empty"}`}
          onClick={() => {
            setFocusItemId(null);
            setOpen(true);
          }}
        >
          {mode === "hero" ? (
            <div
              className="gl-cargo-hero-art"
              aria-label={`${cargo.length} customer orders in vehicle`}
            >
              <div className="gl-cargo-ambient-glow" aria-hidden="true" />
              <img
                className="gl-cargo-car"
                src={CAR_ASSET}
                alt="Top-down vehicle interior"
                onError={event => {
                  if (event.currentTarget.src.endsWith(CAR_FALLBACK)) return;
                  event.currentTarget.src = CAR_FALLBACK;
                }}
              />
              <div className="gl-cargo-sheen" aria-hidden="true" />
              <div className="gl-cargo-garments">
                {projection.visible.map((item, index) => (
                  <GarmentBagSprite
                    key={item.id}
                    item={item}
                    style={SLOTS[index]}
                    editable={item.source === "field"}
                    onSelect={selectItem}
                  />
                ))}
              </div>
              {projection.overflow > 0 ? (
                <strong className="gl-cargo-overflow">
                  +{projection.overflow} MORE
                </strong>
              ) : null}
            </div>
          ) : (
            <PackageOpen />
          )}
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
      <Dialog.Portal>
        <Dialog.Content className="gl-cargo-view">
          <header>
            <div>
              <p>DRIVER · AUTHORITATIVE CUSTODY</p>
              <Dialog.Title>VEHICLE CARGO</Dialog.Title>
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
            What customer property is physically in my vehicle right now?
          </Dialog.Description>
          <section className="gl-cargo-list">
            {cargo.map(item => {
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
                </article>
              );
            })}
            {!cargo.length ? (
              <p>NO CUSTOMER PROPERTY RECORDED IN THIS VEHICLE</p>
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
          <footer>
            GPS may prompt a transfer, but never performs one. Cargo remains
            until explicit custody evidence or delivery.
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
