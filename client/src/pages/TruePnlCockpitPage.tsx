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
import cockpitBgUrl from "@/assets/pnl/cockpit-bg.png";
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
  trueNet: { left: "6.6%", top: "18.4%", width: "16.3%", height: "22.9%" },
  gauges: { left: "25.8%", top: "32.2%", width: "46.4%", height: "16.6%" },
  cloudLadder: { left: "80%", top: "13.8%", width: "16.8%", height: "34.5%" },
  expense: { left: "5%", top: "44%", width: "18%", height: "28%" },
  pnl: { left: "23.9%", top: "52%", width: "51%", height: "19.2%" },
  prevComp: { left: "80%", top: "53%", width: "17.8%", height: "20%" },
  missionCtrl: { left: "5%", top: "75.5%", width: "15%", height: "16.5%" },
  reward: { left: "67%", top: "75.9%", width: "9%", height: "15.5%" },
  whatif: { left: "77.3%", top: "75.4%", width: "20.7%", height: "15.8%" },
  footer: { left: "5%", top: "93.2%", width: "93%", height: "5.5%" },
} satisfies Record<string, CSSProperties>;

const MISSION_SLOTS = [
  { left: "20.8%", width: "10.6%" },
  { left: "32.7%", width: "10.6%" },
  { left: "44.7%", width: "10.8%" },
  { left: "56.6%", width: "9.9%" },
];
const MISSION_ROW = { top: "76.2%", height: "15.4%" };
const MISSION_ICONS = [flyersIcon, peopleIcon, basketIcon, starIcon];

