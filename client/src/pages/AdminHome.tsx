import { useMemo } from "react";
import { ArrowRight, RefreshCw, TrendingUp, Users } from "lucide-react";
import type { Order } from "@shared/types";
import { trpc } from "@/lib/trpc";
import { classifyLanternCustomer } from "@/components/admin/control-room/LanternCityAtlas";

const WORLD_IMAGE = "/assets/admin/control-room/world/lantern-city-atlas.jpg";

type AdminHomeProps = {
  experienceMode?: "kingdom" | "operator-demo";
  operatorName?: string;
  path?: string;
  onOpenMobileNav?: () => void;
  onNavigate?: (path: string) => void;
  onOpenCustomer?: (phone: string) => void;
};

function todayYmd() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function money(value: number | null | undefined) {
  if (typeof value !== "number") return "Unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function orderName(order: Pick<Order, "firstName" | "lastName">) {
  return `${order.firstName ?? ""} ${order.lastName ?? ""}`.trim() || `Order customer`;
}

function MetricCard({ tone, icon, label, value, note }: { tone: string; icon: React.ReactNode; label: string; value: string; note: string }) {
  return <article className={`pwc-metric tone-${tone}`}><div className="pwc-metric-icon">{icon}</div><span><small>{label}</small><strong>{value}</strong><p>{note}</p></span><i /></article>;
}

