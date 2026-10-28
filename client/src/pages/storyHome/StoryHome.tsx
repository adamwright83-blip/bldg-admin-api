import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";
import type { IslandIntroPhase } from "@/components/admin/control-room/LanternCityIslands/islandBoard";
import type { LanternStage } from "@/components/admin/control-room/LanternCityIslands/LanternCityIslands";
import { Link } from "wouter";
import {
  ArrowRight,
  Bell,
  Box,
  Map,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import { PRODUCT_NAME } from "@shared/productIdentity";
import { trpc } from "@/lib/trpc";
import { ChapterHost } from "@/story/ChapterHost";
import { Keepsake } from "@/story/Keepsake";
import { storyClient } from "@/story/storyClient";
import { useRefreshStoryTonight } from "@/story/useStoryTonight";
import {
  chapterEyebrow,
  claimDailyIntro,
  heroLines,
  HOME_ART,
  HOME_NAV,
  metricView,
  neighbourhoodCards,
  NOT_WIRED,
  type StoryEnabled,
} from "./homeModel";
import "./StoryHome.css";

// The 3D board (three.js) loads on its own, after the page: three.js never sits in the home's own chunk.
const LanternCityIslands = lazy(
  () =>
    import(
      "@/components/admin/control-room/LanternCityIslands/LanternCityIslands"
    )
);

/**
 * The main account page while a story season is on: one five-minute chapter tonight, over business numbers that
 * stay truthful and always visible. Story words come only from `system.story.tonight`; business numbers come only
 * from the business reads. The two never mix: story calls go through the story client, business reads through the
 * main client.
 */

const NAV_ICONS: Record<
  (typeof HOME_NAV)[number]["key"],
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  city: Map,
  customers: Users,
  operations: Box,
  money: Wallet,
  settings: Settings,
};

type IntroState = "waiting" | IslandIntroPhase;

export default function StoryHome({
  tonight,
  operatorName,
  onOpenCustomer,
  onNavigate,
}: {
  tonight: StoryEnabled;
  operatorName: string;
  /** A lit home on the board was clicked: open that customer. */
  onOpenCustomer?: (phone: string) => void;
  onNavigate?: (path: string) => void;
}) {
  const [playing, setPlaying] = useState(false);
  // "returning": the chapter just closed and the invitation settles back over the city
  const [returning, setReturning] = useState(false);
  const stage = useRef<LanternStage | null>(null);
  const onStage = useCallback((next: LanternStage | null) => {
    stage.current = next;
  }, []);
  // The opening sequence plays on the first open of the day (never with reduced motion); every later open lands lit.
  const [playIntro] = useState(claimDailyIntro);
  const [intro, setIntro] = useState<IntroState>(
    playIntro ? "waiting" : "settled"
  );
  const refreshTonight = useRefreshStoryTonight();
  const chapter = tonight.chapter;
  const insetLeft = useChapterCardInset();
  // a tower's floors or Small Comforts opened from the board: the home's own cards step aside
  const [embedded, setEmbedded] = useState(false);
  useChromeHeight();

  // Play: the camera approaches tonight's destination while the chapter opens. The approach never holds the chapter
  // back for long, and with reduced motion (or no destination) there is no approach at all.
  const [arrival, setArrival] = useState<Promise<void> | null>(null);
  const play = () => {
    if (playing) return;
    window.scrollTo({ top: 0 });
    const approach = stage.current?.focusDestination() ?? Promise.resolve();
    setArrival(
      Promise.race([
        approach.catch(() => undefined),
        new Promise<void>(resolve => window.setTimeout(resolve, 1100)),
      ])
    );
    setPlaying(true);
  };
  const leave = () => {
    stage.current?.returnHome();
    setPlaying(false);
    setArrival(null);
    setReturning(true);
    void refreshTonight();
  };
  useEffect(() => {
    if (!returning) return;
    const t = window.setTimeout(() => setReturning(false), 900);
    return () => window.clearTimeout(t);
  }, [returning]);

  return (
    <div
      className={embedded ? "sh-page is-world is-embedded" : "sh-page is-world"}
      data-testid="story-home"
      data-intro={intro}
      data-playing={playing}
      data-returning={returning || undefined}
      data-finished={tonight.state === "won_tonight"}
    >
      <section className="sh-world" aria-label="Lantern City">
        <div className="sh-world-board">
          <Suspense
            fallback={
              <p className="sh-scene-loading" role="status">
                The city is coming into view…
              </p>
            }
          >
            <LanternCityIslands
              key={`${chapter?.location ?? "city"}:${chapter?.anomaly ?? "none"}`}
              intro={playIntro}
              onIntroPhase={setIntro}
              homeChrome
              showBrand={false}
              showUtilityDock={false}
              onOpenCustomer={phone => onOpenCustomer?.(phone)}
              onNavigate={onNavigate}
              insetLeft={insetLeft}
              skyBoard
              storyLocation={chapter?.location}
              storyAnomaly={chapter?.anomaly}
              onEmbeddedChange={setEmbedded}
              onStage={onStage}
            />
          </Suspense>
        </div>
        <div className="sh-world-overlay">
          <TopBar operatorName={operatorName} />
          <GlassStats />
          <ChapterCard
            tonight={tonight}
            playing={playing}
            onPlay={play}
            onAnswered={() => void refreshTonight()}
          />
        </div>
      </section>
      <CityStrip />
      {playing && chapter ? (
        <ChapterHost
          client={storyClient()}
          chapterNumber={chapter.number}
          title={chapter.title}
          arrival={arrival}
          onClose={leave}
        />
      ) : null}
    </div>
  );
}

