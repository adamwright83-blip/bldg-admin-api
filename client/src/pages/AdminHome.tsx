import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, RefreshCw, TrendingUp, Users } from "lucide-react";
import type { Order } from "@shared/types";
import { trpc } from "@/lib/trpc";
import { classifyLanternCustomer } from "@/components/admin/control-room/LanternCityAtlas";
import { CityTowerButton } from "@/components/admin/control-room/CityTowerButton";
import { useLanternVitality } from "@/components/admin/control-room/useLanternVitality";
import { speak } from "@shared/goldlineVoice";
import { WorldGeographySurface } from "@/components/admin/control-room/WorldGeographySurface";
import { WorldDayPhaseIndicator } from "@/components/admin/control-room/WorldDayPhase";
import { clusterGeographicCustomers, clustersAsGoogleEntities, fanOutAtlasCollisions } from "@/components/admin/control-room/customerGeography";
import type { CustomerLocationCluster } from "@/components/admin/control-room/customerGeography";
import { CustomerClusterDetail } from "@/components/admin/control-room/CustomerClusterDetail";

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

export default function AdminHome({ operatorName = "Admin", path = "/", onNavigate = next => { window.location.href = next; }, onOpenCustomer }: AdminHomeProps) {
  const options = { refetchInterval: 30_000, refetchOnWindowFocus: true } as const;
  const dashboard = trpc.admin.dashboardSummary.useQuery(undefined, options);
  const customers = trpc.admin.listCustomers.useQuery({ sortBy: "lastOrder", includeLegacyCleanCloud: true }, { staleTime: 60_000 });
  /*
    Which customers sit in which tower, and how they are doing. Separate from
    `customers` above because this one is bound to buildings through the order
    each customer was last served on — the only building evidence a churn
    snapshot carries.
  */
  const cityVitality = trpc.system.churnRadar.cityVitality.useQuery(undefined, { staleTime: 60_000 });
  const received = trpc.admin.listByStatus.useQuery({ status: "new" }, options);
  const collected = trpc.admin.listByStatus.useQuery({ status: "collected" }, options);
  const processing = trpc.admin.listByStatus.useQuery({ status: "processing" }, options);
  const todayQueue = trpc.system.dayforgeToday.list.useQuery(undefined, { retry: false, refetchInterval: 30_000 });
  const towerToday = trpc.system.towerWars.today.useQuery(undefined, options);
  const geographicAtlas = trpc.system.geographicTruth.atlas.useQuery(undefined, { staleTime: 30_000 });
  const customerClusters = useMemo(() => clusterGeographicCustomers((geographicAtlas.data?.customers ?? []) as any), [geographicAtlas.data?.customers]);
  const [selectedCluster, setSelectedCluster] = useState<CustomerLocationCluster | null>(null);
  const geographicEntities = useMemo(() => clustersAsGoogleEntities(customerClusters, setSelectedCluster), [customerClusters]);

  const rows = customers.data?.customers ?? [];
  const activeCustomers = rows.filter(customer => classifyLanternCustomer(customer) === "active").length;
  const churnRisk = rows.filter(customer => classifyLanternCustomer(customer) !== "active").length;
  const overdueFollowups = todayQueue.data?.filter(item => item.kind === "follow_up" && item.urgency === "overdue") ?? [];
  const promiseRisk = useMemo(() => [...(received.data ?? []), ...(collected.data ?? []), ...(processing.data ?? [])].filter(order => order.deliveryDate === todayYmd()), [received.data, collected.data, processing.data]);
  const buildingCounts = rows.reduce((acc, customer) => { if (customer.propertyGroup === "opus_la") acc.opus += 1; if (customer.propertyGroup === "century_park_east") acc.century += 1; return acc; }, { opus: 0, century: 0 });
  const opusRevenue = towerToday.data?.state.buildings.opus_la.revenueCents ?? null;
  const cpeRevenue = towerToday.data?.state.buildings.century_park_east.revenueCents ?? null;
  const pressureBuilding = opusRevenue !== null && cpeRevenue !== null && opusRevenue !== cpeRevenue ? (opusRevenue < cpeRevenue ? "opus_la" : "century_park_east") : null;
  const [revenueCue, setRevenueCue] = useState<"opus_la" | "century_park_east" | null>(null);
  const priorTowerEvents = useRef<string[] | null>(null);
  useEffect(() => {
    if (!towerToday.data) return;
    const ids = towerToday.data.ledger.map(item => item.eventId);
    if (priorTowerEvents.current === null) { priorTowerEvents.current = ids; return; }
    const known = new Set(priorTowerEvents.current);
    const newest = towerToday.data.ledger.filter(item => !known.has(item.eventId)).at(-1);
    priorTowerEvents.current = ids;
    if (!newest) return;
    setRevenueCue(newest.buildingId);
    const timer = window.setTimeout(() => setRevenueCue(null), 1400);
    return () => window.clearTimeout(timer);
  }, [towerToday.data]);
  const { byBuilding: buildingVitality, unresolvedLabel } = useLanternVitality(cityVitality.data);

  /*
    The city says one true sentence about the morning, built from the same counts
    the windows are lit from. Salted with the scan id rather than the render, so
    the line is stable while you look at it and changes when the world does —
    a sentence that reshuffled on every re-render would read as noise.
  */
  const morningLine = useMemo(() => {
    const buildings = Array.from(buildingVitality.values());
    const quiet = buildings.reduce((sum, b) => sum + b.quietCount, 0);
    const known = buildings.reduce((sum, b) => sum + b.warmCount + b.quietCount, 0);
    if (known === 0) return null;
    return speak({
      moment: "morning_report",
      slots: { count: quiet, total: known },
      salt: cityVitality.data?.scanId ?? "",
    });
  }, [buildingVitality, cityVitality.data?.scanId]);
  const firstName = operatorName.split(/\s+/)[0] || "Admin";
  const viewName = path.startsWith("/home/") ? path.split("/").pop() : "overview";
  const sourceGap = dashboard.isError || customers.isError || todayQueue.isError || towerToday.isError;

  const refresh = () => { void Promise.all([dashboard.refetch(), customers.refetch(), received.refetch(), collected.refetch(), processing.refetch(), todayQueue.refetch(), towerToday.refetch()]); };

  return <main className="pwc-page">
    <header className="pwc-title">
      <div>
        <span>{viewName === "overview" ? "✦" : ""}</span>
        <h1>{viewName === "overview" ? "Persistent World Control" : `Home · ${viewName?.replace(/^./, letter => letter.toUpperCase())}`}</h1>
        <p>Real world. Real customers. Live business truth. You’re in control, {firstName}.</p>
      </div>
      <div className="pwc-header-actions">
        <WorldDayPhaseIndicator />
        <button type="button" onClick={refresh}><RefreshCw /> Refresh truth</button>
      </div>
    </header>

    <section className="pwc-metrics" aria-label="Authoritative business metrics">
      <MetricCard tone="purple" icon={<Users />} label="Active customers" value={customers.isLoading ? "—" : customers.isError ? "Unavailable" : String(activeCustomers)} note={customers.isError ? "Customer source unavailable" : "Active, new, or warm cadence"} />
      <MetricCard tone="green" icon={<span>$</span>} label="Revenue this month" value={dashboard.isLoading ? "—" : money(dashboard.data?.revenueMonth)} note={dashboard.data?.revenueTimestampBasis ? `Basis: ${dashboard.data.revenueTimestampBasis}` : "Source basis unavailable"} />
      <MetricCard tone="orange" icon={<span className="pwc-lantern-symbol" />} label="Churn-risk lanterns" value={customers.isLoading ? "—" : customers.isError ? "Unavailable" : String(churnRisk)} note={customers.isError ? "Customer source unavailable" : "Cooling or lapsed cadence"} />
      <MetricCard tone="blue" icon={<span>✓</span>} label="Overdue follow-ups" value={todayQueue.isLoading ? "—" : todayQueue.error ? "Unavailable" : String(overdueFollowups.length)} note="Persisted commercial follow-ups" />
    </section>

    <section className="pwc-world-layout">
      <div className="pwc-world" aria-label="Live world overview of Los Angeles customer geography">
        <WorldGeographySurface
          mode="overview"
          onNavigate={onNavigate}
          showNeighborhoods={true}
          showOpportunityLayer={true}
          geographicEntities={geographicEntities}
          battleState={{ pressureBuilding, revenueCue, revenues: { opus_la: opusRevenue, century_park_east: cpeRevenue } }}
          buildingVitality={buildingVitality}
        >
          <header className="pwc-world-header">
            <strong>Live world overview — Los Angeles</strong>
            <span className={sourceGap ? "has-gap" : ""}>
              <i /> {sourceGap ? "Source gap" : "Living LA Live"}
            </span>
          </header>
          {/*
            Customers we could not place in any tower. Shown rather than dropped:
            a city that silently omits them reads as "there are no others", which
            is a quieter untruth than a wrong placement but an untruth all the
            same.
          */}
          {/*
            Stacked in one column rather than pinned to opposite corners. Pinned
            separately they overlapped each other AND the map's zoom controls at
            phone width — the unplaced label was already doing so before the
            voice line joined it.
          */}
          {unresolvedLabel || morningLine ? (
            <div className="pwc-world-notes">
              {morningLine ? (
                <p className="pwc-world-voice" data-testid="city-voice">{morningLine.text}</p>
              ) : null}
              {unresolvedLabel ? (
                <p className="pwc-world-unplaced" data-testid="city-unplaced">{unresolvedLabel}</p>
              ) : null}
            </div>
          ) : null}
          {fanOutAtlasCollisions(customerClusters.filter(cluster => !cluster.outsideAtlas)).map(({ cluster, fanSlot }) => (
            <Fragment key={cluster.key}>
              {fanSlot > 0 ? (
                <>
                  <span className="lc-anchor" style={{ left: `${cluster.x}%`, top: `${cluster.y}%` }} aria-hidden />
                  <span className={`lc-stem fan-${fanSlot}`} style={{ left: `${cluster.x}%`, top: `${cluster.y}%` }} aria-hidden />
                </>
              ) : null}
              <button type="button" className={`lc-lantern state-${cluster.dark === cluster.total ? "dark" : cluster.dimming > 0 || cluster.dark > 0 ? "dimming" : "active"}${fanSlot > 0 ? ` fan-${fanSlot}` : ""}`} style={{ left: `${cluster.x}%`, top: `${cluster.y}%` }} onClick={() => setSelectedCluster(cluster)} aria-label={`${cluster.total} customer${cluster.total === 1 ? "" : "s"} at this location`}><span className="lc-lantern-handle" /><span className="lc-lantern-body" /><span className="lc-lantern-base" />{cluster.total > 1 ? <b>{cluster.total}</b> : null}</button>
            </Fragment>
          ))}
          {customerClusters.filter(cluster => cluster.outsideAtlas).length > 0 ? <button type="button" className="pwc-risk-lantern" onClick={() => onNavigate("/growth/lantern-city")}>{customerClusters.filter(cluster => cluster.outsideAtlas).reduce((sum, cluster) => sum + cluster.total, 0)} outside atlas</button> : null}
        </WorldGeographySurface>
      </div>

      <aside className="pwc-alerts">
        {promiseRisk.length > 0 ? (
          <article className="pwc-alert clockhead">
            <div className="pwc-character">◉</div>
            <span>
              <small>Clockhead alert</small>
              <strong>{promiseRisk.length} {promiseRisk.length === 1 ? "promise" : "promises"} endangered</strong>
              <p>{orderName(promiseRisk[0])}{promiseRisk.length > 1 ? ` and ${promiseRisk.length - 1} more` : ""} are due today and not ready.</p>
            </span>
            <button type="button" onClick={() => onNavigate("/processing")}>
              View at-risk orders <ArrowRight />
            </button>
          </article>
        ) : (
          <article className="pwc-alert is-clear">
            <span>
              <small>Promise risk</small>
              <strong>No endangered promises derived</strong>
              <p>No connected order due today is currently outside Ready.</p>
            </span>
          </article>
        )}

        {overdueFollowups.length > 0 ? (
          <article className="pwc-alert collector">
            <div className="pwc-character">◆</div>
            <span>
              <small>Collector alert</small>
              <strong>{overdueFollowups.length} follow-ups overdue</strong>
              <p>Persisted commercial follow-up work is waiting.</p>
            </span>
            <button type="button" onClick={() => onNavigate("/commercial-pipeline")}>
              View overdue follow-ups <ArrowRight />
            </button>
          </article>
        ) : (
          <article className="pwc-alert is-clear">
            <span>
              <small>Follow-up debt</small>
              <strong>{todayQueue.error ? "Data unavailable" : "No overdue follow-ups"}</strong>
              <p>{todayQueue.error ? "The persisted follow-up queue could not be read." : "No open persisted follow-up is currently overdue."}</p>
            </span>
          </article>
        )}
      </aside>
    </section>

    {selectedCluster ? <CustomerClusterDetail cluster={selectedCluster} onClose={() => setSelectedCluster(null)} onOpenCustomer={phone => onOpenCustomer?.(phone)} /> : null}

    <section className="pwc-insights">
      <h2>✦ Insights for visual learners</h2>
      <div>
        <article>
          <span className="pwc-lantern-symbol" />
          <p>
            <strong>{churnRisk} churn-risk lanterns detected.</strong>
            <small>Every lantern is backed by a real customer cadence.</small>
          </p>
        </article>
        <article>
          <TrendingUp />
          <p>
            <strong>{dashboard.data ? `${money(dashboard.data.revenueMonth)} revenue this month.` : "Revenue unavailable."}</strong>
            <small>Live business revenue basis.</small>
          </p>
        </article>
        <article>
          <span className="pwc-world-dot" />
          <p>
            <strong>{buildingCounts.opus + buildingCounts.century} customers mapped to known buildings.</strong>
            <small>Real Los Angeles geospatial coordinates authoritative.</small>
          </p>
        </article>
      </div>
    </section>
  </main>;
}
