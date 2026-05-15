import { useMemo, useState } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

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

function money(cents: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents ?? 0) / 100);
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function reportLabel(sourceReportType: string): string {
  return sourceReportType === "orders_revenue" ? "orders_revenue fallback" : "orders_sales";
}

export default function PaymentReconciliationPage() {
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [businessUnit, setBusinessUnit] = useState<"all" | "laundry_butler" | "laundry_farm">("all");
  const [status, setStatus] = useState<"all" | "matched" | "unmatched" | "needs_review" | "possible_duplicate" | "ignored">("all");

  const queryInput = useMemo(
    () => ({ startDate, endDate, businessUnit, status, processor: "clearent" as const }),
    [businessUnit, endDate, startDate, status]
  );
  const reconciliation = trpc.admin.paymentReconciliation.summary.useQuery(queryInput);
  const data = reconciliation.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payment Reconciliation</h1>
          <p className="mt-1 text-sm text-black/55">Clearent payment truth matched against CleanCloud paid orders.</p>
        </div>
        <Button type="button" variant="outline" className="gap-2" onClick={() => reconciliation.refetch()} disabled={reconciliation.isFetching}>
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <div className="flex gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{data?.warning ?? "Clearent daily summaries prove money collected. Customer rankings update only after dollars are reconciled to orders."}</p>
        </div>
      </div>

      <div className="grid gap-3 rounded border border-black/10 bg-white p-3 md:grid-cols-4">
        <label className="text-xs font-medium text-black/60">
          Start
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1" />
        </label>
        <label className="text-xs font-medium text-black/60">
          End
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1" />
        </label>
        <label className="text-xs font-medium text-black/60">
          Business unit
          <select value={businessUnit} onChange={(e) => setBusinessUnit(e.target.value as typeof businessUnit)} className="mt-1 h-10 w-full rounded border border-black/15 bg-white px-3 text-sm">
            <option value="all">All</option>
            <option value="laundry_butler">Laundry Butler</option>
            <option value="laundry_farm">Laundry Farm</option>
          </select>
        </label>
        <label className="text-xs font-medium text-black/60">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="mt-1 h-10 w-full rounded border border-black/15 bg-white px-3 text-sm">
            <option value="all">All</option>
            <option value="matched">Matched</option>
            <option value="needs_review">Needs review</option>
            <option value="unmatched">Unmatched</option>
            <option value="possible_duplicate">Possible duplicate</option>
            <option value="ignored">Ignored</option>
          </select>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {[
          ["Clearent collected", money(data?.totals.clearentCollectedCents)],
          ["CleanCloud candidates", money(data?.totals.cleancloudCandidateOrderCents)],
          ["Reconciled customer revenue", money(data?.totals.reconciledCustomerRevenueCents)],
          ["Unresolved delta", money(data?.totals.unresolvedDeltaCents)],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-black/10 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-black/45">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-black">{value}</p>
          </div>
        ))}
      </div>

      <section className="rounded border border-black/10 bg-white">
        <div className="border-b border-black/10 p-4">
          <h2 className="font-semibold">Needs Review</h2>
          <p className="mt-1 text-sm text-black/50">Mismatched daily totals stay out of customer rankings.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[800px] w-full text-sm">
            <thead className="bg-black/[0.03] text-left text-xs uppercase tracking-wide text-black/50">
              <tr>
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Reason</th>
                <th className="px-3 py-3">Delta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {data?.needsReviewRows.length ? data.needsReviewRows.map((row) => {
                const raw = row.rawJson as { unresolvedDeltaCents?: number } | null;
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-3">{row.localBusinessDate}</td>
                    <td className="px-3 py-3 font-mono text-xs">{row.matchStatus}</td>
                    <td className="px-3 py-3">{row.matchReason}</td>
                    <td className="px-3 py-3">{money(raw?.unresolvedDeltaCents)}</td>
                  </tr>
                );
              }) : (
                <tr><td className="px-3 py-6 text-center text-black/45" colSpan={4}>No needs-review rows for these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded border border-black/10 bg-white">
        <div className="border-b border-black/10 p-4">
          <h2 className="font-semibold">CleanCloud Candidate Paid Orders</h2>
          <p className="mt-1 text-sm text-black/50">Paid card orders with Clearent card type, grouped by local payment date.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1000px] w-full text-sm">
            <thead className="bg-black/[0.03] text-left text-xs uppercase tracking-wide text-black/50">
              <tr>
                <th className="px-3 py-3">Order</th>
                <th className="px-3 py-3">Customer</th>
                <th className="px-3 py-3">Payment date</th>
                <th className="px-3 py-3">Report</th>
                <th className="px-3 py-3">Amount</th>
                <th className="px-3 py-3">Building</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {data?.cleancloudCandidateOrders.length ? data.cleancloudCandidateOrders.map((row) => (
                <tr key={`${row.sourceReportType}-${row.cleancloudOrderId}`}>
                  <td className="px-3 py-3 font-mono text-xs">{row.cleancloudOrderId}</td>
                  <td className="px-3 py-3">{row.customerName}</td>
                  <td className="px-3 py-3">{formatDate(row.paymentDateUtc ?? row.paidDateUtc)}</td>
                  <td className="px-3 py-3 font-mono text-xs">{reportLabel(row.sourceReportType)}</td>
                  <td className="px-3 py-3">{money(row.totalCents)}</td>
                  <td className="px-3 py-3">{row.buildingName || row.buildingSlug || "Unresolved / Needs Mapping"}</td>
                </tr>
              )) : (
                <tr><td className="px-3 py-6 text-center text-black/45" colSpan={6}>No CleanCloud Clearent card candidates for these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
