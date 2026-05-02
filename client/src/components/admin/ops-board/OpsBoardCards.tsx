import { useId } from "react";
import {
  Activity,
  Bell,
  CalendarDays,
  ClipboardList,
  CreditCard,
  FilePlus2,
  Gauge,
  Home,
  Lock,
  Map,
  Menu,
  MessageSquareText,
  PackageCheck,
  Plus,
  Receipt,
  Route,
  Shield,
  Sun,
  User,
  Users,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminHomeData, OpsBoardModal } from "./types";
import { formatCompactUsd, formatUsd } from "./opsBoardData";

// Source attachment: ChatGPT Image Apr 23, 2026, 06_00_16 PM.png
const HERO_ASSET = "/assets/admin/ops-board/hero-three-buildings-road.png";
// Source attachment: daniel-cha-avatar.png
const DANIEL_AVATAR_ASSET = "/assets/admin/ops-board/daniel-cha-avatar.png";
// Source attachment: Untitled design (30).png
const TERRITORY_ASSET = "/assets/admin/ops-board/territory-progression.png";

type BoardActionProps = {
  data: AdminHomeData;
  onOpenModal: (modal: OpsBoardModal) => void;
  onNavigate: (path: string) => void;
  onOpenCollectionPriority: () => void;
};

export function MobileTopBar({
  operatorName,
  onOpenMobileNav,
}: {
  operatorName: string;
  onOpenMobileNav: () => void;
}) {
  const initials = operatorName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "A";

  return (
    <header className="ops-mobile-topbar">
      <button type="button" aria-label="Open navigation" onClick={onOpenMobileNav}>
        <Menu className="h-5 w-5" />
      </button>
      <div>OPS BOARD / 04</div>
      <div className="ops-topbar-right">
        <button type="button" aria-label="Notifications" className="ops-bell">
          <Bell className="h-5 w-5" />
          <span>2</span>
        </button>
        <span className="ops-operator-avatar">{initials}</span>
      </div>
    </header>
  );
}

export function StatusStrip({ data, includeRunRate = true }: { data: AdminHomeData; includeRunRate?: boolean }) {
  return (
    <section className="ops-status-strip">
      <div className="ops-card ops-date-card">
        <div className="ops-card-icon">
          <Sun className="h-4 w-4" />
        </div>
        <p>{data.businessDay}</p>
        <strong>{data.businessTime}</strong>
        <span>{data.businessLocation}</span>
      </div>
      <div className="ops-card ops-rating-card">
        <div className="ops-rating-head">
          <span>
            <Shield className="h-4 w-4" />
            LVL {String(data.butlerRating.level).padStart(2, "0")}
          </span>
          <span>BUTLER RATING</span>
        </div>
        <div className="ops-rating-score">{data.butlerRating.score}</div>
        <div className="ops-rating-band">Band: {data.butlerRating.band}</div>
        <div className="ops-rating-zones" aria-hidden>
          <i />
          <i />
          <i />
          <i className="active" />
          <i />
          <b />
        </div>
        <div className="ops-daily-xp" aria-label={`Daily XP ${data.butlerRating.dailyXp.value} of ${data.butlerRating.dailyXp.target}`}>
          <div className="ops-daily-xp-head">
            <span>DAILY XP</span>
            <strong>
              {data.butlerRating.dailyXp.value.toLocaleString("en-US")} / {data.butlerRating.dailyXp.target.toLocaleString("en-US")}
            </strong>
          </div>
          <div className="ops-daily-xp-bar" aria-hidden>
            <span style={{ width: `${data.butlerRating.dailyXp.percent}%` }} />
          </div>
        </div>
      </div>
      {includeRunRate ? <RunRateCard data={data} compact /> : null}
    </section>
  );
}

export function HeroCard() {
  return (
    <section className="ops-hero" aria-label="Operational intelligence">
      <img src={HERO_ASSET} alt="" />
      <div className="sr-only">
        <p>OPERATIONAL INTELLIGENCE</p>
        <h1>Three buildings away from a different life.</h1>
        <p>Every action today either moves you closer or keeps you where you are.</p>
      </div>
    </section>
  );
}

