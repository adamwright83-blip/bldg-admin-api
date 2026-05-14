import { useState } from "react";
import type React from "react";
import { ArrowRight, CalendarDays, CheckCircle2, Clock, DollarSign, Link2, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";

function money(cents?: number | null) {
  return ((cents ?? 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function minutes(value?: number | null) {
  if (value == null) return "not enough data";
  if (value < 60) return `${value}m`;
  const h = Math.floor(value / 60);
  const m = value % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function completedDate(value?: string | Date | null) {
  if (!value) return "not completed";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function laneShort(lane: string) {
  if (lane === "lane_1") return "Lane 1";
  if (lane === "lane_2") return "Lane 2";
  if (lane === "lane_3") return "Lane 3";
  return "Level 4";
}

function customerOrder(task: any) {
  const parts = [];
  if (task.customerId) parts.push(`Customer #${task.customerId}`);
  if (task.orderId) parts.push(`Order #${task.orderId}`);
  return parts.join(" / ") || "—";
}

function MetricCard({
  icon,
  value,
  label,
  detail,
}: {
  icon: React.ReactNode;
  value: string | number;
  label: string;
  detail: string;
}) {
  return (
    <article className="rounded-lg border border-[#e8dcc8] bg-[#fffdf8] p-5 shadow-[0_14px_40px_rgba(81,56,28,0.05)]">
      <div className="mb-5 text-[#b78a3b]">{icon}</div>
      <div className="font-serif text-4xl leading-none text-[#21170f]">{value}</div>
      <p className="mt-2 text-sm text-[#21170f]">{label}</p>
      <p className="mt-5 text-xs leading-5 text-[#6f6254]">{detail}</p>
    </article>
  );
}

export default function OperatorReflection() {
  const [view, setView] = useState<"reflection" | "proof">("reflection");
  const reflection = trpc.admin.opsTasks.weeklyReflection.useQuery();
  const performance = trpc.admin.opsTasks.performanceMetrics.useQuery();
  const data = reflection.data;
  const metrics = performance.data;

  return (
    <main className="min-h-screen bg-[#fbf7ee] px-4 py-8 text-[#21170f] sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 border-b border-[#e3d4bd] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-[#b78a3b]">BLDG.chat</p>
            <h1 className="mt-2 font-serif text-4xl leading-tight sm:text-5xl">Operator Reflection</h1>
            <p className="mt-2 text-sm text-[#6f6254]">Completed work, recovered revenue, and the loops that stopped leaking.</p>
          </div>
          <div className="flex rounded-full border border-[#dfcfb6] bg-[#fffdf8] p-1 text-sm">
            <button
              type="button"
              className={`rounded-full px-4 py-2 ${view === "reflection" ? "bg-[#c49742] text-white" : "text-[#6f6254]"}`}
              onClick={() => setView("reflection")}
            >
              Reflection
            </button>
            <button
              type="button"
              className={`rounded-full px-4 py-2 ${view === "proof" ? "bg-[#c49742] text-white" : "text-[#6f6254]"}`}
              onClick={() => setView("proof")}
            >
              Performance Proof
            </button>
          </div>
        </header>

        {view === "reflection" ? (
          <>
            <section className="mt-8 grid gap-4 md:grid-cols-4">
              <MetricCard
                icon={<CheckCircle2 className="h-7 w-7" />}
                value={data?.metrics.thingsFinished ?? 0}
                label="things you finished"
                detail={data?.empty ? "No completed tasks logged yet this week." : "Completed work that is now structured and visible."}
              />
              <MetricCard
                icon={<DollarSign className="h-7 w-7" />}
                value={money(data?.metrics.revenueProtectedCents)}
                label="you protected from leaking away"
                detail="Revenue recovered, secured, or made visible by completed tasks."
              />
              <MetricCard
                icon={<Users className="h-7 w-7" />}
                value={data?.metrics.customersReengaged ?? 0}
                label="customers you re-engaged"
                detail="Stale customer, referral, and follow-up loops moved forward."
              />
              <MetricCard
                icon={<Link2 className="h-7 w-7" />}
                value={data?.metrics.patternsBroken ?? 0}
                label="patterns you broke this week"
                detail="Real breakthroughs only. No invented progress."
              />
            </section>

            <section className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
              <div className="rounded-lg border border-[#e8dcc8] bg-[#fffdf8] p-6">
                <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6f6254]">Where your energy went</h2>
                <div className="mt-5 space-y-5">
                  {(data?.laneBreakdown ?? []).map((lane: any) => (
                    <article key={lane.lane} className="grid gap-3 border-b border-[#efe5d5] pb-4 last:border-0 last:pb-0 sm:grid-cols-[72px_1fr]">
                      <div className="font-serif text-3xl text-[#c49742]">{lane.lane === "level_4" ? "4" : lane.lane.replace("lane_", "")}</div>
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-medium">{lane.label}</h3>
                          <span className="text-sm text-[#6f6254]">{lane.completedCount} completed</span>
                        </div>
                        <p className="mt-1 text-xs text-[#6f6254]">
                          Avg. completion time: {minutes(lane.averageCompletionMinutes)} · {lane.unresolvedCount} unresolved
                        </p>
                        <p className="mt-2 text-sm text-[#21170f]">
                          {lane.recentCompletedExample ? lane.recentCompletedExample.title : "No completed example yet."}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-[#e8dcc8] bg-[#fffdf8] p-6">
                <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6f6254]">What you broke through this week</h2>
                <div className="mt-5 space-y-5">
                  {data?.breakthroughs?.length ? (
                    data.breakthroughs.map((item: any) => (
                      <article key={item.title}>
                        <h3 className="font-serif text-xl">{item.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-[#6f6254]">{item.detail}</p>
                      </article>
                    ))
                  ) : (
                    <p className="text-sm leading-6 text-[#6f6254]">Patterns will appear after more completed work is logged.</p>
                  )}
                </div>
              </div>
            </section>

            <section className="mt-6 rounded-lg border border-[#e8dcc8] bg-[#fffdf8] p-6">
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6f6254]">Recently completed</h2>
              {data?.recentlyCompleted?.length ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="border-b border-[#e8dcc8] text-xs uppercase tracking-[0.12em] text-[#6f6254]">
                      <tr>
                        <th className="py-3 pr-4">task</th>
                        <th className="py-3 pr-4">lane</th>
                        <th className="py-3 pr-4">customer/order</th>
                        <th className="py-3 pr-4">outcome</th>
                        <th className="py-3 pr-4">revenue impact</th>
                        <th className="py-3">completed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentlyCompleted.map((task: any) => (
                        <tr key={task.id} className="border-b border-[#f0e6d7] last:border-0">
                          <td className="py-3 pr-4">{task.title}</td>
                          <td className="py-3 pr-4">{laneShort(task.lane)}</td>
                          <td className="py-3 pr-4 text-[#6f6254]">{customerOrder(task)}</td>
                          <td className="py-3 pr-4 text-[#6f6254]">{task.outcome || "—"}</td>
                          <td className="py-3 pr-4 text-[#2f6f45]">{task.revenueRecoveredCents ? money(task.revenueRecoveredCents) : "—"}</td>
                          <td className="py-3">{completedDate(task.completedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-4 text-sm text-[#6f6254]">No completed tasks logged yet this week.</p>
              )}
            </section>

            <section className="mt-6 rounded-lg border border-[#e8dcc8] bg-[#fffdf8] p-6">
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6f6254]">What’s calling for your attention</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {data?.attention?.length ? (
                  data.attention.map((task: any) => (
                    <article key={task.id} className="rounded-md border border-[#eadfce] p-4">
                      <p className="text-sm font-medium">{task.title}</p>
                      <p className="mt-2 text-xs text-[#6f6254]">{laneShort(task.lane)} · {money(task.revenueAtRiskCents)} at risk</p>
                    </article>
                  ))
                ) : (
                  <p className="text-sm text-[#6f6254]">No open tasks are calling for attention.</p>
                )}
              </div>
            </section>
          </>
        ) : (
          <section className="mt-8">
            <div className="rounded-lg border border-[#e8dcc8] bg-[#fffdf8] p-7">
              <h2 className="font-serif text-3xl">Performance Proof</h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#6f6254]">
                We turn messy operator behavior into structured execution data, then agents use that data to make the business run better.
              </p>
              <div className="mt-7 grid gap-4 md:grid-cols-4">
                {[
                  ["total tasks completed", metrics?.totalTasksCompleted ?? 0, <CheckCircle2 className="h-5 w-5" />],
                  ["revenue recovered", money(metrics?.revenueRecoveredCents), <DollarSign className="h-5 w-5" />],
                  ["Clearent / XplorPay collected", money((metrics as any)?.clearentPaymentTruthCents), <DollarSign className="h-5 w-5" />],
                  ["Clearent / XplorPay settled", money((metrics as any)?.clearentSettledCents), <DollarSign className="h-5 w-5" />],
                  ["revenue at risk detected", money(metrics?.revenueAtRiskDetectedCents), <CalendarDays className="h-5 w-5" />],
                  ["average completion time", minutes(metrics?.averageCompletionMinutes), <Clock className="h-5 w-5" />],
                  ["stale customers reactivated", metrics?.staleCustomersReactivated ?? 0, <Users className="h-5 w-5" />],
                  ["Level 4 actions completed", metrics?.level4ActionsCompleted ?? 0, <ArrowRight className="h-5 w-5" />],
                  ["referral asks completed", metrics?.referralAsksCompleted ?? 0, <Link2 className="h-5 w-5" />],
                  ["unresolved revenue leaks", metrics?.unresolvedRevenueLeaks ?? 0, <DollarSign className="h-5 w-5" />],
                ].map(([label, value, icon]) => (
                  <article key={String(label)} className="rounded-md border border-[#eadfce] p-4">
                    <div className="text-[#b78a3b]">{icon}</div>
                    <div className="mt-4 font-serif text-3xl">{value as any}</div>
                    <p className="mt-2 text-sm text-[#6f6254]">{label as string}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
