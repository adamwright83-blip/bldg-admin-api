import { useState } from "react";
import { PackageOpen, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./vehicle-cargo.css";
import "./daily-line-readable.css";

export type VehicleCargoItem = { id: number; firstName?: string | null; lastName?: string | null; address?: string | null; state: "IN_VEHICLE_UNPROCESSED" | "IN_VEHICLE_PROCESSED"; appearance: { kind: "paper_bag" | "garment_bag"; condition: string; next: string } };
const ASSET = "/assets/goldline/vehicle-cargo/v1";
const CAR_ASSET = "/assets/goldline/vehicle-cargo/v2/car-topdown-neutral.png";
const SLOTS = [{ left: "30%", top: "56%" }, { left: "66%", top: "56%" }, { left: "30%", top: "72%" }, { left: "66%", top: "72%" }] as const;

export function cargoSprite(item: VehicleCargoItem) {
  if (item.state === "IN_VEHICLE_PROCESSED") return item.id % 2 ? `${ASSET}/cargo-processed-hanging-garments.jpg` : `${ASSET}/cargo-processed-folded-package.jpg`;
  return item.id % 2 ? `${ASSET}/cargo-unprocessed-paper-bag-a.jpg` : `${ASSET}/cargo-unprocessed-paper-bag-b.jpg`;
}
export function visibleCargo(cargo: VehicleCargoItem[]) { return { visible: cargo.slice(0, SLOTS.length), overflow: Math.max(0, cargo.length - SLOTS.length) }; }

export function VehicleCargo({ mode = "floating", fixtureCargo }: { mode?: "floating" | "hero"; fixtureCargo?: VehicleCargoItem[] }) {
  const [open, setOpen] = useState(false);
  const onboarding = trpc.system.goldlineOnboarding.state.useQuery(undefined, { enabled: fixtureCargo === undefined, retry: false });
  const state = trpc.system.goldlineCargo.state.useQuery(undefined, { enabled: fixtureCargo === undefined, refetchInterval: 15_000, retry: false });
  const utils = trpc.useUtils();
  const transfer = trpc.system.goldlineCargo.transfer.useMutation({ onSuccess: () => utils.system.goldlineCargo.state.invalidate() });
  const cargo = (fixtureCargo ?? state.data?.cargo ?? []) as VehicleCargoItem[];
  const unassigned = state.data?.unassigned ?? [], atProcessor = state.data?.atProcessor ?? [];
  const relevant = onboarding.data?.session?.interpretation?.profile.transportsCustomerProperty === true || cargo.length > 0 || unassigned.length > 0 || atProcessor.length > 0;
  if (mode === "floating" && state.isSuccess && onboarding.isSuccess && !relevant) return null;
  const projection = visibleCargo(cargo);
  return <>
    <button data-testid="vehicle-cargo-cta" className={`gl-cargo-cta gl-cargo-cta--${mode} ${cargo.length ? "has-cargo" : "is-empty"}`} onClick={() => setOpen(true)}>
      {mode === "hero" ? <div className="gl-cargo-hero-art" aria-label={`${cargo.length} customer orders in vehicle`}>
        <img className="gl-cargo-car" src={CAR_ASSET} alt="Top-down transparent vehicle interior" />
        <div className="gl-cargo-sprites">{projection.visible.map((item, index) => <img key={item.id} className={`gl-cargo-sprite ${item.state === "IN_VEHICLE_PROCESSED" ? "is-processed" : "is-unprocessed"}`} style={SLOTS[index]} src={cargoSprite(item)} alt={`${item.firstName ?? "Customer"} ${item.lastName ?? ""} cargo`} />)}</div>
        {projection.overflow > 0 ? <strong className="gl-cargo-overflow">+{projection.overflow} MORE</strong> : null}
      </div> : <PackageOpen />}
      <span><strong>VEHICLE CARGO</strong><small>{state.isLoading && fixtureCargo === undefined ? "READING CUSTODY…" : cargo.length ? `${cargo.length} CUSTOMER ${cargo.length === 1 ? "ORDER" : "ORDERS"} IN VEHICLE` : unassigned.length ? `${unassigned.length} PICKED UP · VEHICLE UNCONFIRMED` : "VEHICLE EMPTY"}</small></span>
    </button>
    {open ? <main className="gl-cargo-view" role="dialog" aria-modal="true" aria-label="Vehicle Cargo"><header><div><p>DRIVER · AUTHORITATIVE CUSTODY</p><h1>VEHICLE CARGO</h1></div><button onClick={() => setOpen(false)} aria-label="Close cargo"><X /></button></header><p className="gl-cargo-question">What customer property is physically in my vehicle right now?</p>
      <section className="gl-cargo-list">{cargo.map(item => <article key={item.id}><img src={cargoSprite(item)} alt="" /><span><strong>{item.firstName} {item.lastName}</strong><em>{item.appearance.condition}</em><small>{item.appearance.next}</small></span>{item.state === "IN_VEHICLE_UNPROCESSED" ? <button disabled={transfer.isPending} onClick={() => transfer.mutate({ orderId: item.id, to: "AT_PROCESSOR", confirmed: true })}>CONFIRM PROCESSOR HANDOFF</button> : null}</article>)}{!cargo.length ? <p>NO CUSTOMER PROPERTY RECORDED IN THIS VEHICLE</p> : null}</section>
      {unassigned.length ? <section className="gl-unassigned"><h2>Picked up · vehicle not yet confirmed</h2>{unassigned.map((item: any) => <article key={item.orderId}><span><strong>{item.customer}</strong><small>{item.address}</small></span><button disabled={transfer.isPending} onClick={() => transfer.mutate({ orderId: item.orderId, to: "IN_VEHICLE_UNPROCESSED", confirmed: true })}>I LOADED THIS VEHICLE</button></article>)}</section> : null}
      {atProcessor.length ? <section className="gl-unassigned"><h2>At processor</h2>{atProcessor.map((item: any) => <article key={item.id}><span><strong>{item.firstName} {item.lastName}</strong><small>{item.status === "ready" ? "Ready for return" : "Processor still has custody"}</small></span>{item.status === "ready" ? <button disabled={transfer.isPending} onClick={() => transfer.mutate({ orderId: item.id, to: "IN_VEHICLE_PROCESSED", confirmed: true })}>LOADED PROCESSED CARGO</button> : null}</article>)}</section> : null}
      {transfer.error ? <p role="alert">{transfer.error.message}</p> : null}<footer>GPS may prompt a transfer, but never performs one. Cargo remains until explicit custody evidence or delivery.</footer></main> : null}
  </>;
}