/**
 * How much of the board the chapter card covers on the left (its right edge plus a gap), so the board can centre in
 * the open space beside it. Zero on narrow screens, where the card sits below the board's centre instead.
 */
function useChapterCardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const measure = () => {
      const card = document.querySelector<HTMLElement>(".sh-chapter");
      const world = document.querySelector<HTMLElement>(".sh-world");
      if (!card || !world || window.innerWidth <= 900) return setInset(0);
      setInset(
        Math.round(
          card.getBoundingClientRect().right -
            world.getBoundingClientRect().left +
            24
        )
      );
    };
    measure();
    const ro =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    const card = document.querySelector(".sh-chapter");
    if (ro && card) ro.observe(card);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return inset;
}

/**
 * Where the business summary ends, as `--sh-chrome` on the page: the chapter stage opens below it so the real numbers
 * stay readable while a chapter plays.
 */
function useChromeHeight() {
  useEffect(() => {
    const page = document.querySelector<HTMLElement>(".sh-page");
    const stats = document.querySelector<HTMLElement>(".sh-glass-stats");
    if (!page || !stats) return;
    const measure = () =>
      page.style.setProperty(
        "--sh-chrome",
        `${Math.round(stats.getBoundingClientRect().bottom + window.scrollY)}px`
      );
    measure();
    const ro =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(stats);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
}

function TopBar({ operatorName }: { operatorName: string }) {
  const inbox = trpc.system.claire.analysisInbox.useQuery(undefined, {
    retry: false,
    staleTime: 30_000,
  });
  const firstNotification = inbox.data?.[0] ?? null;
  const initial = (operatorName.trim()[0] ?? "A").toUpperCase();
  return (
    <header className="sh-topbar">
      <Link
        href="/"
        className="sh-wordmark"
        aria-label={`${PRODUCT_NAME} home`}
      >
        {PRODUCT_NAME}
      </Link>
      <nav className="sh-nav" aria-label="Main">
        {HOME_NAV.map(item => {
          const Icon = NAV_ICONS[item.key];
          return (
            <Link
              key={item.key}
              href={item.path}
              className="sh-nav-icon"
              aria-label={item.label}
              title={item.label}
            >
              <Icon aria-hidden="true" />
            </Link>
          );
        })}
      </nav>
      <details className="sh-menu">
        <summary aria-label="Open navigation">☰</summary>
        <nav aria-label="Main navigation"><Link href="/new-order">New order</Link><Link href="/claire">Talk to Claire</Link>
          {HOME_NAV.map(item => (
            <Link key={item.key} href={item.path}>
              {item.label}
            </Link>
          ))}
        </nav>
      </details>
      <div className="sh-actions">
        <Link href="/new-order" className="sh-pill is-dark">
          New order
        </Link>
        <Link href="/claire" className="sh-pill is-gold">
          Talk to Claire
        </Link>
        {/* Shown only when there is something to open: an empty bell would be a dead end. */}
        {firstNotification ? (
          <Link
            href={firstNotification.href}
            className="sh-bell"
            aria-label={`Notifications: ${inbox.data!.length} unread`}
          >
            <Bell aria-hidden="true" />
            <span className="sh-bell-count">{inbox.data!.length}</span>
          </Link>
        ) : null}
        <Link
          href="/operator"
          className="sh-avatar"
          aria-label={`${operatorName}: operator context`}
        >
          {initial}
        </Link>
      </div>
    </header>
  );
}

/** The business at a glance, as glass cards over the sky. Truthful numbers only: unsourced reads "Not wired yet". */
function GlassStats() {
  const snapshot = trpc.system.accountSnapshot.get.useQuery(undefined, {
    retry: 1,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const data = snapshot.data;
  const cards = [
    {
      key: "week",
      label: "Week to date",
      view: metricView(data?.week.revenueCents, "cents"),
      against: data?.week.comparison.label,
    },
    {
      key: "month",
      label: "Month to date",
      view: metricView(data?.month.revenueCents, "cents"),
      against: data?.month.comparison.label,
    },
    {
      key: "orders",
      label: "Orders (MTD)",
      view: metricView(data?.month.orders, "count"),
      against: data?.month.comparison.label,
    },
    {
      key: "new",
      label: "New customers (MTD)",
      view: metricView(data?.month.newCustomers, "count"),
      against: data?.month.comparison.label,
    },
  ];
  return (
    <section
      className="sh-glass-stats"
      aria-label="Business snapshot"
      data-testid="story-home-snapshot"
    >
      {cards.map(card => (
        <div key={card.key} className="sh-glass-card">
          <span className="sh-glass-label">{card.label}</span>
          <span
            className={
              card.view.wired ? "sh-glass-value" : "sh-glass-value is-not-wired"
            }
            title={
              card.view.recorded
                ? "What the books hold so far; not every source is confirmed for this stretch."
                : undefined
            }
          >
            {card.view.text}
          </span>
          {card.view.change ? (
            <span
              className={`sh-metric-change is-${card.view.change.direction}`}
              title={card.against ? `Against ${card.against}` : undefined}
            >
              {card.view.change.text}
            </span>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function ClairePortrait() {
  const [missing, setMissing] = useState(false);
  return (
    <span className="sh-claire-portrait" aria-hidden="true">
      {missing ? null : (
        <img src={HOME_ART.claire} alt="" onError={() => setMissing(true)} />
      )}
    </span>
  );
}

/** Tonight's chapter over the city. Story words come only from `system.story.tonight`. */
function ChapterCard({
  tonight,
  playing,
  onPlay,
  onAnswered,
}: {
  tonight: StoryEnabled;
  playing: boolean;
  onPlay: () => void;
  onAnswered: () => void;
}) {
  const chapter = tonight.chapter;
  return (
    <section
      className="sh-chapter"
      data-testid="story-home-hero"
      data-state={tonight.state}
    >
      <div className="sh-chapter-copy">
        {tonight.state === "season_complete" || !chapter ? (
          <div className="sh-settled">
            <p className="sh-eyebrow">SEASON COMPLETE</p>
            <h1 className="sh-title is-settled">{tonight.seasonTitle}</h1>
            <p className="sh-hook">Every chapter of this season is played.</p>
          </div>
        ) : tonight.state === "won_tonight" ? (
          <WonTonight chapter={chapter} onAnswered={onAnswered} />
        ) : (
          <Available chapter={chapter} playing={playing} onPlay={onPlay} />
        )}
      </div>
    </section>
  );
}

type TonightChapter = NonNullable<StoryEnabled["chapter"]>;

function Available({
  chapter,
  playing,
  onPlay,
}: {
  chapter: TonightChapter;
  playing: boolean;
  onPlay: () => void;
}) {
  const { hook, note } = heroLines(chapter.before);
  return (
    <>
      <p className="sh-eyebrow">
        {chapterEyebrow(chapter.number)} <span>· TONIGHT</span>
      </p>
      <h1 className="sh-title">{chapter.title}</h1>
      <div className="sh-hook">
        {hook.map(line => (
          <p key={line.key}>{line.text}</p>
        ))}
      </div>
      <div className="sh-play-row">
        <button
          type="button"
          className="sh-play"
          onClick={onPlay}
          disabled={playing}
          data-testid="story-home-play"
        >
          <span>Play tonight’s chapter</span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
        <p className="sh-facts">About 5 minutes</p>
      </div>
      {note ? <ClaireNote text={note.text} /> : null}
    </>
  );
}

/** Claire's line under the invitation: a note left for the operator, signed. */
function ClaireNote({ text }: { text: string }) {
  return (
    <figure className="sh-claire">
      <ClairePortrait />
      <blockquote className="sh-claire-note">
        <p>{text}</p>
        <figcaption className="sh-claire-sign">Claire</figcaption>
      </blockquote>
    </figure>
  );
}

function WonTonight({
  chapter,
  onAnswered,
}: {
  chapter: TonightChapter;
  onAnswered: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revisit, setRevisit] = useState(false);
  const question = chapter.question;
  const chosen = question?.options.find(o => o.key === question.answered);

  if (revisit)
    return (
      <div className="sh-revisit-story" data-testid="story-home-revisit">
        <p className="sh-eyebrow">
          {chapterEyebrow(chapter.number)} <span>· TONIGHT’S STORY</span>
        </p>
        <h1 className="sh-title is-settled">{chapter.title}</h1>
        <div className="sh-story-lines">
          {chapter.before.map(line => (
            <p key={`b-${line.key}`}>{line.text}</p>
          ))}
          <hr aria-hidden="true" />
          {(chapter.after ?? []).map(line => (
            <p key={`a-${line.key}`}>{line.text}</p>
          ))}
        </div>
        {question && chosen ? (
          <p className="sh-your-answer">
            <span>{question.text}</span> {chosen.text}
          </p>
        ) : null}
        <button
          type="button"
          className="sh-quiet-link"
          onClick={() => setRevisit(false)}
        >
          Close the story
        </button>
      </div>
    );

  if (!question || question.answered)
    return (
      <div className="sh-settled" data-testid="story-home-finished">
        <p className="sh-eyebrow">
          {chapterEyebrow(chapter.number)} <span>· REMEMBERED</span>
        </p>
        <h1 className="sh-title is-settled">{chapter.title}</h1>
        {chapter.closing?.response ? (
          <p className="sh-response">{chapter.closing.response}</p>
        ) : chosen ? (
          <p className="sh-response">{chosen.text}.</p>
        ) : null}
        {chapter.closing?.keepsake ? (
          <Keepsake
            chapterNumber={chapter.number}
            title={chapter.closing.keepsake.title}
            text={chapter.closing.keepsake.text}
          />
        ) : null}
        <p className="sh-tomorrow">
          {chapter.closing?.tomorrow ?? "The next chapter opens tomorrow night."}
        </p>
        <button
          type="button"
          className="sh-quiet-link"
          onClick={() => setRevisit(true)}
          data-testid="story-home-revisit-open"
        >
          Revisit tonight’s story <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
    );

  const answer = async (optionKey: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await storyClient().answer({ questionKey: question.key, optionKey });
      onAnswered();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "That did not save. Try again."
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="sh-eyebrow">
        {chapterEyebrow(chapter.number)} <span>· ONE QUESTION LEFT</span>
      </p>
      <h1 className="sh-title is-settled">{chapter.title}</h1>
      <div className="sh-story-lines">
        {(chapter.after ?? []).map(line => (
          <p key={line.key}>{line.text}</p>
        ))}
      </div>
      <div className="sh-question">
        <p className="sh-question-text">{question.text}</p>
        <div className="sh-options">
          {question.options.map(option => (
            <button
              key={option.key}
              type="button"
              className="sh-option"
              disabled={busy}
              onClick={() => void answer(option.key)}
            >
              {option.text}
            </button>
          ))}
        </div>
        {error ? (
          <p className="sh-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}

function CityStrip() {
  const report = trpc.system.geographicTruth.territoryReport.useQuery(
    { windowDays: 30 },
    { retry: 1, staleTime: 60_000 }
  );
  const snapshot = trpc.system.accountSnapshot.get.useQuery(undefined, {
    retry: 1,
    staleTime: 60_000,
  });
  const cards = neighbourhoodCards(report.data);
  return (
    <section
      className="sh-city"
      aria-label="The city"
      data-testid="story-home-city"
    >
      <header className="sh-city-head">
        <h2>
          THE CITY
          {snapshot.data ? <span> · {snapshot.data.monthName}</span> : null}
        </h2>
        <Link href="/growth/lantern-city" className="sh-city-all">
          Lantern City <ArrowRight aria-hidden="true" />
        </Link>
      </header>
      {cards.length ? (
        <ul className="sh-cards">
          {cards.map(card => (
            <li key={card.id} className="sh-card">
              {/* A full navigation: the neighbourhood views read their level from the query string. */}
              <a
                href={card.href}
                className="sh-card-link"
                aria-label={`Open ${card.name}`}
              >
                <span className="sh-card-name">{card.name.toUpperCase()}</span>
                <span className="sh-card-figures">
                  <span>
                    <strong
                      className={
                        card.revenueText === NOT_WIRED
                          ? "is-not-wired"
                          : undefined
                      }
                    >
                      {card.revenueText}
                    </strong>
                    <small>last 30 days</small>
                  </span>
                  <span>
                    <strong>{card.customers}</strong>
                    <small>
                      {card.customers === 1 ? "customer" : "customers"}
                    </small>
                  </span>
                </span>
                <ArrowRight className="sh-card-arrow" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sh-city-empty">
          {report.isLoading
            ? "Reading the city…"
            : (report.data?.reason ??
              "No neighbourhoods with customers on the map yet.")}
        </p>
      )}
    </section>
  );
}
