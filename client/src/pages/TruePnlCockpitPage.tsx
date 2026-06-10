import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Info,
  Loader2,
  RefreshCw,
  Star,
} from "lucide-react";
import { keepPreviousData } from "@tanstack/react-query";
import cockpitFrameUrl from "@/assets/pnl/cockpit-frame.png";
import skyCliffUrl from "@/assets/pnl/sky-cliff.png";
import skyHoverUrl from "@/assets/pnl/sky-hover.png";
import skyCloud2Url from "@/assets/pnl/sky-cloud2.png";
import skyCloud3Url from "@/assets/pnl/sky-cloud3.png";
import basketIcon from "@/assets/pnl/icons/basket.png";
import flyersIcon from "@/assets/pnl/icons/flyers.png";
import peopleIcon from "@/assets/pnl/icons/people.png";
import planeIcon from "@/assets/pnl/icons/plane.png";
import starIcon from "@/assets/pnl/icons/star.png";
import { trpc } from "@/lib/trpc";
import {
  addTenOrdersWhatIf,
  cockpitLevelCopy,
  generateCockpitMissions,
  moneyFromCents,
  percentLabel,
  sceneAccentClass,
  sceneFromCloudLevel,
  type CockpitLevel,
  type CockpitMission,
  type CockpitScene,
} from "./truePnlCockpitViewModel";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PeriodView = "Today" | "Week" | "Month";

export type CockpitMissionView = CockpitMission & {
  /** Dollar lift (cents) applied when the operator commits the action. */
  liftCents?: number;
};

type Warning = {
  severity: "info" | "warning" | "critical";
  code: string;
  message: string;
  labels?: string[];
};

type PnlLine = {
  key: string;
  label: string;
  amountCents: number;
  matchedLabels: string[];
  missing: boolean;
  core: boolean;
};

export type CockpitData = {
  month: string;
  monthLabel: string;
  tabName: string | null;
  trusted: boolean;
  grossRevenueCents: number;
  totalExpenseCents: number;
  trueNetCents: number;
  marginPct: number | null;
  expensePressurePct: number | null;
  cliffDistanceCents: number;
  cloudLevel: CockpitLevel;
  cloudLabel: string;
  fuel:
    | { status: "ready"; runwayDays: number; label: string }
    | { status: "setup_needed"; runwayDays: null; label: string };
  lines: PnlLine[];
  warnings: Warning[];
  dateColumnCount: number;
  previousMonth: null | {
    monthLabel: string;
    tabName: string;
    grossRevenueCents: number;
    trueNetCents: number;
    marginPct: number | null;
    cloudLevel: CockpitLevel;
  };
};

// ─── Zone map (percent of the 1536×1024 cockpit-bg.png art) ──────────────────

const ZONES = {
  eyebrow: { left: "5%", top: "1.4%", width: "37%", height: "5.5%" },
  toggle: { left: "42.5%", top: "1.2%", width: "17%", height: "6%" },
  sheet: { left: "60.5%", top: "1.4%", width: "13.5%", height: "5.6%" },
  headline: { left: "6%", top: "7.2%", width: "46%", height: "10.5%" },
  trueNet: { left: "7.6%", top: "19.5%", width: "16.5%", height: "22.9%" },
  gauges: { left: "26%", top: "33%", width: "46%", height: "15.5%" },
  cloudLadder: { left: "80%", top: "13.8%", width: "16.8%", height: "34.5%" },
  expense: { left: "5%", top: "45%", width: "18%", height: "26%" },
  pnl: { left: "24.6%", top: "53.9%", width: "49.6%", height: "16.1%" },
  prevComp: { left: "80%", top: "53%", width: "17.8%", height: "19%" },
  missionCtrl: { left: "5%", top: "75.5%", width: "15%", height: "16.5%" },
  reward: { left: "67%", top: "75.9%", width: "9%", height: "15.5%" },
  whatif: { left: "77.3%", top: "75.4%", width: "20.7%", height: "15.8%" },
  footer: { left: "5%", top: "93.2%", width: "93%", height: "5.5%" },
} satisfies Record<string, CSSProperties>;

const MISSION_SLOTS = [
  { left: "21.6%", width: "10.2%" },
  { left: "33.0%", width: "10.6%" },
  { left: "44.7%", width: "10.6%" },
  { left: "56.4%", width: "10.3%" },
];
const MISSION_ROW = { top: "74.4%", height: "15%" };
const MISSION_ICONS = [flyersIcon, peopleIcon, basketIcon, starIcon];

const LINE_ORDER = [
  "grossRevenue",
  "storeLabor",
  "driverOperatorPay",
  "ownerPay",
  "gasFuel",
  "vehicleInsurance",
  "mileageVehicleExpenses",
  "dryCleaningPartnerCost",
];

// Healthy-tier missions (growth/pipeline) — shown when already profitable.
const CANONICAL_MISSIONS: CockpitMissionView[] = [
  { title: "Post 10 new flyers", detail: "Keep the pipeline full", impactLabel: "+$40 true net", tone: "growth" },
  { title: "Reactivate 2 customers", detail: "Win back inactive accounts", impactLabel: "+$25 true net", tone: "growth" },
  { title: "Get 2 orders over $45", detail: "Lift average ticket", impactLabel: "+$50 true net", tone: "growth" },
  { title: "Maintain 5-star service", detail: "Protect your rating", impactLabel: "On track", tone: "steady" },
];

