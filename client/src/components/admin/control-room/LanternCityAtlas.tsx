import { useMemo, useState } from "react";
import { ArrowRight, MapPinOff, Search, X } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import { trpc } from "@/lib/trpc";

type ListCustomersOutput = inferRouterOutputs<AppRouter>["admin"]["listCustomers"];
export type LanternCustomer = ListCustomersOutput["customers"][number];
export type LanternState = "active" | "dimming" | "dark";

const MAP_IMAGE = "/assets/admin/control-room/world/lantern-city-atlas.jpg";
const TERMINAL_PIPELINE_STAGES = new Set(["won", "lost"]);

const NEIGHBORHOODS = [
  { label: "West Hollywood", x: 18, y: 18 },
  { label: "Beverly Hills", x: 13, y: 43 },
  { label: "Century City", x: 12, y: 76 },
  { label: "Hollywood", x: 47, y: 34 },
  { label: "Koreatown", x: 51, y: 70 },
  { label: "Los Feliz", x: 76, y: 20 },
  { label: "Silver Lake", x: 82, y: 43 },
  { label: "Echo Park", x: 86, y: 72 },
] as const;

export function classifyLanternCustomer(customer: Pick<LanternCustomer, "recencyStatus">): LanternState {
  if (customer.recencyStatus === "lapsed") return "dark";
  if (customer.recencyStatus === "cooling") return "dimming";
  return "active";
}

export function resolveCustomerMapLocation(customer: Pick<LanternCustomer, "propertyGroup" | "address">) {
  if (customer.propertyGroup === "opus_la") return { neighborhood: "Koreatown", x: 51, y: 70, confidence: "building" as const };
  if (customer.propertyGroup === "century_park_east") return { neighborhood: "Century City", x: 12, y: 76, confidence: "building" as const };
  const address = String(customer.address ?? "").toLowerCase();
  if (/west hollywood|\b90069\b/.test(address)) return { neighborhood: "West Hollywood", x: 18, y: 18, confidence: "address" as const };
  if (/beverly hills|\b90210\b|\b90211\b|\b90212\b/.test(address)) return { neighborhood: "Beverly Hills", x: 13, y: 43, confidence: "address" as const };
  if (/century city|century park/.test(address)) return { neighborhood: "Century City", x: 12, y: 76, confidence: "address" as const };
  if (/\bkoreatown\b|wilshire blvd|\b90005\b|\b90010\b/.test(address)) return { neighborhood: "Koreatown", x: 51, y: 70, confidence: "address" as const };
  if (/\bhollywood\b|\b90028\b|\b90038\b/.test(address)) return { neighborhood: "Hollywood", x: 47, y: 34, confidence: "address" as const };
  if (/los feliz|\b90027\b/.test(address)) return { neighborhood: "Los Feliz", x: 76, y: 20, confidence: "address" as const };
  if (/silver lake/.test(address)) return { neighborhood: "Silver Lake", x: 82, y: 43, confidence: "address" as const };
  if (/echo park/.test(address)) return { neighborhood: "Echo Park", x: 86, y: 72, confidence: "address" as const };
  return null;
}

function stableOffset(customer: Pick<LanternCustomer, "phone" | "firstName" | "lastName">, axis: number) {
  const key = `${customer.phone}|${customer.firstName}|${customer.lastName}`;
  let hash = axis ? 2166136261 : 5381;
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return ((Math.abs(hash) % 1000) / 1000 - 0.5) * 6;
}

