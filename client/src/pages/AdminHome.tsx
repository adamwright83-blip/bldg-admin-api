import { lazy, Suspense, useMemo } from "react";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  ChevronRight,
  Crown,
  Home,
  Landmark,
  Map,
  Mic,
  Package,
  Plus,
  Sparkles,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { classifyLanternCustomer } from "@/components/admin/control-room/LanternCityAtlas";
import { presentCurrentDayLine } from "@shared/currentDayLine";
import "./AdminHome.css";

const LanternCityIslands = lazy(
  () =>
    import(
      "@/components/admin/control-room/LanternCityIslands/LanternCityIslands"
    )
);

type AdminHomeProps = {
  experienceMode?: "kingdom" | "operator-demo";
  operatorName?: string;
  path?: string;
  onOpenMobileNav?: () => void;
  onNavigate?: (path: string) => void;
  onOpenCustomer?: (phone: string) => void;
};

const PRESIDENT_ART = [
  "/assets/admin/home/president-proposal-01.svg",
  "/assets/admin/home/president-proposal-02.svg",
  "/assets/admin/home/president-proposal-03.svg",
] as const;

const MITCH_ART = [
  "/assets/admin/home/mitch-build-01.svg",
  "/assets/admin/home/mitch-build-02.svg",
  "/assets/admin/home/mitch-build-03.svg",
] as const;