export function RunRateCard({ data, compact = false }: { data: AdminHomeData; compact?: boolean }) {
  return (
    <section className={`ops-card ops-run-rate-card ${compact ? "ops-run-rate-compact" : ""}`}>
      <div className="ops-section-kicker">RUN RATE</div>
      <div className="ops-run-rate-values">
        <strong>{formatCompactUsd(data.runRate.monthly)} /MO</strong>
        <span>
          TARGET
          <b>{formatCompactUsd(data.runRate.target)}/MO</b>
        </span>
      </div>
      <div className="ops-progress-row">
        <span>{data.runRate.percentToTarget}%</span>
        <div className="ops-progress-track">
          <i style={{ width: `${data.runRate.percentToTarget}%` }} />
        </div>
      </div>
    </section>
  );
}

export function KpiGrid({ data, onNavigate }: Pick<BoardActionProps, "data" | "onNavigate">) {
  type KpiCardConfig = {
    key: string;
    label: string;
    value: string;
    detail: string;
    tone: "green" | "red" | "blue" | "amber";
    icon: LucideIcon;
    route?: string;
  };

  const cards: KpiCardConfig[] = [
    {
      key: "collected",
      label: "COLLECTED TODAY",
      value: formatUsd(data.kpis.collectedToday.value),
      detail: `↑ +${data.kpis.collectedToday.deltaPct ?? 0}% vs yesterday`,
      tone: "green",
      icon: WalletCards,
    },
    {
      key: "awaiting",
      label: "AWAITING PAYMENT",
      value: formatCompactUsd(data.kpis.awaitingPayment.value),
      detail: `${data.kpis.awaitingPayment.invoiceCount} invoices`,
      tone: "red",
      icon: Receipt,
    },
    {
      key: "routes",
      label: "ACTIVE ROUTES",
      value: String(data.kpis.activeRoutes.value).padStart(2, "0"),
      detail: `${data.kpis.activeRoutes.completingToday ?? 0} completing today`,
      tone: "blue",
      icon: Route,
      route: "/pickups",
    },
    {
      key: "risk",
      label: "AT RISK",
      value: String(data.kpis.atRisk.count).padStart(2, "0"),
      detail: `${formatCompactUsd(data.kpis.atRisk.exposure)} exposure`,
      tone: "amber",
      icon: Activity,
    },
  ];

  return (
    <section className="ops-kpi-grid">
      {cards.map((card) => {
        const Icon = card.icon;
        const inner = (
          <>
            <div className={`ops-kpi-icon ${card.tone}`}>
              <Icon className="h-4 w-4" />
            </div>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <em>{card.detail}</em>
          </>
        );
        // TODO: Keep cards static until a real filtered admin route exists.
        const route = card.route;
        return route ? (
          <button type="button" className="ops-card ops-kpi-card" key={card.key} onClick={() => onNavigate(route)}>
            {inner}
          </button>
        ) : (
          <div className="ops-card ops-kpi-card" key={card.key}>
            {inner}
          </div>
        );
      })}
    </section>
  );
}

export function MissionStack({
  data,
  onOpenModal,
  onOpenCollectionPriority,
}: Pick<BoardActionProps, "data" | "onOpenModal" | "onOpenCollectionPriority">) {
  return (
    <section className="ops-mission-stack">
      <ChristopherCard data={data} onOpenModal={onOpenModal} />
      <DanielCard data={data} onOpenModal={onOpenModal} onOpenCollectionPriority={onOpenCollectionPriority} />
    </section>
  );
}

function ChristopherCard({ data, onOpenModal }: Pick<BoardActionProps, "data" | "onOpenModal">) {
  const daysSinceLastAsk = data.oneThingRightNow.daysSinceLastAsk;

  return (
    <article className="ops-card ops-mission-card ops-christopher-card">
      <div className="ops-ribbon">★ ONE THING RIGHT NOW · SEED-CRITICAL</div>
      <div className="ops-mission-main">
        <div className="ops-christopher-avatar" aria-hidden>
          C
        </div>
        <div>
          <p className="ops-mission-type">BUILDING INTRO — PENDING</p>
          <h2>{data.oneThingRightNow.contactContext}</h2>
          <p>
            Promised intro to {data.oneThingRightNow.buildingTarget} · {data.oneThingRightNow.daysSinceLastAsk} days
            since you last asked
          </p>
        </div>
        <div className="ops-days-counter">
          <strong>
            <b>{daysSinceLastAsk}</b>
            <small>DAYS</small>
          </strong>
          <span>SINCE LAST ASK</span>
        </div>
      </div>
      <Button type="button" className="ops-button ops-button-green" onClick={() => onOpenModal({ kind: "christopher_text" })}>
        <MessageSquareText className="h-4 w-4" />
        Text Christopher about Building 3 →
      </Button>
      <button type="button" className="ops-link-button" onClick={() => onOpenModal({ kind: "log_outreach" })}>
        Log outreach attempt →
      </button>
    </article>
  );
}

