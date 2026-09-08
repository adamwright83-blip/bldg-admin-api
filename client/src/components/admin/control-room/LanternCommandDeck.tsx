import React, { useState } from "react";
import { LANTERN_CITY_V5_ASSETS } from "@/components/goldline/lanternCityV5Assets";

const ENTRIES = [
  { id: "map", label: "Map", icon: LANTERN_CITY_V5_ASSETS.hud.iconMap },
  { id: "missions", label: "Missions", icon: LANTERN_CITY_V5_ASSETS.hud.iconMissions },
  { id: "companions", label: "Companions", icon: LANTERN_CITY_V5_ASSETS.hud.iconCompanions },
  { id: "arsenal", label: "Arsenal", icon: LANTERN_CITY_V5_ASSETS.hud.iconArsenal },
  { id: "buildings", label: "Buildings", icon: LANTERN_CITY_V5_ASSETS.hud.iconBuildings },
  { id: "conquest", label: "Conquest", icon: LANTERN_CITY_V5_ASSETS.hud.iconConquest },
] as const;

export type LanternCommandId = (typeof ENTRIES)[number]["id"];

export function LanternCommandDeck({
  active,
  onSelect,
}: {
  active: LanternCommandId;
  onSelect: (command: LanternCommandId) => void;
}) {
  return (
    <nav className="lc-v5-command-deck" aria-label="Lantern City command deck">
      <img
        className="lc-v5-command-frame"
        src={LANTERN_CITY_V5_ASSETS.commandDeck.frame}
        alt=""
        aria-hidden
      />
      <div className="lc-v5-command-buttons">
        {ENTRIES.map(entry => {
          const isActive = active === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              className={`lc-v5-command-btn${isActive ? " is-active" : ""}`}
              onClick={() => onSelect(entry.id)}
              aria-current={isActive ? "page" : undefined}
            >
              <img
                src={
                  isActive
                    ? LANTERN_CITY_V5_ASSETS.commandDeck.buttonActive
                    : LANTERN_CITY_V5_ASSETS.commandDeck.buttonIdle
                }
                alt=""
                aria-hidden
              />
              <img className="lc-v5-command-icon" src={entry.icon} alt="" aria-hidden />
              <span>{entry.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Legend rows. Lantern rows use the very lantern art the city renders, so the
 * key can never drift from the map. Neighbourhood rows use the gel tints.
 */
const LANTERN_LEGEND = [
  { id: "active", label: "Active customer", hint: "Ordering on cadence", art: LANTERN_CITY_V5_ASSETS.lanterns.active },
  { id: "cooling", label: "Cooling / Fading", hint: "Overdue — take action", art: LANTERN_CITY_V5_ASSETS.lanterns.cooling },
  { id: "quiet", label: "Quiet / Dormant", hint: "Inactive — win back", art: LANTERN_CITY_V5_ASSETS.lanterns.quiet },
  { id: "hearth", label: "Hearth", hint: "Verified recurring service", art: LANTERN_CITY_V5_ASSETS.lanterns.hearth },
  { id: "opportunity", label: "Opportunity", hint: "Prospect to pursue", art: LANTERN_CITY_V5_ASSETS.lanterns.opportunity },
] as const;

const TERRITORY_LEGEND = [
  { id: "healthy", label: "Healthy", tint: "#3fbf5a" },
  { id: "at_risk", label: "At Risk", tint: "#f0a921" },
  { id: "cooling", label: "Cooling", tint: "#e2542a" },
  { id: "overgrown", label: "Overgrown / Decay", tint: "#557a1a" },
  { id: "locked_opportunity", label: "Locked opportunity", tint: "#3a3f8f" },
  { id: "lost_ground", label: "Lost · Re-earn", tint: "#5a5461" },
] as const;

export function LanternMapLegend({ collapsedDefault = false }: { collapsedDefault?: boolean }) {
  const [collapsed, setCollapsed] = useState(collapsedDefault);
  return (
    <aside
      className={`lc-v5-legend${collapsed ? " is-collapsed" : ""}`}
      aria-label="Lantern City legend"
    >
      <button
        type="button"
        className="lc-v5-legend-toggle"
        onClick={() => setCollapsed(current => !current)}
        aria-expanded={!collapsed}
      >
        {collapsed ? "Legend" : "Hide legend"}
      </button>
      {!collapsed ? (
        <>
          <div className="lc-v5-legend-frame">
            <img src={LANTERN_CITY_V5_ASSETS.hud.mapLegend} alt="" aria-hidden />
            <div className="lc-v5-legend-body" aria-label="Lantern status">
              {LANTERN_LEGEND.map(row => (
                <div className="lc-v5-legend-row" key={row.id} data-legend={row.id}>
                  <img src={row.art} alt="" aria-hidden />
                  <span>
                    <b>{row.label}</b>
                    <small>{row.hint}</small>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="lc-v5-legend-territories">
            <strong className="lc-v5-legend-heading">Neighborhood state</strong>
            <ul>
              {TERRITORY_LEGEND.map(row => (
                <li key={row.id} data-legend={row.id}>
                  <i style={{ ["--lc-swatch" as string]: row.tint }} aria-hidden />
                  <span>{row.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </aside>
  );
}

export function LanternGameRoom({
  command,
  onClose,
  children,
}: {
  command: LanternCommandId | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!command || command === "map") return null;
  return (
    <div className="lc-v5-game-room-scrim" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className="lc-v5-game-room" role="dialog" aria-modal="true">
        <button type="button" className="lc-v5-game-room-close" onClick={onClose} aria-label="Return to map">
          <XIcon />
        </button>
        {children}
      </section>
    </div>
  );
}

function XIcon() {
  return <span aria-hidden>×</span>;
}