function customerName(customer: LanternCustomer) {
  return `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || "Customer name unavailable";
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function StatusCard({ state, label, value, note }: { state: LanternState | "pursued"; label: string; value: number | null; note: string }) {
  return <article className={`lc-status-card state-${state}`}><span className="lc-status-icon" aria-hidden>{state === "pursued" ? "♨" : ""}</span><div><small>{label}</small><strong>{value === null ? "—" : value}</strong><p>{note}</p></div></article>;
}

export default function LanternCityAtlas({ onOpenCustomer }: { onOpenCustomer: (phone: string) => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LanternCustomer | null>(null);
  const customers = trpc.admin.listCustomers.useQuery({ sortBy: "lastOrder", includeLegacyCleanCloud: true }, { staleTime: 60_000 });
  const pipeline = trpc.system.commercialPipeline.list.useQuery(undefined, { retry: false });
  const rows = customers.data?.customers ?? [];
  const mapped = useMemo(() => rows.map(customer => ({ customer, location: resolveCustomerMapLocation(customer), state: classifyLanternCustomer(customer) })).filter(item => item.location !== null), [rows]);
  const unmapped = rows.length - mapped.length;
  const normalizedQuery = query.trim().toLowerCase();
  const visible = mapped.filter(({ customer, location }) => !normalizedQuery || `${customerName(customer)} ${customer.address} ${location?.neighborhood}`.toLowerCase().includes(normalizedQuery));
  const counts = rows.reduce<Record<LanternState, number>>((acc, customer) => { acc[classifyLanternCustomer(customer)] += 1; return acc; }, { active: 0, dimming: 0, dark: 0 });
  const pursued = pipeline.data ? pipeline.data.filter(item => !TERMINAL_PIPELINE_STAGES.has(item.stage)).length : null;

  return (
    <main className="lc-page">
      <header className="lc-page-header"><div><span className="lc-spark">✦</span><h1>Lantern City Atlas — Los Angeles</h1><p>Illuminate every neighborhood. Grow every route.</p></div><label className="lc-search"><Search aria-hidden /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search customers, neighborhoods…" aria-label="Search Lantern City" />{query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X /></button> : null}</label></header>
      <section className="lc-status-grid" aria-label="Customer relationship counts">
        <StatusCard state="active" label="Active" value={customers.isLoading || customers.isError ? null : counts.active} note={customers.isError ? "Customer source unavailable" : "Active, new, or warm cadence"} />
        <StatusCard state="dimming" label="Dimming" value={customers.isLoading || customers.isError ? null : counts.dimming} note={customers.isError ? "Customer source unavailable" : "Cooling cadence"} />
        <StatusCard state="dark" label="Dark" value={customers.isLoading || customers.isError ? null : counts.dark} note={customers.isError ? "Customer source unavailable" : "Lapsed cadence"} />
        <StatusCard state="pursued" label="Pursued" value={pipeline.isLoading || pipeline.isError ? null : pursued} note={pipeline.error ? "Pipeline unavailable" : "Active persisted opportunities"} />
      </section>
      <section className="lc-map" aria-label="Customer relationship atlas">
        <img src={MAP_IMAGE} alt="Illustrated Los Angeles relationship atlas" />
        <div className="lc-map-wash" />
        {NEIGHBORHOODS.map(neighborhood => <span key={neighborhood.label} className="lc-neighborhood" style={{ left: `${neighborhood.x}%`, top: `${neighborhood.y}%` }}>{neighborhood.label}</span>)}
        {visible.map(({ customer, location, state }, index) => {
          if (!location) return null;
          const x = Math.max(4, Math.min(96, location.x + stableOffset(customer, 0)));
          const y = Math.max(8, Math.min(92, location.y + stableOffset(customer, 1)));
          return <button type="button" key={`${customer.phone}-${customer.lastOrderId}-${index}`} className={`lc-lantern state-${state}`} style={{ left: `${x}%`, top: `${y}%` }} onClick={() => setSelected(customer)} aria-label={`${customerName(customer)}, ${state}, ${location.neighborhood}`}><span className="lc-lantern-handle" /><span className="lc-lantern-body" /><span className="lc-lantern-base" /></button>;
        })}
        {!customers.isLoading && visible.length === 0 ? <div className="lc-map-empty"><strong>{customers.isError ? "Customer data unavailable" : "No mapped customers match this view"}</strong><span>{customers.isError ? "The authoritative customer source could not be read." : "Lanterns appear only when a customer has an authoritative location."}</span></div> : null}
      </section>
      <section className="lc-utility-row">
        <article className="lc-legend"><h2>Lantern legend</h2>{(["active", "dimming", "dark"] as LanternState[]).map(state => <span key={state}><i className={`lc-mini-lantern state-${state}`} /><strong>{state === "dark" ? "Dormant" : state[0].toUpperCase() + state.slice(1)}</strong></span>)}<span><i className="lc-mini-flame">♨</i><strong>Pursued</strong></span></article>
        <article className="lc-unmapped"><MapPinOff aria-hidden /><div><h2>Location unavailable</h2><strong>{unmapped}</strong><p>{unmapped === 1 ? "customer is" : "customers are"} held outside the map because no confident location mapping exists.</p></div></article>
      </section>
      {selected ? <aside className="lc-detail" aria-live="polite"><button type="button" onClick={() => setSelected(null)} aria-label="Close customer detail"><X /></button><span>{classifyLanternCustomer(selected)} lantern</span><h2>{customerName(selected)}</h2><p>{selected.address || "Address unavailable"}{selected.unit ? ` · Unit ${selected.unit}` : ""}</p><dl><div><dt>Last order</dt><dd>{selected.lastOrderAt ? new Date(selected.lastOrderAt).toLocaleDateString() : "Unavailable"}</dd></div><div><dt>Orders</dt><dd>{selected.totalOrders}</dd></div><div><dt>Last 90 days</dt><dd>{selected.ordersLast90Days}</dd></div><div><dt>Operational revenue</dt><dd>{formatMoney(selected.totalOperationalRevenue)}</dd></div></dl><button type="button" className="lc-open-customer" onClick={() => onOpenCustomer(selected.phone)}>Open customer evidence <ArrowRight /></button></aside> : null}
    </main>
  );
}
