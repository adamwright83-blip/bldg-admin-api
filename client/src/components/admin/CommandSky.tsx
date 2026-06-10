/**
 * COMMAND SKY — the merged Command screen's weather system.
 *
 * One ambient gradient wraps the whole Board: the operator feels the state
 * of the business before reading a single number. The sky is a covenant,
 * not a verdict — hope events (Log a Win) turn it blue NOW, because
 * discouragement is the enemy of activation.
 *
 *  - SkyBackdrop: full-bleed gradient behind the board, tone-driven
 *  - SkyBar: the covenant strip — weather reason, campaign beads,
 *    LOG A WIN, and the settings gear (mode toggle + tunable bars)
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Settings2, Sun } from "lucide-react";

type SkyTone = "blue" | "fair" | "overcast" | "storm" | "red";

const SKY_GRADIENTS: Record<SkyTone, string> = {
  blue: "linear-gradient(180deg, #8ec9f2 0%, #cfe9fb 34%, rgba(244,241,234,0) 72%)",
  fair: "linear-gradient(180deg, #a9cfe3 0%, #dcebf3 34%, rgba(244,241,234,0) 72%)",
  overcast: "linear-gradient(180deg, #b9bfc7 0%, #dfe2e6 34%, rgba(244,241,234,0) 72%)",
  storm: "linear-gradient(180deg, #8a8f9e 0%, #c3c7cf 34%, rgba(244,241,234,0) 72%)",
  red: "linear-gradient(180deg, #c96a55 0%, #e8b3a3 34%, rgba(244,241,234,0) 72%)",
};

const SKY_LABEL: Record<SkyTone, string> = {
  blue: "BLUE SKY",
  fair: "FAIR",
  overcast: "OVERCAST",
  storm: "STORM",
  red: "RED SKY",
};

export function useCommandSky() {
  const skyQuery = trpc.admin.getCommandSky.useQuery(
    {},
    { refetchInterval: 60_000, refetchOnWindowFocus: true }
  );
  return skyQuery;
}

export function SkyBackdrop({ tone }: { tone: SkyTone | undefined }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[420px] transition-[background] duration-[1200ms] ease-out"
      style={{ background: SKY_GRADIENTS[tone ?? "overcast"] }}
    />
  );
}

export function SkyBar() {
  const utils = trpc.useUtils();
  const sky = useCommandSky();
  const [winOpen, setWinOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [winName, setWinName] = useState("");
  const [winKind, setWinKind] = useState<"verbal_commitment" | "first_order">("verbal_commitment");

  const logWin = trpc.admin.logCommandSkyWin.useMutation({
    onSuccess: async (result) => {
      await utils.admin.getCommandSky.invalidate();
      await utils.admin.getLevel4WarState.invalidate();
      toast.success(
        result.deduped
          ? "Already on the board today."
          : winKind === "verbal_commitment"
            ? "Logged. Blue sky for the next 3 hours — go get the next one."
            : "Logged. Blue sky until the block ends."
      );
      setWinOpen(false);
      setWinName("");
    },
    onError: (error) => toast.error(error.message || "Could not log the win."),
  });

  const updateSettings = trpc.admin.updateCommandSkySettings.useMutation({
    onSuccess: async () => {
      await utils.admin.getCommandSky.invalidate();
      toast.success("Sky settings saved.");
      setSettingsOpen(false);
    },
    onError: (error) => toast.error(error.message || "Could not save settings."),
  });

  const data = sky.data;
  const tone = (data?.tone ?? "overcast") as SkyTone;
  const campaign = data?.campaign;
  const beads = useMemo(() => {
    const target = campaign?.target ?? 50;
    const count = campaign?.count ?? 0;
    // Up to 50 beads reads fine; beyond that, bead = ceil(target/50) wins.
    const beadCount = Math.min(50, target);
    const perBead = target / beadCount;
    return Array.from({ length: beadCount }, (_, i) => (i + 1) * perBead <= count);
  }, [campaign?.target, campaign?.count]);

  // Local settings draft (only while dialog open).
  const [draft, setDraft] = useState<null | {
    mode: "profit" | "campaign";
    period: "today" | "week" | "month";
    redBelow: string;
    blueAbove: string;
    campaignTarget: string;
    campaignLabel: string;
  }>(null);
  const openSettings = () => {
    const s = data?.settings;
    setDraft({
      mode: s?.mode ?? "campaign",
      period: s?.period ?? "today",
      redBelow: String(Math.round((s?.redBelowCents ?? 0) / 100)),
      blueAbove: String(Math.round((s?.blueAboveCents ?? 20000) / 100)),
      campaignTarget: String(s?.campaignTarget ?? 50),
      campaignLabel: s?.campaignLabel ?? "50 new customers",
    });
    setSettingsOpen(true);
  };

  return (
    <section className="relative z-10 mb-4 rounded-lg border border-black/10 bg-white/70 px-4 py-3 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Sun className={`h-4 w-4 ${tone === "blue" || tone === "fair" ? "text-sky-500" : tone === "red" ? "text-red-600" : "text-slate-400"}`} />
          <span className="font-mono text-[11px] font-black uppercase tracking-[0.18em]">
            {SKY_LABEL[tone]}
          </span>
        </div>
        <span className="min-w-0 flex-1 truncate text-[12px] text-black/65">{data?.reason ?? "Reading the weather…"}</span>
        {data?.hope ? (
          <span className="rounded-full border border-sky-400/50 bg-sky-50 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-sky-700">
            HOPE · {data.hope.minutesLeft}m
          </span>
        ) : null}
        <Button size="sm" className="bg-sky-600 text-white hover:bg-sky-700" onClick={() => setWinOpen(true)}>
          ☀ Log a Win
        </Button>
        <button
          type="button"
          aria-label="Sky settings"
          className="rounded-md border border-black/15 p-1.5 text-black/60 hover:bg-black hover:text-white"
          onClick={openSettings}
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </div>

      {/* Campaign beads — the keep-my-job goal, visual, zero arithmetic. */}
      {data?.settings.mode === "campaign" && campaign ? (
        <div className="mt-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-black/55">
              {campaign.label}
            </span>
            <span className="font-mono text-[10px] font-bold text-black/55">
              {campaign.count} / {campaign.target}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-[3px]">
            {beads.map((won, i) => (
              <span
                key={i}
                className={`h-2.5 w-2.5 rounded-full transition-colors duration-700 ${
                  won ? "bg-sky-500 shadow-[0_0_6px_rgba(56,150,255,0.6)]" : "bg-black/10"
                }`}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* LOG A WIN */}
      <Dialog open={winOpen} onOpenChange={setWinOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log a Win</DialogTitle>
            <DialogDescription>
              Wins change the weather immediately. A verbal yes earns 3 hours of blue sky;
              a first order keeps it blue until the block ends (2pm / 10pm).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`rounded-md border px-3 py-2 text-left text-sm font-semibold ${winKind === "verbal_commitment" ? "border-sky-600 bg-sky-50" : "border-black/15"}`}
                onClick={() => setWinKind("verbal_commitment")}
              >
                Verbal commitment
                <span className="block text-[11px] font-normal text-black/55">They said yes · 3h blue</span>
              </button>
              <button
                type="button"
                className={`rounded-md border px-3 py-2 text-left text-sm font-semibold ${winKind === "first_order" ? "border-sky-600 bg-sky-50" : "border-black/15"}`}
                onClick={() => setWinKind("first_order")}
              >
                First order placed
                <span className="block text-[11px] font-normal text-black/55">Counts toward the goal · blue to block end</span>
              </button>
            </div>
            <input
              className="w-full rounded-md border border-black/20 px-3 py-2 text-sm"
              placeholder="Who? (e.g. Sarah M — Century Park East)"
              value={winName}
              onChange={(e) => setWinName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWinOpen(false)}>Cancel</Button>
            <Button
              className="bg-sky-600 text-white hover:bg-sky-700"
              disabled={logWin.isPending || winName.trim().length < 2}
              onClick={() => logWin.mutate({ kind: winKind, label: winName.trim() })}
            >
              {logWin.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Make it blue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SKY SETTINGS — the operator owns the thermostat. */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sky settings</DialogTitle>
            <DialogDescription>
              Choose what the weather measures, and set the bars yourself — the sky should
              push you forward, never bury you.
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`rounded-md border px-3 py-2 text-left text-sm font-semibold ${draft.mode === "campaign" ? "border-sky-600 bg-sky-50" : "border-black/15"}`}
                  onClick={() => setDraft({ ...draft, mode: "campaign" })}
                >
                  Customer campaign
                  <span className="block text-[11px] font-normal text-black/55">Sky = progress to the goal</span>
                </button>
                <button
                  type="button"
                  className={`rounded-md border px-3 py-2 text-left text-sm font-semibold ${draft.mode === "profit" ? "border-sky-600 bg-sky-50" : "border-black/15"}`}
                  onClick={() => setDraft({ ...draft, mode: "profit" })}
                >
                  Profit weather
                  <span className="block text-[11px] font-normal text-black/55">Sky = net vs your bars</span>
                </button>
              </div>

              {draft.mode === "campaign" ? (
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-[0.12em] text-black/55">
                    Goal
                    <input
                      type="number"
                      min={1}
                      className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 text-sm font-normal"
                      value={draft.campaignTarget}
                      onChange={(e) => setDraft({ ...draft, campaignTarget: e.target.value })}
                    />
                  </label>
                  <label className="block text-xs font-bold uppercase tracking-[0.12em] text-black/55">
                    Goal name
                    <input
                      className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 text-sm font-normal"
                      value={draft.campaignLabel}
                      onChange={(e) => setDraft({ ...draft, campaignLabel: e.target.value })}
                    />
                  </label>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-[0.12em] text-black/55">
                    Period
                    <select
                      className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 text-sm font-normal"
                      value={draft.period}
                      onChange={(e) => setDraft({ ...draft, period: e.target.value as "today" | "week" | "month" })}
                    >
                      <option value="today">Today</option>
                      <option value="week">This week</option>
                      <option value="month">Last 30 days</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-xs font-bold uppercase tracking-[0.12em] text-red-700">
                      Red below ($)
                      <input
                        type="number"
                        className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 text-sm font-normal text-black"
                        value={draft.redBelow}
                        onChange={(e) => setDraft({ ...draft, redBelow: e.target.value })}
                      />
                    </label>
                    <label className="block text-xs font-bold uppercase tracking-[0.12em] text-sky-700">
                      Blue above ($)
                      <input
                        type="number"
                        className="mt-1 w-full rounded-md border border-black/20 px-3 py-2 text-sm font-normal text-black"
                        value={draft.blueAbove}
                        onChange={(e) => setDraft({ ...draft, blueAbove: e.target.value })}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button
              disabled={updateSettings.isPending || !draft}
              onClick={() => {
                if (!draft) return;
                updateSettings.mutate({
                  mode: draft.mode,
                  period: draft.period,
                  redBelowCents: Math.round(Number(draft.redBelow || 0) * 100),
                  blueAboveCents: Math.round(Number(draft.blueAbove || 0) * 100),
                  campaignTarget: Math.max(1, Number(draft.campaignTarget || 50)),
                  campaignLabel: draft.campaignLabel || "New customers",
                });
              }}
            >
              {updateSettings.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
