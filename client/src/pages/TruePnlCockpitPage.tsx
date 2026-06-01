import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Cloud,
  Fuel,
  Gauge,
  Loader2,
  Mountain,
  Plane,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  cockpitLevelCopy,
  moneyFromCents,
  percentLabel,
  warningBorderClass,
  type CockpitLevel,
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

function statusGradient(level: CockpitLevel): string {
  switch (level) {
    case "cliff":
      return "from-red-500 via-orange-400 to-amber-300";
    case "hover":
      return "from-amber-300 via-yellow-200 to-emerald-200";
    case "cloud1":
      return "from-emerald-400 via-lime-200 to-sky-200";
    case "cloud2":
      return "from-sky-400 via-cyan-200 to-emerald-200";
    case "cloud3":
      return "from-indigo-400 via-sky-200 to-emerald-200";
    case "setup_needed":
      return "from-slate-400 via-amber-100 to-sky-100";
  }
}

function SkyBackdrop({ level }: { level: CockpitLevel }) {
  return (
    <div
      className={`absolute inset-0 overflow-hidden bg-gradient-to-b ${statusGradient(level)}`}
    >
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-emerald-300/70 to-transparent" />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1200 520"
        role="img"
        aria-label="Cloud cockpit altitude path"
        preserveAspectRatio="none"
      >
        <path
          d="M90 405 C260 360 330 320 440 292 C545 265 620 246 714 198 C804 152 910 118 1110 90"
          fill="none"
          stroke="rgba(255,255,255,0.86)"
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray="1 30"
        />
        <path
          d="M90 405 C260 360 330 320 440 292 C545 265 620 246 714 198 C804 152 910 118 1110 90"
          fill="none"
          stroke="rgba(14,165,233,0.45)"
          strokeWidth="6"
          strokeLinecap="round"
        />
        {[
          [125, 155, 95],
          [290, 75, 75],
          [492, 125, 120],
          [745, 82, 100],
          [980, 145, 135],
        ].map(([x, y, size], index) => (
          <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
            <ellipse
              cx={size * 0.5}
              cy={size * 0.52}
              rx={size * 0.52}
              ry={size * 0.24}
              fill="rgba(255,255,255,0.76)"
            />
            <circle
              cx={size * 0.28}
              cy={size * 0.42}
              r={size * 0.22}
              fill="rgba(255,255,255,0.86)"
            />
            <circle
              cx={size * 0.52}
              cy={size * 0.32}
              r={size * 0.3}
              fill="rgba(255,255,255,0.9)"
            />
            <circle
              cx={size * 0.78}
              cy={size * 0.44}
              r={size * 0.22}
              fill="rgba(255,255,255,0.82)"
            />
            {index === 3 ? (
              <text
                x={size * 0.5}
                y={size * 0.58}
                textAnchor="middle"
                className="fill-slate-700 text-[24px] font-black"
              >
                CLOUD
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

function Instrument({
  icon,
  label,
  value,
  detail,
  tone = "text-slate-950",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <section className="rounded-lg border border-white/55 bg-white/86 p-4 shadow-[0_14px_34px_rgba(15,23,42,0.16)] backdrop-blur">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">
        {icon}
        {label}
      </div>
      <div
        className={`mt-2 font-mono text-3xl font-black leading-none ${tone}`}
      >
        {value}
      </div>
      <p className="mt-2 text-sm font-semibold text-slate-700">{detail}</p>
    </section>
  );
}

function PnlMathPanel({ data }: { data: CockpitData }) {
  const rows = LINE_ORDER.map(key => lineByKey(data, key));
  return (
    <section className="rounded-lg border border-slate-900/20 bg-slate-950/92 p-4 text-white shadow-[0_24px_60px_rgba(15,23,42,0.32)]">
      <div className="flex flex-col gap-2 border-b border-white/12 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-200">
            Actual True P&L Breakdown
          </div>
          <h2 className="mt-1 text-xl font-black tracking-normal">
            Pickup & delivery survival math
          </h2>
        </div>
        <div className="rounded-md border border-white/15 bg-white/8 px-3 py-2 text-xs font-bold text-white/78">
          Sheet tab: {data.tabName ?? "not connected"}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {rows.map((line, index) => {
          const isRevenue = line.key === "grossRevenue";
          const amount = isRevenue ? line.amountCents : -line.amountCents;
          return (
            <div
              key={line.key}
              className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border border-white/10 bg-white/6 px-3 py-2"
            >
              <div>
                <div className="text-sm font-bold text-white">
                  {index === 0 ? line.label : `minus ${line.label}`}
                </div>
                <div className="mt-0.5 text-[11px] font-semibold text-white/48">
                  {line.missing
                    ? line.core
                      ? "missing core revenue row"
                      : "missing optional row, counted as $0"
                    : `matched ${line.matchedLabels.join(", ")}`}
                </div>
              </div>
              <div
                className={`font-mono text-lg font-black ${isRevenue ? "text-emerald-300" : "text-orange-200"}`}
              >
                {moneyFromCents(amount)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-sky-300/40 bg-sky-300/12 px-4 py-4">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-sky-200">
            equals
          </div>
          <div className="text-2xl font-black">TRUE NET</div>
        </div>
        <div
          className={`font-mono text-3xl font-black ${data.trueNetCents < 0 ? "text-red-300" : "text-emerald-300"}`}
        >
          {moneyFromCents(data.trueNetCents)}
        </div>
      </div>
    </section>
  );
}

function CloudLadder({ active }: { active: CockpitLevel }) {
  const levels: Array<{ key: CockpitLevel; label: string; note: string }> = [
    { key: "cloud3", label: "Cloud 3", note: "$3k+ and 25%+" },
    { key: "cloud2", label: "Cloud 2", note: "$1.5k+ and 15%+" },
    { key: "cloud1", label: "Cloud 1", note: "$500+ and 5%+" },
    { key: "hover", label: "Hover", note: "fragile profit" },
    { key: "cliff", label: "Cliff", note: "loss zone" },
  ];
  return (
    <section className="rounded-lg border border-white/55 bg-white/86 p-4 shadow-[0_14px_34px_rgba(15,23,42,0.16)] backdrop-blur">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">
        <Cloud className="h-4 w-4" />
        Cloud level
      </div>
      <div className="mt-3 space-y-2">
        {levels.map(level => {
          const activeLevel = active === level.key;
          return (
            <div
              key={level.key}
              className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                activeLevel
                  ? "border-sky-500 bg-sky-100 text-sky-950 shadow-[0_0_0_2px_rgba(14,165,233,0.12)]"
                  : "border-slate-200 bg-white/70 text-slate-600"
              }`}
            >
              <span className="font-black">{level.label}</span>
              <span className="text-xs font-bold">{level.note}</span>
            </div>
          );
        })}
        {active === "setup_needed" ? (
          <div className="rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-black text-amber-950">
            Setup needed before cloud ranking is trusted.
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function TruePnlCockpitPage() {
  const [month, setMonth] = useState(currentMonthInput);
  const query = trpc.admin.truePnlCockpitSummary.useQuery({ month });
  const data = query.data as CockpitData | undefined;
  const levelCopy = cockpitLevelCopy(data?.cloudLevel ?? "setup_needed");
  const previousDelta = useMemo(() => {
    if (!data?.previousMonth) return null;
    return data.trueNetCents - data.previousMonth.trueNetCents;
  }, [data]);

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
    <main className="relative min-h-screen overflow-hidden bg-sky-100 text-slate-950">
      <SkyBackdrop level={data.cloudLevel} />
      <div className="relative mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <header className="rounded-lg border border-slate-950/10 bg-white/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.16)] backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-sky-700">
                <Plane className="h-4 w-4" />
                True P&L Cockpit
              </div>
              <h1 className="mt-2 max-w-4xl text-3xl font-black leading-tight tracking-normal sm:text-5xl">
                CleanCloud shows what we sold.
                <span className="block text-sky-700">
                  BLDG.chat shows what survived.
                </span>
              </h1>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="text-xs font-black uppercase tracking-[0.14em] text-slate-600">
                Month
                <input
                  type="month"
                  value={month}
                  onChange={event => setMonth(event.target.value)}
                  className="mt-1 block h-10 rounded-md border border-slate-300 bg-white px-3 font-mono text-sm text-slate-950 shadow-sm"
                />
              </label>
              <button
                type="button"
                onClick={() => query.refetch()}
                className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50 sm:mt-0"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </button>
            </div>
          </div>
        </header>

        {data.warnings.length ? (
          <section className="grid gap-2">
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

        <section className="grid gap-4 xl:grid-cols-[280px_1fr_300px]">
          <div className="grid gap-4">
            <Instrument
              icon={<Gauge className="h-4 w-4" />}
              label="Altitude = true net"
              value={moneyFromCents(data.trueNetCents)}
              detail={`${data.monthLabel} after hidden expenses`}
              tone={data.trueNetCents < 0 ? "text-red-600" : "text-emerald-700"}
            />
            <Instrument
              icon={<Fuel className="h-4 w-4" />}
              label="Fuel = cash runway"
              value={
                data.fuel.status === "ready"
                  ? `${data.fuel.runwayDays}`
                  : "Setup"
              }
              detail={data.fuel.label}
              tone={
                data.fuel.status === "ready"
                  ? "text-emerald-700"
                  : "text-amber-700"
              }
            />
            <Instrument
              icon={<Mountain className="h-4 w-4" />}
              label="Cliff distance"
              value={
                data.trueNetCents < 0
                  ? moneyFromCents(data.trueNetCents)
                  : moneyFromCents(data.cliffDistanceCents)
              }
              detail={
                data.trueNetCents < 0
                  ? "Already below break-even"
                  : "Current cushion above loss zone"
              }
              tone={data.trueNetCents < 0 ? "text-red-600" : "text-sky-700"}
            />
          </div>

          <div className="grid gap-4">
            <section className="rounded-lg border border-white/55 bg-white/88 p-4 shadow-[0_14px_34px_rgba(15,23,42,0.16)] backdrop-blur">
              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                    Gross sold
                  </div>
                  <div className="mt-1 font-mono text-2xl font-black text-slate-950">
                    {moneyFromCents(data.grossRevenueCents)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                    Expenses
                  </div>
                  <div className="mt-1 font-mono text-2xl font-black text-orange-600">
                    {moneyFromCents(data.totalExpenseCents)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                    Margin
                  </div>
                  <div className="mt-1 font-mono text-2xl font-black text-sky-700">
                    {percentLabel(data.marginPct)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                    Health
                  </div>
                  <div className="mt-1 text-2xl font-black text-slate-950">
                    {levelCopy.label}
                  </div>
                  <div className="text-xs font-bold text-slate-500">
                    {levelCopy.subtitle}
                  </div>
                </div>
              </div>
            </section>
            <PnlMathPanel data={data} />
          </div>

          <div className="grid gap-4">
            <Instrument
              icon={<TrendingUp className="h-4 w-4" />}
              label="Turbulence = expense pressure"
              value={percentLabel(data.expensePressurePct)}
              detail="Expenses as a share of gross revenue"
              tone={
                (data.expensePressurePct ?? 0) > 90
                  ? "text-red-600"
                  : "text-sky-700"
              }
            />
            <CloudLadder active={data.cloudLevel} />
            <section className="rounded-lg border border-white/55 bg-white/86 p-4 shadow-[0_14px_34px_rgba(15,23,42,0.16)] backdrop-blur">
              <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-600">
                Previous month
              </div>
              {data.previousMonth ? (
                <div className="mt-2">
                  <div className="font-bold text-slate-700">
                    {data.previousMonth.monthLabel}
                  </div>
                  <div className="mt-1 font-mono text-2xl font-black text-slate-950">
                    {moneyFromCents(data.previousMonth.trueNetCents)}
                  </div>
                  <div
                    className={`mt-2 text-sm font-black ${previousDelta != null && previousDelta < 0 ? "text-red-600" : "text-emerald-700"}`}
                  >
                    {previousDelta == null
                      ? ""
                      : `${previousDelta >= 0 ? "+" : ""}${moneyFromCents(previousDelta)} vs previous`}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm font-semibold text-slate-600">
                  Previous tab missing. The cockpit stays live without
                  comparison.
                </p>
              )}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
