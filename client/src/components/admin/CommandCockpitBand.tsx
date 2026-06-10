/**
 * COMMAND COCKPIT BAND — the CFO Cockpit folded into the Board.
 *
 * One band, three truths, zero page-hops:
 *  - the big TRUE NET number with its tier label (the cockpit's heartbeat)
 *  - Mission Control: tappable moves with green checks (war-wired)
 *  - "Show me the math" — the full P&L table, hidden behind ONE tap
 *  - a doorway to the full cockpit scene for the cinematic view
 *
 * Plus two thin strips that close the loop with the rest of the system:
 *  - WarStrip: the Level 4 front line, visible from the money room
 *  - ReflectionDigest: the week's proof, visual, replacing the unvisited tab
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Check, ChevronDown, ChevronRight, Loader2, Swords } from "lucide-react";

function usd(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const s = abs >= 1000 ? abs.toLocaleString("en-US", { maximumFractionDigits: 0 }) : abs.toFixed(2);
  return `${cents < 0 ? "-" : ""}$${s}`;
}

const TIER_LABEL: Record<string, { label: string; cls: string }> = {
  cliff: { label: "CLIFF — every move counts", cls: "text-red-700" },
  hover: { label: "HOVER — climbing out", cls: "text-amber-700" },
  cloud1: { label: "CLOUD 1 — above the line", cls: "text-sky-700" },
  cloud2: { label: "CLOUD 2 — building margin", cls: "text-sky-700" },
  cloud3: { label: "CLOUD 3 — strong air", cls: "text-emerald-700" },
  setup_needed: { label: "SETUP — wiring the sheet", cls: "text-slate-500" },
};

export function CommandCockpitBand({ onNavigate }: { onNavigate: (path: string) => void }) {
  const utils = trpc.useUtils();
  const summary = trpc.admin.truePnlCockpitSummary.useQuery(
    { period: "today" },
    { refetchInterval: 120_000, refetchOnWindowFocus: true }
  );
  const [mathOpen, setMathOpen] = useState(false);
  const [committed, setCommitted] = useState<Set<string>>(new Set());

  const warTaskCheck = trpc.admin.recordLevel4WarAction.useMutation({
    onSuccess: async () => {
      await utils.admin.getLevel4WarState.invalidate();
    },
  });

  const data = summary.data;
  const tier = TIER_LABEL[data?.cloudLevel ?? "setup_needed"] ?? TIER_LABEL.setup_needed;

  // Mission Control: same canonical moves the cockpit page uses, kept short.
  const missions = useMemo(
    () => [
      { id: "post-flyers", title: "Post 40 flyers", detail: "Target building lobby" },
      { id: "call-past", title: "Call 10 past customers", detail: "Friendly check-in" },
      { id: "push-orders", title: "Push 3 orders over $45", detail: "Pickup today" },
      { id: "ask-referral", title: "Ask 1 VIP for an intro", detail: "1 paid order = 1 ask" },
    ],
    []
  );

  const checkMission = (m: { id: string; title: string }) => {
    const willCheck = !committed.has(m.id);
    setCommitted((prev) => {
      const next = new Set(prev);
      next.has(m.id) ? next.delete(m.id) : next.add(m.id);
      return next;
    });
    if (willCheck) {
      const day = new Date().toISOString().slice(0, 10);
      warTaskCheck.mutate({
        kind: "task_check",
        dedupeKey: `cockpit:${day}:${m.id}`,
        meta: { source: "command_band", mission: m.title },
      });
      toast.success(`Logged: ${m.title} — the line moves.`);
    }
  };

  return (
    <section className="relative z-10 mb-4 rounded-lg border border-black/10 bg-white/80 p-4 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-start gap-5">
        {/* THE NUMBER — one heartbeat, tier-colored, no gauges needed here. */}
        <button
          type="button"
          className="group min-w-[200px] text-left"
          onClick={() => onNavigate("/pnl")}
          aria-label="Open the full CFO cockpit"
        >
          <div className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-black/45">
            True net · today
          </div>
          <div className={`mt-0.5 font-mono text-4xl font-black tracking-tight ${(data?.trueNetCents ?? 0) < 0 ? "text-red-700" : "text-emerald-700"}`}>
            {summary.isLoading ? "…" : usd(data?.trueNetCents ?? 0)}
          </div>
          <div className={`mt-0.5 flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] ${tier.cls}`}>
            {tier.label}
            <ChevronRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
          </div>
        </button>

        {/* MISSION CONTROL — the only task list. Checks push the war. */}
        <div className="min-w-[260px] flex-1">
          <div className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-sky-700">
            Mission Control
          </div>
          <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {missions.map((m) => {
              const done = committed.has(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => checkMission(m)}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left transition ${
                    done ? "border-emerald-500/60 bg-emerald-50" : "border-black/12 bg-white hover:border-black/30"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      done ? "border-emerald-600 bg-emerald-500 text-white" : "border-black/25 bg-white"
                    }`}
                  >
                    {done ? <Check className="h-3.5 w-3.5" strokeWidth={4} /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className={`block truncate text-[12px] font-bold ${done ? "text-emerald-800 line-through" : ""}`}>
                      {m.title}
                    </span>
                    <span className="block truncate text-[10px] text-black/50">{m.detail}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* SHOW ME THE MATH — the entire P&L, one tap away, never shouting. */}
      <button
        type="button"
        className="mt-3 flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-black/55 hover:text-black"
        onClick={() => setMathOpen((v) => !v)}
        aria-expanded={mathOpen}
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${mathOpen ? "rotate-180" : ""}`} />
        {mathOpen ? "Hide the math" : "Show me the math"}
      </button>
      {mathOpen ? (
        <div className="mt-2 overflow-hidden rounded-md border border-black/10">
          <table className="w-full text-[12px]">
            <tbody>
              {(data?.lines ?? []).map((line) => (
                <tr key={line.key} className="border-b border-black/5 last:border-0">
                  <td className="px-3 py-1.5 text-black/70">{line.label}</td>
                  <td className={`px-3 py-1.5 text-right font-mono font-semibold ${line.amountCents < 0 ? "text-red-700" : "text-black/80"}`}>
                    {usd(line.amountCents)}
                  </td>
                </tr>
              ))}
              <tr className="bg-black/[0.04]">
                <td className="px-3 py-2 font-bold uppercase tracking-[0.1em]">True net</td>
                <td className={`px-3 py-2 text-right font-mono text-sm font-black ${(data?.trueNetCents ?? 0) < 0 ? "text-red-700" : "text-emerald-700"}`}>
                  {usd(data?.trueNetCents ?? 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      {warTaskCheck.isPending ? (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-black/40">
          <Loader2 className="h-3 w-3 animate-spin" /> pushing the line…
        </div>
      ) : null}
    </section>
  );
}

/** Thin Level 4 strip: the front line, visible from the money room. */
export function WarStrip({ onNavigate }: { onNavigate: (path: string) => void }) {
  const war = trpc.admin.getLevel4WarState.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const data = war.data;
  if (!data?.available) return null;
  const tiles = Array.from({ length: 14 }, (_, i) => i);
  return (
    <button
      type="button"
      className="relative z-10 mb-4 block w-full rounded-lg border border-black/10 bg-[#14110d] px-4 py-3 text-left shadow-sm transition hover:border-black/30"
      onClick={() => onNavigate("/level4")}
      aria-label="Open Level 4 — the War for the Bridge"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Swords className="h-4 w-4 text-amber-400" />
          <span className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-amber-200/90">
            The War · front line
          </span>
        </div>
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">
          {data.victoryToday
            ? "BRIDGE TAKEN"
            : data.combo.label
              ? `MOMENTUM ${data.combo.label}`
              : data.projectiles.length > 0
                ? `${data.projectiles.length} EXCUSE${data.projectiles.length > 1 ? "S" : ""} INCOMING`
                : "HOLDING"}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-[3px]">
        {tiles.map((i) => (
          <span
            key={i}
            className={`h-2 flex-1 rounded-sm transition-colors duration-700 ${
              i <= data.frontLineTile
                ? "bg-gradient-to-b from-amber-400 to-amber-600 shadow-[0_0_6px_rgba(255,170,60,0.5)]"
                : "bg-white/10"
            }`}
          />
        ))}
      </div>
    </button>
  );
}

/** Reflection digest: proof of work, visual, replacing the unvisited tab. */
export function ReflectionDigest({ onNavigate }: { onNavigate: (path: string) => void }) {
  const metrics = trpc.admin.opsTasks.performanceMetrics.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: false,
  });
  const data = metrics.data;
  const done = data?.totalTasksCompleted ?? 0;
  const recovered = data?.revenueRecoveredCents ?? 0;
  const bossWins = data?.level4ActionsCompleted ?? 0;
  const hasProof = done > 0 || recovered > 0;
  return (
    <button
      type="button"
      className="relative z-10 mb-4 block w-full rounded-lg border border-black/10 bg-white/70 px-4 py-3 text-left shadow-sm backdrop-blur transition hover:border-black/30"
      onClick={() => onNavigate("/operator-reflection")}
      aria-label="Open the full reflection page"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-black/50">
          Proof you showed up
        </span>
        <span className={`font-mono text-[10px] font-bold uppercase tracking-[0.14em] ${hasProof ? "text-emerald-700" : "text-black/40"}`}>
          {hasProof ? "▲ on the board" : "first proof pending"}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div className="rounded-md bg-black/[0.04] px-2.5 py-2">
          <div className="font-mono text-xl font-black leading-none">{done}</div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-black/45">tasks closed</div>
        </div>
        <div className="rounded-md bg-emerald-500/10 px-2.5 py-2">
          <div className="font-mono text-xl font-black leading-none text-emerald-700">{usd(recovered)}</div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-black/45">recovered</div>
        </div>
        <div className="rounded-md bg-amber-500/10 px-2.5 py-2">
          <div className="font-mono text-xl font-black leading-none text-amber-700">{bossWins}</div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-black/45">boss strikes</div>
        </div>
      </div>
    </button>
  );
}