const LINE_ORDER = [
  "grossRevenue",
  "storeLabor",
  "driverOperatorPay",
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
 * Derive a tier from live net + revenue for the interactive climb.
 * Mirrors the server's resolveTruePnlCloudLevel thresholds so demo and real agree.
 */
function levelFromNet(netCents: number, revenueCents: number): CockpitLevel {
  if (netCents < 0) return "cliff";
  const margin = revenueCents > 0 ? netCents / revenueCents : 0;
  if (margin < 0.05 || netCents < 50_000) return "hover";
  if (netCents >= 300_000 && margin >= 0.25) return "cloud3";
  if (netCents >= 150_000 && margin >= 0.15) return "cloud2";
  return "cloud1";
}

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

// Tier-driven world art (swap in bespoke per-tier skies as generated).
const SCENE_BG: Record<CockpitScene, string> = {
  cliff: cockpitBgUrl,
  hover: cockpitBgUrl,
  cloud1: cockpitBgUrl,
  cloud2: cockpitBgUrl,
  cloud3: cockpitBgUrl,
};

function sceneTintStyle(scene: CockpitScene): CSSProperties {
  switch (scene) {
    case "cliff":
      return {
        background:
          "linear-gradient(to bottom, rgba(120,12,12,0.72) 0%, rgba(140,20,20,0.30) 34%, rgba(120,12,12,0.10) 55%, transparent 70%)",
      };
    case "hover":
      return {
        background:
          "linear-gradient(to bottom, rgba(245,158,11,0.16) 0%, transparent 44%)",
      };
    case "cloud1":
      return {
        background:
          "linear-gradient(to bottom, rgba(16,185,129,0.18) 0%, transparent 46%)",
      };
    case "cloud2":
      return {
        background:
          "linear-gradient(to bottom, rgba(56,189,248,0.22) 0%, rgba(186,230,253,0.10) 28%, transparent 52%)",
      };
    case "cloud3":
      return {
        background:
          "linear-gradient(to bottom, rgba(167,139,250,0.26) 0%, rgba(251,191,36,0.14) 26%, transparent 54%)",
      };
  }
}

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

  let liftCents = 0;
  if (canCommit) {
    displayMissions.forEach((m, i) => {
      if (committed.has(i)) liftCents += m.liftCents ?? 0;
    });
  }
  const netCents = data.trueNetCents + liftCents;
  const projecting = canCommit && liftCents > 0;
  const animatedNet = useCountUp(netCents);
  const marginPct =
    data.grossRevenueCents > 0
      ? (netCents / data.grossRevenueCents) * 100
      : data.marginPct;
  const level = canCommit
    ? levelFromNet(netCents, data.grossRevenueCents)
    : data.cloudLevel;
  const scene = sceneFromCloudLevel(level);
  const levelCopy = cockpitLevelCopy(level);
  const ratios = gaugeRatios(netCents, marginPct, data);
  const rows = LINE_ORDER.map(key => lineByKey(data, key));
  const warningCount = data.warnings.filter(w => w.severity !== "info").length;
  const missingLabels = data.warnings.flatMap(w => w.labels ?? []);
  const drags = data.lines
    .filter(l => !l.core && l.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 4);

  // What-If always resolves to a believable projection (never "unavailable").
  const baseWhatIf = addTenOrdersWhatIf({ trueNetCents: netCents });
  const aovCents = 4600;
  const whatIfNet = baseWhatIf.available
    ? baseWhatIf.projectedTrueNetCents
    : netCents + Math.round(10 * aovCents * 0.3);

  const prevDelta = data.previousMonth
    ? netCents - data.previousMonth.trueNetCents
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
        className="relative mx-auto w-full select-none overflow-hidden"
        style={{
          aspectRatio: "1536 / 1024",
          containerType: "size",
          backgroundImage: `url(${SCENE_BG[scene]})`,
          backgroundSize: "100% 100%",
        }}
      >
        {/* MOOD GRADE */}
        <div
          className="pointer-events-none absolute inset-0 transition-[background] duration-700"
          style={sceneTintStyle(scene)}
        />
        {scene === "cliff" && (
          <div
            className="pointer-events-none absolute inset-0 animate-pulse"
            style={{ boxShadow: "inset 0 0 16cqw 5cqw rgba(120,0,0,0.6)" }}
          />
        )}

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

        {/* TRUE NET CARD */}
        <Zone
          area={ZONES.trueNet}
          className="flex flex-col justify-between p-[0.9cqw]"
        >
          <div>
            <div className="text-[0.6cqw] font-black uppercase tracking-widest text-slate-500">
              {projecting ? "Projected True Net" : `True Net Profit (${activeView})`}
            </div>
            <div
              className={`mt-[0.3cqh] font-mono text-[2.5cqw] font-black leading-none ${
                netCents < 0 ? "text-red-600" : "text-emerald-700"
              }`}
            >
              {moneyFromCents(animatedNet)}
            </div>
            {projecting ? (
              <div className="mt-[0.4cqh] text-[0.6cqw] font-bold leading-snug text-slate-500">
                Today {moneyFromCents(data.trueNetCents)}{" "}
                <span className="text-emerald-700">
                  · +{moneyFromCents(liftCents)} from these moves
                </span>
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
            </div>
            <p className="mt-[0.2cqh] text-[0.64cqw] font-semibold leading-snug text-slate-600">
              {levelCopy.sentence}
            </p>
          </div>
        </Zone>

        {/* 4 GAUGES */}
        <Zone area={ZONES.gauges} className="grid grid-cols-4">
          <GaugeCell
            title="Altitude"
            subtitle="True Net Profit"
            ratio={ratios.altitude}
            value={compactMoney(netCents)}
            detail={`Margin ${percentLabel(marginPct)}`}
            tone={netCents < 0 ? "text-red-400" : "text-emerald-400"}
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
            value={compactMoney(netCents)}
            detail={netCents < 0 ? "Below break-even" : "Above the cliff"}
            tone={netCents < 0 ? "text-red-400" : "text-emerald-400"}
          />
        </Zone>

        {/* CLOUD LADDER */}
        <Zone area={ZONES.cloudLadder} className="flex flex-col">
          <div className="text-center text-[0.62cqw] font-black uppercase tracking-widest text-white/80">
            Cloud Level
          </div>
          <div className="mb-[0.3cqh] text-center text-[0.48cqw] font-semibold text-white/40">
            Business Health
          </div>
          <div className="flex flex-1 flex-col justify-between">
            {ladder.map(lvl => {
              const on = level === lvl.key;
              return (
                <div
                  key={lvl.key}
                  className={`flex items-center justify-end gap-[0.4cqw] rounded-[0.5cqw] px-[0.5cqw] py-[0.2cqh] transition-all duration-500 ${
                    on ? "bg-sky-500/25 ring-1 ring-sky-400/60" : ""
                  }`}
                >
                  <div className="text-right">
                    <div
                      className={`text-[0.66cqw] font-black leading-none ${
                        on ? "text-white" : "text-white/55"
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
        <Zone area={ZONES.expense} className="flex flex-col p-[0.7cqw]">
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
        <Zone area={ZONES.pnl} className="flex flex-col px-[1.6cqw] py-[0.9cqw]">
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
        <Zone area={ZONES.prevComp} className="flex flex-col p-[0.7cqw]">
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
              onClick={() =>
                setCommitted(prev => {
                  const next = new Set(prev);
                  next.has(i) ? next.delete(i) : next.add(i);
                  return next;
                })
              }
              className={`absolute flex flex-col items-center px-[0.5cqw] py-[0.5cqh] text-center transition-transform ${
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
          className="flex items-center gap-[0.6cqw] px-[0.8cqw]"
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

const PERIOD_BY_VIEW: Record<PeriodView, "today" | "week" | "month"> = {
  Today: "today",
  Week: "week",
  Month: "month",
};

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
