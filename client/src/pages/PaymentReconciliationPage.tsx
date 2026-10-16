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

function localDateKey(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return dateInputValue(d);
}

function reportLabel(sourceReportType: string): string {
  return sourceReportType === "orders_revenue" ? "orders_revenue fallback" : "orders_sales";
}

function coverageLabel(status: string): string {
  if (status === "matched") return "matched";
  if (status === "needs_review") return "needs review";
  if (status === "missing_clearent") return "missing Clearent";
  if (status === "missing_cleancloud") return "missing CleanCloud";
  return "no activity";
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
  const manualMatch = trpc.admin.paymentReconciliation.manualMatch.useMutation();
  const ignoreRow = trpc.admin.paymentReconciliation.ignore.useMutation();
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [ignoreDraft, setIgnoreDraft] = useState<{ matchId: number; requestId: string; reason: string; confirmed: boolean } | null>(null);
  const [matchDraft, setMatchDraft] = useState<{ transactionId: number; orderId: string; requestId: string; confirmed: boolean } | null>(null);
  const data = reconciliation.data;
  const coverageByDate = useMemo(
    () => new Map((data?.sourceCoverage ?? []).map((row) => [row.localBusinessDate, row])),
    [data?.sourceCoverage]
  );
  const matchedOrderIds = useMemo(
    () => new Set((data?.matchedRows ?? []).map((row) => row.cleancloudOrderId).filter(Boolean)),
    [data?.matchedRows]
  );

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

      {actionMessage ? (
        <p role="status" className="rounded border border-black/10 bg-white p-3 text-sm" data-testid="reconciliation-action-result">{actionMessage}</p>
      ) : null}

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
          ["All CleanCloud candidates", money(data?.totals.allCleancloudCandidateOrderCents ?? data?.totals.cleancloudCandidateOrderCents)],
          ["Comparable candidates", money(data?.totals.comparableCleancloudCandidateOrderCents)],
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
          <h2 className="font-semibold">Matched / Reconciled Orders</h2>
          <p className="mt-1 text-sm text-black/50">Every dollar in reconciled customer revenue must appear here.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1000px] w-full text-sm">
            <thead className="bg-black/[0.03] text-left text-xs uppercase tracking-wide text-black/50">
              <tr>
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Reason</th>
                <th className="px-3 py-3">Order</th>
                <th className="px-3 py-3">Customer</th>
                <th className="px-3 py-3">Amount</th>
                <th className="px-3 py-3">Building</th>
                <th className="px-3 py-3">Source</th>
                <th className="px-3 py-3">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {data?.matchedRows.length ? data.matchedRows.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-3">{row.localBusinessDate}</td>
                  <td className="px-3 py-3 font-mono text-xs">{row.matchStatus}</td>
                  <td className="px-3 py-3">{row.matchReason}</td>
                  <td className="px-3 py-3 font-mono text-xs">{row.cleancloudOrderId || "-"}</td>
                  <td className="px-3 py-3">{row.customerName || "-"}</td>
                  <td className="px-3 py-3">{money(row.matchedAmountCents)}</td>
                  <td className="px-3 py-3">{row.buildingName || row.buildingSlug || "Unresolved / Needs Mapping"}</td>
                  <td className="px-3 py-3 font-mono text-xs">{row.orderSource}</td>
                  <td className="px-3 py-3 font-mono text-xs">{row.matchConfidence}</td>
                </tr>
              )) : (
                <tr><td className="px-3 py-6 text-center text-black/45" colSpan={9}>No matched rows for these filters. Reconciled customer revenue should be $0.00.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded border border-black/10 bg-white">
        <div className="border-b border-black/10 p-4">
          <h2 className="font-semibold">Source Coverage</h2>
          <p className="mt-1 text-sm text-black/50">Only dates with Clearent entered totals and CleanCloud candidates are comparable.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="bg-black/[0.03] text-left text-xs uppercase tracking-wide text-black/50">
              <tr>
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Clearent entered</th>
                <th className="px-3 py-3">Clearent settled</th>
                <th className="px-3 py-3">CleanCloud candidates</th>
                <th className="px-3 py-3">Comparable</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Delta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {data?.sourceCoverage.length ? data.sourceCoverage.map((row) => (
                <tr key={row.localBusinessDate}>
                  <td className="px-3 py-3">{row.localBusinessDate}</td>
                  <td className="px-3 py-3">{row.clearentEnteredCents == null ? "-" : money(row.clearentEnteredCents)}</td>
                  <td className="px-3 py-3">{row.clearentSettledCents == null ? "-" : money(row.clearentSettledCents)}</td>
                  <td className="px-3 py-3">{money(row.cleancloudCandidateCents)}</td>
                  <td className="px-3 py-3">{row.comparable ? "yes" : "no"}</td>
                  <td className="px-3 py-3 font-mono text-xs">{coverageLabel(row.status)}</td>
                  <td className="px-3 py-3">{row.comparable ? money(row.unresolvedDeltaCents) : "-"}</td>
                </tr>
              )) : (
                <tr><td className="px-3 py-6 text-center text-black/45" colSpan={7}>No source coverage for these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded border border-black/10 bg-white">
        <div className="border-b border-black/10 p-4">
          <h2 className="font-semibold">Needs Review</h2>
          <p className="mt-1 text-sm text-black/50">Mismatched daily totals stay out of customer rankings. Ignoring a row does not change captured money.</p>
        </div>
        {ignoreDraft ? (
          <form
            className="space-y-2 border-b border-black/10 p-4 text-sm"
            data-testid="ignore-confirmation"
            onSubmit={event => {
              event.preventDefault();
              if (!ignoreDraft.confirmed || !ignoreDraft.reason.trim()) return;
              void ignoreRow.mutateAsync({
                confirmed: true,
                requestId: ignoreDraft.requestId,
                matchId: ignoreDraft.matchId,
                reason: ignoreDraft.reason.trim(),
              }).then(result => {
                setActionMessage(`${result.outcome === "already_recorded" ? "Already ignored" : "Ignored"}. Receipt ${result.auditLogId ?? result.matchId}. Captured revenue was not changed.`);
                setIgnoreDraft(null);
                void reconciliation.refetch();
              }).catch(error => {
                setActionMessage(error instanceof Error ? error.message : "The row was not ignored.");
              });
            }}
          >
            <p>Ignore reconciliation row {ignoreDraft.matchId}. This does not change Clearent or CleanCloud amounts.</p>
            <label className="block text-xs">
              Why
              <Input value={ignoreDraft.reason} onChange={event => setIgnoreDraft({ ...ignoreDraft, reason: event.target.value })} className="mt-1" />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={ignoreDraft.confirmed} onChange={event => setIgnoreDraft({ ...ignoreDraft, confirmed: event.target.checked })} />
              I confirm this ignore
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={ignoreRow.isPending || !ignoreDraft.confirmed || !ignoreDraft.reason.trim()}>Record ignore</Button>
              <Button type="button" variant="outline" onClick={() => setIgnoreDraft(null)}>Cancel</Button>
            </div>
          </form>
        ) : null}
        <div className="overflow-x-auto">
          <table className="min-w-[800px] w-full text-sm">
            <thead className="bg-black/[0.03] text-left text-xs uppercase tracking-wide text-black/50">
              <tr>
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Reason</th>
                <th className="px-3 py-3">Delta</th>
                <th className="px-3 py-3">Action</th>
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
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        className="rounded border border-black/20 px-2 py-1 text-xs"
                        onClick={() => setIgnoreDraft({ matchId: row.id, requestId: crypto.randomUUID(), reason: "", confirmed: false })}
                      >
                        Ignore
                      </button>
                    </td>
                  </tr>
                );
              }) : (
                <tr><td className="px-3 py-6 text-center text-black/45" colSpan={5}>No needs-review rows for these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded border border-black/10 bg-white" data-testid="ignored-decisions">
        <div className="border-b border-black/10 p-4">
          <h2 className="font-semibold">Ignored</h2>
          <p className="mt-1 text-sm text-black/50">An ignore is a recorded decision. It does not change Clearent or CleanCloud amounts, and a later refresh does not put the row back into reconciled revenue.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[800px] w-full text-sm">
            <thead className="bg-black/[0.03] text-left text-xs uppercase tracking-wide text-black/50">
              <tr>
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Reason</th>
                <th className="px-3 py-3">Stored amount</th>
                <th className="px-3 py-3">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {data?.ignoredRows.length ? data.ignoredRows.map(row => (
                <tr key={row.id} data-testid={`ignored-row-${row.id}`}>
                  <td className="px-3 py-3">{row.localBusinessDate}</td>
                  <td className="px-3 py-3">{row.matchReason}</td>
                  <td className="px-3 py-3">{money(row.matchedAmountCents)} left unchanged</td>
                  <td className="px-3 py-3 font-mono text-xs">match {row.id}</td>
                </tr>
              )) : (
                <tr><td className="px-3 py-6 text-center text-black/45" colSpan={4}>No ignored rows for these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded border border-black/10 bg-white">
        <div className="border-b border-black/10 p-4">
          <h2 className="font-semibold">Clearent transactions</h2>
          <p className="mt-1 text-sm text-black/50">A match can use only a stored transaction gross amount. An order total is not captured money, and a daily summary cannot be assigned to one order.</p>
        </div>
        {matchDraft ? (
          <form
            className="space-y-2 border-b border-black/10 p-4 text-sm"
            data-testid="match-confirmation"
            onSubmit={event => {
              event.preventDefault();
              const orderId = Number(matchDraft.orderId);
              if (!matchDraft.confirmed || !Number.isInteger(orderId) || orderId <= 0) return;
              void manualMatch.mutateAsync({
                confirmed: true,
                requestId: matchDraft.requestId,
                clearentTransactionId: matchDraft.transactionId,
                cleancloudPaidOrderId: orderId,
              }).then(result => {
                setActionMessage(`${result.outcome === "already_recorded" ? "Already matched" : "Matched"} ${money(result.matchedAmountCents)} from the Clearent transaction. Receipt ${result.auditLogId ?? result.matchId}.`);
                setMatchDraft(null);
                void reconciliation.refetch();
              }).catch(error => {
                setActionMessage(error instanceof Error ? error.message : "No match was recorded.");
              });
            }}
          >
            <p>Match Clearent transaction {matchDraft.transactionId}. The recorded cents come from that transaction&apos;s gross amount.</p>
            <label className="block text-xs">
              CleanCloud order
              <select
                className="mt-1 h-10 w-full rounded border border-black/15 bg-white px-3 text-sm"
                value={matchDraft.orderId}
                onChange={event => setMatchDraft({ ...matchDraft, orderId: event.target.value })}
              >
                {(data?.cleancloudCandidateOrders ?? [])
                  .filter(order => localDateKey(order.paymentDateUtc ?? order.paidDateUtc) === localDateKey(data?.clearentTransactions.find(row => row.id === matchDraft.transactionId)?.enteredDateUtc))
                  .map(order => (
                    <option key={order.id} value={order.id}>{order.cleancloudOrderId} · {money(order.totalCents)} order total</option>
                  ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={matchDraft.confirmed} onChange={event => setMatchDraft({ ...matchDraft, confirmed: event.target.checked })} />
              I confirm this match
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={manualMatch.isPending || !matchDraft.confirmed || !matchDraft.orderId}>Record match</Button>
              <Button type="button" variant="outline" onClick={() => setMatchDraft(null)}>Cancel</Button>
            </div>
          </form>
        ) : null}
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-sm">
            <thead className="bg-black/[0.03] text-left text-xs uppercase tracking-wide text-black/50">
              <tr>
                <th className="px-3 py-3">Transaction</th>
                <th className="px-3 py-3">Entered</th>
                <th className="px-3 py-3">Gross</th>
                <th className="px-3 py-3">Customer</th>
                <th className="px-3 py-3">Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {data?.clearentTransactions.length ? data.clearentTransactions.map(row => {
                const entered = localDateKey(row.enteredDateUtc);
                const sameDay = (data.cleancloudCandidateOrders ?? []).filter(order => localDateKey(order.paymentDateUtc ?? order.paidDateUtc) === entered);
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-3 font-mono text-xs">{row.clearentTransactionId || row.id}</td>
                    <td className="px-3 py-3">{entered ?? "-"}</td>
                    <td className="px-3 py-3">{money(row.grossAmountCents)}</td>
                    <td className="px-3 py-3">{row.customerName || "-"}</td>
                    <td className="px-3 py-3">
                      {sameDay.length ? (
                        <button
                          type="button"
                          className="rounded border border-black/20 px-2 py-1 text-xs"
                          onClick={() => setMatchDraft({ transactionId: row.id, orderId: String(sameDay[0]?.id ?? ""), requestId: crypto.randomUUID(), confirmed: false })}
                        >
                          Review match
                        </button>
                      ) : (
                        <span className="text-xs text-black/45">No same-day Clearent candidate</span>
                      )}
                    </td>
                  </tr>
                );
              }) : (
                <tr><td className="px-3 py-6 text-center text-black/45" colSpan={5}>No Clearent transaction amounts in this range. Daily totals stay unmatched to a single order.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded border border-black/10 bg-white">
        <div className="border-b border-black/10 p-4">
          <h2 className="font-semibold">CleanCloud Candidate Paid Orders</h2>
          <p className="mt-1 text-sm text-black/50">Candidate orders are not counted in customer rankings unless reconciled.</p>
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
                <th className="px-3 py-3">Coverage</th>
                <th className="px-3 py-3">Revenue status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {data?.cleancloudCandidateOrders.length ? data.cleancloudCandidateOrders.map((row) => {
                const candidateDate = localDateKey(row.paymentDateUtc ?? row.paidDateUtc);
                const coverage = candidateDate ? coverageByDate.get(candidateDate) : undefined;
                const isMatched = matchedOrderIds.has(row.cleancloudOrderId);
                return (
                  <tr key={`${row.sourceReportType}-${row.cleancloudOrderId}`}>
                    <td className="px-3 py-3 font-mono text-xs">{row.cleancloudOrderId}</td>
                    <td className="px-3 py-3">{row.customerName}</td>
                    <td className="px-3 py-3">{formatDate(row.paymentDateUtc ?? row.paidDateUtc)}</td>
                    <td className="px-3 py-3 font-mono text-xs">{reportLabel(row.sourceReportType)}</td>
                    <td className="px-3 py-3">{money(row.totalCents)}</td>
                    <td className="px-3 py-3">{row.buildingName || row.buildingSlug || "Unresolved / Needs Mapping"}</td>
                    <td className="px-3 py-3 font-mono text-xs">{coverage ? coverageLabel(coverage.status) : "outside coverage"}</td>
                    <td className="px-3 py-3">{isMatched ? "counted via matched row" : coverage?.status === "needs_review" ? "excluded: needs review" : coverage?.status === "missing_clearent" ? "excluded: missing Clearent" : "excluded"}</td>
                  </tr>
                );
              }) : (
                <tr><td className="px-3 py-6 text-center text-black/45" colSpan={8}>No CleanCloud Clearent card candidates for these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