export default function AdminHome({ operatorName = "Admin", path = "/", onNavigate = next => { window.location.href = next; } }: AdminHomeProps) {
  const options = { refetchInterval: 30_000, refetchOnWindowFocus: true } as const;
  const dashboard = trpc.admin.dashboardSummary.useQuery(undefined, options);
  const customers = trpc.admin.listCustomers.useQuery({ sortBy: "lastOrder", includeLegacyCleanCloud: true }, { staleTime: 60_000 });
  const received = trpc.admin.listByStatus.useQuery({ status: "new" }, options);
  const collected = trpc.admin.listByStatus.useQuery({ status: "collected" }, options);
  const processing = trpc.admin.listByStatus.useQuery({ status: "processing" }, options);
  const todayQueue = trpc.system.dayforgeToday.list.useQuery(undefined, { retry: false, refetchInterval: 30_000 });
  const rows = customers.data?.customers ?? [];
  const activeCustomers = rows.filter(customer => classifyLanternCustomer(customer) === "active").length;
  const churnRisk = rows.filter(customer => classifyLanternCustomer(customer) !== "active").length;
  const overdueFollowups = todayQueue.data?.filter(item => item.kind === "follow_up" && item.urgency === "overdue") ?? [];
  const promiseRisk = useMemo(() => [...(received.data ?? []), ...(collected.data ?? []), ...(processing.data ?? [])].filter(order => order.deliveryDate === todayYmd()), [received.data, collected.data, processing.data]);
  const buildingCounts = rows.reduce((acc, customer) => { if (customer.propertyGroup === "opus_la") acc.opus += 1; if (customer.propertyGroup === "century_park_east") acc.century += 1; return acc; }, { opus: 0, century: 0 });
  const firstName = operatorName.split(/\s+/)[0] || "Admin";
  const viewName = path.startsWith("/home/") ? path.split("/").pop() : "overview";
  const sourceGap = dashboard.isError || customers.isError || todayQueue.isError;
  const refresh = () => { void Promise.all([dashboard.refetch(), customers.refetch(), received.refetch(), collected.refetch(), processing.refetch(), todayQueue.refetch()]); };

  return <main className="pwc-page">
    <header className="pwc-title"><div><span>{viewName === "overview" ? "✦" : ""}</span><h1>{viewName === "overview" ? "Persistent World Control" : `Home · ${viewName?.replace(/^./, letter => letter.toUpperCase())}`}</h1><p>Real world. Real customers. Live business truth. You’re in control, {firstName}.</p></div><button type="button" onClick={refresh}><RefreshCw /> Refresh truth</button></header>
    <section className="pwc-metrics" aria-label="Authoritative business metrics">
      <MetricCard tone="purple" icon={<Users />} label="Active customers" value={customers.isLoading ? "—" : customers.isError ? "Unavailable" : String(activeCustomers)} note={customers.isError ? "Customer source unavailable" : "Active, new, or warm cadence"} />
      <MetricCard tone="green" icon={<span>$</span>} label="Revenue this month" value={dashboard.isLoading ? "—" : money(dashboard.data?.revenueMonth)} note={dashboard.data?.revenueTimestampBasis ? `Basis: ${dashboard.data.revenueTimestampBasis}` : "Source basis unavailable"} />
      <MetricCard tone="orange" icon={<span className="pwc-lantern-symbol" />} label="Churn-risk lanterns" value={customers.isLoading ? "—" : customers.isError ? "Unavailable" : String(churnRisk)} note={customers.isError ? "Customer source unavailable" : "Cooling or lapsed cadence"} />
      <MetricCard tone="blue" icon={<span>✓</span>} label="Overdue follow-ups" value={todayQueue.isLoading ? "—" : todayQueue.error ? "Unavailable" : String(overdueFollowups.length)} note="Persisted commercial follow-ups" />
    </section>
    <section className="pwc-world-layout">
      <div className="pwc-world" aria-label="Live world overview of Los Angeles customer geography">
        <img src={WORLD_IMAGE} alt="Illustrated Los Angeles business world" /><div className="pwc-world-shade" />
        <header><strong>Live world overview — Los Angeles</strong><span className={sourceGap ? "has-gap" : ""}><i /> {sourceGap ? "Source gap" : "Live"}</span></header>
        {[{ label: "West Hollywood", x: 13, y: 24 }, { label: "Beverly Hills", x: 12, y: 52 }, { label: "Century City", x: 18, y: 81 }, { label: "Hollywood", x: 46, y: 37 }, { label: "Koreatown", x: 54, y: 76 }, { label: "Los Feliz", x: 78, y: 25 }, { label: "Silver Lake", x: 84, y: 50 }, { label: "Echo Park", x: 87, y: 77 }].map(neighborhood => <span key={neighborhood.label} className="pwc-place" style={{ left: `${neighborhood.x}%`, top: `${neighborhood.y}%` }}>{neighborhood.label}</span>)}
        <button type="button" className="pwc-building cpe" onClick={() => onNavigate("/growth/tower-wars")}><img className="pwc-building-art" src="/assets/admin/control-room/tower-wars/century-park-east-tower-v2.png" alt="" /><strong>Century Park East</strong><small>Century City · {customers.isLoading || customers.isError ? "—" : buildingCounts.century} customers</small></button>
        <button type="button" className="pwc-building opus" onClick={() => onNavigate("/growth/tower-wars")}><img className="pwc-building-art" src="/assets/admin/control-room/tower-wars/opus-la-tower-v2.png" alt="" /><strong>OPUS LA</strong><small>Koreatown · {customers.isLoading || customers.isError ? "—" : buildingCounts.opus} customers</small></button>
        {churnRisk > 0 ? <button type="button" className="pwc-risk-lantern" onClick={() => onNavigate("/growth/lantern-city")} aria-label={`${churnRisk} churn-risk lanterns`}><span className="pwc-lantern-symbol" /><b>{churnRisk}</b></button> : null}
      </div>
      <aside className="pwc-alerts">
        {promiseRisk.length > 0 ? <article className="pwc-alert clockhead"><div className="pwc-character">◉</div><span><small>Clockhead alert</small><strong>{promiseRisk.length} {promiseRisk.length === 1 ? "promise" : "promises"} endangered</strong><p>{orderName(promiseRisk[0])}{promiseRisk.length > 1 ? ` and ${promiseRisk.length - 1} more` : ""} are due today and not ready.</p></span><button type="button" onClick={() => onNavigate("/processing")}>View at-risk orders <ArrowRight /></button></article> : <article className="pwc-alert is-clear"><span><small>Promise risk</small><strong>No endangered promises derived</strong><p>No connected order due today is currently outside Ready.</p></span></article>}
        {overdueFollowups.length > 0 ? <article className="pwc-alert collector"><div className="pwc-character">◆</div><span><small>Collector alert</small><strong>{overdueFollowups.length} follow-ups overdue</strong><p>Persisted commercial follow-up work is waiting.</p></span><button type="button" onClick={() => onNavigate("/commercial-pipeline")}>View overdue follow-ups <ArrowRight /></button></article> : <article className="pwc-alert is-clear"><span><small>Follow-up debt</small><strong>{todayQueue.error ? "Data unavailable" : "No overdue follow-ups"}</strong><p>{todayQueue.error ? "The persisted follow-up queue could not be read." : "No open persisted follow-up is currently overdue."}</p></span></article>}
      </aside>
    </section>
    <section className="pwc-insights"><h2>✦ Insights for visual learners</h2><div><article><span className="pwc-lantern-symbol" /><p><strong>{churnRisk} churn-risk lanterns detected.</strong><small>Every lantern is backed by a real customer cadence.</small></p></article><article><TrendingUp /><p><strong>{dashboard.data ? `${money(dashboard.data.revenueMonth)} revenue this month.` : "Revenue unavailable."}</strong><small>No reference-image placeholder values are used.</small></p></article><article><span className="pwc-world-dot" /><p><strong>{buildingCounts.opus + buildingCounts.century} customers mapped to known buildings.</strong><small>Uncertain locations remain outside the world map.</small></p></article></div></section>
  </main>;
}
