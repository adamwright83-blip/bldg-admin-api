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

const EXPENSE_ICONS: Record<string, ReactElement> = {
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

function sceneGradient(scene: CockpitScene): string {
  switch (scene) {
    case "cliff":
      return "from-red-900 via-red-700 to-orange-500";
    case "hover":
      return "from-sky-900 via-sky-700 to-sky-500";
    case "cloud1":
      return "from-sky-900 via-cyan-800 to-emerald-600";
    case "cloud2":
      return "from-blue-950 via-blue-800 to-sky-500";
    case "cloud3":
      return "from-indigo-950 via-indigo-800 to-sky-400";
  }
}

function SceneBackdrop({ scene }: { scene: CockpitScene }) {
  return (
    <div className={`absolute inset-0 bg-gradient-to-b ${sceneGradient(scene)}`}>
      <div className="absolute left-[8%] top-[8%] h-32 w-48 rounded-full bg-white/20 blur-2xl" />
      <div className="absolute right-[15%] top-[4%] h-28 w-56 rounded-full bg-white/25 blur-2xl" />
      <div className="absolute right-[5%] top-[14%] h-24 w-36 rounded-full bg-white/15 blur-2xl" />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1400 400"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M80 280 C280 240 480 190 680 155 C860 124 1060 90 1280 62"
          fill="none"
          stroke="rgba(255,255,255,0.6)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray="1 28"
        />
        <path
          d="M80 280 C280 240 480 190 680 155 C860 124 1060 90 1280 62"
          fill="none"
          stroke="rgba(14,165,233,0.3)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <g transform="translate(1160 55)">
          <path d="M0 0 L130 16 L0 34 Z" fill="rgba(239,68,68,0.9)" />
          <text x="18" y="24" fill="white" fontSize="18" fontWeight="900" fontFamily="system-ui">
            PROFIT
          </text>
        </g>
        {scene === "cliff" ? (
          <g transform="translate(900 200)">
            <rect width="82" height="32" rx="6" fill="rgba(127,29,29,0.9)" />
            <text x="41" y="21" textAnchor="middle" fill="white" fontSize="14" fontWeight="900" fontFamily="system-ui">
              DANGER
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

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
    <div className="flex items-center gap-3">
      <div className="flex overflow-hidden rounded-lg border border-white/20 bg-white/10 text-center backdrop-blur">
        {[
          ["Today", false],
          ["Week", false],
          ["Month", true],
        ].map(([label, enabled]) => (
          <button
            key={label as string}
            type="button"
            disabled={!enabled}
            className={`border-r border-white/20 px-4 py-2 last:border-r-0 ${
              enabled
                ? "bg-white/20 font-black text-white"
                : "font-semibold text-white/40"
            } text-sm`}
          >
            {label as string}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 backdrop-blur">
        <span className="text-xs font-semibold text-white/70">
          Google Sheet
        </span>
        <input
          aria-label="Select cockpit month"
          type="month"
          value={month}
          onChange={e => onMonthChange(e.target.value)}
          className="bg-transparent font-mono text-xs text-white outline-none"
        />
        <button
          type="button"
          onClick={onRefresh}
          className="text-white/70 hover:text-white"
          aria-label="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function TrueNetHero({
  data,
  levelCopy,
}: {
  data: CockpitData;
  levelCopy: ReturnType<typeof cockpitLevelCopy>;
}) {
  const scene = sceneFromCloudLevel(data.cloudLevel);
  return (
    <div className="rounded-2xl border border-amber-300/30 bg-amber-50/95 p-5 shadow-2xl">
      <div className="text-xs font-black uppercase tracking-widest text-slate-500">
        True Net Profit
      </div>
      <div
        className={`mt-1 font-mono text-5xl font-black leading-none ${
          data.trueNetCents < 0 ? "text-red-600" : "text-emerald-700"
        }`}
      >
        {moneyFromCents(data.trueNetCents)}
      </div>
      <div className="mt-2 text-sm font-black text-sky-700">
        {percentLabel(data.marginPct)} Margin
      </div>
      <div className="my-3 h-px bg-amber-200" />
      <div className="text-sm font-black">
        Status:{" "}
        <span className={sceneAccentClass(scene)}>{levelCopy.label}</span>
      </div>
      <p className="mt-1 text-xs font-semibold leading-snug text-slate-600">
        {levelCopy.sentence}
      </p>
    </div>
  );
}

function GaugeCard({
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
    <div className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-4 text-center text-white shadow-lg backdrop-blur">
      <div className="text-[10px] font-black uppercase tracking-widest text-white/60">
        {title}
      </div>
      <div className="text-[9px] font-bold uppercase text-white/40">
        {subtitle}
      </div>
      <div className="mx-auto mt-3 h-10 w-16 rounded-t-full border-x-4 border-t-4 border-slate-600/60">
        <div className="mx-auto mt-5 h-1.5 w-1.5 rounded-full bg-slate-400" />
      </div>
      <div className={`mt-1 font-mono text-2xl font-black leading-none ${tone}`}>
        {value}
      </div>
      <div className="mt-2 text-[9px] font-bold text-white/50">{detail}</div>
    </div>
  );
}

function PnlBreakdownPanel({ data }: { data: CockpitData }) {
  const rows = LINE_ORDER.map(key => lineByKey(data, key));
  return (
    <div className="rounded-2xl border border-amber-400/20 bg-amber-50/96 px-6 py-5 shadow-2xl">
      <div className="mb-4 text-center text-sm font-black uppercase tracking-widest text-slate-800">
        True P&L Breakdown &middot;{" "}
        <span className="font-semibold text-slate-500">
          {new Date().toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-2">
        {rows.map((line, index) => {
          const isRevenue = line.key === "grossRevenue";
          const amount = isRevenue ? line.amountCents : -line.amountCents;
          return (
            <div
              key={line.key}
              className="flex items-center justify-between text-sm font-bold"
            >
              <span className="text-slate-700">
                {index === 0 ? line.label : `− ${line.label}`}
              </span>
              <span
                className={`font-mono font-black ${
                  isRevenue ? "text-emerald-700" : "text-red-600"
                }`}
              >
                {moneyFromCents(amount)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between border-t-2 border-amber-300 pt-3">
        <span className="text-base font-black uppercase tracking-wide text-slate-900">
          = True Net Profit
        </span>
        <span
          className={`font-mono text-2xl font-black ${
            data.trueNetCents < 0 ? "text-red-600" : "text-emerald-700"
          }`}
        >
          {moneyFromCents(data.trueNetCents)}
        </span>
      </div>
    </div>
  );
}

function TopExpenseDragsPanel({ data }: { data: CockpitData }) {
  const drags = data.lines
    .filter(line => !line.core && line.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 4);
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-5 text-white shadow-lg backdrop-blur">
      <div className="mb-4 text-xs font-black uppercase tracking-widest text-white/60">
        Top Expense Drags
      </div>
      <div className="space-y-3">
        {drags.length ? (
          drags.map(line => (
            <div
              key={line.key}
              className="flex items-center gap-2 text-sm font-bold"
            >
              <span className="text-sky-300">
                {EXPENSE_ICONS[line.key] ?? <Gauge className="h-4 w-4" />}
              </span>
              <span className="flex-1 text-white/80">{line.label}</span>
              <span className="font-mono text-red-400">
                &minus;{moneyFromCents(line.amountCents)}
              </span>
            </div>
          ))
        ) : (
          <p className="text-xs font-semibold text-white/50">
            No expense drag rows found yet.
          </p>
        )}
      </div>
      <p className="mt-4 text-[10px] font-semibold text-white/40">
        These are your biggest headwinds.
      </p>
    </div>
  );
}

function CloudLadderPanel({ active }: { active: CockpitLevel }) {
  const levels: Array<{ key: CockpitLevel; label: string; note: string }> = [
    { key: "cloud3", label: "Cloud 3", note: "Elite Profit" },
    { key: "cloud2", label: "Cloud 2", note: "Strong Profit" },
    { key: "cloud1", label: "Cloud 1", note: "Profitable" },
    { key: "hover", label: "Hover", note: "Fragile Profit" },
    { key: "cliff", label: "Cliff", note: "Loss Zone" },
  ];
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-5 text-white shadow-lg backdrop-blur">
      <div className="mb-1 text-center text-xs font-black uppercase tracking-widest text-white/60">
        Cloud Level
      </div>
      <div className="mb-4 text-center text-[10px] font-semibold text-white/40">
        Business Health
      </div>
      <div className="space-y-2">
        {levels.map(level => {
          const isActive =
            active === level.key ||
            (active === "setup_needed" && level.key === "hover");
          return (
            <div
              key={level.key}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                isActive
                  ? "border-sky-400/60 bg-sky-500/20 shadow-[0_0_14px_rgba(14,165,233,0.35)]"
                  : "border-white/8 bg-white/4"
              }`}
            >
              <Cloud
                className={`h-3.5 w-3.5 ${isActive ? "text-sky-300" : "text-white/30"}`}
              />
              <div>
                <div
                  className={`text-xs font-black ${isActive ? "text-white" : "text-white/50"}`}
                >
                  {level.label}
                </div>
                <div className="text-[9px] font-semibold text-white/40">
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

function PreviousComparisonPanel({ data }: { data: CockpitData }) {
  const delta = data.previousMonth
    ? data.trueNetCents - data.previousMonth.trueNetCents
    : null;
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-5 text-white shadow-lg backdrop-blur">
      <div className="mb-4 text-xs font-black uppercase tracking-widest text-white/60">
        Previous Comparison
      </div>
      {data.previousMonth ? (
        <div className="space-y-3 text-sm font-bold">
          <div className="flex justify-between border-b border-white/10 pb-2">
            <span className="text-white/70">Revenue</span>
            <span className="font-mono">
              {moneyFromCents(data.previousMonth.grossRevenueCents)}
            </span>
          </div>
          <div className="flex justify-between border-b border-white/10 pb-2">
            <span className="text-white/70">True Net</span>
            <span className="font-mono">
              {moneyFromCents(data.previousMonth.trueNetCents)}
            </span>
          </div>
          {delta != null && (
            <div
              className={`text-sm font-black ${delta >= 0 ? "text-emerald-400" : "text-red-400"}`}
            >
              {delta >= 0 ? "▲" : "▼"} {moneyFromCents(Math.abs(delta))} vs
              previous
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs font-semibold text-white/50">
          Previous tab missing. Comparison unavailable.
        </p>
      )}
    </div>
  );
}

function MissionControlPanel({ missions }: { missions: CockpitMission[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-5 text-white shadow-lg backdrop-blur">
      <div className="mb-1 text-xs font-black uppercase tracking-widest text-sky-300">
        Mission Control
      </div>
      <p className="mb-4 text-xs font-semibold text-white/50">
        Protect profit and build tomorrow&apos;s pipeline.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {missions.map(mission => (
          <article
            key={mission.title}
            className="rounded-xl border border-amber-300/40 bg-amber-50/90 p-3 text-slate-900"
          >
            <div className="text-xs font-black">{mission.title}</div>
            <p className="mt-1 text-[10px] font-semibold leading-snug text-slate-600">
              {mission.detail}
            </p>
            <div className="mt-2 rounded-full bg-slate-900/10 px-2 py-0.5 text-[9px] font-black text-slate-700">
              {mission.impactLabel}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function WhatIfPanel({ data }: { data: CockpitData }) {
  const whatIf = addTenOrdersWhatIf({ trueNetCents: data.trueNetCents });
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/80 p-5 text-white shadow-lg backdrop-blur">
      <div className="mb-1 text-xs font-black uppercase tracking-widest text-sky-300">
        What If? Simulator
      </div>
      <p className="mt-2 text-sm font-semibold text-white/80">
        Add 10 more orders
      </p>
      {whatIf.available ? (
        <div className="mt-2">
          <div className="text-xs text-white/50">Projected True Net</div>
          <div className="font-mono text-2xl font-black text-emerald-400">
            {moneyFromCents(whatIf.projectedTrueNetCents)}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs font-semibold text-white/50">
          {whatIf.reason}
        </p>
      )}
    </div>
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

  const warningCount = data.warnings.filter(
    w => w.severity !== "info"
  ).length;
  const missingLabels = data.warnings.flatMap(w => w.labels ?? []);

  return (
    <div className="min-h-screen bg-[#06101d] text-white">
      {/* ── Hero section: sky art + headline ── */}
      <div className="relative overflow-hidden" style={{ minHeight: 320 }}>
        <SceneBackdrop scene={scene} />

        {/* plane art positioned top-center */}
        <img
          src={cockpitShellUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover object-top opacity-40"
        />

        {/* dark fade at bottom so content below reads cleanly */}
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-[#06101d]" />

        {/* top bar */}
        <div className="relative z-10 mx-auto max-w-[1400px] px-6 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* eyebrow */}
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 fill-amber-300 text-amber-300" />
              <span className="text-xs font-black uppercase tracking-widest text-white/70">
                True P&L Cockpit
              </span>
              {warningCount > 0 && (
                <span
                  className="ml-2 flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-900/60 px-2 py-0.5 text-[10px] font-black text-amber-300"
                  title={missingLabels.join(", ")}
                >
                  <AlertTriangle className="h-3 w-3" />
                  {warningCount} optional row{warningCount > 1 ? "s" : ""}{" "}
                  missing
                </span>
              )}
            </div>

            {/* period toggle + data source */}
            <PeriodToggle
              month={month}
              onMonthChange={setMonth}
              onRefresh={() => query.refetch()}
            />
          </div>

          {/* headline */}
          <div className="mt-8 max-w-2xl">
            <h1 className="text-4xl font-black leading-tight tracking-tight text-white drop-shadow-lg lg:text-5xl">
              CleanCloud shows what we sold.
              <br />
              <span className="text-sky-400">BLDG.chat shows what survived.</span>
            </h1>
            <p className="mt-2 text-sm font-semibold text-white/60">
              Real profit. Real expenses. Real decisions.
            </p>
          </div>
        </div>

        {/* true net hero card — floats over art, bottom-right */}
        <div className="absolute bottom-6 right-6 z-10 w-64">
          <TrueNetHero data={data} levelCopy={levelCopy} />
        </div>
      </div>

      {/* ── Main content grid ── */}
      <div className="mx-auto max-w-[1400px] space-y-4 px-6 pb-8 pt-4">

        {/* Gauge row */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <GaugeCard
            title="Altitude"
            subtitle="True net profit"
            value={moneyFromCents(data.trueNetCents)}
            detail={`Margin ${percentLabel(data.marginPct)}`}
            tone={data.trueNetCents < 0 ? "text-red-400" : "text-emerald-400"}
          />
          <GaugeCard
            title="Fuel"
            subtitle="Cash runway"
            value={
              data.fuel.status === "ready"
                ? `${data.fuel.runwayDays}`
                : "Setup"
            }
            detail={data.fuel.label}
            tone={
              data.fuel.status === "ready" ? "text-white" : "text-amber-300"
            }
          />
          <GaugeCard
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
          <GaugeCard
            title="Cliff Distance"
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

        {/* Middle row: expense drags | P&L breakdown (dominant) | right rail */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr_220px]">
          <TopExpenseDragsPanel data={data} />
          <PnlBreakdownPanel data={data} />
          <div className="flex flex-col gap-4">
            <CloudLadderPanel active={data.cloudLevel} />
            <PreviousComparisonPanel data={data} />
          </div>
        </div>

        {/* Bottom row: missions | what-if */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
          <MissionControlPanel missions={missions} />
          <WhatIfPanel data={data} />
        </div>

        {/* Footer ticker */}
        <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/4 px-6 py-3 text-xs font-semibold text-white/60">
          <span>
            ⭐ You&apos;re not just running a laundromat. You&apos;re building a
            business that flies.
          </span>
          <span>{levelCopy.sentence}</span>
          <span>Fly smart. Profit real. ⭐</span>
        </div>
      </div>
    </div>
  );
}
