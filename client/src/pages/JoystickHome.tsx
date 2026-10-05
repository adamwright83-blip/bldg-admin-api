import { lazy, Suspense, useMemo } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  Bell,
  Box,
  Building2,
  CalendarDays,
  Crown,
  Home,
  Map,
  Mic,
  PackagePlus,
  Sparkles,
  UserRound,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./JoystickHome.css";

const LanternCityIslands = lazy(
  () => import("@/components/admin/control-room/LanternCityIslands/LanternCityIslands")
);

type Props = {
  operatorName?: string;
  onNavigate?: (path: string) => void;
};

const presidentImages = [
  "/assets/joystick-home/president-growth.svg",
  "/assets/joystick-home/president-retention.svg",
  "/assets/joystick-home/president-conversion.svg",
];

const mitchImages = [
  "/assets/joystick-home/mitch-emberline.svg",
  "/assets/joystick-home/mitch-northreach.svg",
  "/assets/joystick-home/mitch-thornhollow.svg",
];

function money(value: number | null | undefined) {
  if (typeof value !== "number") return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function when(iso: string | null | undefined) {
  if (!iso) return "Now";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "Now";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function JoystickHome({
  operatorName = "Adam",
  onNavigate = path => {
    window.location.href = path;
  },
}: Props) {
  const dashboard = trpc.admin.dashboardSummary.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const today = trpc.system.legacyDayforgeToday.list.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: false,
  });
  const president = trpc.president.founderSurface.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: false,
  });
  const atlas = trpc.system.geographicTruth.atlas.useQuery(undefined, {
    staleTime: 30_000,
    retry: false,
  });

  const firstName = operatorName.split(/\s+/)[0] || "Adam";
  const summary = dashboard.data;
  const dayItems = today.data ?? [];
  const current = dayItems[0] ?? null;
  const upcoming = dayItems.slice(1, 4);
  const questions = president.data?.brief.questions ?? [];

  const presidentRows = useMemo(
    () =>
      [0, 1, 2].map(index => {
        const question = questions[index];
        if (question) {
          return {
            title: question.question,
            subtitle: question.reason,
            status: "READY FOR YOU",
            live: true,
          };
        }
        const placeholders = [
          ["Tonight's growth proposal", "President has not published this slot yet."],
          ["Tonight's operating proposal", "A second initiative will appear after President's run."],
          ["Tonight's leverage proposal", "A third initiative will appear when grounded evidence exists."],
        ] as const;
        return {
          title: placeholders[index][0],
          subtitle: placeholders[index][1],
          status: "AWAITING TONIGHT'S RUN",
          live: false,
        };
      }),
    [questions]
  );

  const lanternCount =
    atlas.data?.customers?.filter(customer => Boolean(customer.location)).length ?? null;
  const weekShare =
    summary?.revenueMonth && summary.revenueMonth > 0
      ? Math.round((summary.revenueWeek / summary.revenueMonth) * 100)
      : null;
  const firstInsight =
    weekShare !== null
      ? `This week accounts for ${weekShare}% of month-to-date revenue.`
      : "Revenue intelligence will appear when payment truth is available.";

  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <main className="jh-page">
      <header className="jh-topbar">
        <Link href="/" className="jh-brand" aria-label="JOYSTICK Home">
          <Crown aria-hidden />
          <strong>JOYSTICK</strong>
        </Link>

        <nav className="jh-nav" aria-label="Primary">
          <Link href="/" className="is-active"><Home />Home</Link>
          <Link href="/growth/lantern-city"><Map />Lantern City</Link>
          <Link href="/play"><CalendarDays />Day Line</Link>
          <Link href="/operations"><Box />Operations</Link>
          <Link href="/president"><Building2 />Company</Link>
          <Link href="/operator"><UserRound />Operator</Link>
        </nav>

        <div className="jh-top-actions">
          <Link href="/new-order" className="jh-new-order">
            <PackagePlus /> <span>New order</span>
          </Link>
          <Link href="/claire" className="jh-claire">
            <span className="jh-claire-orb"><Mic /></span>
            <span><b>Talk to Claire</b><small>Press to speak</small></span>
          </Link>
          <button className="jh-icon-button" type="button" aria-label="Notifications"><Bell /></button>
          <div className="jh-avatar" aria-label={firstName}>{firstName.slice(0, 1).toUpperCase()}</div>
        </div>
      </header>

      <section className="jh-intro">
        <div className="jh-greeting">
          <span>GOOD EVENING</span>
          <h1>{firstName}.</h1>
        </div>
        <div className="jh-opening-line">
          <h2>
            {summary?.revenueMonth
              ? `${money(summary.revenueMonth)} in revenue this month.`
              : "JOYSTICK is ready."}
          </h2>
          <p>
            {questions.length
              ? `President has ${questions.length} decision${questions.length === 1 ? "" : "s"} waiting.`
              : "President is preparing tonight's decisions."}{" "}
            Mitch's build receipts will appear here as overnight work lands.
          </p>
        </div>
        <time>{dateLabel}</time>
      </section>

      <section className="jh-dashboard">
        <article className="jh-world-card">
          <div className="jh-world-stage" aria-hidden="true">
            <Suspense fallback={<div className="jh-world-loading">Raising Lantern City…</div>}>
              <LanternCityIslands
                showBrand={false}
                showUtilityDock={false}
                onOpenCustomer={() => onNavigate("/customers")}
                onNavigate={onNavigate}
              />
            </Suspense>
          </div>
          <div className="jh-world-wash" />
          <div className="jh-world-copy">
            <span>YOUR BUSINESS, PLAYABLE</span>
            <h2>LANTERN<br />CITY</h2>
            <p>Real customers. Real places.<br />Real progress.</p>
            <div className="jh-world-facts">
              <b>{lanternCount ?? "—"}</b>
              <span>live customer lanterns</span>
            </div>
            <Link href="/growth/lantern-city" className="jh-enter">
              Open city <ArrowRight />
            </Link>
          </div>
        </article>

        <div className="jh-right-rail">
          <article className="jh-panel jh-president">
            <header>
              <div>
                <span className="jh-kicker"><Sparkles /> PRESIDENT</span>
                <h2>{questions.length ? `${questions.length} decisions for tonight` : "Preparing tonight's decisions"}</h2>
                <p>The few consequential calls worth your attention.</p>
              </div>
              <Link href="/president">View all <ArrowRight /></Link>
            </header>
            <div className="jh-president-list">
              {presidentRows.map((row, index) => (
                <Link href="/president" className="jh-president-row" key={index}>
                  <img src={presidentImages[index]} alt="" />
                  <div>
                    <span className={row.live ? "is-live" : ""}>{row.status}</span>
                    <strong>{row.title}</strong>
                    <small>{row.subtitle}</small>
                  </div>
                  <ArrowRight />
                </Link>
              ))}
            </div>
          </article>

          <article className="jh-panel jh-mitch">
            <header>
              <div>
                <span className="jh-kicker"><Box /> MITCH</span>
                <h2>Built overnight.</h2>
                <p>Build evidence appears here as Mitch ships it.</p>
              </div>
              <Link href="/goldline-kingdoms">View progress <ArrowRight /></Link>
            </header>
            <div className="jh-build-grid">
              {mitchImages.map((image, index) => (
                <Link href="/goldline-kingdoms" className="jh-build" key={image}>
                  <img src={image} alt="" />
                  <strong>{["World build", "Character pass", "Lighting pass"][index]}</strong>
                  <span>Placeholder · awaiting receipt</span>
                </Link>
              ))}
            </div>
          </article>
        </div>

        <article className="jh-panel jh-now">
          <header>
            <div>
              <span className="jh-kicker">NOW · FROM YOUR DAY LINE</span>
              <h2>{current?.displayTitle ?? "No ranked Day Line item"}</h2>
              <p>{current ? `${current.accountName} · ${when(current.dueAt)}` : "Nothing is asking for immediate action."}</p>
            </div>
            <Link href={current?.destinationPath ?? "/play"} className="jh-round-link" aria-label="Open current Day Line item">
              <ArrowRight />
            </Link>
          </header>
          {current?.note ? <div className="jh-claire-note"><Mic /> <span><b>Claire briefing</b>{current.note}</span></div> : null}
          <div className="jh-up-next">
            {upcoming.length ? upcoming.map(item => (
              <Link key={item.id} href={item.destinationPath}>
                <time>{when(item.dueAt)}</time>
                <span>{item.displayTitle}</span>
              </Link>
            )) : <span className="jh-empty">Your next ranked actions will appear here.</span>}
          </div>
        </article>

        <article className="jh-panel jh-sales">
          <header>
            <span className="jh-kicker">SALES & CUSTOMERS</span>
          </header>
          <div className="jh-sales-grid">
            <div>
              <span>This week</span>
              <strong>{money(summary?.revenueWeek)}</strong>
              <small>Payment truth</small>
            </div>
            <div>
              <span>This month</span>
              <strong>{money(summary?.revenueMonth)}</strong>
              <small>{summary?.paidOrderCountMonth ?? "—"} paid orders · AOV {money(summary?.avgOrderValueMonth)}</small>
            </div>
          </div>
        </article>

        <article className="jh-panel jh-claire-noticed">
          <header>
            <span className="jh-kicker"><Sparkles /> CLAIRE NOTICED</span>
            <Link href="/claire">Open Claire <ArrowRight /></Link>
          </header>
          <blockquote>“{firstInsight}”</blockquote>
          <ul>
            <li>{summary?.distinctCustomerPhones ?? "—"} customer phones in the connected order history</li>
            <li>{dayItems.filter(item => item.urgency === "overdue").length} overdue Day Line follow-ups</li>
            <li>{lanternCount ?? "—"} located customers currently represented in Lantern City</li>
          </ul>
        </article>
      </section>
    </main>
  );
}
