import React from "react";
import { Building2, Flame, Map, ScrollText } from "lucide-react";

const CITY_HREF = "https://admin.bldg.chat/growth/lantern-city";

export type GoldlineNavActive = "day" | "week" | "play" | "journal";

/**
 * The existing light Goldline nav, plus Week as a destination.
 * Same parchment bar the Day Line already uses. Not a second nav paradigm.
 */
export function GoldlineGameNav({
  active,
  onYourDay,
  onWeek,
  onPlay,
  onJournal,
}: {
  active: GoldlineNavActive;
  onYourDay: () => void;
  onWeek?: () => void;
  onPlay: () => void;
  onJournal: () => void;
}) {
  return (
    <nav className="gdp-game-nav" aria-label="Goldline navigation">
      <button
        className={active === "day" ? "is-active" : undefined}
        type="button"
        aria-current={active === "day" ? "page" : undefined}
        onClick={onYourDay}
      >
        <ScrollText />
        <span>YOUR DAY</span>
      </button>
      <button
        className={active === "week" ? "is-active" : undefined}
        type="button"
        aria-current={active === "week" ? "page" : undefined}
        data-testid="goldline-nav-week"
        onClick={onWeek}
      >
        <Map />
        <span>WEEK</span>
      </button>
      <button
        className={active === "play" ? "is-active" : undefined}
        type="button"
        aria-current={active === "play" ? "page" : undefined}
        onClick={onPlay}
      >
        <Flame />
        <span>PLAY</span>
      </button>
      <button
        className={active === "journal" ? "is-active" : undefined}
        type="button"
        aria-current={active === "journal" ? "page" : undefined}
        onClick={onJournal}
      >
        <ScrollText />
        <span>JOURNAL</span>
      </button>
      <a href={CITY_HREF} target="_blank" rel="noreferrer">
        <Building2 />
        <span>CITY</span>
      </a>
    </nav>
  );
}
