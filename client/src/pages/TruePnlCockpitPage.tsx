import { useMemo, useState, type ReactElement } from "react";
import {
  AlertTriangle,
  Car,
  Cloud,
  Fuel,
  Gauge,
  Loader2,
  RefreshCw,
  Shirt,
  Star,
  Users,
} from "lucide-react";
import brightBlankCanvasUrl from "@/assets/pnl/brightblankcanvas.png";
import cockpitShellUrl from "@/assets/pnl/cockpit-shell.png";
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
} from "./truePnlCockpitViewModel";

// ─── Types ────────────────────────────────────────────────────────────────────

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

type CockpitData = {
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

// ─── Constants ────────────────────────────────────────────────────────────────

const LINE_ORDER = [
  "grossRevenue",
  "storeLabor",
  "driverOperatorPay",
  "gasFuel",
  "vehicleInsurance",
  "mileageVehicleExpenses",
  "dryCleaningPartnerCost",
];

const EXPENSE_ICONS: Record<string, ReactElement> = {
  storeLabor: <Shirt className="h-3 w-3" />,
  driverOperatorPay: <Users className="h-3 w-3" />,
  gasFuel: <Fuel className="h-3 w-3" />,
  vehicleInsurance: <Car className="h-3 w-3" />,
  mileageVehicleExpenses: <Gauge className="h-3 w-3" />,
  dryCleaningPartnerCost: <Shirt className="h-3 w-3" />,
};

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

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Period selector + refresh – compact for the top bar zone */
function PeriodToggle({
  month,
  onMonthChange,
  onRefresh,
}: {
  month: string;
  onMonthChange: (m: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex overflow-hidden rounded border border-white/25 bg-slate-900/70 text-center backdrop-blur">
        {(["Today", "Week", "Month"] as const).map((label, i) => (
          <button
            key={label}
            type="button"
            disabled={i !== 2}
            className={`border-r border-white/20 px-3 py-1 last:border-r-0 text-[0.65vw] font-black ${
              i === 2 ? "bg-white/20 text-white" : "text-white/35"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 rounded border border-white/25 bg-slate-900/70 px-2 py-1 backdrop-blur">
        <span className="text-[0.6vw] font-semibold text-white/70">Google Sheet</span>
        <input
          aria-label="Select cockpit month"
          type="month"
          value={month}
          onChange={e => onMonthChange(e.target.value)}
          className="bg-transparent font-mono text-[0.6vw] text-white outline-none"
        />
        <button
          type="button"
          onClick={onRefresh}
          className="text-white/60 hover:text-white"
          aria-label="Refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/** True Net card — fits the upper-left cream zone of the cockpit shell */
function TrueNetCard({
  data,
  levelCopy,
}: {
  data: CockpitData;
  levelCopy: ReturnType<typeof cockpitLevelCopy>;
}) {
  const scene = sceneFromCloudLevel(data.cloudLevel);
  return (
    <div className="flex h-full flex-col justify-between overflow-hidden rounded-xl bg-amber-50/90 p-3">
      <div>
        <div className="text-[0.55vw] font-black uppercase tracking-widest text-slate-500">
          True Net Profit
        </div>
        <div
          className={`font-mono font-black leading-none ${
            data.trueNetCents < 0 ? "text-red-600" : "text-emerald-700"
          }`}
          style={{ fontSize: "2.4vw", marginTop: "2%" }}
        >
          {moneyFromCents(data.trueNetCents)}
        </div>
        <div
          className="font-black text-sky-700"
          style={{ fontSize: "0.8vw", marginTop: "3%" }}
        >
          {percentLabel(data.marginPct)} Margin
        </div>
      </div>
      <div className="border-t border-amber-200 pt-2">
        <div style={{ fontSize: "0.75vw" }} className="font-black text-slate-800">
          Status:{" "}
          <span className={sceneAccentClass(scene)}>{levelCopy.label}</span>
        </div>
        <p
          className="font-semibold leading-snug text-slate-600"
          style={{ fontSize: "0.65vw", marginTop: "2%" }}
        >
          {levelCopy.sentence}
        </p>
      </div>
    </div>
  );
}

/** Single circular-style gauge panel — sits over a gauge circle in the shell */
function GaugeCell({
  title,
  subtitle,
  value,
  detail,
  tone,
}: {
  title: string;
  subtitle: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-between py-1 text-white">
      <div className="text-center">
        <div
          className="font-black uppercase tracking-widest text-white/70"
          style={{ fontSize: "0.55vw" }}
        >
          {title}
        </div>
        <div className="font-bold text-white/40" style={{ fontSize: "0.45vw" }}>
          {subtitle}
        </div>
      </div>
      <div
        className={`font-mono font-black leading-none text-center ${tone}`}
        style={{ fontSize: "1.7vw" }}
      >
        {value}
      </div>
      <div
        className="text-center font-bold text-white/55"
        style={{ fontSize: "0.5vw" }}
      >
        {detail}
      </div>
    </div>
  );
}

/** Cloud level ladder — right zone */
function CloudLadder({ active }: { active: CockpitLevel }) {
  const levels: Array<{ key: CockpitLevel; label: string; note: string }> = [
    { key: "cloud3", label: "Cloud 3", note: "Elite Profit" },
    { key: "cloud2", label: "Cloud 2", note: "Strong Profit" },
    { key: "cloud1", label: "Cloud 1", note: "Profitable" },
    { key: "hover", label: "Hover", note: "Fragile Profit" },
    { key: "cliff", label: "Cliff", note: "Loss Zone" },
  ];
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-slate-900/75 p-2 text-white backdrop-blur">
      <div
        className="mb-1 text-center font-black uppercase tracking-widest text-white/60"
        style={{ fontSize: "0.55vw" }}
      >
        Cloud Level
      </div>
      <div
        className="mb-2 text-center font-semibold text-white/40"
        style={{ fontSize: "0.45vw" }}
      >
        Business Health
      </div>
      <div className="flex flex-1 flex-col justify-between gap-1">
        {levels.map(level => {
          const isActive =
            active === level.key ||
            (active === "setup_needed" && level.key === "hover");
          return (
            <div
              key={level.key}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 ${
                isActive
                  ? "border-sky-400/60 bg-sky-500/25 shadow-[0_0_10px_rgba(14,165,233,0.4)]"
                  : "border-white/8 bg-white/4"
              }`}
            >
              <Cloud
                className={`shrink-0 ${isActive ? "text-sky-300" : "text-white/25"}`}
                style={{ width: "0.8vw", height: "0.8vw" }}
              />
              <div>
                <div
                  className={`font-black leading-none ${
                    isActive ? "text-white" : "text-white/45"
                  }`}
                  style={{ fontSize: "0.65vw" }}
                >
                  {level.label}
                </div>
                <div
                  className="font-semibold text-white/40"
                  style={{ fontSize: "0.5vw" }}
                >
                  {level.note}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Top expense drags — lower-left dark zone */
function ExpenseDrags({ data }: { data: CockpitData }) {
  const drags = data.lines
    .filter(l => !l.core && l.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 4);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-slate-900/75 p-2 text-white backdrop-blur">
      <div
        className="mb-2 font-black uppercase tracking-widest text-white/60"
        style={{ fontSize: "0.55vw" }}
      >
        Top Expense Drags
      </div>
      <div className="flex flex-1 flex-col justify-around">
        {drags.length ? (
          drags.map(line => (
            <div key={line.key} className="flex items-center gap-1">
              <span className="shrink-0 text-sky-300">
                {EXPENSE_ICONS[line.key] ?? <Gauge className="h-3 w-3" />}
              </span>
              <span
                className="min-w-0 flex-1 truncate font-semibold text-white/80"
                style={{ fontSize: "0.6vw" }}
              >
                {line.label}
              </span>
              <span
                className="shrink-0 font-mono font-black text-red-400"
                style={{ fontSize: "0.65vw" }}
              >
                −{moneyFromCents(line.amountCents)}
              </span>
            </div>
          ))
        ) : (
          <p
            className="font-semibold text-white/45"
            style={{ fontSize: "0.6vw" }}
          >
            No expense drag rows found yet.
          </p>
        )}
      </div>
      <p
        className="mt-1 font-semibold text-white/35"
        style={{ fontSize: "0.5vw" }}
      >
        These are your biggest headwinds.
      </p>
    </div>
  );
}

/** True P&L Breakdown — the large dominant cream center panel */
function PnlBreakdown({ data }: { data: CockpitData }) {
  const rows = LINE_ORDER.map(key => lineByKey(data, key));
  const monthLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-amber-50/95 px-4 py-3">
      <div
        className="mb-3 text-center font-black uppercase tracking-widest text-slate-700"
        style={{ fontSize: "0.7vw" }}
      >
        True P&L Breakdown &middot;{" "}
        <span className="font-semibold text-slate-500">{monthLabel}</span>
      </div>
      <div className="grid flex-1 grid-cols-2 content-start gap-x-8 gap-y-2">
        {rows.map((line, index) => {
          const isRevenue = line.key === "grossRevenue";
          const amount = isRevenue ? line.amountCents : -line.amountCents;
          return (
            <div key={line.key} className="flex items-baseline justify-between">
              <span
                className="font-bold text-slate-700"
                style={{ fontSize: "0.65vw" }}
              >
                {index === 0 ? line.label : `− ${line.label}`}
              </span>
              <span
                className={`font-mono font-black ${
                  isRevenue ? "text-emerald-700" : "text-red-600"
                }`}
                style={{ fontSize: "0.7vw" }}
              >
                {moneyFromCents(amount)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between border-t-2 border-amber-300 pt-2">
        <span
          className="font-black uppercase tracking-wide text-slate-900"
          style={{ fontSize: "0.75vw" }}
        >
          = True Net Profit
        </span>
        <span
          className={`font-mono font-black ${
            data.trueNetCents < 0 ? "text-red-600" : "text-emerald-700"
          }`}
          style={{ fontSize: "1.8vw" }}
        >
          {moneyFromCents(data.trueNetCents)}
        </span>
      </div>
    </div>
  );
}

/** Previous comparison — right zone below cloud ladder */
function PreviousComparison({ data }: { data: CockpitData }) {
  const delta =
    data.previousMonth
      ? data.trueNetCents - data.previousMonth.trueNetCents
      : null;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-slate-900/75 p-2 text-white backdrop-blur">
      <div
        className="mb-2 font-black uppercase tracking-widest text-white/60"
        style={{ fontSize: "0.55vw" }}
      >
        Previous Comparison
      </div>
      {data.previousMonth ? (
        <div className="flex flex-1 flex-col justify-around">
          <div className="flex justify-between border-b border-white/10 pb-1">
            <span className="font-semibold text-white/70" style={{ fontSize: "0.6vw" }}>
              Revenue
            </span>
            <span className="font-mono font-black" style={{ fontSize: "0.65vw" }}>
              {moneyFromCents(data.previousMonth.grossRevenueCents)}
            </span>
          </div>
          <div className="flex justify-between border-b border-white/10 pb-1">
            <span className="font-semibold text-white/70" style={{ fontSize: "0.6vw" }}>
              True Net
            </span>
            <span className="font-mono font-black" style={{ fontSize: "0.65vw" }}>
              {moneyFromCents(data.previousMonth.trueNetCents)}
            </span>
          </div>
          {delta != null && (
            <div
              className={`font-black ${delta >= 0 ? "text-emerald-400" : "text-red-400"}`}
              style={{ fontSize: "0.7vw" }}
            >
              {delta >= 0 ? "▲" : "▼"} {moneyFromCents(Math.abs(delta))} vs prev
            </div>
          )}
        </div>
      ) : (
        <p className="font-semibold text-white/45" style={{ fontSize: "0.6vw" }}>
          Previous tab missing.
        </p>
      )}
    </div>
  );
}

/** Single mission card for the bottom row */
function MissionCard({ mission }: { mission: CockpitMission }) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-lg border border-amber-300/50 bg-amber-50/90 p-2">
      <div
        className="font-black leading-tight text-slate-900"
        style={{ fontSize: "0.65vw" }}
      >
        {mission.title}
      </div>
      <p
        className="mt-1 flex-1 font-semibold leading-snug text-slate-600"
        style={{ fontSize: "0.55vw" }}
      >
        {mission.detail}
      </p>
      <div
        className="mt-1 font-black text-emerald-700"
        style={{ fontSize: "0.6vw" }}
      >
        {mission.impactLabel}
      </div>
    </article>
  );
}

/** What-If simulator — bottom-right zone */
function WhatIf({ data }: { data: CockpitData }) {
  const whatIf = addTenOrdersWhatIf({ trueNetCents: data.trueNetCents });
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-slate-900/75 p-2 text-white backdrop-blur">
      <div
        className="mb-1 font-black uppercase tracking-widest text-sky-300"
        style={{ fontSize: "0.55vw" }}
      >
        What If? Simulator
      </div>
      <p className="font-semibold text-white/80" style={{ fontSize: "0.65vw" }}>
        Add 10 more orders
      </p>
      {whatIf.available ? (
        <div className="mt-auto">
          <div className="font-semibold text-white/50" style={{ fontSize: "0.55vw" }}>
            Projected True Net
          </div>
          <div
            className="font-mono font-black text-emerald-400"
            style={{ fontSize: "1.4vw" }}
          >
            {moneyFromCents(whatIf.projectedTrueNetCents)}
          </div>
        </div>
      ) : (
        <p
          className="mt-auto font-semibold text-white/45"
          style={{ fontSize: "0.6vw" }}
        >
          {whatIf.reason}
        </p>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TruePnlCockpitPage() {
  const [month, setMonth] = useState(currentMonthInput);
  const query = trpc.admin.truePnlCockpitSummary.useQuery({ month });
  const data = query.data as CockpitData | undefined;
  const levelCopy = cockpitLevelCopy(data?.cloudLevel ?? "setup_needed");
  const missions = useMemo(
    () =>
      data
        ? generateCockpitMissions({
            cloudLevel: data.cloudLevel,
            trueNetCents: data.trueNetCents,
            grossRevenueCents: data.grossRevenueCents,
            expensePressurePct: data.expensePressurePct,
          })
        : [],
    [data]
  );

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

  const warningCount = data.warnings.filter(w => w.severity !== "info").length;
  const missingLabels = data.warnings.flatMap(w => w.labels ?? []);

  return (
    <div className="overflow-hidden bg-[#06101d]">
      {/*
       * COCKPIT CANVAS
       * ─────────────────────────────────────────────────────────────────────
       * 16:9 container. Two image layers (landscape + cockpit shell), then
       * data panels positioned over the blank zones in the shell image.
       *
       * All zone positions are % of total canvas width / height, measured
       * from the cockpit-shell.png art.
       *
       * LEFT NAV STRIP in the shell art: 0–5.5 % width
       * RIGHT EDGE: 99 %
       * ─────────────────────────────────────────────────────────────────────
       */}
      <div className="relative w-full" style={{ aspectRatio: "1456 / 816" }}>
        {/* ── Layer 1: landscape background ── */}
        <img
          src={brightBlankCanvasUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />

        {/* ── Layer 2: cockpit shell (frame + pilot + blank instrument zones) ── */}
        <img
          src={cockpitShellUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-fill"
        />

        {/* ── Layer 3: Data panels ─────────────────────────────────────────── */}

        {/* TOP BAR: eyebrow label + period toggle + data-source badge */}
        <div
          className="absolute flex items-center gap-3"
          style={{ top: "1.5%", left: "6%", right: "1%", height: "7%" }}
        >
          {/* Eyebrow */}
          <div className="flex items-center gap-1.5">
            <Star
              style={{ width: "1vw", height: "1vw" }}
              className="fill-amber-300 text-amber-300"
            />
            <span
              className="font-black uppercase tracking-widest text-white/80"
              style={{ fontSize: "0.65vw" }}
            >
              True P&L Cockpit
            </span>
            {warningCount > 0 && (
              <span
                className="flex items-center gap-0.5 rounded-full border border-amber-400/40 bg-amber-900/70 px-1.5 py-0.5 font-black text-amber-300"
                style={{ fontSize: "0.5vw" }}
                title={missingLabels.join(", ")}
              >
                <AlertTriangle style={{ width: "0.7vw", height: "0.7vw" }} />
                {warningCount} optional row{warningCount > 1 ? "s" : ""} missing
              </span>
            )}
          </div>
          {/* Period toggle pushed right */}
          <div className="ml-auto">
            <PeriodToggle
              month={month}
              onMonthChange={setMonth}
              onRefresh={() => query.refetch()}
            />
          </div>
        </div>

        {/* HEADLINE — floats over the pilot/sky area */}
        <div
          className="absolute"
          style={{ top: "9%", left: "27%", right: "20.5%", height: "30%" }}
        >
          <h1
            className="font-black leading-tight tracking-tight text-white drop-shadow-lg"
            style={{ fontSize: "2.6vw" }}
          >
            CleanCloud shows what we sold.
            <br />
            <span className="text-sky-400">BLDG.chat shows what survived.</span>
          </h1>
          <p
            className="font-semibold text-white/60"
            style={{ fontSize: "0.85vw", marginTop: "1.5%" }}
          >
            Real profit. Real expenses. Real decisions.
          </p>
        </div>

        {/* TRUE NET CARD — upper-left cream zone */}
        <div
          className="absolute"
          style={{ top: "12%", left: "5.5%", width: "20%", bottom: "52%" }}
        >
          <TrueNetCard data={data} levelCopy={levelCopy} />
        </div>

        {/* CLOUD LADDER — upper-right dark zone */}
        <div
          className="absolute"
          style={{ top: "12%", right: "0.5%", width: "18.5%", bottom: "36%" }}
        >
          <CloudLadder active={data.cloudLevel} />
        </div>

        {/* 4 GAUGES — instrument panel row */}
        <div
          className="absolute grid grid-cols-4"
          style={{
            top: "39%",
            left: "27%",
            right: "20.5%",
            bottom: "35%",
            gap: "0.3%",
          }}
        >
          <GaugeCell
            title="Altitude"
            subtitle="True Net Profit"
            value={moneyFromCents(data.trueNetCents)}
            detail={`Margin ${percentLabel(data.marginPct)}`}
            tone={data.trueNetCents < 0 ? "text-red-400" : "text-emerald-400"}
          />
          <GaugeCell
            title="Fuel"
            subtitle="Cash Runway"
            value={
              data.fuel.status === "ready"
                ? `${data.fuel.runwayDays}d`
                : "Setup"
            }
            detail={data.fuel.label}
            tone={
              data.fuel.status === "ready" ? "text-white" : "text-amber-300"
            }
          />
          <GaugeCell
            title="Turbulence"
            subtitle="Expense Pressure"
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
            value={moneyFromCents(
              data.trueNetCents < 0
                ? data.trueNetCents
                : data.cliffDistanceCents
            )}
            detail={
              data.trueNetCents < 0 ? "Below break-even" : "Above the cliff"
            }
            tone={data.trueNetCents < 0 ? "text-red-400" : "text-emerald-400"}
          />
        </div>

        {/* EXPENSE DRAGS — lower-left dark zone */}
        <div
          className="absolute"
          style={{ top: "50%", left: "5.5%", width: "20%", bottom: "18%" }}
        >
          <ExpenseDrags data={data} />
        </div>

        {/* P&L BREAKDOWN — large dominant center cream zone */}
        <div
          className="absolute"
          style={{ top: "66%", left: "27%", right: "20.5%", bottom: "3%" }}
        >
          <PnlBreakdown data={data} />
        </div>

        {/* PREVIOUS COMPARISON — right zone below cloud ladder */}
        <div
          className="absolute"
          style={{ top: "64%", right: "0.5%", width: "18.5%", bottom: "18%" }}
        >
          <PreviousComparison data={data} />
        </div>

        {/* WHAT-IF — bottom-left zone */}
        <div
          className="absolute"
          style={{ top: "82%", left: "5.5%", width: "20%", bottom: "2.5%" }}
        >
          <WhatIf data={data} />
        </div>

        {/* MISSION CARDS — bottom center row (up to 4) */}
        <div
          className="absolute"
          style={{
            top: "82%",
            left: "27%",
            right: "20.5%",
            bottom: "2.5%",
          }}
        >
          <div
            className="grid h-full gap-1"
            style={{
              gridTemplateColumns: `repeat(${Math.min(
                missions.length || 1,
                4
              )}, 1fr)`,
            }}
          >
            {missions.slice(0, 4).map(mission => (
              <MissionCard key={mission.title} mission={mission} />
            ))}
          </div>
        </div>

        {/* BOTTOM RIGHT — mission reward / next cloud level */}
        <div
          className="absolute flex flex-col items-center justify-center overflow-hidden rounded-xl bg-slate-900/70 text-center text-white backdrop-blur"
          style={{ top: "82%", right: "0.5%", width: "18.5%", bottom: "2.5%" }}
        >
          <div
            className="font-black uppercase tracking-widest text-sky-300"
            style={{ fontSize: "0.55vw" }}
          >
            Mission Reward
          </div>
          <p
            className="mt-1 font-semibold leading-snug text-white/60"
            style={{ fontSize: "0.6vw" }}
          >
            Complete missions to climb the cloud ladder
          </p>
        </div>

        {/* FOOTER TICKER */}
        <div
          className="absolute bottom-0 left-[5.5%] right-0 flex items-center justify-between px-3 text-white/55"
          style={{ height: "3%", fontSize: "0.55vw" }}
        >
          <span>
            ⭐ You're not just running a laundromat. You're building a business that flies.
          </span>
          <span>{levelCopy.sentence}</span>
          <span>Fly smart. Profit real. ⭐</span>
        </div>
      </div>
    </div>
  );
}
