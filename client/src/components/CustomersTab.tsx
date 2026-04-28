import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import { BUILDINGS } from "@shared/buildings";

type RecencyStatus = "new" | "active" | "warm" | "cooling" | "lapsed";
type Tier = "vip" | "standard";
type BuildingSort = "revenue" | "orders" | "active";
type PropertyGroup = "opus_la" | "century_park_east" | "unknown";

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
  /** Latest order address from aggregate (for unresolved-building triage). */
  address: string;
  totalOrders: number;
  lifetimeSpend: number;
  lastOrderAt: Date | string;
  recencyStatus: RecencyStatus;
  tier: Tier;
  statusColor: string;
  propertyGroup?: PropertyGroup;
  propertyDisplayName?: string;
  towerKey?: string;
  towerDisplayName?: string;
  buildingAddressCanonical?: string | null;
  stripeVerifiedRevenue?: number;
  legacyCleanCloudRevenue?: number;
  totalOperationalRevenue?: number;
  source?: string;
  paymentProcessor?: string;
  includedInStripe?: boolean;
  cleanCloudLegacyBadge?: string;
  cleanCloudStripeStatus?: string;
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
  /** Default All — only send tier to API when VIP or Standard is explicitly chosen. */
  const [tierFilter, setTierFilter] = useState<Tier | "">("");
  const [buildingSort, setBuildingSort] = useState<BuildingSort>("revenue");
  const [includeLegacyCleanCloud, setIncludeLegacyCleanCloud] = useState(true);
  const [propertyFilter, setPropertyFilter] = useState<PropertyGroup | "">("");
  const [towerFilter, setTowerFilter] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const tierForApi = tierFilter === "" ? undefined : tierFilter;

  const list = trpc.admin.listCustomers.useQuery({
    search: debouncedSearch || undefined,
    sortBy: "lastOrder",
    status: statusFilter || undefined,
    tier: tierForApi,
    propertyGroup: propertyFilter || undefined,
    towerKey: towerFilter || undefined,
    includeLegacyCleanCloud,
  });

  const customers: CustomerRow[] = (list.data?.customers ?? []).map((row) => ({
    ...(row as CustomerRow),
    address:
      typeof (row as { address?: string }).address === "string"
        ? (row as { address: string }).address
        : "",
  }));
  const buildingSummary = (list.data?.buildingSummary ?? {}) as Record<
    string,
    BuildingSummaryEntry
  >;
  const contestTotals = list.data?.contestTotals as
    | {
        stripeOnlyHelperText: string;
        legacyHelperText: string;
        grand: {
          stripeVerifiedRevenue: number;
          legacyCleanCloudRevenue: number;
          totalOperationalRevenue: number;
        };
        properties: Record<
          string,
          {
            propertyDisplayName: string;
            stripeVerifiedRevenue: number;
            legacyCleanCloudRevenue: number;
            totalOperationalRevenue: number;
            towers: Record<
              string,
              {
                towerDisplayName: string;
                buildingAddressCanonical: string | null;
                stripeVerifiedRevenue: number;
                legacyCleanCloudRevenue: number;
                totalOperationalRevenue: number;
              }
            >;
          }
        >;
      }
    | undefined;

  const towerOptions = useMemo(() => {
    if (propertyFilter === "opus_la") {
      return [
        ["", "All OPUS LA"],
        ["opus_south_3545", "South Tower / 3545"],
        ["opus_north_3650", "North Tower / 3650"],
        ["unknown", "Unknown Tower"],
      ] as const;
    }
    if (propertyFilter === "century_park_east") {
      return [
        ["", "All Century Park East"],
        ["cpe_south_2170", "South Tower / 2170"],
        ["cpe_north_2160", "North Tower / 2160"],
      ] as const;
    }
    return [["", "All towers"]] as const;
  }, [propertyFilter]);

  const resolvedCustomers = useMemo(
    () =>
      customers.filter((c) => normalizeBuildingSlug(c.buildingSlug) !== "unknown"),
    [customers]
  );

  const unresolvedCustomers = useMemo(() => {
    const rows = customers.filter(
      (c) => normalizeBuildingSlug(c.buildingSlug) === "unknown"
    );
    return [...rows].sort(
      (a, b) =>
        new Date(b.lastOrderAt).getTime() - new Date(a.lastOrderAt).getTime()
    );
  }, [customers]);

  const buildingSections = useMemo(() => {
    const grouped = new Map<string, CustomerRow[]>();
    for (const c of resolvedCustomers) {
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
  }, [resolvedCustomers, buildingSummary, buildingSort]);

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

      <div className="rounded-md border border-black/10 bg-white px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-black">
            <input
              type="checkbox"
              checked={includeLegacyCleanCloud}
              onChange={(e) => setIncludeLegacyCleanCloud(e.target.checked)}
              className="h-4 w-4 rounded border-black/30"
            />
            Include legacy CleanCloud orders
          </label>
          <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-black/65">
            {includeLegacyCleanCloud ? "Operational performance view" : "Stripe verified only"}
          </span>
        </div>
        <p className="text-xs text-black/55">
          {includeLegacyCleanCloud
            ? contestTotals?.legacyHelperText
            : contestTotals?.stripeOnlyHelperText}
        </p>
      </div>

      {contestTotals && (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-black/10 bg-white p-3">
              <p className="text-xs uppercase tracking-wider text-black/45">Stripe verified revenue</p>
              <p className="text-2xl font-semibold text-black">${contestTotals.grand.stripeVerifiedRevenue.toFixed(2)}</p>
            </div>
            <div className="rounded-md border border-black/10 bg-white p-3">
              <p className="text-xs uppercase tracking-wider text-black/45">Legacy CleanCloud revenue</p>
              <p className="text-2xl font-semibold text-black">${contestTotals.grand.legacyCleanCloudRevenue.toFixed(2)}</p>
            </div>
            <div className="rounded-md border border-black/10 bg-white p-3">
              <p className="text-xs uppercase tracking-wider text-black/45">Total operational revenue</p>
              <p className="text-2xl font-semibold text-black">${contestTotals.grand.totalOperationalRevenue.toFixed(2)}</p>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {(["opus_la", "century_park_east"] as const).map((key) => {
              const prop = contestTotals.properties[key];
              const towerKeys =
                key === "opus_la"
                  ? ["opus_south_3545", "opus_north_3650", "unknown"]
                  : ["cpe_south_2170", "cpe_north_2160"];
              return (
                <section key={key} className="rounded-md border border-black/10 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-black">{prop.propertyDisplayName}</h3>
                      <p className="text-2xl font-semibold text-black">${prop.totalOperationalRevenue.toFixed(2)}</p>
                    </div>
                    <div className="text-right text-xs text-black/55">
                      <div>Stripe ${prop.stripeVerifiedRevenue.toFixed(2)}</div>
                      <div>CleanCloud ${prop.legacyCleanCloudRevenue.toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="mt-3 divide-y divide-black/5">
                    {towerKeys.map((towerKey) => {
                      const tower = prop.towers[towerKey];
                      return (
                        <div key={towerKey} className="flex items-center justify-between gap-3 py-2 text-sm">
                          <span className="text-black/75">
                            {tower.towerDisplayName}
                            {tower.buildingAddressCanonical ? ` / ${tower.buildingAddressCanonical.split(" ")[0]}` : ""}
                          </span>
                          <span className="font-medium text-black">${tower.totalOperationalRevenue.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

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
            Property
          </label>
          <select
            value={propertyFilter}
            onChange={(e) => {
              setPropertyFilter(e.target.value as PropertyGroup | "");
              setTowerFilter("");
            }}
            className="rounded-md border border-black/20 bg-white px-3 py-2 text-sm min-w-[160px]"
          >
            <option value="">All properties</option>
            <option value="opus_la">OPUS LA</option>
            <option value="century_park_east">Century Park East</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">
            Tower
          </label>
          <select
            value={towerFilter}
            onChange={(e) => setTowerFilter(e.target.value)}
            className="rounded-md border border-black/20 bg-white px-3 py-2 text-sm min-w-[170px]"
          >
            {towerOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
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
            <option value="">All tiers</option>
            <option value="vip">VIP</option>
            <option value="standard">Standard</option>
          </select>
        </div>
      </div>

      <p className="text-sm text-black/50">
        {customers.length === 0 ? (
          <>No customers match the current filters.</>
        ) : (
          (() => {
            let s = `${customers.length} customer${customers.length === 1 ? "" : "s"}`;
            if (buildingSections.length > 0) {
              s += ` across ${buildingSections.length} building${buildingSections.length === 1 ? "" : "s"}`;
            }
            if (unresolvedCustomers.length > 0) {
              s += ` · ${unresolvedCustomers.length} need building resolution`;
            }
            return <>{s}.</>;
          })()
        )}
      </p>

      <div className="space-y-5">
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
                <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-2 items-center px-4 py-2 text-[11px] uppercase tracking-wider text-black/45 bg-white/60">
                  <div>Name</div>
                  <div>Unit</div>
                  <div>Spend</div>
                  <div>Source</div>
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
                    <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-2 items-center text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-black truncate">
                          {r.firstName} {r.lastName}
                        </p>
                        <p className="text-xs text-black/45 truncate">
                          {[r.propertyDisplayName, r.towerDisplayName, r.buildingAddressCanonical]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="text-black/70">{r.unit || "—"}</div>
                      <div className="text-black/80 font-medium">${r.lifetimeSpend.toFixed(2)}</div>
                      <div className="space-y-1">
                        {(r.legacyCleanCloudRevenue ?? 0) > 0 ? (
                          <>
                            <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                              LEGACY · CLEANCLOUD
                            </span>
                            <div className="text-[11px] font-medium text-black/60">Not in Stripe</div>
                          </>
                        ) : (
                          <span className="text-xs text-black/45">Stripe</span>
                        )}
                      </div>
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

        {unresolvedCustomers.length > 0 && (
          <section className="rounded-md border border-amber-200/80 bg-amber-50/40">
            <div className="px-4 py-3 border-b border-amber-200/60">
              <p className="font-semibold text-base text-black">
                Needs Building Resolution
              </p>
              <p className="text-sm text-black/60 mt-0.5">
                {unresolvedCustomers.length} customer
                {unresolvedCustomers.length === 1 ? "" : "s"} — could not match{" "}
                <code className="text-xs bg-white/80 px-1 rounded">buildingSlug</code> or address
                to a known building. Open a profile to fix data upstream.
              </p>
            </div>
            <div className="divide-y divide-amber-100 overflow-x-auto">
              <div className="grid min-w-[640px] grid-cols-[minmax(0,1.1fr)_minmax(0,0.45fr)_minmax(0,0.5fr)_minmax(0,0.55fr)_minmax(0,1.35fr)] gap-2 items-center px-4 py-2 text-[10px] uppercase tracking-wider text-black/45 bg-white/50">
                <div>Name</div>
                <div>Unit</div>
                <div>Spend</div>
                <div>Last Order</div>
                <div>buildingSlug / address</div>
              </div>
              {unresolvedCustomers.map((r) => (
                <button
                  key={`needs-building:${r.phone}:${r.unit ?? ""}:${String(r.lastOrderAt)}:${r.address}`}
                  type="button"
                  onClick={() => onOpenProfile(r.phone)}
                  className="w-full min-w-[640px] px-4 py-2 text-left hover:bg-amber-100/50 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
                  aria-label={`Open profile for ${r.firstName} ${r.lastName}`}
                >
                  <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.45fr)_minmax(0,0.5fr)_minmax(0,0.55fr)_minmax(0,1.35fr)] gap-2 items-start text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-black truncate">
                        {[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}
                      </p>
                    </div>
                    <div className="text-black/70">{r.unit || "—"}</div>
                    <div className="text-black/80 font-medium">${r.lifetimeSpend.toFixed(2)}</div>
                    <div className="text-black/60 text-xs whitespace-nowrap">
                      {formatLastOrder(r.lastOrderAt)}
                    </div>
                    <div className="min-w-0 text-xs text-black/70 space-y-0.5">
                      <p className="truncate" title={r.buildingSlug ?? ""}>
                        <span className="text-black/45">slug:</span>{" "}
                        {r.buildingSlug?.trim() ? r.buildingSlug.trim() : "—"}
                      </p>
                      <p className="break-words line-clamp-3" title={r.address}>
                        <span className="text-black/45">addr:</span>{" "}
                        {r.address?.trim() ? r.address.trim() : "—"}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
