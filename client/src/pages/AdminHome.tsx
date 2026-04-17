import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Level4Offensive } from "@/components/Level4Offensive";

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

export default function AdminHome({
  forceLevel4Preview = false,
}: {
  forceLevel4Preview?: boolean;
}) {
  const { user, isAuthenticated } = useAuth();
  const isAdmin = user?.role === "admin";
  const q = trpc.admin.dashboardSummary.useQuery(undefined, { enabled: isAuthenticated });
  const actedOn = trpc.admin.getActedOnToday.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const awaiting = trpc.admin.getAwaitingPayment.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const collected = trpc.admin.getCollectedToday.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const recovery = trpc.admin.getRecoveryPipelineState.useQuery(undefined, {
    enabled: isAuthenticated && isAdmin,
  });
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

  const [awaitingEditing, setAwaitingEditing] = useState(false);
  const [awaitingDraft, setAwaitingDraft] = useState("");
  const awaitingInputRef = useRef<HTMLInputElement>(null);
  const skipAwaitingBlurCommit = useRef(false);
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

  useEffect(() => {
    if (l1Flash == null || !recovery.isSuccess || recovery.data == null) return;
    const cid = recovery.data.apexCandidate?.order.id ?? null;
    if (cid == null || cid !== l1Flash.orderId) {
      setL1Flash(null);
    }
  }, [recovery.isSuccess, recovery.data, l1Flash]);

  useEffect(() => {
    if (awaitingEditing) awaitingInputRef.current?.focus();
  }, [awaitingEditing]);

  const setAwaitingAdjustment = trpc.admin.setAwaitingPaymentAdjustment.useMutation({
    onSuccess: () => {
      void utils.admin.getAwaitingPayment.invalidate();
      setAwaitingEditing(false);
    },
  });

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
        utils.admin.getRecoveryPipelineState.invalidate(),
      ]);
    },
  });

  if (q.isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (q.isError || q.data == null) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        Could not load dashboard metrics.
      </div>
    );
  }

  const d = q.data;

  const interventionLoading =
    actedOn.isLoading || awaiting.isLoading || collected.isLoading || recovery.isLoading;

  const interventionReady =
    !interventionLoading &&
    actedOn.data &&
    awaiting.data &&
    collected.data &&
    recovery.data &&
    actedOn.data.dbAvailable &&
    awaiting.data.dbAvailable &&
    collected.data.dbAvailable &&
    recovery.data.dbAvailable;

  const l1Candidate = recovery.data?.apexCandidate ?? null;
  const l1OrderId = l1Candidate?.order.id;
  const showL1Success =
    l1Flash && l1OrderId != null && l1Flash.orderId === l1OrderId && sendReminder.isPending === false;

  const l1CtaShort =
    l1Candidate != null
      ? PIPELINE_ISSUES.has(l1Candidate.issueLabel)
        ? "Log intake / pipeline action"
        : "Send payment reminder (log attempt)"
      : "";
  const l1CtaHover =
    l1Candidate != null
      ? PIPELINE_ISSUES.has(l1Candidate.issueLabel)
        ? `Log intake · ${formatUsdFromCents(l1Candidate.dollarValueCents)}`
        : `Send reminder · ${formatUsdFromCents(l1Candidate.dollarValueCents)}`
      : "";

  const headlineDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const showLevel4 =
    forceLevel4Preview || (interventionReady && recovery.data?.isRecoveryEmpty === true);

  return (
    <div className="max-w-[1200px] mx-auto px-6 sm:px-9 py-7 space-y-8">
      <div className="relative -mx-1 px-1">
        <div
          className="pointer-events-none absolute inset-x-0 -top-6 h-44 bg-[radial-gradient(ellipse_at_50%_0%,rgba(200,169,110,0.16)_0%,rgba(247,246,241,0)_58%)]"
          aria-hidden
        />
        <header className="relative space-y-3">
          <p className="text-xs font-sans font-normal text-[var(--ink-muted)]">{headlineDate}</p>
          <h1 className="font-display text-[clamp(1.875rem,4vw,2.625rem)] font-normal tracking-[-0.02em] text-[var(--foreground)] leading-[1.12]">
            Three buildings away from{" "}
            <span className="italic text-[var(--gold)]">a different life.</span>
          </h1>
          <p className="text-sm font-sans font-normal text-[var(--ink-muted)] max-w-2xl leading-relaxed">
            Every action today either moves you closer or keeps you where you are.
          </p>
        </header>
      </div>

      {isAdmin && (
        <section className="space-y-5">
          <h2 className="text-[10px] font-sans font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
            Revenue intervention
          </h2>
          {!interventionReady ? (
            <p className="text-sm text-amber-950 bg-amber-50 border border-amber-200/90 rounded-md px-3 py-2">
              {interventionLoading ? (
                "Loading revenue intervention metrics…"
              ) : (
                <>
                  Database unavailable or schema missing. Run migration{" "}
                  <code className="text-xs font-mono text-amber-900">0011_orders_paid_at.sql</code>,{" "}
                  <code className="text-xs font-mono text-amber-900">0010_admin_action_log_status_expand.sql</code>, and{" "}
                  <code className="text-xs font-mono text-amber-900">0009_revenue_intervention.sql</code>,{" "}
                  <code className="text-xs font-mono text-amber-900">0012_admin_settings_awaiting_adjustment.sql</code> if needed, and ensure{" "}
                  <code className="text-xs font-mono text-amber-900">DATABASE_URL</code> is set.
                </>
              )}
            </p>
          ) : (
            <>
              {showLevel4 ? (
                <Level4Offensive
                  soberDays={2114}
                  recoveredTodayCents={actedOn.data!.cents}
                  debtCents={0}
                  onDeployLane1={() => {
                    // Placeholder action: Lane 1 in Level 4 is not wired to the payment reminder pipeline.
                    // We keep this as a UI-only ritual surface until business logic is defined.
                    console.log("[Level4] Lane 1 deploy");
                  }}
                />
              ) : null}

              <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 pb-5 border-b border-[var(--hairline)]">
                <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
                  <div className="flex flex-col gap-1 min-w-[7rem]">
                    <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                      Acted on today
                    </p>
                    <p className="font-display text-[28px] font-normal tabular-nums leading-none text-[var(--foreground)]">
                      {formatUsdFromCents(actedOn.data!.cents)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 min-w-[7rem]">
                    <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                      Awaiting payment
                    </p>
                    {awaitingEditing ? (
                      <div className="flex items-center gap-2 min-h-[34px]">
                        <input
                          ref={awaitingInputRef}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          disabled={setAwaitingAdjustment.isPending}
                          value={awaitingDraft}
                          onChange={(e) => setAwaitingDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault();
                              skipAwaitingBlurCommit.current = true;
                              setAwaitingEditing(false);
                            }
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const raw = awaitingDraft.trim().replace(/[$,]/g, "");
                              const n = parseFloat(raw);
                              if (!Number.isFinite(n) || n < 0) {
                                setAwaitingEditing(false);
                                return;
                              }
                              const displayCents = Math.round(n * 100);
                              const pipeline = awaiting.data!.pipelineCents;
                              setAwaitingAdjustment.mutate({
                                adjustmentCents: displayCents - pipeline,
                              });
                            }
                          }}
                          onBlur={() => {
                            if (skipAwaitingBlurCommit.current) {
                              skipAwaitingBlurCommit.current = false;
                              return;
                            }
                            if (setAwaitingAdjustment.isPending) return;
                            const raw = awaitingDraft.trim().replace(/[$,]/g, "");
                            const n = parseFloat(raw);
                            if (!Number.isFinite(n) || n < 0) {
                              setAwaitingEditing(false);
                              return;
                            }
                            const displayCents = Math.round(n * 100);
                            const pipeline = awaiting.data!.pipelineCents;
                            const nextAdj = displayCents - pipeline;
                            if (nextAdj === awaiting.data!.adjustmentCents) {
                              setAwaitingEditing(false);
                              return;
                            }
                            setAwaitingAdjustment.mutate({ adjustmentCents: nextAdj });
                          }}
                          className={cn(
                            "font-display text-[28px] font-normal tabular-nums leading-none text-[var(--red)]",
                            "min-w-[6.5rem] max-w-[12rem] bg-transparent border-0 border-b border-[var(--hairline)] rounded-none p-0",
                            "focus:outline-none focus:border-b-[var(--red)]/35"
                          )}
                          aria-label="Awaiting payment amount"
                        />
                        {setAwaitingAdjustment.isPending ? (
                          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[var(--muted-foreground)]" />
                        ) : null}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={cn(
                          "font-display text-[28px] font-normal tabular-nums leading-none text-[var(--red)] text-left",
                          "bg-transparent border-0 p-0 m-0 cursor-default",
                          "hover:opacity-[0.92] active:opacity-85",
                          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]/20 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] rounded-sm"
                        )}
                        aria-label="Edit awaiting payment amount"
                        onClick={() => {
                          setAwaitingDraft((awaiting.data!.cents / 100).toFixed(2));
                          setAwaitingEditing(true);
                        }}
                      >
                        {formatUsdFromCents(awaiting.data!.cents)}
                      </button>
                    )}
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
                <div className="w-full rounded-[10px] border border-[rgba(35,138,91,0.28)] bg-[rgba(47,184,121,0.09)] px-6 py-4 shadow-[0_0_36px_var(--emerald-glow)]">
                  <p className="font-display text-xl font-normal text-[var(--emerald-text)] leading-snug">
                    ✓ Collected {formatUsdFromCents(paymentCelebrationCents)}
                  </p>
                  <p className="font-mono text-[11px] text-[var(--emerald-text)] mt-1">
                    paidAt recorded for this order.
                  </p>
                </div>
              )}

              <div className="pt-1 space-y-4">
                {l1Candidate ? (
                  <div
                    className={cn(
                      "relative overflow-hidden rounded-xl border-[0.5px] border-[var(--hairline)] bg-[var(--card)] px-7 py-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),0_10px_40px_-16px_rgba(200,169,110,0.18),0_4px_20px_-12px_rgba(45,122,79,0.08)] transition-colors duration-200",
                      showL1Success &&
                        "border-[rgba(35,138,91,0.3)] bg-[rgba(47,184,121,0.07)] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7),0_0_0_1px_rgba(47,184,121,0.06),0_12px_40px_-14px_rgba(47,184,121,0.14)]"
                    )}
                  >
                    <div
                      className="absolute top-0 left-0 right-0 h-[5px]"
                      style={{
                        background: "linear-gradient(90deg, var(--gold), var(--forest))",
                      }}
                      aria-hidden
                    />
                    <div className="relative space-y-4 pt-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="ri-pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--emerald)]"
                          aria-hidden
                        />
                        <p className="text-[11px] font-sans font-semibold uppercase tracking-[0.1em] text-[var(--gold)]">
                          One thing right now
                        </p>
                      </div>
                      <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
                        {l1Candidate.issueLabel}
                      </p>
                      <p className="font-sans text-[19px] font-medium text-[var(--foreground)] leading-snug">
                        {l1Candidate.order.firstName} {l1Candidate.order.lastName}
                      </p>
                      <p className="text-sm font-sans font-normal text-[var(--ink-muted)]">
                        Order #{l1Candidate.order.id} · {l1Candidate.order.phone}
                      </p>
                      <p className="text-sm font-sans font-normal text-[var(--ink-muted)]">
                        Status <span className="font-mono text-[13px]">{l1Candidate.order.status}</span>
                        {l1Candidate.order.paid ? " · paid" : " · unpaid"}
                      </p>
                      <p className="font-display text-[22px] tabular-nums text-[var(--foreground)]">
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
                            "group h-11 min-h-[44px] rounded-lg px-8 font-sans text-[15px] font-semibold border-0 shadow-none transition-all duration-150",
                            "active:scale-[0.98]",
                            showL1Success
                              ? "bg-[var(--emerald-text)] text-[var(--primary-foreground)] hover:brightness-105 shadow-[0_0_28px_var(--emerald-glow)]"
                              : "bg-[var(--forest)] text-[var(--primary-foreground)] hover:brightness-[1.03] shadow-[0_0_22px_var(--forest-glow)] hover:shadow-[0_0_32px_var(--forest-glow)]"
                          )}
                        >
                          {sendReminder.isPending ? (
                            "Working…"
                          ) : showL1Success ? (
                            actionSuccessButtonLabel(
                              l1Flash?.issueLabel ?? undefined,
                              l1Flash?.outboundDelivered ?? false
                            )
                          ) : (
                            <>
                              <span className="inline-flex items-center gap-1.5">
                                <span className="group-hover:hidden">{l1CtaShort}</span>
                                <span className="hidden group-hover:inline">{l1CtaHover}</span>
                              </span>
                              <span
                                className="inline-block text-lg leading-none font-normal transition-transform duration-200 ease-out group-hover:translate-x-[3px]"
                                aria-hidden
                              >
                                →
                              </span>
                            </>
                          )}
                        </Button>
                        {sendReminder.isError && (
                          <p className="text-xs text-[var(--red)] mt-2 font-sans">{sendReminder.error.message}</p>
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

                <div className="space-y-0 pt-4 border-t border-[var(--hairline)]">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3">
                    <p className="text-[10px] font-mono uppercase tracking-wide text-[var(--ink-muted)]">
                      Level 2 — Tactical cluster
                    </p>
                    {recovery.data!.tacticalCluster.length > 1 &&
                      recovery.data!.aggregateMutationType != null && (
                      <p className="text-xs font-sans text-[var(--ink-muted)]">
                        {recovery.data!.tacticalCluster.length} reminders ·{" "}
                        {formatUsdFromCents(
                          recovery.data!.tacticalCluster.reduce(
                            (acc, it) => acc + it.dollarValueCents,
                            0
                          )
                        )}{" "}
                        combined
                      </p>
                    )}
                  </div>
                  {recovery.data!.tacticalCluster.length > 0 ? (
                    <ul className="divide-y divide-[var(--hairline)] border-t border-[var(--hairline)]">
                      {recovery.data!.tacticalCluster.map((item) => (
                        <li
                          key={item.order.id}
                          className="group/row py-3.5 -mx-2 px-2 rounded-md transition-colors hover:bg-[rgba(22,22,22,0.03)] hover:-mx-3 hover:px-3"
                        >
                          <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
                            {item.issueLabel}
                          </p>
                          <p className="font-sans text-[13px] text-[var(--foreground)] mt-1">
                            Order #{item.order.id} · {item.order.firstName} {item.order.lastName} · {item.order.phone}
                          </p>
                          <p className="font-mono text-[13px] font-medium text-[var(--foreground)] mt-0.5 tabular-nums">
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
                                "h-[34px] min-h-[34px] rounded-md px-[18px] py-2 font-sans text-xs font-semibold text-[var(--primary-foreground)] border-0 shadow-none",
                                "bg-[var(--forest)] shadow-[0_0_12px_rgba(45,122,79,0.12)] hover:shadow-[0_0_20px_rgba(45,122,79,0.2)] hover:brightness-[1.03] active:scale-[0.98] transition-all"
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
                  ) : (
                    <p className="text-sm font-sans text-[var(--ink-muted)] pb-1">
                      No additional candidates — Level 2 is the next orders in the same queue after Level 1. It fills in
                      automatically when more than one at-risk order qualifies; there is no separate screen to open.
                    </p>
                  )}
                </div>
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
                  className="font-mono text-xs border border-[var(--hairline)] rounded px-2 py-1 w-32 bg-[var(--card)] text-[var(--foreground)]"
                  placeholder="order id"
                  value={debugOrderInput}
                  onChange={(e) => setDebugOrderInput(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="font-mono text-xs h-8 border-[var(--hairline)] text-[var(--foreground)]"
                  onClick={() => {
                    const n = parseInt(debugOrderInput, 10);
                    setDebugLoadId(Number.isFinite(n) && n > 0 ? n : null);
                  }}
                >
                  Load
                </Button>
              </div>
              {debugLoadId != null && (
                <pre className="text-[10px] font-mono text-[var(--foreground)]/90 bg-[var(--muted)] border border-[var(--hairline)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
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
        <div className="space-y-1">
          <h2 className="font-display text-xl font-normal tracking-tight text-[var(--foreground)]">Command center</h2>
          <p className="text-[10px] font-sans text-[var(--ink-ghost)]">
            Paid revenue · by payment time ({d.dashboardTimeZone})
          </p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6 pb-5 border-b border-[var(--hairline)]">
          <div className="flex flex-col gap-1 min-w-[6rem]">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Revenue today
            </p>
            <p className="font-display text-2xl font-normal tabular-nums text-[var(--foreground)] leading-none">
              {formatUsd(d.revenueToday)}
            </p>
          </div>
          <div className="flex flex-col gap-1 min-w-[6rem]">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Revenue this week
            </p>
            <p className="font-display text-2xl font-normal tabular-nums text-[var(--foreground)] leading-none">
              {formatUsd(d.revenueWeek)}
            </p>
          </div>
          <div className="flex flex-col gap-1 min-w-[6rem]">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Revenue this month
            </p>
            <p className="font-display text-2xl font-normal tabular-nums text-[var(--foreground)] leading-none">
              {formatUsd(d.revenueMonth)}
            </p>
          </div>
          <div className="flex flex-col gap-1 min-w-[8rem]">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Avg order value
            </p>
            <p className="text-[10px] font-sans text-[var(--ink-ghost)]">This month · paid orders</p>
            <p className="font-display text-2xl font-normal tabular-nums text-[var(--foreground)] leading-none mt-0.5">
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
            <p className="font-display text-[22px] font-normal tabular-nums text-[var(--gold)] [text-shadow:0_1px_0_rgba(200,169,110,0.35)]">
              {d.distinctBuildingsWithSlug}
            </p>
            <p className="text-[10px] font-sans text-[var(--ink-ghost)]">Distinct building slugs on orders</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Customers
            </p>
            <p className="font-display text-[22px] font-normal tabular-nums text-[var(--foreground)]">{d.distinctCustomerPhones}</p>
            <p className="text-[10px] font-sans text-[var(--ink-ghost)]">Distinct phone numbers</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Orders</p>
            <p className="font-display text-[22px] font-normal tabular-nums text-[var(--foreground)]">{d.totalOrders}</p>
            <p className="text-[10px] font-sans text-[var(--ink-ghost)]">All orders in the system</p>
          </div>
        </div>
      </section>
    </div>
  );
}
