import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import { BUILDINGS } from "@shared/buildings";

type RecencyStatus = "new" | "active" | "warm" | "cooling" | "lapsed";
type Tier = "vip" | "standard";
type BuildingSort = "revenue" | "orders" | "active";

type Props = {
  onOpenProfile: (phone: string) => void;
};

type CustomerRow = {
  phone: string;
  firstName: string;
  lastName: string;
  email: string | null;
  unit: string | null;
  buildingSlug: string | null;
  totalOrders: number;
  lifetimeSpend: number;
  lastOrderAt: Date | string;
  recencyStatus: RecencyStatus;
  tier: Tier;
  statusColor: string;
};

type BuildingSummaryEntry = {
  totalCustomers: number;
  activeCustomers: number;
  totalRevenue: number;
  floors?: Record<string, { totalCustomers: number; activeCustomers: number; totalRevenue: number }>;
  estimatedUnits?: number;
};

function formatStatusLabel(s: RecencyStatus) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusBadgeClass(token: string) {
  switch (token) {
    case "success":
      return "bg-green-100 text-green-700";
    case "warning":
      return "bg-amber-100 text-amber-700";
    case "danger":
      return "bg-red-100 text-red-700";
    case "info":
      return "bg-blue-100 text-blue-700";
    case "muted":
      return "bg-neutral-200 text-neutral-600";
    default:
      return "bg-neutral-100 text-neutral-700";
  }
}

const buildingNameBySlug = new Map(
  BUILDINGS.map((b) => [b.slug.toLowerCase(), b.name])
);

