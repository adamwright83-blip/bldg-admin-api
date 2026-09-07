import { Search, X } from "lucide-react";
import { LANTERN_CITY_V5_ASSETS } from "@/components/goldline/lanternCityV5Assets";

export function LanternCityHud({
  businessDate,
  questTitle,
  questBody,
  questEmpty,
  query,
  onQueryChange,
  searchOpen,
  onToggleSearch,
}: {
  businessDate: string;
  questTitle: string;
  questBody: string;
  questEmpty: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
}) {
  return (
    <div className="lc-v5-hud-top" aria-label="Lantern City game HUD">
      <div className="lc-v5-identity">
        <span className="lc-v5-brand">Goldline</span>
        <strong>Lantern City</strong>
        <small>{businessDate}</small>
      </div>
      <article className="lc-v5-today-quest">
        <img src={LANTERN_CITY_V5_ASSETS.hud.todayQuest} alt="" aria-hidden />
        <div>
          <h2>Today&apos;s Quest</h2>
          {questEmpty ? (
            <p className="lc-v5-quest-empty">
              No active mission right now. Explore the city and watch for lights
              that need attention.
            </p>
          ) : (
            <>
              <strong>{questTitle}</strong>
              <p>{questBody}</p>
            </>
          )}
        </div>
      </article>
      <button
        type="button"
        className="lc-v5-search-toggle"
        onClick={onToggleSearch}
        aria-expanded={searchOpen}
        aria-label="Search Lantern City"
      >
        <Search aria-hidden />
      </button>
      {searchOpen ? (
        <label className="lc-v5-search">
          <Search aria-hidden />
          <input
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            placeholder="Search customers and opportunities…"
            aria-label="Search Lantern City"
            autoFocus
          />
          <button type="button" onClick={onToggleSearch} aria-label="Close search">
            <X aria-hidden />
          </button>
        </label>
      ) : null}
    </div>
  );
}
