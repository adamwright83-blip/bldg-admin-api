import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Car,
  Cloud,
  Fuel,
  Gauge,
  Loader2,
  Mountain,
  Plane,
  RefreshCw,
  Shirt,
  Star,
  TrendingUp,
  Users,
} from "lucide-react";
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
  warningBorderClass,
  type CockpitLevel,
  type CockpitMission,
  type CockpitScene,
} from "./truePnlCockpitViewModel";

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

const LINE_ORDER = [
  "grossRevenue",
  "storeLabor",
  "driverOperatorPay",
  "gasFuel",
  "vehicleInsurance",
  "mileageVehicleExpenses",
  "dryCleaningPartnerCost",
];

const EXPENSE_ICONS: Record<string, JSX.Element> = {
  storeLabor: <Shirt className="h-4 w-4" />,
  driverOperatorPay: <Users className="h-4 w-4" />,
  gasFuel: <Fuel className="h-4 w-4" />,
  vehicleInsurance: <Car className="h-4 w-4" />,
  mileageVehicleExpenses: <Gauge className="h-4 w-4" />,
  dryCleaningPartnerCost: <Shirt className="h-4 w-4" />,
};

function currentMonthInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function lineByKey(data: CockpitData, key: string): PnlLine {
  return (
    data.lines.find(line => line.key === key) ?? {
      key,
      label: key,
      amountCents: 0,
      matchedLabels: [],
      missing: true,
      core: false,
    }
  );
}

function sceneClass(scene: CockpitScene): string {
  switch (scene) {
    case "cliff":
      return "from-red-500 via-orange-300 to-slate-200";
    case "hover":
      return "from-sky-300 via-sky-100 to-amber-100";
    case "cloud1":
      return "from-sky-400 via-cyan-100 to-emerald-100";
    case "cloud2":
      return "from-blue-500 via-sky-200 to-emerald-100";
    case "cloud3":
      return "from-indigo-500 via-sky-200 to-lime-100";
  }
}