function money(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function compactMoney(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1000 ? 2 : 0,
  }).format(value);
}

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function go(onNavigate: (path: string) => void, path: string) {
  onNavigate(path);
}

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "is-active" : undefined}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export default function AdminHome({
  operatorName = "Admin",
  onNavigate = next => {
    window.location.href = next;
  },
}: AdminHomeProps) {
  const dashboard = trpc.admin.dashboardSummary.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const customers = trpc.admin.listCustomers.useQuery(
    { sortBy: "lastOrder", includeLegacyCleanCloud: true },
    { staleTime: 60_000, refetchOnWindowFocus: true }
  );
  const dayLine = trpc.system.currentDayLine.today.useQuery(undefined, {
    retry: false,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const president = trpc.president.founderSurface.useQuery(undefined, {
    retry: false,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const geographicAtlas = trpc.system.geographicTruth.atlas.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });

  const rows = customers.data?.customers ?? [];
  const churnRisk = rows.filter(
    customer => classifyLanternCustomer(customer) !== "active"
  ).length;
  const activeCustomers = Math.max(rows.length - churnRisk, 0);

  const dayPresentation = useMemo(
    () => (dayLine.data ? presentCurrentDayLine(dayLine.data) : null),
    [dayLine.data]
  );
  const nowItem =
    dayPresentation?.items[0] ?? dayPresentation?.designated ?? null;
  const dayLineCount = dayPresentation?.items.length ?? 0;

  const founderDecisions = president.data?.brief.questions ?? [];
  const visibleDecisions = Array.from({ length: 3 }, (_, index) => {
    const decision = founderDecisions[index];
    if (decision) {
      return {
        id: decision.id,
        title: decision.question,
        note: decision.reason,
        status: "Ready for you",
        placeholder: false,
        image: PRESIDENT_ART[index],
      };
    }
    return {
      id: `president-placeholder-${index + 1}`,
      title: `Proposal slot 0${index + 1}`,
      note: "President will populate this when tonight’s brief is ready.",
      status: "Awaiting brief",
      placeholder: true,
      image: PRESIDENT_ART[index],
    };
  });

  const locatedLanterns =
    geographicAtlas.data?.customers?.filter(customer => customer.location).length ??
    null;
  const firstName = operatorName.split(/\s+/)[0] || "Admin";
  const now = new Date();
  const greeting = greetingForHour(now.getHours());
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long" }).format(now);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(now);

  const presidentSentence = president.isLoading
    ? "President is reading company state."
    : president.isError
      ? "President briefing is unavailable."
      : founderDecisions.length
        ? `President has ${founderDecisions.length} decision${founderDecisions.length === 1 ? "" : "s"} waiting.`
        : "President has no founder decision waiting.";

  const daySentence = dayLine.isLoading
    ? "Day Line is loading."
    : dayLine.isError
      ? "Day Line is unavailable."
      : dayLineCount > 0
        ? `Day Line has ${dayLineCount} ranked item${dayLineCount === 1 ? "" : "s"}.`
        : dayPresentation?.statusText ?? "No ranked line for today.";

  const monthRevenue = dashboard.data?.revenueMonth;
  const weekRevenue = dashboard.data?.revenueWeek;
  const monthOrders = dashboard.data?.paidOrderCountMonth ?? null;
  const monthAov = dashboard.data?.avgOrderValueMonth ?? null;

  return (
    <main className="jhome">
      <header className="jhome-topbar">
        <button
          type="button"
          className="jhome-brand"
          onClick={() => go(onNavigate, "/")}
          aria-label="JOYSTICK Home"
        >
          <Crown aria-hidden />
          JOYSTICK
        </button>

        <nav className="jhome-nav" aria-label="JOYSTICK">
          <NavButton
            icon={<Home aria-hidden />}
            label="Home"
            active
            onClick={() => go(onNavigate, "/")}
          />
          <NavButton
            icon={<Map aria-hidden />}
            label="Lantern City"
            onClick={() => go(onNavigate, "/growth/lantern-city")}
          />
          <NavButton
            icon={<CalendarDays aria-hidden />}
            label="Day Line"
            onClick={() => go(onNavigate, "/play")}
          />
          <NavButton
            icon={<Package aria-hidden />}
            label="Operations"
            onClick={() => go(onNavigate, "/operations")}
          />
          <NavButton
            icon={<Landmark aria-hidden />}
            label="Company"
            onClick={() => go(onNavigate, "/president")}
          />
          <NavButton
            icon={<UserRound aria-hidden />}
            label="Operator"
            onClick={() => go(onNavigate, "/operator")}
          />
        </nav>

        <div className="jhome-actions">
          <button
            type="button"
            className="jhome-voice"
            onClick={() => go(onNavigate, "/claire")}
          >
            <Mic aria-hidden />
            <span>Talk to Claire</span>
          </button>
          <button
            type="button"
            className="jhome-new-order"
            onClick={() => go(onNavigate, "/new-order")}
          >
            <Plus aria-hidden />
            New Order
          </button>
          <button
            type="button"
            className="jhome-avatar"
            onClick={() => go(onNavigate, "/settings")}
            aria-label="Open settings"
          >
            {firstName.slice(0, 1).toUpperCase()}
          </button>
        </div>
      </header>

      <div className="jhome-content">
        <section className="jhome-intro" aria-label="Company briefing">
          <div className="jhome-greeting">
            <small>{greeting}</small>
            <strong className="jhome-serif">{firstName}.</strong>
          </div>
          <div className="jhome-brief">
            <h1 className="jhome-serif">
              {dashboard.isLoading
                ? "Reading JOYSTICK right now."
                : dashboard.isError
                  ? "Business pulse is temporarily unavailable."
                  : `${monthName} revenue is ${money(monthRevenue)} month to date.`}
            </h1>
            <p>
              {presidentSentence} {daySentence}
            </p>
          </div>
          <div className="jhome-date">
            <b>{dateLabel}</b>
            <br />
            JOYSTICK HQ
          </div>
        </section>

        <section className="jhome-dashboard">
          <article className="jhome-card jhome-city">
            <div className="jhome-city-preview" aria-hidden>
              <Suspense fallback={<div className="jhome-skeleton" style={{ width: "100%", height: "100%" }} />}>
                <LanternCityIslands
                  onOpenCustomer={() => undefined}
                  onNavigate={onNavigate}
                  showBrand={false}
                  showUtilityDock={false}
                />
              </Suspense>
            </div>
            <div className="jhome-city-copy">
              <span className="jhome-eyebrow">Your business, playable</span>
              <h2 className="jhome-serif">Lantern<br />City</h2>
              <p>One world. Real customers. Real progress.</p>
            </div>
            <div className="jhome-city-action">
              <button
                type="button"
                onClick={() => go(onNavigate, "/growth/lantern-city")}
              >
                <span><ArrowRight aria-hidden /></span>
                Open Lantern City
              </button>
              <small>
                {locatedLanterns == null
                  ? "Live world"
                  : `${locatedLanterns.toLocaleString()} lantern${locatedLanterns === 1 ? "" : "s"} located`}
              </small>
            </div>
          </article>

          <div className="jhome-right">
            <article className="jhome-card jhome-agent-card">
              <header className="jhome-agent-head">
                <div>
                  <span className="jhome-section-kicker">President</span>
                  <h2 className="jhome-serif">
                    {founderDecisions.length
                      ? `${Math.min(founderDecisions.length, 3)} decision${Math.min(founderDecisions.length, 3) === 1 ? "" : "s"} for tonight`
                      : "Tonight’s proposals"}
                  </h2>
                  <p>
                    {president.isError
                      ? "President state is unavailable."
                      : founderDecisions.length
                        ? "The few company decisions that need you."
                        : "Placeholder slots until President publishes tonight’s brief."}
                  </p>
                </div>
                <button
                  type="button"
                  className="jhome-text-link"
                  onClick={() => go(onNavigate, "/president")}
                >
                  View all <ArrowRight aria-hidden />
                </button>
              </header>

              <div className="jhome-decisions">
                {visibleDecisions.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className="jhome-decision"
                    onClick={() => go(onNavigate, "/president")}
                  >
                    <img src={item.image} alt="" />
                    <span className="jhome-decision-copy">
                      <small
                        className={`jhome-status${item.placeholder ? " is-placeholder" : ""}`}
                      >
                        {item.status}
                      </small>
                      <b>{item.title}</b>
                      <small>{item.note}</small>
                    </span>
                    <ChevronRight aria-hidden />
                  </button>
                ))}
              </div>
            </article>

            <article className="jhome-card jhome-agent-card">
              <header className="jhome-agent-head">
                <div>
                  <span className="jhome-section-kicker">Mitch</span>
                  <h2 className="jhome-serif">Overnight work</h2>
                  <p>Actual build evidence will replace these placeholders.</p>
                </div>
                <button
                  type="button"
                  className="jhome-text-link"
                  onClick={() => go(onNavigate, "/goldline-kingdoms")}
                >
                  View production <ArrowRight aria-hidden />
                </button>
              </header>
              <div className="jhome-builds">
                {MITCH_ART.map((image, index) => (
                  <button
                    key={image}
                    type="button"
                    className="jhome-build"
                    onClick={() => go(onNavigate, "/goldline-kingdoms")}
                  >
                    <img src={image} alt="" />
                    <b>Build slot 0{index + 1}</b>
                    <small>Awaiting Mitch feed</small>
                  </button>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section className="jhome-bottom">
          <article className="jhome-card jhome-now">
            <header className="jhome-card-head">
              <h3><CalendarDays aria-hidden /> Now</h3>
              <small>From your Day Line</small>
            </header>
            <div className="jhome-now-body">
              <div className="jhome-now-art" aria-hidden />
              <div className="jhome-now-copy">
                <span className="jhome-section-kicker">
                  {nowItem?.executionType ?? "Day Line"}
                </span>
                <h4>
                  {dayLine.isLoading
                    ? "Reading today…"
                    : nowItem?.title ??
                      dayPresentation?.statusText ??
                      "No ranked line for today."}
                </h4>
                <p>
                  {nowItem
                    ? "Open Day Line for the authoritative objective and completion evidence."
                    : "Nothing is being invented here. When Mission Director ranks today, it appears here."}
                </p>
                <button
                  type="button"
                  className="jhome-text-link jhome-now-action"
                  onClick={() => go(onNavigate, "/play")}
                >
                  Open Day Line <ArrowRight aria-hidden />
                </button>
              </div>
            </div>
          </article>

          <article className="jhome-card jhome-sales">
            <header className="jhome-card-head">
              <h3><TrendingUp aria-hidden /> Sales & customers</h3>
              <button
                type="button"
                className="jhome-text-link"
                onClick={() => go(onNavigate, "/money")}
              >
                View details <ArrowRight aria-hidden />
              </button>
            </header>
            <div className="jhome-sales-grid">
              <section className="jhome-sales-stat">
                <small>This Week</small>
                <strong>{dashboard.isLoading ? "—" : money(weekRevenue)}</strong>
                <p>Paid revenue · week to date</p>
                <p style={{ marginTop: 12 }}>
                  {customers.isLoading
                    ? "Reading customers…"
                    : customers.isError
                      ? "Customer source unavailable"
                      : `${activeCustomers.toLocaleString()} active customers`}
                </p>
              </section>
              <section className="jhome-sales-stat">
                <small>This Month</small>
                <strong>{dashboard.isLoading ? "—" : money(monthRevenue)}</strong>
                <p>
                  {monthOrders == null
                    ? "Paid orders unavailable"
                    : `${monthOrders.toLocaleString()} paid orders`}
                  {monthAov == null ? "" : ` · ${compactMoney(monthAov)} AOV`}
                </p>
                <p style={{ marginTop: 12 }}>
                  {dashboard.data
                    ? `${dashboard.data.distinctCustomerPhones.toLocaleString()} customer phones in order history`
                    : "Reading payment truth…"}
                </p>
              </section>
            </div>
          </article>

          <article className="jhome-card jhome-claire">
            <header className="jhome-card-head">
              <h3><Sparkles aria-hidden /> Claire noticed</h3>
              <button
                type="button"
                className="jhome-text-link"
                onClick={() => go(onNavigate, "/claire")}
              >
                Open Claire <ArrowRight aria-hidden />
              </button>
            </header>
            <div className="jhome-claire-main">
              <span><TrendingUp aria-hidden /></span>
              <b>
                {dashboard.isLoading
                  ? "Reading the business pulse…"
                  : monthAov == null
                    ? "Average order value is not available yet."
                    : `Month-to-date AOV is ${compactMoney(monthAov)} across ${monthOrders ?? 0} paid orders.`}
              </b>
            </div>
            <div className="jhome-claire-list">
              <button type="button" onClick={() => go(onNavigate, "/money")}>
                <TrendingUp aria-hidden />
                Week-to-date paid revenue: {money(weekRevenue)}
              </button>
              <button type="button" onClick={() => go(onNavigate, "/customers")}>
                <UserRound aria-hidden />
                {customers.isLoading
                  ? "Reading customer cadence…"
                  : customers.isError
                    ? "Customer cadence unavailable"
                    : `${churnRisk} customers are cooling or lapsed`}
              </button>
              <button type="button" onClick={() => go(onNavigate, "/operations")}>
                <Building2 aria-hidden />
                {dashboard.data
                  ? `${dashboard.data.distinctBuildingsWithSlug} buildings have a canonical slug`
                  : "Reading building truth…"}
              </button>
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
