import { useMemo, useState, type CSSProperties } from "react";
import { AlertTriangle, Loader2, RefreshCw, Star } from "lucide-react";
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

// ─── Tier-driven world art ───────────────────────────────────────────────────
// The background swaps with the profit tier (the "Super Mario altitude" idea):
// danger cliffs when profit is down, higher cloud kingdoms as profit climbs.
// Drop tier-specific art here as you generate it (e.g. cliff-bg.png,
// cloud2-bg.png). Until a tier has its own art it falls back to the base scene.
const SCENE_BG: Record<CockpitScene, string> = {
  cliff: cockpitBgUrl,
  hover: cockpitBgUrl,
  cloud1: cockpitBgUrl,
  cloud2: cockpitBgUrl,
  cloud3: cockpitBgUrl,
};

// A v1 "mood grade" overlaid on the sky so the tier is felt immediately,
// even before each tier has bespoke art. Top-weighted so it tints the sky,
// not the data panels below.
function sceneTintStyle(scene: CockpitScene): CSSProperties {
  switch (scene) {
    case "cliff":
      return {
        background:
          "linear-gradient(to bottom, rgba(127,20,20,0.60) 0%, rgba(127,20,20,0.22) 30%, transparent 50%)",
      };
    case "hover":
      return {
        background:
          "linear-gradient(to bottom, rgba(245,158,11,0.16) 0%, transparent 44%)",
      };
    case "cloud1":
      return {
        background:
          "linear-gradient(to bottom, rgba(16,185,129,0.16) 0%, transparent 44%)",
      };
    case "cloud2":
      return {
        background:
          "linear-gradient(to bottom, rgba(14,165,233,0.20) 0%, transparent 46%)",
      };
    case "cloud3":
      return {
        background:
          "linear-gradient(to bottom, rgba(167,139,250,0.22) 0%, rgba(251,191,36,0.12) 24%, transparent 50%)",
      };
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

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
// Measured directly from the art. We overlay ONLY data into the art's
// pre-drawn panels — we never draw our own panel backgrounds.

const ZONES = {
  eyebrow: { left: "5%", top: "1.4%", width: "37%", height: "5.5%" },
  toggle: { left: "42.5%", top: "1.4%", width: "17%", height: "5.6%" },
  sheet: { left: "60.5%", top: "1.4%", width: "13.5%", height: "5.6%" },
  headline: { left: "6%", top: "7.2%", width: "46%", height: "10.5%" },
  trueNet: { left: "6.6%", top: "18.4%", width: "16.3%", height: "22.9%" },
  gauges: { left: "25.8%", top: "32.6%", width: "46.4%", height: "16%" },
  cloudLadder: { left: "80%", top: "13.8%", width: "16.8%", height: "34.5%" },
  expense: { left: "5%", top: "44%", width: "18%", height: "28%" },
  pnl: { left: "23.9%", top: "52%", width: "51%", height: "19.2%" },
  prevComp: { left: "80%", top: "53%", width: "17.8%", height: "20%" },
  missionCtrl: { left: "5%", top: "75.5%", width: "15%", height: "16.5%" },
  reward: { left: "67%", top: "75.9%", width: "9%", height: "15.5%" },
  whatif: { left: "77.3%", top: "75.4%", width: "20.7%", height: "15.8%" },
  footer: { left: "5%", top: "93.2%", width: "93%", height: "5.5%" },
} satisfies Record<string, CSSProperties>;

// Individual mission-card slots (matched to the art's cream cards).
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

// ─── SVG arc gauge (green→amber→red with needle) ─────────────────────────────

let gaugeSeq = 0;
function ArcGauge({ ratio }: { ratio: number }) {
  const id = useMemo(() => `g${gaugeSeq++}`, []);
  const cx = 50;
  const cy = 50;
  const r = 40;
  const theta = Math.PI * (1 - clamp01(ratio));
  const nx = cx + r * 0.74 * Math.cos(theta);
  const ny = cy - r * 0.74 * Math.sin(theta);
  return (
    <svg viewBox="0 0 100 56" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="45%" stopColor="#a3e635" />
          <stop offset="72%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <path
        d="M 10 50 A 40 40 0 0 1 90 50"
        fill="none"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <path
        d="M 10 50 A 40 40 0 0 1 90 50"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="6"
        strokeLinecap="round"
      />
      <line
        x1={cx}
        y1={cy}
        x2={nx}
        y2={ny}
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r="4" fill="white" />
    </svg>
  );
}

function gaugeRatios(data: CockpitData) {
  const margin = data.marginPct ?? 0;
  return {
    altitude: data.trueNetCents < 0 ? 0.08 : clamp01(0.3 + margin / 30),
    fuel:
      data.fuel.status === "ready" ? clamp01(data.fuel.runwayDays / 30) : 0.05,
    turbulence: clamp01((data.expensePressurePct ?? 0) / 100),
    cliff:
      data.grossRevenueCents > 0
        ? clamp01(data.cliffDistanceCents / data.grossRevenueCents + 0.25)
        : 0.1,
  };
}

// ─── Gauge cell ───────────────────────────────────────────────────────────────

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
    <div className="flex h-full flex-col items-center justify-between py-[0.5cqh] text-center text-white">
      <div className="leading-none">
        <div className="text-[0.66cqw] font-black uppercase tracking-wider text-white/85">
          {title}
        </div>
        <div className="text-[0.5cqw] font-bold uppercase tracking-wide text-white/45">
          {subtitle}
        </div>
      </div>
      <div className="relative mt-[0.2cqh] h-[3cqh] w-[5.6cqw]">
        <ArcGauge ratio={ratio} />
        <div
          className={`absolute inset-x-0 bottom-0 font-mono text-[1.25cqw] font-black leading-none ${tone}`}
        >
          {value}
        </div>
      </div>
      <div className="text-[0.5cqw] font-bold text-white/60">{detail}</div>
    </div>
  );
}

