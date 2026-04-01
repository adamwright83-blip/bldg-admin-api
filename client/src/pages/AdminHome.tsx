import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";

function formatUsd(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatUsdFromCents(cents: number) {
  return formatUsd(cents / 100);
}

export default function AdminHome() {
  const { user, isAuthenticated } = useAuth();
  const isAdmin = user?.role === "admin";
  const q = trpc.admin.dashboardSummary.useQuery(undefined, { enabled: isAuthenticated });
  const recovered = trpc.admin.getRecoveredToday.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const apex = trpc.admin.getLevel1ApexCommand.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const utils = trpc.useUtils();

  const sendReminder = trpc.admin.sendPaymentReminder.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.admin.getRecoveredToday.invalidate(),
        utils.admin.getLevel1ApexCommand.invalidate(),
      ]);
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

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-8">
      {isAdmin && (
        <section className="rounded-lg border border-black/10 bg-white px-4 py-4 space-y-3">
          <h2 className="text-sm font-semibold text-black">Revenue intervention — Level 1</h2>
          {!recovered.data?.dbAvailable || !apex.data?.dbAvailable ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Database unavailable or schema missing. Run migration{" "}
              <code className="text-xs">0009_revenue_intervention.sql</code> and ensure{" "}
              <code className="text-xs">DATABASE_URL</code> is set.
            </p>
          ) : (
            <>
              <p className="text-xs text-black/50">
                Business day {recovered.data.businessYmd} ({recovered.data.timeZone}) · Recovered today (manual
                log):{" "}
                <span className="font-mono text-black">{formatUsdFromCents(recovered.data.cents)}</span>
              </p>
              {apex.data.candidate ? (
                <div className="space-y-2 border-t border-black/10 pt-3">
                  <p className="text-[11px] font-mono uppercase tracking-wide text-black/45">
                    {apex.data.candidate.issueLabel}
                  </p>
                  <p className="text-sm text-black">
                    Order #{apex.data.candidate.order.id} · {apex.data.candidate.order.firstName}{" "}
                    {apex.data.candidate.order.lastName} · {apex.data.candidate.order.phone}
                  </p>
                  <p className="text-xs text-black/50">
                    Status <span className="font-mono">{apex.data.candidate.order.status}</span>
                    {apex.data.candidate.order.paid ? " · paid" : " · unpaid"} · Potential{" "}
                    <span className="font-mono">{formatUsdFromCents(apex.data.candidate.dollarValueCents)}</span>
                  </p>
                  <Button
                    type="button"
                    className="bg-emerald-600 hover:bg-emerald-600/90 text-white"
                    disabled={sendReminder.isPending}
                    onClick={() => sendReminder.mutate({ orderId: apex.data.candidate!.order.id })}
                  >
                    {sendReminder.isPending ? "Logging…" : "Send payment reminder (log action)"}
                  </Button>
                  {sendReminder.isSuccess && (
                    <p className="text-xs text-emerald-700">
                      Logged{sendReminder.data.deduped ? " (idempotent — already counted today)" : ""}. Recovered
                      today: {formatUsdFromCents(sendReminder.data.recoveredTodayCents)}.
                    </p>
                  )}
                  {sendReminder.isError && (
                    <p className="text-xs text-red-600">{sendReminder.error.message}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-black/45 pt-2">
                  No Level 1 candidate — no at-risk orders for this tenant, or each already has a successful
                  reminder logged today.
                </p>
              )}
            </>
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
        <p className="text-[11px] text-black/45 mt-3 leading-snug">
          Based on paid orders · timestamp proxy
        </p>
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
