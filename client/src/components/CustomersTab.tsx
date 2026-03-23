import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";

type SortBy = "lastOrder" | "spend" | "orders";
type RecencyStatus = "new" | "active" | "warm" | "cooling" | "lapsed";
type Tier = "vip" | "standard";

type Props = {
  onOpenProfile: (phone: string) => void;
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

function floorBaseClass(recency: RecencyStatus | "none") {
  switch (recency) {
    case "active":
    case "new":
      return "bg-green-500";
    case "warm":
      return "bg-neutral-500";
    case "cooling":
      return "bg-amber-500";
    case "lapsed":
      return "bg-neutral-400";
    default:
      return "bg-red-500";
  }
}

function cleanPhoneForSms(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

export function CustomersTab({ onOpenProfile }: Props) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("lastOrder");
  const [statusFilter, setStatusFilter] = useState<RecencyStatus | "">("");
  const [tierFilter, setTierFilter] = useState<Tier | "">("");
  const [buildingFilter, setBuildingFilter] = useState<string>("");
  const [selectedFloor, setSelectedFloor] = useState<number | null>(null);
  const debouncedSearch = useDebounce(search, 300);

  const list = trpc.admin.listCustomers.useQuery({
    search: debouncedSearch || undefined,
    sortBy,
    status: statusFilter || undefined,
    tier: tierFilter || undefined,
    buildingSlug: buildingFilter || undefined,
  });

  const buildings = useMemo(() => {
    const s = new Set<string>();
    for (const r of list.data?.customers ?? []) {
      if (r.buildingSlug) s.add(r.buildingSlug);
    }
    return Array.from(s).sort();
  }, [list.data?.customers]);

  const rows = list.data?.customers ?? [];
  const territoryBuildingSlug = "opusla";
  const territoryBuildingName = "OPUS LA";

  const territorySummary = list.data?.buildingSummary?.[territoryBuildingSlug];
  const territoryCustomers = useMemo(
    () => rows.filter((r) => r.buildingSlug === territoryBuildingSlug),
    [rows]
  );
  const selectedFloorCustomers = useMemo(
    () =>
      selectedFloor == null
        ? []
        : territoryCustomers.filter((r) => r.floorNumber === selectedFloor),
    [selectedFloor, territoryCustomers]
  );

  const floorRows = useMemo(() => {
    const floorsFromSummary = Object.entries(territorySummary?.floors ?? {}).map(
      ([floor, metrics]) => ({
        floorNumber: Number(floor),
        ...metrics,
      })
    );
    floorsFromSummary.sort((a, b) => b.floorNumber - a.floorNumber);
    const maxCustomers = floorsFromSummary.reduce(
      (max, f) => Math.max(max, f.totalCustomers),
      0
    );

    return floorsFromSummary.map((f) => {
      const customersOnFloor = territoryCustomers.filter(
        (c) => c.floorNumber === f.floorNumber
      );
      const counts = {
        active: customersOnFloor.filter((c) => c.recencyStatus === "active").length,
        warm: customersOnFloor.filter((c) => c.recencyStatus === "warm").length,
        cooling: customersOnFloor.filter((c) => c.recencyStatus === "cooling").length,
        lapsed: customersOnFloor.filter((c) => c.recencyStatus === "lapsed").length,
        new: customersOnFloor.filter((c) => c.recencyStatus === "new").length,
      };
      const dominantRecency: RecencyStatus | "none" =
        counts.active > 0
          ? "active"
          : counts.new > 0
            ? "new"
            : counts.warm > 0
              ? "warm"
              : counts.cooling > 0
                ? "cooling"
                : counts.lapsed > 0
                  ? "lapsed"
                  : "none";
      const vipCount = customersOnFloor.filter((c) => c.tier === "vip").length;
      const vipHeavy =
        customersOnFloor.length > 0 &&
        vipCount / customersOnFloor.length >= 0.5;
      const density =
        maxCustomers > 0 ? f.totalCustomers / maxCustomers : 0;

      return {
        ...f,
        dominantRecency,
        vipHeavy,
        density,
      };
    });
  }, [territorySummary?.floors, territoryCustomers]);

  const topFloor = useMemo(() => {
    if (floorRows.length === 0) return null;
    return [...floorRows].sort((a, b) => b.totalRevenue - a.totalRevenue)[0];
  }, [floorRows]);

  const weakestFloor = useMemo(() => {
    if (floorRows.length === 0) return null;
    return [...floorRows].sort(
      (a, b) => a.activeCustomers - b.activeCustomers || a.totalCustomers - b.totalCustomers
    )[0];
  }, [floorRows]);

  const smsAllHref = useMemo(() => {
    if (selectedFloorCustomers.length === 0) return "";
    const recipients = selectedFloorCustomers
      .map((c) => cleanPhoneForSms(c.phone))
      .filter(Boolean)
      .join(",");
    const body = encodeURIComponent("Hi from Laundry Butler. We have service windows open this week.");
    return recipients ? `sms:${recipients}?body=${body}` : "";
  }, [selectedFloorCustomers]);

  const reengageHref = useMemo(() => {
    const targets = selectedFloorCustomers.filter((c) => c.recencyStatus === "lapsed");
    if (targets.length === 0) return "";
    const recipients = targets
      .map((c) => cleanPhoneForSms(c.phone))
      .filter(Boolean)
      .join(",");
    const body = encodeURIComponent("Hi from Laundry Butler. We miss you and would love to schedule your next pickup.");
    return recipients ? `sms:${recipients}?body=${body}` : "";
  }, [selectedFloorCustomers]);

  const rowsForTable = useMemo(() => {
    if (selectedFloor == null) return rows;
    return rows.filter(
      (r) => r.buildingSlug === territoryBuildingSlug && r.floorNumber === selectedFloor
    );
  }, [rows, selectedFloor]);

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
      <h2 className="text-lg font-semibold text-black">Customers</h2>
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
            Sort by
          </label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="rounded-md border border-black/20 bg-white px-3 py-2 text-sm"
          >
            <option value="lastOrder">Last order</option>
            <option value="spend">Lifetime spend</option>
            <option value="orders">Order count</option>
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
        <div>
          <label className="block text-xs font-medium text-black/50 uppercase tracking-wider mb-1">
            Building
          </label>
          <select
            value={buildingFilter}
            onChange={(e) => setBuildingFilter(e.target.value)}
            className="rounded-md border border-black/20 bg-white px-3 py-2 text-sm min-w-[140px]"
          >
            <option value="">All</option>
            {buildings.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs text-black/45">
        {rowsForTable.length} customer{rowsForTable.length === 1 ? "" : "s"} (grouped by exact phone). Spend and average
        use paid orders only.
      </p>

      {!!territorySummary && (
        <section className="border border-black/10 rounded-md p-3 bg-neutral-50/70">
          <h3 className="text-sm font-semibold text-black mb-3">
            Building territory view — {territoryBuildingName}
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
            <div className="space-y-2 text-sm">
              <div className="border border-black/10 rounded-md p-2.5 bg-white">
                <p className="text-xs text-black/50">Total customers</p>
                <p className="font-semibold text-black">{territorySummary.totalCustomers}</p>
              </div>
              <div className="border border-black/10 rounded-md p-2.5 bg-white">
                <p className="text-xs text-black/50">Active customers</p>
                <p className="font-semibold text-black">{territorySummary.activeCustomers}</p>
              </div>
              <div className="border border-black/10 rounded-md p-2.5 bg-white">
                <p className="text-xs text-black/50">Total revenue</p>
                <p className="font-semibold text-black">${territorySummary.totalRevenue.toFixed(2)}</p>
              </div>
              <div className="border border-black/10 rounded-md p-2.5 bg-white">
                <p className="text-xs text-black/50">Top floor (revenue)</p>
                <p className="font-semibold text-black">
                  {topFloor ? `${topFloor.floorNumber} • $${topFloor.totalRevenue.toFixed(2)}` : "—"}
                </p>
              </div>
              <div className="border border-black/10 rounded-md p-2.5 bg-white">
                <p className="text-xs text-black/50">Weakest floor</p>
                <p className="font-semibold text-black">
                  {weakestFloor
                    ? `${weakestFloor.floorNumber} • ${weakestFloor.activeCustomers} active`
                    : "—"}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {floorRows.map((f) => (
                <button
                  key={f.floorNumber}
                  type="button"
                  onClick={() => {
                    setSelectedFloor(f.floorNumber);
                    setBuildingFilter(territoryBuildingSlug);
                  }}
                  className={`w-full border rounded-md px-3 py-2 text-left transition ${
                    selectedFloor === f.floorNumber
                      ? "border-black bg-white"
                      : "border-black/10 bg-white/70 hover:bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs text-black/60 mb-1">
                    <span>Floor {f.floorNumber}</span>
                    <span>
                      {f.totalCustomers} cust · {f.activeCustomers} active · ${f.totalRevenue.toFixed(0)}
                    </span>
                  </div>
                  <div
                    className={`h-4 rounded ${floorBaseClass(f.dominantRecency)} ${
                      f.vipHeavy ? "ring-2 ring-amber-300/70" : ""
                    }`}
                    style={{ opacity: 0.35 + f.density * 0.65 }}
                  />
                </button>
              ))}

              {selectedFloor != null && (
                <div className="border border-black/10 rounded-md p-2.5 bg-white flex flex-wrap gap-2">
                  <span className="text-xs text-black/60 mr-1">
                    Floor {selectedFloor} actions
                  </span>
                  <Button size="sm" variant="outline" className="h-8 text-xs border-black/20" asChild>
                    <a href={smsAllHref || "#"} onClick={(e) => !smsAllHref && e.preventDefault()}>
                      Text all
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs border-black/20" asChild>
                    <a href={reengageHref || "#"} onClick={(e) => !reengageHref && e.preventDefault()}>
                      Re-engage
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-black/20"
                    onClick={() => {
                      setBuildingFilter(territoryBuildingSlug);
                    }}
                  >
                    View customers
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={() => setSelectedFloor(null)}
                  >
                    Clear floor
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {!!list.data?.buildingSummary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {Object.entries(list.data.buildingSummary).map(([slug, summary]) => (
            <div key={slug} className="border border-black/10 rounded-md p-2.5 text-xs bg-neutral-50/80">
              <p className="font-medium text-black mb-1">{slug}</p>
              <p className="text-black/60">Customers: {summary.totalCustomers}</p>
              <p className="text-black/60">Active: {summary.activeCustomers}</p>
              <p className="text-black/60">Revenue: ${summary.totalRevenue.toFixed(2)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto border border-black/10 rounded-md">
        <table className="w-full text-sm text-left">
          <thead className="bg-neutral-50 border-b border-black/10 text-xs uppercase text-black/45">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 font-medium">Building</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium text-right">Orders</th>
              <th className="px-3 py-2 font-medium text-right">Spend</th>
              <th className="px-3 py-2 font-medium">Last order</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Tier</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rowsForTable.map((r) => (
              <tr
                key={r.phone}
                className="border-b border-black/5 hover:bg-black/[0.02] cursor-pointer"
                onClick={() => onOpenProfile(r.phone)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenProfile(r.phone);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Open profile for ${r.firstName} ${r.lastName}`}
              >
                <td className="px-3 py-2 font-medium text-black">
                  {r.firstName} {r.lastName}
                </td>
                <td className="px-3 py-2 text-black/70">{r.unit || "—"}</td>
                <td className="px-3 py-2 text-black/70">{r.buildingSlug || "—"}</td>
                <td className="px-3 py-2 text-black/70 whitespace-nowrap">{r.phone}</td>
                <td className="px-3 py-2 text-black/60 max-w-[160px] truncate">{r.email || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.totalOrders}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  ${r.lifetimeSpend.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-black/60 whitespace-nowrap text-xs">
                  {new Date(r.lastOrderAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${statusBadgeClass(r.statusColor)}`}>
                    {formatStatusLabel(r.recencyStatus)}
                  </span>
                </td>
                <td className="px-3 py-2 text-black/70 uppercase text-xs font-medium">{r.tier}</td>
                <td className="px-3 py-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-black/20"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenProfile(r.phone);
                    }}
                  >
                    Profile
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
