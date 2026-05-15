import { Fragment, useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { ChevronDown, ChevronRight, Download, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { AppRouter } from "../../../server/routers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/useDebounce";
import { trpc } from "@/lib/trpc";

type RouterOutput = inferRouterOutputs<AppRouter>;
type OperationsEventRow = RouterOutput["admin"]["operationsEvents"]["list"]["rows"][number];

type BusinessUnitFilter = "all" | "laundry_butler" | "laundry_farm";
type BuildingFilter = "all" | "opus_la" | "century_park_east" | "other" | "unresolved";
type EventTypeFilter = "all" | "pickup_completed" | "dropoff_completed";

const PAGE_SIZE = 50;
const OPERATOR_TIME_ZONE = "America/Los_Angeles";

function dateInputValue(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATOR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return dateInputValue(d);
}

function defaultEndDate(): string {
  return dateInputValue(new Date());
}

function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatServiceType(value: string): string {
  if (value === "wash_fold") return "Wash & Fold";
  if (value === "dry_cleaning") return "Dry Cleaning";
  return value;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function RawSnapshot({ row }: { row: OperationsEventRow }) {
  const raw = row.rawJson ? JSON.stringify(row.rawJson, null, 2) : "";
  if (!raw) return <p className="text-xs text-black/45">No raw snapshot captured.</p>;
  return (
    <pre className="max-h-80 overflow-auto rounded border border-black/10 bg-black/[0.03] p-3 text-xs leading-relaxed text-black/70">
      {raw}
    </pre>
  );
}

export default function OperationsEventsPage() {
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [businessUnit, setBusinessUnit] = useState<BusinessUnitFilter>("all");
  const [building, setBuilding] = useState<BuildingFilter>("all");
  const [eventType, setEventType] = useState<EventTypeFilter>("all");
  const [customerSearch, setCustomerSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const debouncedSearch = useDebounce(customerSearch, 300);

  const queryInput = useMemo(
    () => ({
      startDate,
      endDate,
      businessUnit,
      building,
      eventType,
      customerSearch: debouncedSearch || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    [building, businessUnit, debouncedSearch, endDate, eventType, page, startDate]
  );

  const events = trpc.admin.operationsEvents.list.useQuery(queryInput);
  const exportCsv = trpc.admin.operationsEvents.exportCsv.useMutation();
  const data = events.data;

  const resetFilters = () => {
    setStartDate(defaultStartDate());
    setEndDate(defaultEndDate());
    setBusinessUnit("all");
    setBuilding("all");
    setEventType("all");
    setCustomerSearch("");
    setPage(1);
    setExpanded(null);
  };

  const handleExport = async () => {
    try {
      const result = await exportCsv.mutateAsync({
        startDate,
        endDate,
        businessUnit,
        building,
        eventType,
        customerSearch: debouncedSearch || undefined,
      });
      downloadCsv(result.filename, result.csv);
      toast.success(`Exported ${result.rowCount} operations event${result.rowCount === 1 ? "" : "s"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CSV export failed");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operations Events</h1>
          <p className="mt-1 text-sm text-black/55">Pickup and dropoff truth across all orders.</p>
        </div>
        <Button
          type="button"
          className="gap-2 bg-black text-white hover:bg-black/85"
          onClick={handleExport}
          disabled={exportCsv.isPending}
        >
          <Download className="h-4 w-4" />
          {exportCsv.isPending ? "Exporting..." : "Export CSV"}
        </Button>
      </div>

      <div className="grid gap-3 rounded border border-black/10 bg-white p-3 md:grid-cols-6">
        <label className="text-xs font-medium text-black/60">
          Start
          <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }} className="mt-1" />
        </label>
        <label className="text-xs font-medium text-black/60">
          End
          <Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }} className="mt-1" />
        </label>
        <label className="text-xs font-medium text-black/60">
          Business unit
          <select value={businessUnit} onChange={(e) => { setBusinessUnit(e.target.value as BusinessUnitFilter); setPage(1); }} className="mt-1 h-10 w-full rounded border border-black/15 bg-white px-3 text-sm">
            <option value="all">All</option>
            <option value="laundry_butler">Laundry Butler</option>
            <option value="laundry_farm">Laundry Farm</option>
          </select>
        </label>
        <label className="text-xs font-medium text-black/60">
          Building
          <select value={building} onChange={(e) => { setBuilding(e.target.value as BuildingFilter); setPage(1); }} className="mt-1 h-10 w-full rounded border border-black/15 bg-white px-3 text-sm">
            <option value="all">All</option>
            <option value="opus_la">OPUS LA</option>
            <option value="century_park_east">Century Park East</option>
            <option value="other">Other</option>
            <option value="unresolved">Unresolved</option>
          </select>
        </label>
        <label className="text-xs font-medium text-black/60">
          Event type
          <select value={eventType} onChange={(e) => { setEventType(e.target.value as EventTypeFilter); setPage(1); }} className="mt-1 h-10 w-full rounded border border-black/15 bg-white px-3 text-sm">
            <option value="all">All</option>
            <option value="pickup_completed">pickup_completed</option>
            <option value="dropoff_completed">dropoff_completed</option>
          </select>
        </label>
        <div className="flex items-end">
          <Button type="button" variant="outline" className="w-full gap-2" onClick={resetFilters}>
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
        </div>
        <label className="md:col-span-6 text-xs font-medium text-black/60">
          Customer search
          <Input
            value={customerSearch}
            onChange={(e) => { setCustomerSearch(e.target.value); setPage(1); }}
            placeholder="Search name, email, or phone"
            className="mt-1"
          />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {[
          ["Total events", data?.summary.totalEvents ?? 0],
          ["Pickups completed", data?.summary.pickupCount ?? 0],
          ["Dropoffs completed", data?.summary.dropoffCount ?? 0],
          ["Unresolved buildings", data?.summary.unresolvedBuildingCount ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-black/10 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-black/45">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-black">{value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded border border-black/10 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-[1200px] w-full text-sm">
            <thead className="bg-black/[0.03] text-left text-xs uppercase tracking-wide text-black/50">
              <tr>
                <th className="w-10 px-3 py-3" />
                <th className="px-3 py-3">Event timestamp</th>
                <th className="px-3 py-3">Event type</th>
                <th className="px-3 py-3">Customer</th>
                <th className="px-3 py-3">Business unit</th>
                <th className="px-3 py-3">Building / Tower / Unit</th>
                <th className="px-3 py-3">Scheduled</th>
                <th className="px-3 py-3">Actor</th>
                <th className="px-3 py-3">Vendor</th>
                <th className="px-3 py-3">Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {events.isLoading ? (
                <tr><td className="px-3 py-8 text-center text-black/45" colSpan={10}>Loading events...</td></tr>
              ) : data?.rows.length ? (
                data.rows.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="align-top hover:bg-black/[0.02]">
                      <td className="px-3 py-3">
                        <button type="button" className="rounded p-1 hover:bg-black/5" onClick={() => setExpanded(expanded === row.id ? null : row.id)} aria-label="Toggle raw snapshot">
                          {expanded === row.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{formatDateTime(row.actualEventTimestamp)}</td>
                      <td className="px-3 py-3 font-mono text-xs">{row.sourceEventType}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium">{row.customerName}</div>
                        <div className="text-xs text-black/45">{row.customerEmail || row.customerPhone || "-"}</div>
                      </td>
                      <td className="px-3 py-3">{row.businessUnitLabel}</td>
                      <td className="px-3 py-3">
                        <div>{row.buildingName || row.buildingSlug || "-"}</div>
                        <div className="text-xs text-black/45">{[row.tower, row.unit ? `Unit ${row.unit}` : null].filter(Boolean).join(" / ") || row.buildingResolutionStatus}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div>{row.scheduledDate || "-"}</div>
                        <div className="text-xs text-black/45">{row.scheduledWindow || "-"}</div>
                      </td>
                      <td className="px-3 py-3">{row.actorDisplayName || "-"}</td>
                      <td className="px-3 py-3">{row.vendorId ?? "-"}</td>
                      <td className="px-3 py-3">{row.orderId ? <a className="underline decoration-black/20 underline-offset-2 hover:decoration-black" href={`/intake?orderId=${row.orderId}`}>#{row.orderId}</a> : "-"}</td>
                    </tr>
                    {expanded === row.id ? (
                      <tr>
                        <td className="px-3 py-3" />
                        <td className="px-3 py-3" colSpan={9}>
                          <RawSnapshot row={row} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              ) : (
                <tr><td className="px-3 py-8 text-center text-black/45" colSpan={10}>No operations events match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-black/10 px-3 py-3 text-sm text-black/60">
          <span>
            Page {data?.page ?? page} of {data?.totalPages ?? 1} · {data?.totalRows ?? 0} events
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
            <Button type="button" variant="outline" size="sm" disabled={!data || page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
