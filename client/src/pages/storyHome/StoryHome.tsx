import { useState, type ComponentType, type SVGProps } from "react";
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
  heroLines,
  HOME_ART,
  HOME_NAV,
  metricView,
  neighbourhoodCards,
  NOT_WIRED,
  type StoryEnabled,
} from "./homeModel";
import { HeroScene } from "./HeroScene";
import "./StoryHome.css";

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

export default function StoryHome({ tonight, operatorName }: { tonight: StoryEnabled; operatorName: string }) {
  const [playing, setPlaying] = useState(false);
  const refreshTonight = useRefreshStoryTonight();
  const chapter = tonight.chapter;

  return (
    <div className="sh-page" data-testid="story-home">
      <TopBar operatorName={operatorName} />
      <SnapshotStrip />
      <Hero tonight={tonight} onPlay={() => setPlaying(true)} onAnswered={() => void refreshTonight()} />
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

function SnapshotStrip() {
  const snapshot = trpc.system.accountSnapshot.get.useQuery(undefined, { retry: 1, staleTime: 60_000, refetchInterval: 120_000 });
  const data = snapshot.data;
  return (
    <section className="sh-snapshot" aria-label="Business snapshot" data-testid="story-home-snapshot">
      <div className="sh-snapshot-periods">
        <SnapshotPeriod title="Week to date" period={data?.week} />
        <SnapshotPeriod title="Month to date" period={data?.month} />
      </div>
      {data ? (
        <div className="sh-snapshot-place">
          <span>{data.monthName}</span>
          {data.city ? <span>{data.city}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

function SnapshotPeriod({ title, period }: { title: string; period: AccountSnapshotPeriod | undefined }) {
  const items = [
    { label: "Revenue", view: metricView(period?.revenueCents, "cents") },
    { label: "Orders", view: metricView(period?.orders, "count") },
    { label: "New customers", view: metricView(period?.newCustomers, "count") },
  ];
  return (
    <div className="sh-period">
      <h2 className="sh-period-title">{title}</h2>
      <dl className="sh-metrics">
        {items.map(item => (
          <div key={item.label} className="sh-metric">
            <dt>{item.label}</dt>
            <dd className={item.view.wired ? "sh-metric-value" : "sh-metric-value is-not-wired"}>
              {item.view.text}
              {item.view.recorded ? <span className="sh-metric-recorded" title="What the books hold so far; not every source is confirmed for this stretch.">recorded</span> : null}
            </dd>
            {item.view.change && period ? (
              <dd className={`sh-metric-change is-${item.view.change.direction}`} title={`Against ${period.comparison.label}`}>
                {item.view.change.text}
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
    </div>
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

function Hero({ tonight, onPlay, onAnswered }: { tonight: StoryEnabled; onPlay: () => void; onAnswered: () => void }) {
  const chapter = tonight.chapter;
  return (
    <section className="sh-hero" data-testid="story-home-hero" data-state={tonight.state}>
      <HeroScene />
      <div className="sh-hero-copy">
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