function SceneBackdrop({ scene }: { scene: CockpitScene }) {
  return (
    <div className={`absolute inset-0 bg-gradient-to-b ${sceneClass(scene)}`}>
      <div className="absolute left-[8%] top-[12%] h-[18%] w-[24%] rounded-full bg-white/45 blur-xl" />
      <div className="absolute right-[18%] top-[6%] h-[16%] w-[26%] rounded-full bg-white/55 blur-xl" />
      <div className="absolute right-[8%] top-[17%] h-[18%] w-[18%] rounded-full bg-white/40 blur-xl" />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1672 941"
        aria-hidden="true"
      >
        <path
          d="M124 346 C330 302 498 246 682 199 C844 158 1020 113 1324 79"
          fill="none"
          stroke="rgba(255,255,255,0.72)"
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray="1 34"
        />
        <path
          d="M124 346 C330 302 498 246 682 199 C844 158 1020 113 1324 79"
          fill="none"
          stroke="rgba(14,165,233,0.36)"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <g transform="translate(1180 92)">
          <path d="M0 0 L162 20 L0 42 Z" fill="rgba(239,68,68,0.86)" />
          <text x="22" y="30" className="fill-white text-[28px] font-black">
            PROFIT
          </text>
        </g>
        {scene === "cliff" ? (
          <g transform="translate(1010 252)">
            <rect width="92" height="38" rx="8" fill="rgba(127,29,29,0.86)" />
            <text
              x="46"
              y="25"
              textAnchor="middle"
              className="fill-white text-[18px] font-black"
            >
              DANGER
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

function PeriodToggle() {
  return (
    <div className="flex h-full overflow-hidden rounded-xl border border-slate-300/70 bg-white/82 text-center shadow-[0_8px_22px_rgba(15,23,42,0.22)] backdrop-blur">
      {[
        ["Today", "Unavailable"],
        ["Week", "Unavailable"],
        ["Month", "Live"],
      ].map(([label, status], index) => {
        const enabled = label === "Month";
        return (
          <button
            key={label}
            type="button"
            disabled={!enabled}
            title={
              enabled
                ? "Monthly Sheet data is live"
                : "Today/Week need a future Sheet sync layer"
            }
            className={`min-w-0 flex-1 border-r border-slate-300/70 px-3 py-2 last:border-r-0 ${
              enabled ? "bg-white text-sky-900" : "text-slate-500 opacity-70"
            }`}
          >
            <div className="text-[clamp(10px,0.85vw,13px)] font-black uppercase tracking-[0.12em]">
              {label}
            </div>
            <div className="mt-0.5 text-[clamp(8px,0.72vw,11px)] font-bold">
              {index === 2 ? "Google Sheet" : status}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ProfitCard({
  data,
  levelCopy,
}: {
  data: CockpitData;
  levelCopy: ReturnType<typeof cockpitLevelCopy>;
}) {
  return (
    <section className="h-full rounded-xl border-2 border-amber-200 bg-amber-50/92 p-[5%] shadow-[0_10px_28px_rgba(15,23,42,0.22)]">
      <div className="text-[clamp(10px,0.85vw,13px)] font-black uppercase tracking-[0.12em] text-slate-800">
        True Net Profit
      </div>
      <div
        className={`mt-[5%] font-mono text-[clamp(34px,3.5vw,58px)] font-black leading-none ${data.trueNetCents < 0 ? "text-red-600" : "text-emerald-700"}`}
      >
        {moneyFromCents(data.trueNetCents)}
      </div>
      <div className="mt-[6%] text-[clamp(12px,1vw,16px)] font-black text-sky-700">
        {percentLabel(data.marginPct)} Margin
      </div>
      <div className="my-[5%] h-px bg-amber-300" />
      <div className="text-[clamp(12px,1vw,16px)] font-black">
        Status:{" "}
        <span
          className={sceneAccentClass(sceneFromCloudLevel(data.cloudLevel))}
        >
          {levelCopy.label}
        </span>
      </div>
      <p className="mt-[4%] text-[clamp(11px,0.95vw,14px)] font-semibold leading-snug text-slate-800">
        {levelCopy.sentence}
      </p>
    </section>
  );
}

function GaugePanel({
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
    <section className="h-full rounded-xl border border-slate-700/80 bg-slate-950/82 px-[6%] py-[5%] text-center text-white shadow-[inset_0_0_20px_rgba(125,211,252,0.16)]">
      <div className="text-[clamp(9px,0.75vw,12px)] font-black uppercase tracking-[0.12em]">
        {title}
      </div>
      <div className="text-[clamp(8px,0.68vw,10px)] font-bold uppercase text-white/72">
        {subtitle}
      </div>
      <div className="mx-auto mt-[6%] h-[34%] w-[76%] rounded-t-full border-x-4 border-t-4 border-slate-500/80">
        <div className="mx-auto mt-[24%] h-2 w-2 rounded-full bg-slate-300" />
      </div>
      <div
        className={`font-mono text-[clamp(22px,2.2vw,34px)] font-black leading-none ${tone}`}
      >
        {value}
      </div>
      <div className="mt-[5%] text-[clamp(8px,0.7vw,11px)] font-bold text-white/72">
        {detail}
      </div>
    </section>
  );
}

function PnlBreakdown({ data }: { data: CockpitData }) {
  const rows = LINE_ORDER.map(key => lineByKey(data, key));
  return (
    <section className="h-full rounded-xl border border-amber-600/25 bg-amber-50/94 px-[3%] py-[2.2%] text-slate-950 shadow-[0_10px_25px_rgba(15,23,42,0.2)]">
      <div className="text-center text-[clamp(12px,1.1vw,18px)] font-black uppercase tracking-[0.14em]">
        True P&L Breakdown
      </div>
      <div className="mt-[1.5%] grid grid-cols-2 gap-x-[4%] gap-y-[1%] rounded-lg border border-amber-300/80 bg-white/35 px-[2%] py-[1.6%]">
        {rows.map((line, index) => {
          const isRevenue = line.key === "grossRevenue";
          const amount = isRevenue ? line.amountCents : -line.amountCents;
          return (
            <div
              key={line.key}
              className="grid grid-cols-[1fr_auto] gap-2 text-[clamp(10px,0.86vw,14px)] font-bold"
            >
              <span>{index === 0 ? line.label : `− ${line.label}`}</span>
              <span
                className={`font-mono font-black ${isRevenue ? "text-emerald-700" : "text-red-600"}`}
              >
                {moneyFromCents(amount)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-[2%] grid grid-cols-[1fr_auto] items-center border-t border-amber-300 pt-[1.6%] text-[clamp(16px,1.6vw,26px)] font-black">
        <span className="text-center uppercase tracking-[0.08em]">
          = True Net Profit
        </span>
        <span
          className={`font-mono ${data.trueNetCents < 0 ? "text-red-600" : "text-emerald-700"}`}
        >
          {moneyFromCents(data.trueNetCents)}
        </span>
      </div>
    </section>
  );
}

function TopExpenseDrags({ data }: { data: CockpitData }) {
  const drags = data.lines
    .filter(line => !line.core && line.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 4);
  return (
    <section className="h-full rounded-xl border border-slate-600/80 bg-slate-950/82 px-[7%] py-[6%] text-white">
      <div className="text-center text-[clamp(10px,0.85vw,13px)] font-black uppercase tracking-[0.14em]">
        Top Expense Drags
      </div>
      <div className="mt-[7%] space-y-[5%]">
        {drags.length ? (
          drags.map(line => (
            <div
              key={line.key}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[clamp(10px,0.88vw,14px)] font-bold"
            >
              <span className="text-sky-200">
                {EXPENSE_ICONS[line.key] ?? <Gauge className="h-4 w-4" />}
              </span>
              <span>{line.label}</span>
              <span className="font-mono text-red-400">
                −{moneyFromCents(line.amountCents)}
              </span>
            </div>
          ))
        ) : (
          <p className="text-[clamp(10px,0.9vw,13px)] font-semibold text-white/70">
            No expense drag rows found yet.
          </p>
        )}
      </div>
      <p className="mt-[8%] text-[clamp(9px,0.75vw,11px)] font-semibold text-white/70">
        These are your biggest headwinds.
      </p>
    </section>
  );
}

function CloudLadder({ active }: { active: CockpitLevel }) {
  const levels: Array<{ key: CockpitLevel; label: string; note: string }> = [
    { key: "cloud3", label: "Cloud 3", note: "Elite Profit" },
    { key: "cloud2", label: "Cloud 2", note: "Strong Profit" },
    { key: "cloud1", label: "Cloud 1", note: "Profitable" },
    { key: "hover", label: "Hover", note: "Fragile Profit" },
    { key: "cliff", label: "Cliff", note: "Loss Zone" },
  ];
  return (
    <section className="h-full rounded-xl border border-slate-600/80 bg-slate-950/82 px-[7%] py-[6%] text-white">
      <div className="text-center text-[clamp(11px,0.95vw,15px)] font-black uppercase tracking-[0.16em]">
        Cloud Level
      </div>
      <div className="mt-[1%] text-center text-[clamp(8px,0.7vw,11px)] font-semibold text-white/70">
        Business Health
      </div>
      <div className="mt-[8%] space-y-[4%]">
        {levels.map(level => {
          const isActive =
            active === level.key ||
            (active === "setup_needed" && level.key === "hover");
          return (
            <div
              key={level.key}
              className={`rounded-lg border px-[5%] py-[3.5%] ${
                isActive
                  ? "border-sky-400 bg-sky-500/24 text-white shadow-[0_0_18px_rgba(14,165,233,0.45)]"
                  : "border-white/10 bg-white/4 text-white/76"
              }`}
            >
              <div className="grid grid-cols-[auto_1fr] items-center gap-2">
                <Cloud className="h-4 w-4 text-sky-200" />
                <div>
                  <div className="text-[clamp(10px,0.88vw,14px)] font-black">
                    {level.label}
                  </div>
                  <div className="text-[clamp(8px,0.72vw,11px)] font-semibold text-white/62">
                    {level.note}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PreviousComparison({ data }: { data: CockpitData }) {
  const delta = data.previousMonth
    ? data.trueNetCents - data.previousMonth.trueNetCents
    : null;
  return (
    <section className="h-full rounded-xl border border-slate-600/80 bg-slate-950/82 px-[7%] py-[5%] text-white">
      <div className="text-center text-[clamp(10px,0.88vw,14px)] font-black uppercase tracking-[0.14em]">
        Previous Comparison
      </div>
      {data.previousMonth ? (
        <div className="mt-[6%] space-y-[4%] text-[clamp(10px,0.85vw,13px)] font-bold">
          <div className="flex justify-between border-b border-white/10 pb-[3%]">
            <span>Revenue</span>
            <span className="font-mono">
              {moneyFromCents(data.previousMonth.grossRevenueCents)}
            </span>
          </div>
          <div className="flex justify-between border-b border-white/10 pb-[3%]">
            <span>True Net</span>
            <span className="font-mono">
              {moneyFromCents(data.previousMonth.trueNetCents)}
            </span>
          </div>
          <div
            className={`font-black ${delta != null && delta >= 0 ? "text-emerald-300" : "text-red-300"}`}
          >
            {delta == null
              ? ""
              : `${delta >= 0 ? "Up" : "Down"} ${moneyFromCents(Math.abs(delta))} vs previous month`}
          </div>
        </div>
      ) : (
        <p className="mt-[8%] text-[clamp(10px,0.86vw,13px)] font-semibold text-white/70">
          Previous tab missing. Comparison unavailable.
        </p>
      )}
    </section>
  );
}

function MissionControl({ missions }: { missions: CockpitMission[] }) {
  return (
    <section className="h-full rounded-xl border border-slate-600/80 bg-slate-950/86 px-[1.7%] py-[1.4%] text-white">
      <div className="grid h-full grid-cols-[1.2fr_repeat(4,1fr)] gap-[1.2%]">
        <div className="flex flex-col justify-center">
          <div className="text-[clamp(11px,0.95vw,15px)] font-black uppercase tracking-[0.14em] text-sky-100">
            Mission Control
          </div>
          <div className="mt-[7%] text-[clamp(24px,2.2vw,36px)]">🎯</div>
          <p className="mt-[4%] text-[clamp(10px,0.82vw,13px)] font-semibold text-white/78">
            Protect profit and build tomorrow’s pipeline.
          </p>
        </div>
        {missions.map(mission => (
          <article
            key={mission.title}
            className="rounded-lg border border-amber-300/50 bg-amber-50/92 px-[7%] py-[6%] text-center text-slate-950"
          >
            <div className="text-[clamp(10px,0.86vw,13px)] font-black">
              {mission.title}
            </div>
            <p className="mt-[5%] text-[clamp(8px,0.72vw,11px)] font-semibold leading-snug text-slate-700">
              {mission.detail}
            </p>
            <div className="mt-[8%] rounded-full bg-slate-900/10 px-2 py-1 text-[clamp(8px,0.68vw,10px)] font-black">
              {mission.impactLabel}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function WhatIfSimulator({ data }: { data: CockpitData }) {
  const whatIf = addTenOrdersWhatIf({ trueNetCents: data.trueNetCents });
  return (
    <section className="h-full rounded-xl border border-slate-600/80 bg-slate-950/86 px-[7%] py-[6%] text-white">
      <div className="text-[clamp(11px,0.95vw,15px)] font-black uppercase tracking-[0.14em] text-sky-100">
        What if? Simulator
      </div>
      <p className="mt-[6%] text-[clamp(11px,0.9vw,14px)] font-semibold">
        Add 10 more orders
      </p>
      {whatIf.available ? (
        <div className="mt-[5%]">
          <div className="text-[clamp(10px,0.85vw,13px)] text-white/70">
            Projected True Net
          </div>
          <div className="font-mono text-[clamp(22px,2vw,32px)] font-black text-emerald-300">
            {moneyFromCents(whatIf.projectedTrueNetCents)}
          </div>
        </div>
      ) : (
        <p className="mt-[5%] text-[clamp(10px,0.82vw,13px)] font-semibold text-white/68">
          {whatIf.reason}
        </p>
      )}
    </section>
  );
}

export default function TruePnlCockpitPage() {
  const [month, setMonth] = useState(currentMonthInput);
  const query = trpc.admin.truePnlCockpitSummary.useQuery({ month });
  const data = query.data as CockpitData | undefined;
  const levelCopy = cockpitLevelCopy(data?.cloudLevel ?? "setup_needed");
  const scene = sceneFromCloudLevel(data?.cloudLevel ?? "setup_needed");
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
      <div className="flex min-h-[70vh] items-center justify-center bg-sky-50 text-slate-700">
        <Loader2 className="mr-3 h-6 w-6 animate-spin" />
        Loading True P&L Cockpit...
      </div>
    );
  }

  if (!data || query.isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-950">
        Could not load the True P&L Cockpit.{" "}
        {query.error?.message ?? "Unknown error."}
      </div>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#06101d] text-slate-950">
      {data.warnings.length ? (
        <section className="mx-auto grid w-full max-w-[1500px] gap-2 px-3 pb-2 pt-3">
          {data.warnings.map((warning, index) => (
            <div
              key={`${warning.code}-${index}`}
              className={`rounded-lg border px-4 py-3 text-sm font-semibold ${warningBorderClass(warning.severity)}`}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div>{warning.message}</div>
                  {warning.labels?.length ? (
                    <div className="mt-1 text-xs opacity-75">
                      Rows: {warning.labels.join(", ")}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <div className="w-full overflow-x-auto px-2 pb-4 pt-2">
        <div className="relative mx-auto aspect-[1672/941] min-w-[1120px] max-w-[1536px] overflow-hidden rounded-[28px] border border-slate-700 bg-sky-200 shadow-[0_30px_90px_rgba(0,0,0,0.55)]">
          <SceneBackdrop scene={scene} />
          <img
            src={cockpitShellUrl}
            alt=""
            className="pointer-events-none absolute inset-0 z-10 h-full w-full select-none object-cover mix-blend-multiply"
          />

          <div className="absolute left-[6.1%] top-[2.3%] z-20 w-[38%]">
            <div className="flex items-center gap-2 text-[clamp(9px,0.75vw,12px)] font-black uppercase tracking-[0.16em] text-sky-800">
              <Star className="h-4 w-4 fill-amber-300 text-sky-700" />
              True P&L Cockpit
            </div>
            <h1 className="mt-[1%] text-[clamp(24px,2.45vw,39px)] font-black leading-[1.03] tracking-normal text-slate-950">
              CleanCloud shows what we sold.
              <span className="block text-sky-800">
                BLDG.chat shows what survived.
              </span>
            </h1>
            <p className="mt-[1.2%] text-[clamp(11px,0.95vw,15px)] font-semibold text-slate-900">
              Real profit. Real expenses. Real decisions.
            </p>
          </div>

          <div className="absolute left-[41.2%] top-[1.4%] z-20 h-[6.8%] w-[25%]">
            <PeriodToggle />
          </div>

          <div className="absolute right-[4.5%] top-[1.7%] z-20 flex h-[4.5%] w-[14%] items-center justify-center rounded-xl border border-sky-200/80 bg-white/80 px-3 text-[clamp(8px,0.75vw,11px)] font-black text-sky-950 shadow-[0_8px_18px_rgba(15,23,42,0.18)]">
            Data from Google Sheet
            <input
              aria-label="Select cockpit month"
              type="month"
              value={month}
              onChange={event => setMonth(event.target.value)}
              className="ml-2 max-w-[76px] bg-transparent font-mono text-[clamp(8px,0.7vw,10px)] text-sky-900 outline-none"
            />
            <button
              type="button"
              onClick={() => query.refetch()}
              className="ml-1 text-sky-700"
              aria-label="Refresh cockpit data"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="absolute left-[6.4%] top-[19.5%] z-20 h-[25.5%] w-[18.8%]">
            <ProfitCard data={data} levelCopy={levelCopy} />
          </div>

          <div className="absolute left-[6.2%] top-[49.5%] z-20 h-[25.6%] w-[15.7%]">
            <TopExpenseDrags data={data} />
          </div>

          <div className="absolute left-[24.6%] top-[36.5%] z-20 grid h-[16.8%] w-[46.8%] grid-cols-4 gap-[1.2%]">
            <GaugePanel
              title="Altitude"
              subtitle="True net profit"
              value={moneyFromCents(data.trueNetCents)}
              detail={`Margin ${percentLabel(data.marginPct)}`}
              tone={data.trueNetCents < 0 ? "text-red-400" : "text-emerald-400"}
            />
            <GaugePanel
              title="Fuel"
              subtitle="Cash runway"
              value={
                data.fuel.status === "ready"
                  ? String(data.fuel.runwayDays)
                  : "Setup"
              }
              detail={data.fuel.label}
              tone={
                data.fuel.status === "ready" ? "text-white" : "text-amber-300"
              }
            />
            <GaugePanel
              title="Turbulence"
              subtitle="Expense pressure"
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
            <GaugePanel
              title="Cliff distance"
              subtitle="How close to loss?"
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

          <div className="absolute left-[24.2%] top-[56.1%] z-20 h-[19.4%] w-[47.7%]">
            <PnlBreakdown data={data} />
          </div>

          <div className="absolute right-[5.2%] top-[20.2%] z-20 h-[33.8%] w-[14.7%]">
            <CloudLadder active={data.cloudLevel} />
          </div>

          <div className="absolute right-[6.4%] top-[58.7%] z-20 h-[17.8%] w-[17.5%]">
            <PreviousComparison data={data} />
          </div>

          <div className="absolute left-[5.5%] top-[79.2%] z-20 h-[15%] w-[69.5%]">
            <MissionControl missions={missions} />
          </div>

          <div className="absolute right-[5.2%] top-[80.2%] z-20 h-[13.8%] w-[20%]">
            <WhatIfSimulator data={data} />
          </div>

          <div className="absolute bottom-[1.3%] left-[5%] z-20 flex h-[3.6%] w-[90%] items-center justify-between rounded-lg border border-slate-600/80 bg-slate-950/82 px-[3%] text-[clamp(10px,0.88vw,14px)] font-semibold text-white">
            <span>
              ⭐ You’re not just running a laundromat. You’re building a
              business that flies.
            </span>
            <span>{levelCopy.sentence}</span>
            <span>Fly smart. Profit real. ⭐</span>
          </div>
        </div>
      </div>
    </main>
  );
}
