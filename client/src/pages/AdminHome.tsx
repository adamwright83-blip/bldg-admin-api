import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatUsd(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatUsdFromCents(cents: number) {
  return formatUsd(cents / 100);
}

function orderTotalToCents(total: unknown): number {
  const n = parseFloat(String(total ?? "0"));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

/** Success CTA after action — pipeline vs webhook-confirmed delivery vs attempt-only. */
function actionSuccessButtonLabel(issueLabel: string | undefined, outboundDelivered: boolean): string {
  if (issueLabel === "collected_financially_open" || issueLabel === "collected_stale_48h") {
    return "✓ Logged for intake / pipeline follow-up";
  }
  if (outboundDelivered) return "✓ Reminder sent";
  return "✓ Reminder attempted";
}

const PIPELINE_ISSUES = new Set(["collected_financially_open", "collected_stale_48h"]);

export default function AdminHome() {
  const { user, isAuthenticated } = useAuth();
  const isAdmin = user?.role === "admin";
  const q = trpc.admin.dashboardSummary.useQuery(undefined, { enabled: isAuthenticated });
  const actedOn = trpc.admin.getActedOnToday.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const awaiting = trpc.admin.getAwaitingPayment.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const collected = trpc.admin.getCollectedToday.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const apex = trpc.admin.getLevel1ApexCommand.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const level2 = trpc.admin.getLevel2TacticalCluster.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const utils = trpc.useUtils();

  const [l1Flash, setL1Flash] = useState<{
    orderId: number;
    issueLabel: string | null;
    outboundDelivered: boolean;
  } | null>(null);
  const [watchPaidOrderId, setWatchPaidOrderId] = useState<number | null>(null);
  const [paymentCelebrationCents, setPaymentCelebrationCents] = useState<number | null>(null);
  const celebrationClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingIssueRef = useRef<string | null>(null);
  const clickWasLevel1Ref = useRef(false);
  const celebratedPaymentOrderIds = useRef(new Set<number>());

  const [debugOrderInput, setDebugOrderInput] = useState("");
  const [debugLoadId, setDebugLoadId] = useState<number | null>(null);
  const riDebug = trpc.admin.getRevenueInterventionOrderDebug.useQuery(
    { orderId: debugLoadId! },
    {
      enabled: import.meta.env.DEV && isAdmin && debugLoadId != null && debugLoadId > 0,
      retry: false,
    }
  );

  const watchedOrder = trpc.admin.getOrder.useQuery(
    { id: watchPaidOrderId ?? 0 },
    {
      enabled: isAuthenticated && isAdmin && watchPaidOrderId != null && watchPaidOrderId > 0,
      refetchInterval: (query) => {
        const d = query.state.data;
        if (d?.paid) return false;
        return 2500;
      },
    }
  );

  useEffect(() => {
    if (!watchPaidOrderId || !watchedOrder.data?.paid) return;
    const id = watchedOrder.data.id;
    const paidAt = watchedOrder.data.paidAt;
    if (paidAt == null) return;
    if (celebratedPaymentOrderIds.current.has(id)) return;
    celebratedPaymentOrderIds.current.add(id);
    const cents = orderTotalToCents(watchedOrder.data.total);
    setPaymentCelebrationCents(cents);
    setWatchPaidOrderId(null);
    void utils.admin.getCollectedToday.invalidate();
    void utils.admin.getAwaitingPayment.invalidate();
    if (celebrationClearRef.current) clearTimeout(celebrationClearRef.current);
    celebrationClearRef.current = setTimeout(() => setPaymentCelebrationCents(null), 10_000);
    return () => {
      if (celebrationClearRef.current) clearTimeout(celebrationClearRef.current);
    };
  }, [watchPaidOrderId, watchedOrder.data?.paid, watchedOrder.data?.paidAt, watchedOrder.data?.total, watchedOrder.data?.id, utils]);

  const sendReminder = trpc.admin.sendPaymentReminder.useMutation({
    onSuccess: async (data, variables) => {
      const issueLabel = pendingIssueRef.current;
      pendingIssueRef.current = null;
      const isL1 = clickWasLevel1Ref.current;
      clickWasLevel1Ref.current = false;
      setWatchPaidOrderId(variables.orderId);
      if (isL1) {
        setL1Flash({
          orderId: variables.orderId,
          issueLabel,
          outboundDelivered: data.outboundReminderDelivered === true,
        });
        await new Promise((r) => setTimeout(r, 400));
      }
      await Promise.all([
        utils.admin.getActedOnToday.invalidate(),
        utils.admin.getAwaitingPayment.invalidate(),
        utils.admin.getCollectedToday.invalidate(),
        utils.admin.getLevel1ApexCommand.invalidate(),
        utils.admin.getLevel2TacticalCluster.invalidate(),
      ]);
      if (isL1) setL1Flash(null);
    },
  });

  if (q.isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-black/25" />
      </div>
    );
  }

  if (q.isError || q.data == null) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        Could not load dashboard metrics.
      </div>
    );
  }

  const d = q.data;

  const interventionLoading =
    actedOn.isLoading || awaiting.isLoading || collected.isLoading || apex.isLoading || level2.isLoading;

  const interventionReady =
    !interventionLoading &&
    actedOn.data &&
    awaiting.data &&
    collected.data &&
    apex.data &&
    level2.data &&
    actedOn.data.dbAvailable &&
    awaiting.data.dbAvailable &&
    collected.data.dbAvailable &&
    apex.data.dbAvailable &&
    level2.data.dbAvailable;

  const l1Candidate = apex.data?.candidate ?? null;
  const l1OrderId = l1Candidate?.order.id;
  const showL1Success =
    l1Flash && l1OrderId != null && l1Flash.orderId === l1OrderId && sendReminder.isPending === false;

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-8">
      {isAdmin && (
        <section className="rounded-lg border border-black/10 bg-white px-4 py-4 space-y-3">
          <h2 className="text-sm font-semibold text-black">Revenue intervention</h2>
          {!interventionReady ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              {interventionLoading ? (
                "Loading revenue intervention metrics…"
              ) : (
                <>
                  Database unavailable or schema missing. Run migration{" "}
                  <code className="text-xs">0011_orders_paid_at.sql</code>,{" "}
                  <code className="text-xs">0010_admin_action_log_status_expand.sql</code>, and{" "}
                  <code className="text-xs">0009_revenue_intervention.sql</code> if needed, and ensure{" "}
                  <code className="text-xs">DATABASE_URL</code> is set.
                </>
              )}
            </p>
          ) : (
            <>
              <p className="text-xs text-black/50">
                Business day {actedOn.data!.businessYmd} ({actedOn.data!.timeZone})
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-md border border-black/10 bg-black/[0.02] px-3 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-black/45">Acted on today</p>
                  <p className="text-lg font-semibold tabular-nums text-black">
                    {formatUsdFromCents(actedOn.data!.cents)}
                  </p>
                  <p className="text-[10px] text-black/40 mt-0.5">Actions attempted or delivered (ops log)</p>
                </div>
                <div className="rounded-md border border-black/10 bg-black/[0.02] px-3 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-black/45">Awaiting payment</p>
                  <p className="text-lg font-semibold tabular-nums text-black">
                    {formatUsdFromCents(awaiting.data!.cents)}
                  </p>
                  <p className="text-[10px] text-black/40 mt-0.5">Outstanding at-risk orders (unpaid)</p>
                </div>
                <div
                  className={cn(
                    "rounded-md border px-3 py-2 transition-colors",
                    paymentCelebrationCents != null
                      ? "border-emerald-400 bg-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]"
                      : "border-black/10 bg-black/[0.02]"
                  )}
                >
                  <p className="text-[10px] font-medium uppercase tracking-wide text-black/45">Collected today</p>
                  <p className="text-lg font-semibold tabular-nums text-emerald-800">
                    {formatUsdFromCents(collected.data!.cents)}
                  </p>
                  <p className="text-[10px] text-black/40 mt-0.5">
                    Paid orders · cash by paidAt ({collected.data!.timeZone})
                  </p>
                </div>
              </div>

              <p className="text-[10px] font-mono text-black/40 leading-snug">
                Operator actions, unpaid pipeline, and cash received (paidAt) are tracked separately.
              </p>

              {paymentCelebrationCents != null && (
                <p className="text-sm font-medium text-emerald-800 bg-emerald-50 border border-emerald-200/90 rounded-md px-3 py-2">
                  ✓ Collected {formatUsdFromCents(paymentCelebrationCents)} — paidAt recorded for this order.
                </p>
              )}

              <div className="border-t border-black/10 pt-3 space-y-2">
                <p className="text-[11px] font-mono uppercase tracking-wide text-black/45">Level 1 — Apex command</p>
                {l1Candidate ? (
                  <div
                    className={cn(
                      "space-y-2 rounded-md transition-colors duration-200",
                      showL1Success && "bg-emerald-50 ring-2 ring-emerald-300/80"
                    )}
                  >
                    <p className="text-[11px] font-mono uppercase tracking-wide text-black/45 px-1 pt-1">
                      {l1Candidate.issueLabel}
                    </p>
                    <p className="text-sm text-black px-1">
                      Order #{l1Candidate.order.id} · {l1Candidate.order.firstName} {l1Candidate.order.lastName} ·{" "}
                      {l1Candidate.order.phone}
                    </p>
                    <p className="text-xs text-black/50 px-1">
                      Status <span className="font-mono">{l1Candidate.order.status}</span>
                      {l1Candidate.order.paid ? " · paid" : " · unpaid"} · At stake{" "}
                      <span className="font-mono">{formatUsdFromCents(l1Candidate.dollarValueCents)}</span>
                    </p>
                    <div className="px-1 pb-2">
                      <Button
                        type="button"
                        className="bg-emerald-600 hover:bg-emerald-600/90 text-white"
                        disabled={sendReminder.isPending}
                        onClick={() => {
                          clickWasLevel1Ref.current = true;
                          pendingIssueRef.current = l1Candidate.issueLabel;
                          sendReminder.mutate({ orderId: l1Candidate.order.id });
                        }}
                      >
                        {sendReminder.isPending
                          ? "Working…"
                          : showL1Success
                            ? actionSuccessButtonLabel(
                                l1Flash?.issueLabel ?? undefined,
                                l1Flash?.outboundDelivered ?? false
                              )
                            : PIPELINE_ISSUES.has(l1Candidate.issueLabel)
                              ? "Log intake / pipeline action"
                              : "Send payment reminder (log attempt)"}
                      </Button>
                      {sendReminder.isError && (
                        <p className="text-xs text-red-600 mt-2">{sendReminder.error.message}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-black/45">
                    No Level 1 candidate — no at-risk orders for this tenant, or each already has a reminder attempt
                    logged today.
                  </p>
                )}
              </div>

              {level2.data!.items.length > 0 && (
                <div className="border-t border-black/10 pt-3 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[11px] font-mono uppercase tracking-wide text-black/45">Level 2 — Tactical cluster</p>
                    {level2.data!.aggregateMutationType != null && level2.data!.items.length > 1 && (
                      <p className="text-xs text-black/50">
                        {level2.data!.items.length} reminders ·{" "}
                        {formatUsdFromCents(
                          level2.data!.items.reduce((acc, it) => acc + it.dollarValueCents, 0)
                        )}{" "}
                        combined
                      </p>
                    )}
                  </div>
                  <ul className="space-y-3">
                    {level2.data!.items.map((item) => (
                      <li
                        key={item.order.id}
                        className="rounded-md border border-black/8 bg-black/[0.02] px-3 py-2 space-y-2"
                      >
                        <p className="text-[10px] font-mono uppercase text-black/40">{item.issueLabel}</p>
                        <p className="text-sm text-black">
                          Order #{item.order.id} · {item.order.firstName} {item.order.lastName} · {item.order.phone}
                        </p>
                        <p className="text-xs text-black/50">
                          At stake <span className="font-mono">{formatUsdFromCents(item.dollarValueCents)}</span>
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-600/90 text-white"
                          disabled={sendReminder.isPending}
                          onClick={() => {
                            clickWasLevel1Ref.current = false;
                            pendingIssueRef.current = null;
                            sendReminder.mutate({ orderId: item.order.id });
                          }}
                        >
                          {sendReminder.isPending
                            ? "Working…"
                            : PIPELINE_ISSUES.has(item.issueLabel)
                              ? "Log intake / pipeline action"
                              : "Log reminder attempt"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {import.meta.env.DEV && isAdmin && (
            <div className="border-t border-dashed border-black/20 mt-3 pt-3 space-y-2">
              <p className="text-[10px] font-mono uppercase text-black/50">Dev — revenue intervention debug</p>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  type="number"
                  min={1}
                  className="font-mono text-xs border border-black/30 rounded px-2 py-1 w-32 bg-black/[0.03]"
                  placeholder="order id"
                  value={debugOrderInput}
                  onChange={(e) => setDebugOrderInput(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="font-mono text-xs h-8 border-black/30"
                  onClick={() => {
                    const n = parseInt(debugOrderInput, 10);
                    setDebugLoadId(Number.isFinite(n) && n > 0 ? n : null);
                  }}
                >
                  Load
                </Button>
              </div>
              {debugLoadId != null && (
                <pre className="text-[10px] font-mono text-black/80 bg-black/[0.04] border border-black/15 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                  {riDebug.isLoading
                    ? "loading…"
                    : riDebug.error
                      ? String(riDebug.error.message)
                      : JSON.stringify(riDebug.data, null, 2)}
                </pre>
              )}
            </div>
          )}
        </section>
      )}

      <section>
        <h1 className="text-lg font-semibold text-black mb-4">Command center</h1>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border border-black/10 bg-white px-4 py-3">
            <p className="text-xs font-medium text-black/50 uppercase tracking-wide">Revenue today</p>
            <p className="text-2xl font-semibold text-black tabular-nums mt-1">{formatUsd(d.revenueToday)}</p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white px-4 py-3">
            <p className="text-xs font-medium text-black/50 uppercase tracking-wide">Revenue this week</p>
            <p className="text-2xl font-semibold text-black tabular-nums mt-1">{formatUsd(d.revenueWeek)}</p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white px-4 py-3">
            <p className="text-xs font-medium text-black/50 uppercase tracking-wide">Revenue this month</p>
            <p className="text-2xl font-semibold text-black tabular-nums mt-1">{formatUsd(d.revenueMonth)}</p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white px-4 py-3">
            <p className="text-xs font-medium text-black/50 uppercase tracking-wide">Avg order value</p>
            <p className="text-xs text-black/40 mt-0.5">This month · paid orders</p>
            <p className="text-2xl font-semibold text-black tabular-nums mt-1">
              {d.avgOrderValueMonth != null ? formatUsd(d.avgOrderValueMonth) : "—"}
            </p>
          </div>
        </div>
        <p className="text-[11px] text-black/45 mt-3 leading-snug">Based on paid orders · timestamp proxy</p>
      </section>

      <section className="rounded-lg border border-black/8 bg-black/[0.02] px-4 py-5">
        <h2 className="text-sm font-medium text-black/70 mb-1">Guidance</h2>
        <p className="text-sm text-black/45">Automated action cards will appear here in a future update.</p>
      </section>

      <section>
        <h2 className="text-sm font-medium text-black/70 mb-3">At a glance</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-lg border border-black/10 bg-white px-4 py-3">
            <p className="text-xs text-black/45">Buildings</p>
            <p className="text-xl font-semibold text-black tabular-nums">{d.distinctBuildingsWithSlug}</p>
            <p className="text-[11px] text-black/40 mt-1">Distinct building slugs on orders</p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white px-4 py-3">
            <p className="text-xs text-black/45">Customers</p>
            <p className="text-xl font-semibold text-black tabular-nums">{d.distinctCustomerPhones}</p>
            <p className="text-[11px] text-black/40 mt-1">Distinct phone numbers</p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white px-4 py-3">
            <p className="text-xs text-black/45">Orders</p>
            <p className="text-xl font-semibold text-black tabular-nums">{d.totalOrders}</p>
            <p className="text-[11px] text-black/40 mt-1">All orders in the system</p>
          </div>
        </div>
      </section>
    </div>
  );
}
