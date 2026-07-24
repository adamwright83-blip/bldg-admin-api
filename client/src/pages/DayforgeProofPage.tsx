import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { LoginForm } from "@/components/LoginForm";
import { useAuth } from "@/_core/hooks/useAuth";

function ymd(date: Date) { return date.toISOString().slice(0, 10); }
function money(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100); }
export default function DayforgeProofPage() {
  const { loading, isAuthenticated } = useAuth();
  const defaultEnd = new Date(); const defaultStart = new Date(defaultEnd.getTime() - 30 * 86_400_000);
  const [start, setStart] = useState(ymd(defaultStart)); const [end, setEnd] = useState(ymd(defaultEnd));
  const dashboard = trpc.system.dayforgeProof.dashboard.useQuery({ start: new Date(`${start}T00:00:00`), end: new Date(`${end}T23:59:59.999`) }, { enabled: isAuthenticated });
  if (loading) return <main className="min-h-screen bg-slate-950 text-white grid place-items-center">Loading proof…</main>;
  if (!isAuthenticated) return <LoginForm role="admin" onSuccess={() => location.reload()} />;
  const data = dashboard.data;
  return <main className="min-h-screen bg-[#07111f] p-4 text-white md:p-8"><div className="mx-auto max-w-6xl">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-black tracking-[.2em] text-orange-400">AUGUST PROOF · LIVE TENANT TRUTH</p><h1 className="text-3xl font-black">DayForge revenue proof</h1><p className="text-slate-400">Paid revenue and verified activity only. Estimates are separated.</p></div><div className="flex gap-2"><input type="date" value={start} onChange={e => setStart(e.target.value)} className="rounded-lg bg-slate-900 p-2" /><input type="date" value={end} onChange={e => setEnd(e.target.value)} className="rounded-lg bg-slate-900 p-2" /><Link href="/dayforge-today" className="rounded-lg border border-white/15 p-2">Today</Link></div></header>
    {dashboard.error ? <p className="mt-6 rounded-xl bg-red-500/15 p-4 text-red-200">{dashboard.error.message}</p> : null}
    {data ? <>
      <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
        ["Businesses added", data.activity.prospectsAdded], ["Walk-ins", data.activity.walkInsLogged], ["Visits", data.activity.fieldVisitsAttempted], ["Follow-ups complete", data.activity.followUpsCompleted],
        ["Accounts won", data.conversion.accountsWon], ["First paid orders", data.conversion.firstPaidOrders], ["Recurring paid orders", data.conversion.recurringPaidOrders], ["Next-action compliance", `${data.productProof.nextActionCompliancePercent}%`],
      ].map(([label, value]) => <article key={label} className="rounded-2xl border border-white/10 bg-slate-900 p-4"><small className="text-slate-400">{label}</small><b className="mt-2 block text-3xl">{value}</b></article>)}</section>
      <section className="mt-6 grid gap-4 md:grid-cols-3"><article className="rounded-3xl bg-emerald-500 p-6 text-emerald-950"><small className="font-black">REALIZED ATTRIBUTED REVENUE</small><b className="mt-2 block text-4xl font-black">{money(data.money.realizedAttributedRevenueCents)}</b><p className="mt-2 text-sm">Paid eligible orders, net where canonical data exists.</p></article><article className="rounded-3xl border border-white/10 bg-slate-900 p-6"><small className="font-black text-sky-300">FIRST ORDER</small><b className="mt-2 block text-3xl">{money(data.money.paidFirstOrderRevenueCents)}</b></article><article className="rounded-3xl border border-white/10 bg-slate-900 p-6"><small className="font-black text-violet-300">RECURRING</small><b className="mt-2 block text-3xl">{money(data.money.paidRecurringRevenueCents)}</b></article></section>
      <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/5 p-4 text-sm text-amber-200">Estimated pipeline, not revenue: <b>{money(data.money.estimatedPipelineCents)}</b></p>
      <section className="mt-8 grid gap-5 md:grid-cols-2"><div><h2 className="mb-3 font-black">Revenue by property</h2>{data.money.byProperty.length ? data.money.byProperty.map(row => <div key={row.label} className="mb-2 flex justify-between rounded-xl bg-slate-900 p-3"><span>{row.label}</span><b>{money(row.realizedCents)}</b></div>) : <p className="text-slate-500">No paid attributed revenue in this range.</p>}</div><div><h2 className="mb-3 font-black">Mission drill-down</h2>{data.drillDown.map(row => <a key={row.pipelineId} href={`/commercial-missions?mission=${row.missionId}`} className="mb-2 flex justify-between rounded-xl bg-slate-900 p-3"><span>{row.accountName}</span><b>{row.stage}</b></a>)}</div></section>
    </> : null}
  </div></main>;
}