function DanielCard({
  data,
  onOpenModal,
  onOpenCollectionPriority,
}: Pick<BoardActionProps, "data" | "onOpenModal" | "onOpenCollectionPriority">) {
  return (
    <article className="ops-card ops-mission-card ops-daniel-card">
      <div className="ops-mission-main">
        <img src={DANIEL_AVATAR_ASSET} alt="" className="ops-daniel-avatar" />
        <div>
          <p className="ops-mission-type">COLLECTED — UNPAID</p>
          <h2>{data.collectionPriority.customerName}</h2>
          <p>
            Order {data.collectionPriority.orderNumber} · At stake {formatUsd(data.collectionPriority.amount)} ·{" "}
            {data.collectionPriority.daysOverdue} days overdue · {data.collectionPriority.priorAttempts} prior attempts
          </p>
        </div>
      </div>
      <Button type="button" variant="outline" className="ops-button ops-button-red-outline" onClick={onOpenCollectionPriority}>
        Open Daniel’s Order →
      </Button>
      <button type="button" className="ops-link-button red" onClick={() => onOpenModal({ kind: "collect_daniel" })}>
        Copy SMS / collection reminder →
      </button>
    </article>
  );
}

export function TerritoryProgression({ data }: { data: AdminHomeData }) {
  return (
    <section className="ops-card ops-territory-card">
      <div className="ops-section-head">
        <div>
          <p className="ops-section-kicker">TERRITORY PROGRESSION</p>
          <h2>{data.territory.sectorLabel}</h2>
          <span>
            {data.territory.liveCount} of {data.territory.targetCount} buildings live —{" "}
            {data.territory.seedPitchPercent}% to seed pitch
          </span>
        </div>
      </div>
      <div className="ops-territory-scroll">
        <div className="ops-territory-track">
          <div className="ops-territory-art">
            <img src={TERRITORY_ASSET} alt="" />
          </div>
          <ol className="ops-territory-labels">
            {data.territory.buildings.map((building) => (
              <li key={`${building.position}-${building.name}`} className={building.status}>
                <span>
                  {building.status === "live" ? <PackageCheck className="h-3.5 w-3.5" /> : null}
                  {building.status === "prospect" ? <Lock className="h-3.5 w-3.5" /> : null}
                  {String(building.position).padStart(2, "0")}
                </span>
                <strong>{building.name}</strong>
                <em>{building.status === "prospect" ? "locked" : building.status}</em>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function RevenueAtRisk({ data, onOpenModal }: Pick<BoardActionProps, "data" | "onOpenModal">) {
  const gradientId = useId().replace(/:/g, "");
  const values = data.revenueAtRisk.sparkline.map((point) => point.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, max * 0.2, 1);
  const chartPoints = data.revenueAtRisk.sparkline.map((point, index) => {
    const x = 6 + (index / Math.max(1, data.revenueAtRisk.sparkline.length - 1)) * 88;
    const y = 54 - ((point.value - min) / range) * 38;
    return { x, y, label: point.date };
  });
  const curvePath = chartPoints.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = chartPoints[index - 1];
    const midX = (previous.x + point.x) / 2;
    return `${path} C ${midX} ${previous.y}, ${midX} ${point.y}, ${point.x} ${point.y}`;
  }, "");
  const areaPath = `${curvePath} L ${chartPoints.at(-1)?.x ?? 94} 60 L ${chartPoints[0]?.x ?? 6} 60 Z`;
  const highlightIndex = values.length
    ? values.reduce((highestIndex, value, index) => (value > values[highestIndex] ? index : highestIndex), 0)
    : -1;
  const highlightPoint = highlightIndex >= 0 ? chartPoints[highlightIndex] : chartPoints.at(-1);

  return (
    <section className="ops-card ops-revenue-risk-card">
      <div className="ops-section-kicker">REVENUE AT RISK · LAST 7 DAYS</div>
      <div className="ops-risk-chart">
        <svg viewBox="0 0 100 76" preserveAspectRatio="none" className="ops-risk-wave" aria-hidden>
          <path className="ops-risk-area" d={areaPath} fill={`url(#${gradientId}-area)`} />
          <path className="ops-risk-curve-shadow" d={curvePath} />
          <path className="ops-risk-curve" d={curvePath} stroke={`url(#${gradientId})`} />
          {highlightPoint ? (
            <>
              <circle className="ops-risk-point-halo" cx={highlightPoint.x} cy={highlightPoint.y} r="5.3" />
              <circle className="ops-risk-point" cx={highlightPoint.x} cy={highlightPoint.y} r="2.8" />
            </>
          ) : null}
          <defs>
            <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="var(--lb-gold)" />
              <stop offset="52%" stopColor="var(--lb-amber)" />
              <stop offset="100%" stopColor="var(--lb-red)" />
            </linearGradient>
            <linearGradient id={`${gradientId}-area`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(212, 60, 55, 0.2)" />
              <stop offset="100%" stopColor="rgba(213, 138, 31, 0)" />
            </linearGradient>
          </defs>
        </svg>
        <div className="ops-risk-axis" aria-hidden>
          {chartPoints.map((point) => (
            <span key={point.label}>{point.label}</span>
          ))}
        </div>
      </div>
      <div className="ops-risk-total">
        <strong>{formatCompactUsd(data.revenueAtRisk.total)}</strong>
        <span>at risk across {data.revenueAtRisk.accountCount} accounts</span>
      </div>
      <Button type="button" className="ops-button ops-button-red" onClick={() => onOpenModal({ kind: "pursue_all" })}>
        Pursue all 3 →
      </Button>
    </section>
  );
}

export function PerformanceGauges({ data }: { data: AdminHomeData }) {
  const gauges = [
    {
      label: "ROUTE EFFICIENCY",
      value: `${data.gauges.routeEfficiency.value}%`,
      detail: `+${data.gauges.routeEfficiency.deltaPct ?? 0}% vs last 7 days`,
      icon: Gauge,
    },
    { label: "QUEUE", value: String(data.gauges.queue.value), detail: "jobs in pipeline", icon: ClipboardList },
    { label: "LEAD VELOCITY", value: String(data.gauges.leadVelocity.value), detail: "new this week", icon: Users },
    {
      label: "CONVERSION",
      value: `${data.gauges.conversion.value}%`,
      detail: `+${data.gauges.conversion.deltaPct ?? 0}% vs last 7 days`,
      icon: Activity,
    },
  ] as const;

  return (
    <section className="ops-performance-grid">
      {gauges.map((gauge) => {
        const Icon = gauge.icon;
        return (
          <article className="ops-card ops-gauge-card" key={gauge.label}>
            <Icon className="h-4 w-4" />
            <span>{gauge.label}</span>
            <strong>{gauge.value}</strong>
            <em>{gauge.detail}</em>
            <i aria-hidden />
          </article>
        );
      })}
    </section>
  );
}

export function QuickActions({ onNavigate, onOpenModal }: Pick<BoardActionProps, "onNavigate" | "onOpenModal">) {
  const actions = [
    { label: "New Intake", icon: ClipboardList, run: () => onNavigate("/intake") },
    { label: "Create Order", icon: FilePlus2, run: () => onNavigate("/new-order") },
    { label: "Catalog & Pricing", icon: Receipt, run: () => onNavigate("/catalog") },
    { label: "Schedule Pickup", icon: CalendarDays, run: () => onNavigate("/pickups") },
    { label: "Record Payment", icon: CreditCard, run: () => onOpenModal({ kind: "pipeline_action" }) },
  ] as const;

  return (
    <section className="ops-card ops-quick-actions">
      <p className="ops-section-kicker">QUICK ACTIONS</p>
      <div>
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button type="button" key={action.label} onClick={action.run}>
              <Icon className="h-4 w-4" />
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function MobileBottomNav({ onNavigate }: { onNavigate: (path: string) => void }) {
  type MobileNavItem = {
    label: string;
    icon: LucideIcon;
    path: string;
    active?: boolean;
    center?: boolean;
  };

  const items: MobileNavItem[] = [
    { label: "Board", icon: Home, path: "/", active: true },
    { label: "Routes", icon: Route, path: "/pickups" },
    { label: "Plus", icon: Plus, path: "/new-order", center: true },
    { label: "Pipeline", icon: Map, path: "/intake" },
    { label: "Profile", icon: User, path: "/customers" },
  ];

  return (
    <nav className="ops-mobile-bottom-nav" aria-label="Ops board navigation">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            type="button"
            key={item.label}
            className={`${item.active ? "active" : ""} ${item.center ? "center" : ""}`}
            onClick={() => onNavigate(item.path)}
          >
            <Icon className="h-5 w-5" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