// Rescue Deck — shown in red/weak tiers. Ordered to the mission icons
// (flyers, people, basket, star) and carrying real dollar lift so committing
// one climbs the (projected) plane off the cliff. -$X + 425 recovers the period.
const RESCUE_MISSIONS: CockpitMissionView[] = [
  { title: "Post 40 flyers", detail: "Target nearby buildings", impactLabel: "+$120 true net", tone: "growth", liftCents: 12000 },
  { title: "Call 10 past customers", detail: "Recover 3 orders", impactLabel: "+$90 true net", tone: "growth", liftCents: 9000 },
  { title: "Push 5 orders over $45", detail: "Protect the margin", impactLabel: "+$55 true net", tone: "steady", liftCents: 5500 },
  { title: "Visit 3 spas in person", detail: "1 weekly towel account", impactLabel: "+$160 / wk", tone: "growth", liftCents: 16000 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentMonthInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function lineByKey(data: CockpitData, key: string): PnlLine {
  return (
    data.lines.find(l => l.key === key) ?? {
      key,
      label: key,
      amountCents: 0,
      matchedLabels: [],
      missing: true,
      core: false,
    }
  );
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Compact currency for the small gauge faces: $183, $3.3K, -$4.2K. */
function compactMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents) / 100;
  if (abs >= 10000) return `${sign}$${(abs / 1000).toFixed(0)}K`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/**
 * Period-aware danger thresholds (true-net cents) — MUST mirror the server's
 * TRUE_PNL_DANGER_THRESHOLDS so the projected climb agrees with the real tier.
 */
const DANGER_THRESHOLDS: Record<
  "today" | "week" | "month",
  { hover: number; cloud1: number; cloud2: number; cloud3: number }
> = {
  today: { hover: 10_000, cloud1: 30_000, cloud2: 60_000, cloud3: 100_000 },
  week: { hover: 30_000, cloud1: 100_000, cloud2: 200_000, cloud3: 400_000 },
  month: { hover: 100_000, cloud1: 300_000, cloud2: 600_000, cloud3: 1_000_000 },
};

function levelFromNet(
  netCents: number,
  period: "today" | "week" | "month"
): CockpitLevel {
  const t = DANGER_THRESHOLDS[period];
  if (netCents < t.hover) return "cliff";
  if (netCents < t.cloud1) return "hover";
  if (netCents < t.cloud2) return "cloud1";
  if (netCents < t.cloud3) return "cloud2";
  return "cloud3";
}

const PERIOD_BY_VIEW: Record<PeriodView, "today" | "week" | "month"> = {
  Today: "today",
  Week: "week",
  Month: "month",
};

/** Smoothly animate a number toward a target (cents). */
function useCountUp(target: number, ms = 650): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const cur = Math.round(from + (target - from) * eased);
      setValue(cur);
      fromRef.current = cur;
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

function Zone({
  area,
  className,
  children,
}: {
  area: CSSProperties;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`absolute ${className ?? ""}`} style={{ ...area }}>
      {children}
    </div>
  );
}

// Tier-driven world seen through the (fixed) cockpit windshield. The sky art
// carries the mood, so we no longer wash the scene in CSS tints — only a light
// scrim behind the headline keeps text legible over bright skies.
const SCENE_SKY: Record<CockpitScene, string> = {
  cliff: skyCliffUrl,
  hover: skyHoverUrl,
  cloud1: skyCloud2Url,
  cloud2: skyCloud2Url,
  cloud3: skyCloud3Url,
};

// ─── SVG arc gauge (rotating needle, animates on value change) ───────────────

let gaugeSeq = 0;
function ArcGauge({ ratio }: { ratio: number }) {
  const id = useMemo(() => `gauge${gaugeSeq++}`, []);
  const deg = (clamp01(ratio) - 0.5) * 180; // -90 (left) .. +90 (right)
  return (
    <svg viewBox="0 0 100 60" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="45%" stopColor="#a3e635" />
          <stop offset="72%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* tick marks */}
      {Array.from({ length: 9 }).map((_, i) => {
        const a = Math.PI * (1 - i / 8);
        const x1 = 50 + 41 * Math.cos(a);
        const y1 = 52 - 41 * Math.sin(a);
        const x2 = 50 + 35 * Math.cos(a);
        const y2 = 52 - 35 * Math.sin(a);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="1"
          />
        );
      })}
      {/* track */}
      <path
        d="M 12 52 A 38 38 0 0 1 88 52"
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth="9"
        strokeLinecap="round"
      />
      {/* colored arc */}
      <path
        d="M 12 52 A 38 38 0 0 1 88 52"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="6.5"
        strokeLinecap="round"
        filter={`url(#${id}-glow)`}
      />
      {/* needle (rotates, animated) */}
      <g
        style={{
          transform: `rotate(${deg}deg)`,
          transformBox: "view-box",
          transformOrigin: "50px 52px",
          transition: "transform 0.65s cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <line
          x1="50"
          y1="52"
          x2="50"
          y2="18"
          stroke="white"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </g>
      <circle cx="50" cy="52" r="4.5" fill="white" />
      <circle cx="50" cy="52" r="2" fill="#0f172a" />
    </svg>
  );
}

function GaugeCell({
  title,
  subtitle,
  ratio,
  value,
  detail,
  tone,
}: {
  title: string;
  subtitle: string;
  ratio: number;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-between py-[0.4cqh] text-center text-white">
      <div className="leading-none">
        <div className="text-[0.64cqw] font-black uppercase tracking-wider text-white/85">
          {title}
        </div>
        <div className="text-[0.5cqw] font-bold uppercase tracking-wide text-white/45">
          {subtitle}
        </div>
      </div>
      <div className="h-[6.6cqh] w-[5.8cqw]">
        <ArcGauge ratio={ratio} />
      </div>
      <div
        className={`font-mono text-[1.35cqw] font-black leading-none ${tone}`}
        style={{ textShadow: "0 1px 6px rgba(0,0,0,0.5)" }}
      >
        {value}
      </div>
      <div className="text-[0.5cqw] font-bold text-white/55">{detail}</div>
    </div>
  );
}

function gaugeRatios(
  netCents: number,
  marginPct: number | null,
  data: CockpitData
) {
  const margin = marginPct ?? 0;
  return {
    altitude: netCents < 0 ? 0.08 : clamp01(0.3 + margin / 30),
    fuel:
      data.fuel.status === "ready" ? clamp01(data.fuel.runwayDays / 30) : 0.05,
    turbulence: clamp01((data.expensePressurePct ?? 0) / 100),
    cliff:
      data.grossRevenueCents > 0
        ? clamp01(netCents / data.grossRevenueCents + 0.25)
        : 0.1,
  };
}

// ─── Owner Pay Helper ─────────────────────────────────────────────────────────
// "Can the business afford to pay me?" Local parser turns messy survival needs
// into a monthly/weekly/daily owner-pay requirement, compared against the owner
// pay ALREADY in the Sheet (the ownerPay line). No double-counting, no write-back.

function parseSurvivalMonthlyCents(text: string): number {
  let monthly = 0;
  for (const m of Array.from(text.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g))) {
    const amt = parseFloat(m[1]!.replace(/,/g, ""));
    if (!Number.isFinite(amt)) continue;
    const after = text
      .slice(m.index! + m[0].length, m.index! + m[0].length + 18)
      .toLowerCase();
    let mult = 1; // default: monthly
    if (/(per\s*week|\/\s*wk|\/\s*week|a week|weekly|each week)/.test(after))
      mult = 4.333;
    else if (/(per\s*year|\/\s*yr|\/\s*year|annual|a year|yearly)/.test(after))
      mult = 1 / 12;
    else if (/(per\s*day|\/\s*day|a day|daily|each day)/.test(after)) mult = 30.4;
    monthly += amt * 100 * mult;
  }
  return Math.round(monthly);
}

function OwnerPayHelper({
  open,
  onClose,
  activeView,
  includedCents,
  text,
  setText,
}: {
  open: boolean;
  onClose: () => void;
  activeView: PeriodView;
  includedCents: number; // owner pay already in the Sheet, for the active period
  text: string;
  setText: (t: string) => void;
}) {
  if (!open) return null;
  const reqMonthly = parseSurvivalMonthlyCents(text);
  const reqWeekly = Math.round(reqMonthly / 4.333);
  const reqDaily = Math.round(reqMonthly / 30.4);
  const periodWord =
    activeView === "Today" ? "day" : activeView === "Week" ? "week" : "month";
  const reqForPeriod =
    activeView === "Today"
      ? reqDaily
      : activeView === "Week"
        ? reqWeekly
        : reqMonthly;
  const gap = reqForPeriod - includedCents;
  const hasInput = reqMonthly > 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-slate-900 text-white shadow-2xl ring-1 ring-white/10"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-white/10 bg-slate-950/60 px-5 py-4">
          <div>
            <div className="text-sm font-black uppercase tracking-widest text-sky-300">
              Owner Pay Helper
            </div>
            <div className="text-xs font-semibold text-white/60">
              Can the business afford to pay you?
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-white/60">
              What do you need to survive?
            </label>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={3}
              placeholder="Rent is $1350. Car insurance is $260. Phone is $85. Food and gas is $600."
              className="w-full resize-none rounded-lg border border-white/15 bg-slate-950/70 p-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-sky-400/60"
            />
            <p className="mt-1 text-[11px] font-semibold text-white/40">
              Tip: amounts are monthly by default — add “/week” or “/year” to change.
            </p>
          </div>

          {hasInput ? (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ["Monthly", reqMonthly],
                  ["Weekly", reqWeekly],
                  ["Daily", reqDaily],
                ].map(([label, cents]) => (
                  <div
                    key={label as string}
                    className="rounded-lg bg-white/5 px-2 py-2"
                  >
                    <div className="text-[10px] font-bold uppercase text-white/45">
                      {label as string}
                    </div>
                    <div className="font-mono text-base font-black text-white">
                      {moneyFromCents(cents as number)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-white/10 bg-slate-950/50 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white/70">
                    Required owner pay ({periodWord})
                  </span>
                  <span className="font-mono font-black text-white">
                    {moneyFromCents(reqForPeriod)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="font-semibold text-white/70">
                    Included in Sheet ({activeView})
                  </span>
                  <span className="font-mono font-black text-white">
                    {moneyFromCents(includedCents)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
                  <span className="font-black">Gap ({periodWord})</span>
                  <span
                    className={`font-mono font-black ${
                      gap > 0 ? "text-red-400" : "text-emerald-400"
                    }`}
                  >
                    {gap > 0 ? moneyFromCents(gap) : "Covered ✓"}
                  </span>
                </div>
              </div>

              {gap > 0 && (
                <div className="rounded-lg border border-amber-400/30 bg-amber-950/40 p-3 text-sm">
                  <div className="font-black text-amber-300">
                    Owner pay is underfunded.
                  </div>
                  <p className="mt-1 font-semibold leading-snug text-amber-100/80">
                    Add {moneyFromCents(gap)} this {periodWord} of true net to
                    cover your survival pay — earn it with the rescue moves on
                    the cockpit, then raise the owner-pay row to{" "}
                    <span className="font-mono">{moneyFromCents(reqDaily)}/day</span>.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                <span className="text-xs font-bold text-white/60">
                  Suggested owner-pay row
                </span>
                <span className="font-mono text-sm font-black text-sky-300">
                  {moneyFromCents(reqDaily)}/day
                </span>
              </div>
            </>
          ) : (
            <p className="text-sm font-semibold text-white/45">
              Type your survival costs above to see what you need to pay
              yourself and whether the business covers it.
            </p>
          )}

          <button
            type="button"
            disabled
            title="Sheet write-back is coming next"
            className="w-full cursor-not-allowed rounded-lg bg-white/10 py-2.5 text-sm font-black text-white/40"
          >
            Apply to Sheet — coming next
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main presentational view ────────────────────────────────────────────────

export function CockpitView({
  data,
  month,
  onMonthChange,
  onRefresh,
  activeView = "Month",
  onViewChange,
  missions: missionsProp,
  interactive = false,
}: {
  data: CockpitData;
  month: string;
  onMonthChange: (m: string) => void;
  onRefresh: () => void;
  activeView?: PeriodView;
  onViewChange?: (v: PeriodView) => void;
  missions?: CockpitMissionView[];
  interactive?: boolean;
}) {
  // Interactive lift: tapping a mission commits its dollar lift and the whole
  // cockpit (number, gauges, sky, tier) climbs in response.
  const [committed, setCommitted] = useState<Set<number>>(new Set());
  useEffect(() => {
    setCommitted(new Set());
  }, [data, interactive]);

  // WAR FOR THE BRIDGE: a checked cockpit mission is a real commitment —
  // it shoves the Level 4 front line (idempotent per mission per day) so
  // the money room and the gameboard tell one story. Fire-and-forget: the
  // cockpit never blocks on the war.
  const utils = trpc.useUtils();
  const warTaskCheck = trpc.admin.recordLevel4WarAction.useMutation({
    onSuccess: () => void utils.admin.getLevel4WarState.invalidate(),
    onError: () => undefined,
  });
  const commitMissionToWar = (mission: CockpitMissionView) => {
    const day = new Date().toISOString().slice(0, 10);
    warTaskCheck.mutate({
      kind: "task_check",
      dedupeKey: `cockpit:${day}:${mission.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`,
      meta: { source: "cfo_cockpit", mission: mission.title },
    });
  };

  const [helperOpen, setHelperOpen] = useState(false);
  const [survivalText, setSurvivalText] = useState("");
  const ownerPayIncludedCents = lineByKey(data, "ownerPay").amountCents;

  // Rescue Deck: in red/weak tiers (based on the booked, server-computed level)
  // Mission Control shows specific operator moves carrying real dollar lift.
  const rescueMode =
    data.cloudLevel === "cliff" || data.cloudLevel === "hover";
  const missions: CockpitMissionView[] =
    missionsProp ?? (rescueMode ? RESCUE_MISSIONS : CANONICAL_MISSIONS);
  const displayMissions = useMemo(() => missions.slice(0, 4), [missions]);

  // Committing a move climbs the (projected) plane — live on the real page too
  // when we're in the danger zone, not just in the scripted demo.
  const canCommit =
    interactive ||
    (rescueMode && displayMissions.some(m => (m.liftCents ?? 0) > 0));

  const period = PERIOD_BY_VIEW[activeView];

  // ── ACTUAL state: where the business is right now (never moved by clicks) ──
  // The sky, status, gauges and tier all reflect the booked, server-computed
  // reality. This stays put so a tapped mission never fakes a recovery.
  const actualNet = data.trueNetCents;
  const actualLevel = data.cloudLevel;
  const scene = sceneFromCloudLevel(actualLevel);
  const levelCopy = cockpitLevelCopy(actualLevel);
  const marginPct = data.marginPct;
  const ratios = gaugeRatios(actualNet, marginPct, data);

  // ── PROJECTED state: a labeled flight path, only if you complete the moves ──
  let liftCents = 0;
  if (canCommit) {
    displayMissions.forEach((m, i) => {
      if (committed.has(i)) liftCents += m.liftCents ?? 0;
    });
  }
  const projecting = canCommit && liftCents > 0;
  const projectedNet = actualNet + liftCents;
  const projectedLevel = levelFromNet(projectedNet, period);
  const animatedProjected = useCountUp(projectedNet);
  const rows = LINE_ORDER.map(key => lineByKey(data, key));
  const warningCount = data.warnings.filter(w => w.severity !== "info").length;
  const missingLabels = data.warnings.flatMap(w => w.labels ?? []);
  const drags = data.lines
    .filter(l => !l.core && l.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 4);

  // What-If always resolves to a believable projection (never "unavailable").
  const baseWhatIf = addTenOrdersWhatIf({ trueNetCents: actualNet });
  const aovCents = 4600;
  const whatIfNet = baseWhatIf.available
    ? baseWhatIf.projectedTrueNetCents
    : actualNet + Math.round(10 * aovCents * 0.3);

  const prevDelta = data.previousMonth
    ? actualNet - data.previousMonth.trueNetCents
    : null;

  const ladder: Array<{ key: CockpitLevel; label: string; note: string }> = [
    { key: "cloud3", label: "Cloud 3", note: "Elite Profit" },
    { key: "cloud2", label: "Cloud 2", note: "Strong Profit" },
    { key: "cloud1", label: "Cloud 1", note: "Profitable" },
    { key: "hover", label: "Hover", note: "Fragile Profit" },
    { key: "cliff", label: "Cliff", note: "Loss Zone" },
  ];

  const periodSub: Record<PeriodView, string> = {
    Today: "Today",
    Week: "This week",
    Month: data.monthLabel,
  };

  return (
    <div className="w-full bg-[#06101d]">
      <div
        className="relative mx-auto w-full select-none overflow-hidden bg-[#06101d]"
        style={{ aspectRatio: "1536 / 1024", containerType: "size" }}
      >
        {/* Layer 1 — the world outside the windshield (changes with the tier) */}
        <style>{`@keyframes cockpitSkyFade{from{opacity:0}to{opacity:1}}`}</style>
        <img
          key={scene}
          src={SCENE_SKY[scene]}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          style={{ animation: "cockpitSkyFade 700ms ease" }}
        />
        {/* Legibility scrim: only darkens the visible sky (sits under the frame) */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(6,16,29,0.55) 0%, rgba(6,16,29,0.12) 22%, transparent 38%)",
          }}
        />
        {/* Layer 2 — the fixed cockpit frame (transparent windshield) */}
        <img
          src={cockpitFrameUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-fill"
        />

        {/* EYEBROW */}
        <Zone area={ZONES.eyebrow} className="flex items-center gap-[0.5cqw]">
          <Star className="h-[1.1cqw] w-[1.1cqw] shrink-0 fill-amber-300 text-amber-300" />
          <span className="text-[0.74cqw] font-black uppercase tracking-widest text-sky-200 drop-shadow">
            True P&L Cockpit
          </span>
          {scene === "cliff" && (
            <span className="flex items-center gap-[0.2cqw] rounded-full bg-red-600 px-[0.5cqw] py-[0.1cqw] text-[0.55cqw] font-black uppercase tracking-wide text-white shadow-[0_0_12px_rgba(239,68,68,0.8)]">
              <AlertTriangle className="h-[0.7cqw] w-[0.7cqw]" />
              Losing money — pull up
            </span>
          )}
          {scene !== "cliff" && warningCount > 0 && (
            // Demoted: a quiet setup indicator, not a SaaS alarm strip.
            <span
              className="flex items-center gap-[0.2cqw] rounded-full border border-white/15 bg-white/5 px-[0.5cqw] py-[0.1cqw] text-[0.5cqw] font-semibold text-white/45"
              title={`Setup: ${missingLabels.join(", ") || "some rows not entered"}`}
            >
              <Info className="h-[0.65cqw] w-[0.65cqw]" />
              Setup
            </span>
          )}
        </Zone>

        {/* PERIOD TOGGLE */}
        <Zone area={ZONES.toggle} className="flex items-center justify-center">
          <div className="flex overflow-hidden rounded-[0.5cqw] text-center">
            {(["Today", "Week", "Month"] as const).map(label => {
              const on = label === activeView;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => onViewChange?.(label)}
                  className={`px-[0.9cqw] py-[0.25cqw] leading-tight transition-colors ${
                    on ? "bg-white/90 text-slate-900" : "text-slate-500"
                  }`}
                >
                  <div className="text-[0.66cqw] font-black">{label}</div>
                  <div
                    className={`text-[0.48cqw] font-semibold ${
                      on ? "text-slate-500" : "text-slate-400"
                    }`}
                  >
                    {periodSub[label]}
                  </div>
                </button>
              );
            })}
          </div>
        </Zone>

        {/* GOOGLE SHEET / MONTH */}
        <Zone
          area={ZONES.sheet}
          className="flex items-center justify-end gap-[0.4cqw]"
        >
          <input
            aria-label="Select cockpit month"
            type="month"
            value={month}
            onChange={e => onMonthChange(e.target.value)}
            className="w-[8cqw] bg-transparent text-right font-mono text-[0.62cqw] font-bold text-white outline-none"
          />
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh"
            className="text-white/70 hover:text-white"
          >
            <RefreshCw className="h-[0.9cqw] w-[0.9cqw]" />
          </button>
        </Zone>

        {/* HEADLINE */}
        <Zone area={ZONES.headline}>
          <h1 className="text-[2.05cqw] font-black leading-[1.04] tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
            CleanCloud shows what we sold.
            <br />
            <span className="text-sky-400">BLDG.chat shows what survived.</span>
          </h1>
          <p className="mt-[0.5cqh] text-[0.8cqw] font-semibold text-white/80 drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]">
            Real profit. Real expenses. Real decisions.
          </p>
        </Zone>

        {/* TRUE NET CARD — cream backing matches the frame panel, so it stays
            readable even if the frame art is slow/blocked on a deploy. */}
        <Zone
          area={ZONES.trueNet}
          className="flex flex-col justify-between rounded-[0.8cqw] bg-[#f7eede]/95 p-[0.9cqw]"
        >
          <div>
            <div className="text-[0.6cqw] font-black uppercase tracking-widest text-slate-500">
              True Net Profit ({activeView})
            </div>
            {/* ACTUAL hero — never moves when you tap a mission */}
            <div
              className={`mt-[0.3cqh] font-mono text-[2.5cqw] font-black leading-none ${
                actualNet < 0 ? "text-red-600" : "text-emerald-700"
              }`}
            >
              {moneyFromCents(actualNet)}
            </div>
            {projecting ? (
              // PROJECTED flight path — clearly labeled, not the actual state
              <div className="mt-[0.4cqh] rounded-[0.5cqw] bg-sky-500/10 px-[0.5cqw] py-[0.3cqh]">
                <div className="text-[0.5cqw] font-black uppercase tracking-wider text-sky-600">
                  ✈ Flight path · projected
                </div>
                <div className="font-mono text-[1cqw] font-black text-sky-700">
                  {moneyFromCents(animatedProjected)}
                  <span className="ml-[0.3cqw] text-[0.55cqw] font-bold text-slate-500">
                    if you complete these moves
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-[0.5cqh] text-[0.82cqw] font-black text-sky-700">
                {percentLabel(marginPct)} Margin
              </div>
            )}
          </div>
          <div className="border-t border-amber-300/60 pt-[0.5cqh]">
            <div className="text-[0.78cqw] font-black text-slate-800">
              Status:{" "}
              <span className={sceneAccentClass(scene)}>{levelCopy.label}</span>
              {projecting && projectedLevel !== actualLevel && (
                <span className="ml-[0.3cqw] text-[0.6cqw] font-bold text-sky-600">
                  → {cockpitLevelCopy(projectedLevel).label} (projected)
                </span>
              )}
            </div>
            <p className="mt-[0.2cqh] text-[0.64cqw] font-semibold leading-snug text-slate-600">
              {levelCopy.sentence}
            </p>
            <button
              type="button"
              onClick={() => setHelperOpen(true)}
              className="mt-[0.5cqh] flex w-full items-center justify-center gap-[0.3cqw] rounded-[0.5cqw] bg-slate-900 px-[0.6cqw] py-[0.5cqh] text-[0.66cqw] font-black uppercase tracking-wide text-white shadow hover:bg-slate-800"
            >
              💵 Owner Pay Helper →
            </button>
          </div>
        </Zone>

        {/* 4 GAUGES */}
        <Zone area={ZONES.gauges} className="grid grid-cols-4">
          <GaugeCell
            title="Altitude"
            subtitle="True Net Profit"
            ratio={ratios.altitude}
            value={compactMoney(actualNet)}
            detail={`Margin ${percentLabel(marginPct)}`}
            tone={actualNet < 0 ? "text-red-400" : "text-emerald-400"}
          />
          <GaugeCell
            title="Fuel"
            subtitle="Cash Runway"
            ratio={ratios.fuel}
            value={
              data.fuel.status === "ready" ? `${data.fuel.runwayDays}d` : "—"
            }
            detail={data.fuel.label}
            tone="text-sky-300"
          />
          <GaugeCell
            title="Turbulence"
            subtitle="Expense Pressure"
            ratio={ratios.turbulence}
            value={percentLabel(data.expensePressurePct)}
            detail={
              (data.expensePressurePct ?? 0) > 85
                ? "Heavy headwinds"
                : "Moderate headwinds"
            }
            tone={
              (data.expensePressurePct ?? 0) > 85
                ? "text-red-400"
                : "text-orange-400"
            }
          />
          <GaugeCell
            title="Cliff Distance"
            subtitle="How Close To Loss?"
            ratio={ratios.cliff}
            value={compactMoney(actualNet)}
            detail={actualNet < 0 ? "Below break-even" : "Above the cliff"}
            tone={actualNet < 0 ? "text-red-400" : "text-emerald-400"}
          />
        </Zone>

        {/* CLOUD LADDER */}
        <Zone
          area={ZONES.cloudLadder}
          className="flex flex-col rounded-[0.8cqw] bg-[#0e2138]/80 p-[0.4cqw]"
        >
          <div className="text-center text-[0.62cqw] font-black uppercase tracking-widest text-white/80">
            Cloud Level
          </div>
          <div className="mb-[0.3cqh] text-center text-[0.48cqw] font-semibold text-white/40">
            Business Health
          </div>
          <div className="flex flex-1 flex-col justify-between">
            {ladder.map(lvl => {
              const on = actualLevel === lvl.key; // solid = where you ARE
              const projectedHere =
                projecting &&
                projectedLevel === lvl.key &&
                projectedLevel !== actualLevel; // ghost = where you COULD be
              return (
                <div
                  key={lvl.key}
                  className={`flex items-center justify-end gap-[0.4cqw] rounded-[0.5cqw] px-[0.5cqw] py-[0.2cqh] transition-all duration-500 ${
                    on
                      ? "bg-sky-500/25 ring-1 ring-sky-400/60"
                      : projectedHere
                        ? "ring-1 ring-dashed ring-sky-300/50"
                        : ""
                  }`}
                >
                  {projectedHere && (
                    <span className="text-[0.45cqw] font-black uppercase text-sky-300/80">
                      ✈ proj
                    </span>
                  )}
                  <div className="text-right">
                    <div
                      className={`text-[0.66cqw] font-black leading-none ${
                        on
                          ? "text-white"
                          : projectedHere
                            ? "text-sky-200/80"
                            : "text-white/55"
                      }`}
                    >
                      {lvl.label}
                    </div>
                    <div className="text-[0.5cqw] font-semibold text-white/45">
                      {lvl.note}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Zone>

        {/* EXPENSE DRAGS */}
        <Zone
          area={ZONES.expense}
          className="flex flex-col rounded-[0.8cqw] bg-[#0e2138]/80 p-[0.7cqw]"
        >
          <div className="text-center text-[0.66cqw] font-black uppercase tracking-widest text-white/80">
            Top Expense Drags
          </div>
          <div className="mt-[0.5cqh] flex flex-1 flex-col justify-center gap-[0.5cqh]">
            {drags.length ? (
              drags.map(line => (
                <div key={line.key} className="flex items-center gap-[0.4cqw]">
                  <span className="min-w-0 flex-1 truncate text-[0.66cqw] font-semibold text-white/85">
                    {line.label}
                  </span>
                  <span className="shrink-0 font-mono text-[0.7cqw] font-black text-red-400">
                    −{moneyFromCents(line.amountCents)}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-[0.62cqw] font-semibold text-white/45">
                Clean skies — no major drags.
              </p>
            )}
          </div>
          <p className="text-[0.5cqw] font-semibold text-white/35">
            These are your biggest headwinds.
          </p>
        </Zone>

        {/* P&L BREAKDOWN */}
        <Zone
          area={ZONES.pnl}
          className="flex flex-col rounded-[0.8cqw] bg-[#f7eede]/95 px-[1.6cqw] py-[0.9cqw]"
        >
          <div className="text-center text-[0.78cqw] font-black uppercase tracking-widest text-slate-700">
            True P&L Breakdown ·{" "}
            <span className="font-semibold text-slate-500">{activeView}</span>
          </div>
          <div className="mt-[0.5cqh] grid flex-1 grid-cols-2 content-center gap-x-[3cqw] gap-y-[0.5cqh]">
            {rows.map((line, index) => {
              const isRevenue = line.key === "grossRevenue";
              const amount = isRevenue ? line.amountCents : -line.amountCents;
              return (
                <div
                  key={line.key}
                  className="flex items-baseline justify-between"
                >
                  <span className="text-[0.72cqw] font-bold text-slate-700">
                    {index === 0 ? line.label : `− ${line.label}`}
                  </span>
                  <span
                    className={`font-mono text-[0.74cqw] font-black ${
                      isRevenue ? "text-emerald-700" : "text-red-600"
                    }`}
                  >
                    {moneyFromCents(amount)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-[0.4cqh] flex items-center justify-between border-t-2 border-amber-300 pt-[0.4cqh]">
            <span className="text-[0.85cqw] font-black uppercase tracking-wide text-slate-900">
              = True Net Profit
            </span>
            <span
              className={`font-mono text-[1.6cqw] font-black ${
                data.trueNetCents < 0 ? "text-red-600" : "text-emerald-700"
              }`}
            >
              {moneyFromCents(data.trueNetCents)}
            </span>
          </div>
        </Zone>

        {/* PREVIOUS COMPARISON */}
        <Zone
          area={ZONES.prevComp}
          className="flex flex-col rounded-[0.8cqw] bg-[#0e2138]/80 p-[0.7cqw]"
        >
          <div className="text-center text-[0.64cqw] font-black uppercase tracking-widest text-white/80">
            Previous Comparison
          </div>
          {data.previousMonth ? (
            <div className="mt-[0.4cqh] flex flex-1 flex-col justify-center gap-[0.4cqh]">
              <div className="flex items-baseline justify-between border-b border-white/10 pb-[0.2cqh]">
                <span className="text-[0.62cqw] font-semibold text-white/70">
                  Revenue
                </span>
                <span className="font-mono text-[0.66cqw] font-black text-white">
                  {moneyFromCents(data.previousMonth.grossRevenueCents)}
                </span>
              </div>
              <div className="flex items-baseline justify-between border-b border-white/10 pb-[0.2cqh]">
                <span className="text-[0.62cqw] font-semibold text-white/70">
                  True Net
                </span>
                <span className="font-mono text-[0.66cqw] font-black text-white">
                  {moneyFromCents(data.previousMonth.trueNetCents)}
                </span>
              </div>
              {prevDelta != null && (
                <div
                  className={`text-[0.7cqw] font-black ${
                    prevDelta >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {prevDelta >= 0 ? "▲" : "▼"}{" "}
                  {moneyFromCents(Math.abs(prevDelta))} vs prev
                </div>
              )}
            </div>
          ) : (
            <p className="mt-[0.4cqh] text-[0.6cqw] font-semibold text-white/45">
              Previous tab missing.
            </p>
          )}
        </Zone>

        {/* MISSION CONTROL */}
        <Zone
          area={ZONES.missionCtrl}
          className="flex flex-col justify-center"
        >
          <div className="text-[0.68cqw] font-black uppercase tracking-widest text-sky-300">
            Mission Control
          </div>
          <p className="mt-[0.3cqh] text-[0.58cqw] font-semibold leading-snug text-white/65">
            {canCommit
              ? "Tap a move you'll make. Watch the plane climb."
              : "Protect profit and build tomorrow's pipeline."}
          </p>
        </Zone>

        {/* MISSION CARDS */}
        {displayMissions.map((mission, i) => {
          const done = committed.has(i);
          const tappable = canCommit && (mission.liftCents ?? 0) > 0;
          return (
            <button
              key={mission.title}
              type="button"
              disabled={!tappable}
              onClick={() => {
                const willCheck = !committed.has(i);
                setCommitted(prev => {
                  const next = new Set(prev);
                  next.has(i) ? next.delete(i) : next.add(i);
                  return next;
                });
                // Checking (not unchecking) pushes the war's front line.
                if (willCheck) commitMissionToWar(mission);
              }}
              className={`absolute flex flex-col items-center rounded-[0.7cqw] bg-[#f7eede]/92 px-[0.5cqw] py-[0.5cqh] text-center transition-transform ${
                tappable ? "cursor-pointer hover:scale-[1.04]" : "cursor-default"
              }`}
              style={{
                left: MISSION_SLOTS[i].left,
                width: MISSION_SLOTS[i].width,
                ...MISSION_ROW,
              }}
            >
              <div className="relative">
                <img
                  src={MISSION_ICONS[i]}
                  alt=""
                  className="h-[3.6cqh] w-auto object-contain drop-shadow"
                />
                {done && (
                  <span className="absolute -right-[0.6cqw] -top-[0.3cqh] flex h-[1.4cqw] w-[1.4cqw] items-center justify-center rounded-full bg-emerald-500 text-white shadow ring-2 ring-white">
                    <Check className="h-[0.9cqw] w-[0.9cqw]" strokeWidth={4} />
                  </span>
                )}
              </div>
              <div className="mt-[0.2cqh] text-[0.58cqw] font-black leading-tight text-slate-900">
                {mission.title}
              </div>
              <div className="text-[0.5cqw] font-semibold leading-tight text-slate-500">
                {mission.detail}
              </div>
              <div
                className={`mt-auto text-[0.56cqw] font-black ${
                  done ? "text-emerald-600" : "text-emerald-700"
                }`}
              >
                {done ? "✓ logged" : mission.impactLabel}
              </div>
            </button>
          );
        })}

        {/* MISSION REWARD */}
        <Zone
          area={ZONES.reward}
          className="flex flex-col items-center justify-end pb-[0.4cqh]"
        >
          <div className="text-center text-[0.5cqw] font-semibold leading-tight text-white/65">
            Climb to the next cloud level
          </div>
        </Zone>

        {/* WHAT-IF */}
        <Zone
          area={ZONES.whatif}
          className="flex items-center gap-[0.6cqw] rounded-[0.8cqw] bg-[#0e2138]/80 px-[0.8cqw]"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[0.64cqw] font-black uppercase tracking-widest text-sky-300">
              What If? Simulator
            </div>
            <p className="mt-[0.2cqh] text-[0.6cqw] font-semibold text-white/80">
              Add 10 more orders (avg $46)
            </p>
            <div className="mt-[0.3cqh]">
              <div className="text-[0.54cqw] font-semibold text-white/50">
                Projected True Net
              </div>
              <div className="font-mono text-[1cqw] font-black text-emerald-400">
                {moneyFromCents(whatIfNet)}
              </div>
            </div>
          </div>
          <img
            src={planeIcon}
            alt=""
            className="h-[6cqh] w-auto shrink-0 object-contain drop-shadow"
          />
        </Zone>

        {/* FOOTER */}
        <Zone
          area={ZONES.footer}
          className="flex items-center justify-between text-[0.6cqw] font-bold text-amber-100/85"
        >
          <span>
            ⭐ You're not just running a laundromat. You're building a business
            that flies.
          </span>
          <span className="hidden text-white/70 lg:inline">
            {levelCopy.sentence}
          </span>
          <span>Fly smart. Profit real. ⭐</span>
        </Zone>
      </div>

      <OwnerPayHelper
        open={helperOpen}
        onClose={() => setHelperOpen(false)}
        activeView={activeView}
        includedCents={ownerPayIncludedCents}
        text={survivalText}
        setText={setSurvivalText}
      />
    </div>
  );
}

// ─── Demo stage (four-step Day → Week → Month story stepper) ─────────────────

export function CockpitDemoStage({
  beats,
}: {
  beats: import("./cockpitDemoData").DemoBeat[];
}) {
  const [i, setI] = useState(0);
  const beat = beats[i];
  return (
    <div className="w-full bg-[#06101d]">
      {/* Stepper bar */}
      <div className="mx-auto flex max-w-[1536px] flex-wrap items-center gap-2 px-3 py-2">
        {beats.map((b, idx) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setI(idx)}
            className={`rounded-lg px-3 py-1.5 text-xs font-black transition-colors ${
              idx === i
                ? "bg-sky-500 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            {idx + 1}. {b.step}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setI(p => Math.min(beats.length - 1, p + 1))}
          className="ml-auto flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-500"
        >
          Next day <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <p className="mx-auto max-w-[1536px] px-3 pb-2 text-sm font-semibold italic text-sky-200/90">
        “{beat.caption}”
      </p>
      <CockpitView
        key={beat.id}
        data={beat.data}
        month={beat.data.month}
        onMonthChange={() => {}}
        onRefresh={() => {}}
        activeView={beat.view}
        missions={beat.missions}
        interactive={beat.interactive}
      />
    </div>
  );
}

// ─── tRPC wrapper (default export, used by the admin tab) ─────────────────────

function useIsDemo(): boolean {
  return (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("demo") === "1"
  );
}

export default function TruePnlCockpitPage() {
  const isDemo = useIsDemo();
  const [month, setMonth] = useState(currentMonthInput);
  const [activeView, setActiveView] = useState<PeriodView>("Month");
  const query = trpc.admin.truePnlCockpitSummary.useQuery(
    { month, period: PERIOD_BY_VIEW[activeView] },
    { enabled: !isDemo, placeholderData: keepPreviousData }
  );
  const data = query.data as CockpitData | undefined;

  // Lazy-load the demo script only when ?demo=1 (keeps it out of normal use).
  const [beats, setBeats] = useState<
    import("./cockpitDemoData").DemoBeat[] | null
  >(null);
  useEffect(() => {
    if (isDemo)
      import("./cockpitDemoData").then(m => setBeats(m.COCKPIT_DEMO_BEATS));
  }, [isDemo]);

  if (isDemo) {
    if (!beats)
      return (
        <div className="flex min-h-[60vh] items-center justify-center bg-[#06101d] text-white">
          <Loader2 className="mr-3 h-5 w-5 animate-spin text-sky-400" />
          <span className="text-sm font-semibold">Loading demo…</span>
        </div>
      );
    return <CockpitDemoStage beats={beats} />;
  }

  if (query.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-[#06101d] text-white">
        <Loader2 className="mr-3 h-5 w-5 animate-spin text-sky-400" />
        <span className="text-sm font-semibold">Loading True P&L Cockpit…</span>
      </div>
    );
  }

  if (!data || query.isError) {
    return (
      <div className="m-6 rounded-xl border border-red-500/30 bg-red-950/60 p-6 text-red-200">
        Could not load the True P&L Cockpit.{" "}
        {query.error?.message ?? "Unknown error."}
      </div>
    );
  }

  return (
    <CockpitView
      data={data}
      month={month}
      onMonthChange={setMonth}
      onRefresh={() => query.refetch()}
      activeView={activeView}
      onViewChange={setActiveView}
    />
  );
}
