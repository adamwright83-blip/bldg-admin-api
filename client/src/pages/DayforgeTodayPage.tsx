import { useMemo, useState } from "react";
import { Link } from "wouter";
import { CalendarClock, Mail, MapPin, MessageSquare, Phone, Plus, TriangleAlert } from "lucide-react";
import { LoginForm } from "@/components/LoginForm";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { WalkInCapture } from "@/components/dayforge/WalkInCapture";

function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export default function DayforgeTodayPage() {
  const { loading, isAuthenticated } = useAuth();
  const [walkInOpen, setWalkInOpen] = useState(() => new URLSearchParams(location.search).get("walkIn") === "1");
  const queue = trpc.system.dayforgeToday.list.useQuery(undefined, { enabled: isAuthenticated });
  const completeFollowUp = trpc.system.dayforgeToday.completeFollowUp.useMutation();
  const rescheduleFollowUp = trpc.system.dayforgeToday.rescheduleFollowUp.useMutation();
  const groups = useMemo(() => ({
    overdue: queue.data?.filter(item => item.urgency === "overdue") ?? [],
    now: queue.data?.filter(item => ["urgent", "today"].includes(item.urgency)) ?? [],
    upcoming: queue.data?.filter(item => item.urgency === "upcoming") ?? [],
    exceptions: queue.data?.filter(item => item.urgency === "exception") ?? [],
  }), [queue.data]);
  if (loading) return <main className="min-h-screen bg-[#07111f] text-white grid place-items-center">Loading today…</main>;
  if (!isAuthenticated) return <LoginForm role="admin" onSuccess={() => location.reload()} />;
  return (
    <main className="min-h-screen bg-[#07111f] text-slate-100 pb-28">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#07111f]/95 px-4 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <div><p className="text-xs font-black tracking-[.2em] text-orange-400">DAYFORGE</p><h1 className="text-2xl font-black">What creates revenue next?</h1></div>
          <Link href="/commercial-missions" className="rounded-xl border border-white/15 px-3 py-2 text-sm">Missions</Link>
        </div>
      </header>
      <div className="mx-auto max-w-4xl space-y-7 px-4 py-6">
        {queue.isLoading ? <p className="text-slate-400">Building your action queue…</p> : null}
        {queue.error ? <p className="rounded-xl bg-red-500/15 p-4 text-red-200">{queue.error.message}</p> : null}
        {queue.data?.length === 0 ? <section className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-6"><h2 className="font-black text-emerald-200">Queue clear.</h2><p className="mt-1 text-sm text-emerald-100/70">Log the next real-world conversation while it is fresh.</p></section> : null}
        {([
          ["OVERDUE", groups.overdue, "text-red-300"],
          ["DO NOW", groups.now, "text-orange-300"],
          ["UPCOMING", groups.upcoming, "text-sky-300"],
          ["MISSING NEXT ACTION", groups.exceptions, "text-amber-300"],
        ] as const).map(([label, items, color]) => items.length ? (
          <section key={label}>
            <h2 className={`mb-3 text-xs font-black tracking-[.18em] ${color}`}>{label} · {items.length}</h2>
            <div className="space-y-3">{items.map(item => (
              <article key={item.id} className="rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-xl">
                <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-orange-300">{item.missionCode}</p><h3 className="text-lg font-black">{item.accountName}</h3><p className="mt-1 text-sm text-slate-400">{item.note}</p></div>{item.kind === "missing_next_action" ? <TriangleAlert className="text-amber-300" /> : <CalendarClock className="text-slate-500" />}</div>
                {item.dueAt ? <p className="mt-3 text-sm font-bold">{new Date(item.dueAt).toLocaleString()}</p> : null}
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <a href={item.destinationPath} className="rounded-xl bg-orange-500 px-3 py-3 text-center text-sm font-black text-white">OPEN</a>
                  {item.address ? <a href={mapsUrl(item.address)} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-3 text-sm"><MapPin className="h-4 w-4" /> Navigate</a> : null}
                  {item.phone ? <a href={`tel:${item.phone}`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-3 text-sm"><Phone className="h-4 w-4" /> Call</a> : null}
                  {item.phone ? <a href={`sms:${item.phone}`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-3 text-sm"><MessageSquare className="h-4 w-4" /> Text</a> : null}
                  {item.email ? <a href={`mailto:${item.email}`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-3 text-sm"><Mail className="h-4 w-4" /> Email</a> : null}
                  {item.pipelineId && item.followUpId ? <button type="button" onClick={async () => { await completeFollowUp.mutateAsync({ pipelineId: item.pipelineId!, followUpId: item.followUpId!, requestId: crypto.randomUUID() }); await queue.refetch(); }} className="rounded-xl border border-emerald-400/40 px-3 py-3 text-sm font-bold text-emerald-200">Complete</button> : null}
                  {item.pipelineId && item.followUpId ? <button type="button" onClick={async () => { const dueAt = new Date(); dueAt.setDate(dueAt.getDate() + 1); dueAt.setHours(9, 0, 0, 0); await rescheduleFollowUp.mutateAsync({ pipelineId: item.pipelineId!, followUpId: item.followUpId!, requestId: crypto.randomUUID(), dueAt }); await queue.refetch(); }} className="rounded-xl border border-sky-400/40 px-3 py-3 text-sm font-bold text-sky-200">Tomorrow 9am</button> : null}
                </div>
              </article>
            ))}</div>
          </section>
        ) : null)}
      </div>
      <button type="button" onClick={() => setWalkInOpen(true)} className="fixed bottom-5 left-1/2 z-30 inline-flex min-h-16 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center justify-center gap-3 rounded-2xl bg-orange-500 px-6 text-lg font-black text-white shadow-2xl shadow-orange-950/50"><Plus /> LOG A WALK-IN</button>
      <WalkInCapture open={walkInOpen} onClose={() => setWalkInOpen(false)} />
    </main>
  );
}
