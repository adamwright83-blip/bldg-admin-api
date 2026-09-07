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

export function LanternMapLegend({ collapsedDefault = false }: { collapsedDefault?: boolean }) {
  const [collapsed, setCollapsed] = useState(collapsedDefault);
  return (
    <aside className={`lc-v5-legend${collapsed ? " is-collapsed" : ""}`}>
      <button
        type="button"
        className="lc-v5-legend-toggle"
        onClick={() => setCollapsed(current => !current)}
        aria-expanded={!collapsed}
      >
        Legend
      </button>
      <img src={LANTERN_CITY_V5_ASSETS.hud.mapLegend} alt="" aria-hidden />
      {!collapsed ? (
        <div className="lc-v5-legend-body">
          <strong>Lanterns</strong>
          <span>Active</span>
          <span>Cooling</span>
          <span>Quiet</span>
          <span>Hearth</span>
          <span>Opportunity</span>
          <strong>Territories</strong>
          <span>Healthy</span>
          <span>At Risk</span>
          <span>Cooling</span>
          <span>Overgrown</span>
          <span>Lost Ground</span>
          <span>What Could Be</span>
        </div>
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
