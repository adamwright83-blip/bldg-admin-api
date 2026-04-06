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

  const headlineDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="max-w-[1200px] mx-auto px-6 sm:px-9 py-7 space-y-8">
      <header className="space-y-3">
        <p className="text-xs font-sans font-normal text-[var(--ink-muted)]">{headlineDate}</p>
        <h1 className="font-display text-[clamp(1.75rem,4vw,2.25rem)] font-normal tracking-tight text-foreground leading-tight">
          Three buildings away from{" "}
          <span className="italic text-[var(--gold)]">a different life.</span>
        </h1>
        <p className="text-sm font-sans font-normal text-[var(--ink-muted)] max-w-2xl leading-relaxed">
          Every action today either moves you closer or keeps you where you are.
        </p>
      </header>

      {isAdmin && (
        <section className="space-y-5">
          <h2 className="text-[10px] font-sans font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
            Revenue intervention
          </h2>
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
              <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 pb-5 border-b border-[var(--hairline)]">
                <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
                  <div className="flex flex-col gap-1 min-w-[7rem]">
                    <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                      Acted on today
                    </p>
                    <p className="font-display text-[28px] font-normal tabular-nums leading-none text-foreground">
                      {formatUsdFromCents(actedOn.data!.cents)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 min-w-[7rem]">
                    <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                      Awaiting payment
                    </p>
                    <p className="font-display text-[28px] font-normal tabular-nums leading-none text-[var(--red-text)]">
                      {formatUsdFromCents(awaiting.data!.cents)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 min-w-[7rem]">
                    <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                      Collected today
                    </p>
                    <p
                      className={cn(
                        "font-display text-[28px] font-normal tabular-nums leading-none text-[var(--emerald-text)] transition-colors",
                        paymentCelebrationCents != null && "animate-pulse"
                      )}
                    >
                      {formatUsdFromCents(collected.data!.cents)}
                    </p>
                  </div>
                </div>
                <p className="text-[10px] font-mono text-[var(--ink-ghost)] w-full sm:w-auto sm:ml-auto sm:text-right">
                  Business day {actedOn.data!.businessYmd} ({actedOn.data!.timeZone})
                </p>
              </div>

              {paymentCelebrationCents != null && (
                <div className="w-full rounded-lg border border-emerald-300 bg-emerald-50 px-5 py-3.5">
                  <p className="font-display text-lg text-emerald-800 leading-snug">
                    ✓ Collected {formatUsdFromCents(paymentCelebrationCents)}
                  </p>
                  <p className="font-mono text-[11px] text-emerald-600 mt-1">paidAt recorded for this order.</p>
                </div>
              )}

              <div className="pt-1 space-y-4">
                {l1Candidate ? (
                  <div
                    className={cn(
                      "relative overflow-hidden rounded-xl border border-[var(--hairline)] bg-white p-6 shadow-sm transition-colors duration-200",
                      showL1Success && "bg-emerald-50 ring-2 ring-emerald-300/80"
                    )}
                  >
                    <div
                      className="absolute top-0 left-0 right-0 h-[3px]"
                      style={{
                        background: "linear-gradient(90deg, var(--gold), var(--forest))",
                      }}
                      aria-hidden
                    />
                    <div className="relative space-y-4 pt-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="ri-pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                          aria-hidden
                        />
                        <p className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-[var(--gold)]">
                          One thing right now
                        </p>
                      </div>
                      <p className="font-mono text-[10px] uppercase tracking-wide text-foreground/45">
                        {l1Candidate.issueLabel}
                      </p>
                      <p className="font-sans text-lg font-medium text-foreground leading-snug">
                        {l1Candidate.order.firstName} {l1Candidate.order.lastName}
                      </p>
                      <p className="text-sm font-sans font-normal text-[var(--ink-muted)]">
                        Order #{l1Candidate.order.id} · {l1Candidate.order.phone}
                      </p>
                      <p className="text-sm font-sans font-normal text-[var(--ink-muted)]">
                        Status <span className="font-mono text-[13px]">{l1Candidate.order.status}</span>
                        {l1Candidate.order.paid ? " · paid" : " · unpaid"}
                      </p>
                      <p className="font-display text-xl tabular-nums text-foreground">
                        At stake {formatUsdFromCents(l1Candidate.dollarValueCents)}
                      </p>
                      <div className="pt-1">
                        <Button
                          type="button"
                          disabled={sendReminder.isPending}
                          onClick={() => {
                            clickWasLevel1Ref.current = true;
                            pendingIssueRef.current = l1Candidate.issueLabel;
                            sendReminder.mutate({ orderId: l1Candidate.order.id });
                          }}
                          className={cn(
                            "h-11 min-h-11 rounded-lg px-7 font-sans text-sm font-semibold text-[var(--primary-foreground)] shadow-none border-0",
                            "bg-[var(--forest)] hover:bg-[var(--forest)]/90"
                          )}
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
                          <p className="text-xs text-red-600 mt-2 font-sans">{sendReminder.error.message}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm font-sans text-[var(--ink-muted)]">
                    No Level 1 candidate — no at-risk orders for this tenant, or each already has a reminder attempt
                    logged today.
                  </p>
                )}

                {level2.data!.items.length > 0 && (
                  <div className="space-y-0 pt-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3">
                      <p className="text-[10px] font-mono uppercase tracking-wide text-foreground/35">
                        Level 2 — Tactical cluster
                      </p>
                      {level2.data!.aggregateMutationType != null && level2.data!.items.length > 1 && (
                        <p className="text-xs font-sans text-[var(--ink-muted)]">
                          {level2.data!.items.length} reminders ·{" "}
                          {formatUsdFromCents(
                            level2.data!.items.reduce((acc, it) => acc + it.dollarValueCents, 0)
                          )}{" "}
                          combined
                        </p>
                      )}
                    </div>
                    <ul className="divide-y divide-[var(--hairline)] border-t border-[var(--hairline)]">
                      {level2.data!.items.map((item) => (
                        <li
                          key={item.order.id}
                          className="group py-3 -mx-2 px-2 rounded-md transition-colors hover:bg-black/[0.008] hover:px-3 hover:-mx-3"
                        >
                          <p className="font-mono text-[10px] uppercase tracking-wide text-foreground/35">
                            {item.issueLabel}
                          </p>
                          <p className="font-sans text-[13px] text-foreground mt-1">
                            Order #{item.order.id} · {item.order.firstName} {item.order.lastName} · {item.order.phone}
                          </p>
                          <p className="font-mono text-[13px] font-medium text-foreground mt-0.5 tabular-nums">
                            At stake {formatUsdFromCents(item.dollarValueCents)}
                          </p>
                          <div className="mt-2">
                            <Button
                              type="button"
                              disabled={sendReminder.isPending}
                              onClick={() => {
                                clickWasLevel1Ref.current = false;
                                pendingIssueRef.current = null;
                                sendReminder.mutate({ orderId: item.order.id });
                              }}
                              className={cn(
                                "h-8 min-h-8 rounded-md px-4 font-sans text-xs font-semibold text-[var(--primary-foreground)] border-0 shadow-none",
                                "bg-[var(--forest)] hover:bg-[var(--forest)]/90"
                              )}
                            >
                              {sendReminder.isPending
                                ? "Working…"
                                : PIPELINE_ISSUES.has(item.issueLabel)
                                  ? "Log intake / pipeline action"
                                  : "Log reminder attempt"}
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
          {import.meta.env.DEV && isAdmin && (
            <div className="border-t border-dashed border-[var(--hairline)] mt-6 pt-4 space-y-2">
              <p className="text-[10px] font-mono uppercase text-[var(--ink-muted)]">Dev — revenue intervention debug</p>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  type="number"
                  min={1}
                  className="font-mono text-xs border border-[var(--hairline)] rounded px-2 py-1 w-32 bg-[var(--muted)]"
                  placeholder="order id"
                  value={debugOrderInput}
                  onChange={(e) => setDebugOrderInput(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="font-mono text-xs h-8 border-[var(--hairline)]"
                  onClick={() => {
                    const n = parseInt(debugOrderInput, 10);
                    setDebugLoadId(Number.isFinite(n) && n > 0 ? n : null);
                  }}
                >
                  Load
                </Button>
              </div>
              {debugLoadId != null && (
                <pre className="text-[10px] font-mono text-foreground/80 bg-[var(--muted)] border border-[var(--hairline)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
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

      <section className="space-y-5">
        <h2 className="font-display text-xl font-normal tracking-tight text-foreground">Command center</h2>
        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6 pb-5 border-b border-[var(--hairline)]">
          <div className="flex flex-col gap-1 min-w-[6rem]">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Revenue today
            </p>
            <p className="font-display text-2xl font-normal tabular-nums text-foreground leading-none">
              {formatUsd(d.revenueToday)}
            </p>
          </div>
          <div className="flex flex-col gap-1 min-w-[6rem]">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Revenue this week
            </p>
            <p className="font-display text-2xl font-normal tabular-nums text-foreground leading-none">
              {formatUsd(d.revenueWeek)}
            </p>
          </div>
          <div className="flex flex-col gap-1 min-w-[6rem]">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Revenue this month
            </p>
            <p className="font-display text-2xl font-normal tabular-nums text-foreground leading-none">
              {formatUsd(d.revenueMonth)}
            </p>
          </div>
          <div className="flex flex-col gap-1 min-w-[8rem]">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Avg order value
            </p>
            <p className="text-[10px] font-sans text-[var(--ink-ghost)]">This month · paid orders</p>
            <p className="font-display text-2xl font-normal tabular-nums text-foreground leading-none mt-0.5">
              {d.avgOrderValueMonth != null ? formatUsd(d.avgOrderValueMonth) : "—"}
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-sans font-medium text-[var(--ink-muted)]">At a glance</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pb-5 border-b border-[var(--hairline)]">
          <div className="flex flex-col gap-1">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Buildings
            </p>
            <p className="font-display text-xl font-normal tabular-nums text-foreground">{d.distinctBuildingsWithSlug}</p>
            <p className="text-[10px] font-sans text-[var(--ink-ghost)]">Distinct building slugs on orders</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Customers
            </p>
            <p className="font-display text-xl font-normal tabular-nums text-foreground">{d.distinctCustomerPhones}</p>
            <p className="text-[10px] font-sans text-[var(--ink-ghost)]">Distinct phone numbers</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Orders</p>
            <p className="font-display text-xl font-normal tabular-nums text-foreground">{d.totalOrders}</p>
            <p className="text-[10px] font-sans text-[var(--ink-ghost)]">All orders in the system</p>
          </div>
        </div>
      </section>
    </div>
  );
}