function formatBuildingLabel(slug: string) {
  const configured = buildingNameBySlug.get(slug.toLowerCase());
  if (configured) return configured;
  return slug
    .split(/[_-]/g)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function normalizeBuildingSlug(slug: string | null | undefined): string {
  const s = (slug || "").trim().toLowerCase();
  if (!s) return "unknown";
  if (
    s === "unknown" ||
    s === "unassigned" ||
    s === "unknown/unassigned" ||
    s === "unknown / unassigned"
  ) {
    return "unknown";
  }
  return s;
}

function formatLastOrder(value: Date | string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function CustomersTab({ onOpenProfile }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RecencyStatus | "">("");
  const [tierFilter, setTierFilter] = useState<Tier | "">("");
  const [buildingSort, setBuildingSort] = useState<BuildingSort>("revenue");
  const debouncedSearch = useDebounce(search, 300);

  const list = trpc.admin.listCustomers.useQuery({
    search: debouncedSearch || undefined,
    sortBy: "lastOrder",
    status: statusFilter || undefined,
    tier: tierFilter || undefined,
  });

  const customers: CustomerRow[] = (list.data?.customers ?? []) as CustomerRow[];
  const buildingSummary = (list.data?.buildingSummary ?? {}) as Record<
    string,
    BuildingSummaryEntry
  >;

  /** Leaderboard hides unassigned rows (test/bad data); drawer and APIs unchanged. */
  const leaderboardCustomers = useMemo(
    () =>
      customers.filter((c) => normalizeBuildingSlug(c.buildingSlug) !== "unknown"),
    [customers]
  );

  const buildingSections = useMemo(() => {
    const grouped = new Map<string, CustomerRow[]>();
    for (const c of leaderboardCustomers) {
      const key = normalizeBuildingSlug(c.buildingSlug);
      const arr = grouped.get(key);
      if (arr) arr.push(c);
      else grouped.set(key, [c]);
    }

    const sections = Array.from(grouped.entries()).map(([slug, rows]) => {
      const summary = buildingSummary[slug];
      const totalOrders = rows.reduce((sum, r) => sum + (r.totalOrders || 0), 0);
      const lapsedCount = rows.filter((r) => r.recencyStatus === "lapsed").length;
      const estimatedUnits =
        typeof summary?.estimatedUnits === "number" ? summary.estimatedUnits : null;
      const penetrationPercent =
        estimatedUnits && estimatedUnits > 0
          ? Math.round((rows.length / estimatedUnits) * 1000) / 10
          : null;
      const floorsWithZeroCustomers = summary?.floors
        ? Object.entries(summary.floors)
            .filter(([, v]) => (v?.totalCustomers ?? 0) === 0)
            .map(([f]) => f)
        : [];

      rows.sort((a, b) => {
        const ta = new Date(a.lastOrderAt).getTime();
        const tb = new Date(b.lastOrderAt).getTime();
        return tb - ta;
      });

      return {
        slug,
        label: formatBuildingLabel(slug),
        totalRevenue: summary?.totalRevenue ?? rows.reduce((sum, r) => sum + (r.lifetimeSpend || 0), 0),
        totalCustomers: summary?.totalCustomers ?? rows.length,
        activeCustomers:
          summary?.activeCustomers ?? rows.filter((r) => r.recencyStatus === "active").length,
        totalOrders,
        lapsedCount,
        penetrationPercent,
        floorsWithZeroCustomers,
        customers: rows,
      };
    });

    sections.sort((a, b) => {
      if (buildingSort === "orders") return b.totalOrders - a.totalOrders;
      if (buildingSort === "active") return b.activeCustomers - a.activeCustomers;
      return b.totalRevenue - a.totalRevenue;
    });

    const revenueRanked = [...sections].sort((a, b) => b.totalRevenue - a.totalRevenue);
    const lowestRevenue =
      revenueRanked.length > 0
        ? Math.min(...revenueRanked.map((s) => s.totalRevenue))
        : null;
    const rankBySlug = new Map(
      revenueRanked.map((s, i) => [s.slug, i + 1])
    );

    return sections.map((s) => ({
      ...s,
      rankLabel:
        lowestRevenue != null && s.totalRevenue === lowestRevenue
          ? "LAST"
          : `#${rankBySlug.get(s.slug) ?? "?"}`,
    }));
  }, [leaderboardCustomers, buildingSummary, buildingSort]);

  const maxRevenue = useMemo(
    () => buildingSections.reduce((m, s) => Math.max(m, s.totalRevenue), 0),
    [buildingSections]
  );

  if (list.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-black/30" />
      </div>
    );
  }

  if (list.error) {
    return <p className="text-sm text-red-600">Failed to load customers.</p>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-black">Building Leaderboard</h2>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-end flex-wrap">
        <div className="max-w-xs flex-1">
          <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">
            Search
          </label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, phone, email"
            className="bg-white border-black/20"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">
            Building sort
          </label>
          <select
            value={buildingSort}
            onChange={(e) => setBuildingSort(e.target.value as BuildingSort)}
            className="rounded-md border border-black/20 bg-white px-3 py-2 text-sm min-w-[150px]"
          >
            <option value="revenue">Revenue</option>
            <option value="orders">Total orders</option>
            <option value="active">Active customers</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">
            Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as RecencyStatus | "")}
            className="rounded-md border border-black/20 bg-white px-3 py-2 text-sm min-w-[120px]"
          >
            <option value="">All</option>
            <option value="new">New</option>
            <option value="active">Active</option>
            <option value="warm">Warm</option>
            <option value="cooling">Cooling</option>
            <option value="lapsed">Lapsed</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">
            Tier
          </label>
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value as Tier | "")}
            className="rounded-md border border-black/20 bg-white px-3 py-2 text-sm min-w-[120px]"
          >
            <option value="">All</option>
            <option value="vip">VIP</option>
            <option value="standard">Standard</option>
          </select>
        </div>
      </div>

      <p className="text-sm text-black/50">
        {leaderboardCustomers.length} customer
        {leaderboardCustomers.length === 1 ? "" : "s"} across{" "}
        {buildingSections.length} building
        {buildingSections.length === 1 ? "" : "s"}
        {customers.length > leaderboardCustomers.length
          ? ` (${customers.length - leaderboardCustomers.length} unassigned hidden)`
          : ""}
        .
      </p>

      <div className="space-y-5">
        {buildingSections.length === 0 && (
          <p className="text-sm text-black/50 py-6">
            No customers with a resolved building in the current filters. Unassigned rows are hidden
            on this view.
          </p>
        )}
        {buildingSections.map((section, idx) => {
          const intensity = maxRevenue > 0 ? section.totalRevenue / maxRevenue : 0;
          const sectionStyle =
            idx === 0
              ? "border-black/25 bg-white shadow-md"
              : intensity < 0.35
                ? "border-black/10 bg-neutral-50/50"
                : "border-black/10 bg-white";
          return (
            <section key={section.slug} className={`rounded-md border ${sectionStyle}`}>
              <div className="px-4 py-3 border-b border-black/10">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className={`font-semibold ${idx === 0 ? "text-lg" : "text-base"} text-black`}>
                      {section.label} <span className="text-black/45">- {section.rankLabel}</span>
                    </p>
                    <p className={`font-semibold ${idx === 0 ? "text-4xl" : "text-3xl"} tracking-tight text-black`}>
                      ${section.totalRevenue.toFixed(0)}
                    </p>
                    <p className="text-sm text-black/55">
                      {section.totalCustomers} customers · {section.activeCustomers} active
                    </p>
                  </div>
                  <p className="text-xs text-black/45">
                    {section.totalCustomers} customers · {section.activeCustomers}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-black/60">
                  <span>Lapsed: {section.lapsedCount}</span>
                  {section.penetrationPercent != null && (
                    <span>Penetration: {section.penetrationPercent}%</span>
                  )}
                  {section.floorsWithZeroCustomers.length > 0 && (
                    <span>Floors with 0 customers: {section.floorsWithZeroCustomers.join(", ")}</span>
                  )}
                </div>
              </div>

              <div className="divide-y divide-black/5">
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 items-center px-4 py-2 text-[11px] uppercase tracking-wider text-black/45 bg-white/60">
                  <div>Name</div>
                  <div>Unit</div>
                  <div>Spend</div>
                  <div>Last Order</div>
                  <div>Status</div>
                  <div>Tier</div>
                </div>
                {section.customers.map((r) => (
                  <button
                    key={`${section.slug}:${r.phone}:${r.unit ?? ""}:${String(r.lastOrderAt)}`}
                    type="button"
                    onClick={() => onOpenProfile(r.phone)}
                    className="w-full px-4 py-2 text-left hover:bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-black/20"
                    aria-label={`Open profile for ${r.firstName} ${r.lastName}`}
                  >
                    <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 items-center text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-black truncate">
                          {r.firstName} {r.lastName}
                        </p>
                      </div>
                      <div className="text-black/70">{r.unit || "—"}</div>
                      <div className="text-black/80 font-medium">${r.lifetimeSpend.toFixed(2)}</div>
                      <div className="text-black/60 text-xs">
                        {formatLastOrder(r.lastOrderAt)}
                      </div>
                      <div>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${statusBadgeClass(r.statusColor)}`}>
                          {formatStatusLabel(r.recencyStatus)}
                        </span>
                      </div>
                      <div className="text-black/70 uppercase text-xs font-medium">{r.tier}</div>
                    </div>
                  </button>
                ))}
                {section.customers.length === 0 && (
                  <div className="px-4 py-3 text-xs text-black/50">No customers in current filter.</div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
