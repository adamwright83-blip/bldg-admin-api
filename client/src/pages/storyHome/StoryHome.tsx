import { lazy, Suspense, useEffect, useState, type ComponentType, type SVGProps } from "react";
import type { IslandIntroPhase } from "@/components/admin/control-room/LanternCityIslands/islandBoard";
import { Link } from "wouter";
import { ArrowRight, Bell, Box, Map, Settings, Users, Wallet } from "lucide-react";
import { PRODUCT_NAME } from "@shared/productIdentity";
import type { AccountSnapshotPeriod } from "@shared/accountSnapshot";
import { trpc } from "@/lib/trpc";
import { ChapterHost } from "@/story/ChapterHost";
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
const LanternCityIslands = lazy(() => import("@/components/admin/control-room/LanternCityIslands/LanternCityIslands"));

/**
 * The main account page while a story season is on: one five-minute chapter tonight, over business numbers that
 * stay truthful and always visible. Story words come only from `system.story.tonight`; business numbers come only
 * from the business reads. The two never mix: story calls go through the story client, business reads through the
 * main client.
 */

const NAV_ICONS: Record<(typeof HOME_NAV)[number]["key"], ComponentType<SVGProps<SVGSVGElement>>> = {
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
  // The opening sequence plays on the first open of the day (never with reduced motion); every later open lands lit.
  const [playIntro] = useState(claimDailyIntro);
  const [intro, setIntro] = useState<IntroState>(playIntro ? "waiting" : "settled");
  const refreshTonight = useRefreshStoryTonight();
  const chapter = tonight.chapter;
  const insetLeft = useChapterCardInset();

  return (
    <div className="sh-page is-world" data-testid="story-home" data-intro={intro}>
      <section className="sh-world" aria-label="Lantern City">
        <div className="sh-world-board">
          <Suspense fallback={null}>
          <LanternCityIslands
            intro={playIntro}
            onIntroPhase={setIntro}
            homeChrome
            showBrand={false}
            showUtilityDock={false}
            onOpenCustomer={phone => onOpenCustomer?.(phone)}
            onNavigate={onNavigate}
            insetLeft={insetLeft}
            skyBoard
          />
          </Suspense>
        </div>
        <div className="sh-world-overlay">
          <TopBar operatorName={operatorName} />
          <GlassStats />
          <ChapterCard tonight={tonight} onPlay={() => setPlaying(true)} onAnswered={() => void refreshTonight()} />
        </div>
      </section>
      <CityStrip />
      {playing && chapter ? (
        <ChapterHost
          client={storyClient()}
          chapterNumber={chapter.number}
          title={chapter.title}
          onClose={() => {
            setPlaying(false);
            void refreshTonight();
          }}
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
      setInset(Math.round(card.getBoundingClientRect().right - world.getBoundingClientRect().left + 24));
    };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
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

function TopBar({ operatorName }: { operatorName: string }) {
  const inbox = trpc.system.claire.analysisInbox.useQuery(undefined, { retry: false, staleTime: 30_000 });
  const firstNotification = inbox.data?.[0] ?? null;
  const initial = (operatorName.trim()[0] ?? "A").toUpperCase();
  return (
    <header className="sh-topbar">
      <Link href="/" className="sh-wordmark" aria-label={`${PRODUCT_NAME} home`}>{PRODUCT_NAME}</Link>
      <nav className="sh-nav" aria-label="Main">
        {HOME_NAV.map(item => {
          const Icon = NAV_ICONS[item.key];
          return (
            <Link key={item.key} href={item.path} className="sh-nav-icon" aria-label={item.label} title={item.label}>
              <Icon aria-hidden="true" />
            </Link>
          );
        })}
      </nav>
      <div className="sh-actions">
        <Link href="/new-order" className="sh-pill is-dark">New order</Link>
        <Link href="/claire" className="sh-pill is-gold">Talk to Claire</Link>
        {/* Shown only when there is something to open: an empty bell would be a dead end. */}
        {firstNotification ? (
          <Link href={firstNotification.href} className="sh-bell" aria-label={`Notifications: ${inbox.data!.length} unread`}>
            <Bell aria-hidden="true" />
            <span className="sh-bell-count">{inbox.data!.length}</span>
          </Link>
        ) : null}
        <Link href="/operator" className="sh-avatar" aria-label={`${operatorName}: operator context`}>{initial}</Link>
      </div>
    </header>
  );
}

/** The business at a glance, as glass cards over the sky. Truthful numbers only: unsourced reads "Not wired yet". */
function GlassStats() {
  const snapshot = trpc.system.accountSnapshot.get.useQuery(undefined, { retry: 1, staleTime: 60_000, refetchInterval: 120_000 });
  const data = snapshot.data;
  const cards = [
    { key: "week", label: "Week to date", view: metricView(data?.week.revenueCents, "cents"), against: data?.week.comparison.label },
    { key: "month", label: "Month to date", view: metricView(data?.month.revenueCents, "cents"), against: data?.month.comparison.label },
    { key: "orders", label: "Orders (MTD)", view: metricView(data?.month.orders, "count"), against: data?.month.comparison.label },
    { key: "new", label: "New customers (MTD)", view: metricView(data?.month.newCustomers, "count"), against: data?.month.comparison.label },
  ];
  return (
    <section className="sh-glass-stats" aria-label="Business snapshot" data-testid="story-home-snapshot">
      {cards.map(card => (
        <div key={card.key} className="sh-glass-card">
          <span className="sh-glass-label">{card.label}</span>
          <span className={card.view.wired ? "sh-glass-value" : "sh-glass-value is-not-wired"}>
            {card.view.text}
            {card.view.recorded ? <span className="sh-metric-recorded" title="What the books hold so far; not every source is confirmed for this stretch.">recorded</span> : null}
          </span>
          {card.view.change ? (
            <span className={`sh-metric-change is-${card.view.change.direction}`} title={card.against ? `Against ${card.against}` : undefined}>
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
      {missing ? null : <img src={HOME_ART.claire} alt="" onError={() => setMissing(true)} />}
    </span>
  );
}

/** Tonight's chapter, on a glass card over the sky. Story words come only from `system.story.tonight`. */
function ChapterCard({ tonight, onPlay, onAnswered }: { tonight: StoryEnabled; onPlay: () => void; onAnswered: () => void }) {
  const chapter = tonight.chapter;
  return (
    <section className="sh-chapter" data-testid="story-home-hero" data-state={tonight.state}>
      <div className="sh-chapter-copy">
        {tonight.state === "season_complete" || !chapter ? (
          <>
            <p className="sh-eyebrow">SEASON COMPLETE</p>
            <h1 className="sh-title">{tonight.seasonTitle}</h1>
            <p className="sh-hook">Every chapter of this season is played.</p>
          </>
        ) : tonight.state === "won_tonight" ? (
          <WonTonight chapter={chapter} onAnswered={onAnswered} />
        ) : (
          <Available chapter={chapter} onPlay={onPlay} />
        )}
      </div>
    </section>
  );
}

type TonightChapter = NonNullable<StoryEnabled["chapter"]>;

function Available({ chapter, onPlay }: { chapter: TonightChapter; onPlay: () => void }) {
  const { hook, note } = heroLines(chapter.before);
  return (
    <>
      <p className="sh-eyebrow">{chapterEyebrow(chapter.number)}</p>
      <h1 className="sh-title">{chapter.title}</h1>
      <div className="sh-hook">
        {hook.map(line => <p key={line.key}>{line.text}</p>)}
      </div>
      {note ? (
        <div className="sh-claire">
          <ClairePortrait />
          <p className="sh-claire-note">{note.text}</p>
        </div>
      ) : null}
      <button type="button" className="sh-play" onClick={onPlay} data-testid="story-home-play">PLAY TONIGHT'S CHAPTER</button>
      <p className="sh-facts">5 minutes · One game · A new clue</p>
    </>
  );
}

function WonTonight({ chapter, onAnswered }: { chapter: TonightChapter; onAnswered: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const question = chapter.question;
  const answer = async (optionKey: string) => {
    if (!question || busy) return;
    setBusy(true);
    setError(null);
    try {
      await storyClient().answer({ questionKey: question.key, optionKey });
      onAnswered();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="sh-eyebrow">{chapterEyebrow(chapter.number)}</p>
      <h1 className="sh-title">{chapter.title}</h1>
      <div className="sh-hook sh-ending">
        {(chapter.after ?? []).map(line => <p key={line.key}>{line.text}</p>)}
      </div>
      {question ? (
        <div className="sh-question">
          <p className="sh-question-text">{question.text}</p>
          <div className="sh-options">
            {question.options.map(option => (
              <button
                key={option.key}
                type="button"
                className={`sh-option${question.answered === option.key ? " is-chosen" : ""}`}
                disabled={Boolean(question.answered) || busy}
                aria-pressed={question.answered === option.key}
                onClick={() => void answer(option.key)}
              >
                {option.text}
              </button>
            ))}
          </div>
          {error ? <p className="sh-error" role="alert">{error}</p> : null}
        </div>
      ) : null}
      <p className="sh-facts">The next chapter opens tomorrow night.</p>
    </>
  );
}

function NeighbourhoodImage({ slug }: { slug: string }) {
  const [step, setStep] = useState(0);
  const sources = [HOME_ART.neighbourhood(slug), HOME_ART.neighbourhoodFallback(slug)];
  if (step >= sources.length) return <span className="sh-card-image is-empty" aria-hidden="true" />;
  return <img className="sh-card-image" src={sources[step]} alt="" loading="lazy" onError={() => setStep(s => s + 1)} />;
}

function CityStrip() {
  const report = trpc.system.geographicTruth.territoryReport.useQuery({ windowDays: 30 }, { retry: 1, staleTime: 60_000 });
  const snapshot = trpc.system.accountSnapshot.get.useQuery(undefined, { retry: 1, staleTime: 60_000 });
  const cards = neighbourhoodCards(report.data);
  return (
    <section className="sh-city" aria-label="The city" data-testid="story-home-city">
      <header className="sh-city-head">
        <h2>THE CITY{snapshot.data ? <span> · {snapshot.data.monthName}</span> : null}</h2>
        <Link href="/growth/lantern-city" className="sh-city-all">Lantern City <ArrowRight aria-hidden="true" /></Link>
      </header>
      {cards.length ? (
        <ul className="sh-cards">
          {cards.map(card => (
            <li key={card.id} className="sh-card">
              {/* A full navigation: the neighbourhood views read their level from the query string. */}
              <a href={card.href} className="sh-card-link" aria-label={`Open ${card.name}`}>
                <NeighbourhoodImage slug={card.id} />
                <span className="sh-card-name">{card.name.toUpperCase()}</span>
                <span className="sh-card-figures">
                  <span>
                    <strong className={card.revenueText === NOT_WIRED ? "is-not-wired" : undefined}>{card.revenueText}</strong>
                    <small>last 30 days</small>
                  </span>
                  <span>
                    <strong>{card.customers}</strong>
                    <small>{card.customers === 1 ? "customer" : "customers"}</small>
                  </span>
                </span>
                <ArrowRight className="sh-card-arrow" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sh-city-empty">
          {report.isLoading ? "Reading the city…" : report.data?.reason ?? "No neighbourhoods with customers on the map yet."}
        </p>
      )}
    </section>
  );
}