// ─── Main presentational view ────────────────────────────────────────────────

export function CockpitView({
  data,
  month,
  onMonthChange,
  onRefresh,
}: {
  data: CockpitData;
  month: string;
  onMonthChange: (m: string) => void;
  onRefresh: () => void;
}) {
  const levelCopy = cockpitLevelCopy(data.cloudLevel);
  const scene = sceneFromCloudLevel(data.cloudLevel);
  const missions = generateCockpitMissions({
    cloudLevel: data.cloudLevel,
    trueNetCents: data.trueNetCents,
    grossRevenueCents: data.grossRevenueCents,
    expensePressurePct: data.expensePressurePct,
  });
  const ratios = gaugeRatios(data);
  const rows = LINE_ORDER.map(key => lineByKey(data, key));
  const warningCount = data.warnings.filter(w => w.severity !== "info").length;
  const missingLabels = data.warnings.flatMap(w => w.labels ?? []);
  const drags = data.lines
    .filter(l => !l.core && l.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 4);
  const whatIf = addTenOrdersWhatIf({ trueNetCents: data.trueNetCents });
  const prevDelta = data.previousMonth
    ? data.trueNetCents - data.previousMonth.trueNetCents
    : null;

  const ladder: Array<{ key: CockpitLevel; label: string; note: string }> = [
    { key: "cloud3", label: "Cloud 3", note: "Elite Profit" },
    { key: "cloud2", label: "Cloud 2", note: "Strong Profit" },
    { key: "cloud1", label: "Cloud 1", note: "Profitable" },
    { key: "hover", label: "Hover", note: "Fragile Profit" },
    { key: "cliff", label: "Cliff", note: "Loss Zone" },
  ];

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
        {/* ── MOOD GRADE (tier-driven sky tint) ── */}
        <div
          className="pointer-events-none absolute inset-0"
          style={sceneTintStyle(scene)}
        />
        {/* Danger vignette only when we're on the cliff */}
        {scene === "cliff" && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{ boxShadow: "inset 0 0 18cqw 6cqw rgba(80,0,0,0.55)" }}
          />
        )}

        {/* ── EYEBROW ── */}
        <Zone area={ZONES.eyebrow} className="flex items-center gap-[0.5cqw]">
          <Star className="h-[1.1cqw] w-[1.1cqw] shrink-0 fill-amber-300 text-amber-300" />
          <span className="text-[0.74cqw] font-black uppercase tracking-widest text-sky-200 drop-shadow">
            True P&L Cockpit
          </span>
          {warningCount > 0 && (
            <span
              className="flex items-center gap-[0.2cqw] rounded-full border border-amber-400/50 bg-amber-900/80 px-[0.5cqw] py-[0.1cqw] text-[0.55cqw] font-black text-amber-200"
              title={missingLabels.join(", ")}
            >
              <AlertTriangle className="h-[0.7cqw] w-[0.7cqw]" />
              {warningCount} optional row{warningCount > 1 ? "s" : ""} missing
            </span>
          )}
        </Zone>

        {/* ── PERIOD TOGGLE ── */}
        <Zone area={ZONES.toggle} className="flex items-center justify-center">
          <div className="flex overflow-hidden rounded-[0.4cqw] text-center">
            {(["Today", "Week", "Month"] as const).map((label, i) => (
              <div
                key={label}
                className={`px-[0.9cqw] py-[0.3cqw] text-[0.66cqw] font-black ${
                  i === 2 ? "text-slate-900" : "text-slate-400"
                }`}
              >
                {label}
                <div
                  className={`text-[0.5cqw] font-semibold ${
                    i === 2 ? "text-slate-500" : "text-slate-300"
                  }`}
                >
                  {i === 0 ? "—" : i === 1 ? "wk" : data.monthLabel}
                </div>
              </div>
            ))}
          </div>
        </Zone>

        {/* ── GOOGLE SHEET / MONTH ── */}
        <Zone area={ZONES.sheet} className="flex items-center justify-end gap-[0.4cqw]">
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

        {/* ── HEADLINE ── */}
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

        {/* ── TRUE NET CARD (cream) ── */}
        <Zone area={ZONES.trueNet} className="flex flex-col justify-between p-[0.9cqw]">
          <div>
            <div className="text-[0.6cqw] font-black uppercase tracking-widest text-slate-500">
              True Net Profit ({data.monthLabel})
            </div>
            <div
              className={`mt-[0.3cqh] font-mono text-[2.5cqw] font-black leading-none ${
                data.trueNetCents < 0 ? "text-red-600" : "text-emerald-700"
              }`}
            >
              {moneyFromCents(data.trueNetCents)}
            </div>
            <div className="mt-[0.5cqh] text-[0.82cqw] font-black text-sky-700">
              {percentLabel(data.marginPct)} Margin
            </div>
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

        {/* ── 4 GAUGES ── */}
        <Zone area={ZONES.gauges} className="grid grid-cols-4">
          <GaugeCell
            title="Altitude"
            subtitle="True Net Profit"
            ratio={ratios.altitude}
            value={moneyFromCents(data.trueNetCents)}
            detail={`Margin ${percentLabel(data.marginPct)}`}
            tone={data.trueNetCents < 0 ? "text-red-400" : "text-emerald-400"}
          />
          <GaugeCell
            title="Fuel"
            subtitle="Cash Runway"
            ratio={ratios.fuel}
            value={
              data.fuel.status === "ready" ? `${data.fuel.runwayDays}d` : "Setup"
            }
            detail={data.fuel.label}
            tone={data.fuel.status === "ready" ? "text-white" : "text-amber-300"}
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
            value={moneyFromCents(
              data.trueNetCents < 0 ? data.trueNetCents : data.cliffDistanceCents
            )}
            detail={data.trueNetCents < 0 ? "Below break-even" : "Above the cliff"}
            tone={data.trueNetCents < 0 ? "text-red-400" : "text-emerald-400"}
          />
        </Zone>

        {/* ── CLOUD LADDER (right, over baked panel) ── */}
        <Zone area={ZONES.cloudLadder} className="flex flex-col">
          <div className="text-center text-[0.62cqw] font-black uppercase tracking-widest text-white/80">
            Cloud Level
          </div>
          <div className="mb-[0.3cqh] text-center text-[0.48cqw] font-semibold text-white/40">
            Business Health
          </div>
          <div className="flex flex-1 flex-col justify-between">
            {ladder.map(level => {
              const active =
                data.cloudLevel === level.key ||
                (data.cloudLevel === "setup_needed" && level.key === "hover");
              return (
                <div
                  key={level.key}
                  className={`flex items-center justify-end gap-[0.4cqw] rounded-[0.5cqw] px-[0.5cqw] py-[0.2cqh] ${
                    active ? "bg-sky-500/25 ring-1 ring-sky-400/60" : ""
                  }`}
                >
                  <div className="text-right">
                    <div
                      className={`text-[0.66cqw] font-black leading-none ${
                        active ? "text-white" : "text-white/55"
                      }`}
                    >
                      {level.label}
                    </div>
                    <div className="text-[0.5cqw] font-semibold text-white/45">
                      {level.note}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Zone>

        {/* ── EXPENSE DRAGS (left, over baked dark panel) ── */}
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
                No expense drag rows found yet.
              </p>
            )}
          </div>
          <p className="text-[0.5cqw] font-semibold text-white/35">
            These are your biggest headwinds.
          </p>
        </Zone>

        {/* ── P&L BREAKDOWN (center cream) ── */}
        <Zone area={ZONES.pnl} className="flex flex-col px-[1.6cqw] py-[0.9cqw]">
          <div className="text-center text-[0.78cqw] font-black uppercase tracking-widest text-slate-700">
            True P&L Breakdown ·{" "}
            <span className="font-semibold text-slate-500">{data.monthLabel}</span>
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

        {/* ── PREVIOUS COMPARISON (right, over baked dark panel) ── */}
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
                  {prevDelta >= 0 ? "▲" : "▼"} {moneyFromCents(Math.abs(prevDelta))}{" "}
                  vs prev
                </div>
              )}
            </div>
          ) : (
            <p className="mt-[0.4cqh] text-[0.6cqw] font-semibold text-white/45">
              Previous tab missing.
            </p>
          )}
        </Zone>

        {/* ── MISSION CONTROL (bottom-left text) ── */}
        <Zone area={ZONES.missionCtrl} className="flex flex-col justify-center">
          <div className="text-[0.68cqw] font-black uppercase tracking-widest text-sky-300">
            Mission Control
          </div>
          <p className="mt-[0.3cqh] text-[0.58cqw] font-semibold leading-snug text-white/65">
            Protect profit and build tomorrow's pipeline.
          </p>
        </Zone>

        {/* ── MISSION CARDS (over baked cream cards) ── */}
        {missions.slice(0, 4).map((mission, i) => (
          <div
            key={mission.title}
            className="absolute flex flex-col items-center px-[0.5cqw] py-[0.5cqh] text-center"
            style={{
              left: MISSION_SLOTS[i].left,
              width: MISSION_SLOTS[i].width,
              ...MISSION_ROW,
            }}
          >
            <img
              src={MISSION_ICONS[i]}
              alt=""
              className="h-[3.6cqh] w-auto object-contain drop-shadow"
            />
            <div className="mt-[0.2cqh] text-[0.58cqw] font-black leading-tight text-slate-900">
              {mission.title}
            </div>
            <div className="mt-auto text-[0.56cqw] font-black text-emerald-700">
              {mission.impactLabel.startsWith("Impact")
                ? "Keep climbing"
                : mission.impactLabel}
            </div>
          </div>
        ))}

        {/* ── MISSION REWARD (text around baked trophy) ── */}
        <Zone area={ZONES.reward} className="flex flex-col items-center justify-end pb-[0.4cqh]">
          <div className="text-center text-[0.5cqw] font-semibold leading-tight text-white/65">
            Climb to the next cloud level
          </div>
        </Zone>

        {/* ── WHAT-IF (bottom-right, over baked dark panel) ── */}
        <Zone area={ZONES.whatif} className="flex items-center gap-[0.6cqw] px-[0.8cqw]">
          <div className="min-w-0 flex-1">
            <div className="text-[0.64cqw] font-black uppercase tracking-widest text-sky-300">
              What If? Simulator
            </div>
            <p className="mt-[0.2cqh] text-[0.6cqw] font-semibold text-white/80">
              Add 10 more orders
            </p>
            {whatIf.available ? (
              <div className="mt-[0.3cqh]">
                <span className="text-[0.54cqw] font-semibold text-white/50">
                  Projected True Net{" "}
                </span>
                <span className="font-mono text-[1cqw] font-black text-emerald-400">
                  {moneyFromCents(whatIf.projectedTrueNetCents)}
                </span>
              </div>
            ) : (
              <p className="mt-[0.3cqh] text-[0.54cqw] font-semibold text-white/45">
                {whatIf.reason}
              </p>
            )}
          </div>
          <img
            src={planeIcon}
            alt=""
            className="h-[6cqh] w-auto shrink-0 object-contain drop-shadow"
          />
        </Zone>

        {/* ── FOOTER TICKER ── */}
        <Zone area={ZONES.footer} className="flex items-center justify-between text-[0.6cqw] font-bold text-amber-100/85">
          <span>
            ⭐ You're not just running a laundromat. You're building a business
            that flies.
          </span>
          <span className="hidden lg:inline text-white/70">
            {levelCopy.sentence}
          </span>
          <span>Fly smart. Profit real. ⭐</span>
        </Zone>
      </div>
    </div>
  );
}

// ─── tRPC wrapper (default export, used by the admin tab) ─────────────────────

export default function TruePnlCockpitPage() {
  const [month, setMonth] = useState(currentMonthInput);
  const query = trpc.admin.truePnlCockpitSummary.useQuery({ month });
  const data = query.data as CockpitData | undefined;

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
    />
  );
}
