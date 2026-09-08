import { Map, Flag, Users, Building2, Swords, Crown } from "lucide-react";
import type { CityScene, SceneControls } from "./sceneTypes";
import { rectStyle } from "./LanternCitySceneRenderer";
import styles from "./lantern-city-v6.module.css";
export type Command =
  | "map"
  | "missions"
  | "customers"
  | "buildings"
  | "arsenal"
  | "conquest";
const commands = [
  ["map", "Map", "Explore L.A.", Map],
  ["missions", "Missions", "Today’s objectives", Flag],
  ["customers", "Customers", "View & outreach", Users],
  ["buildings", "Buildings", "Upgrade & grow", Building2],
  ["arsenal", "Arsenal", "Rekindle & win back", Swords],
  ["conquest", "Conquest", "Unlock new areas", Crown],
] as const;
export function LanternCityHUD({
  scene,
  date,
  quest,
  active,
  counts,
  onCommand,
  onControls,
  onReset,
}: {
  scene: CityScene;
  date: string;
  quest: string;
  active: Command;
  counts: { active: number; dimming: number; dark: number };
  onCommand: (command: Command) => void;
  onControls: (controls: SceneControls) => void;
  onReset: () => void;
}) {
  return (
    <>
      <header
        className={styles.identity}
        style={rectStyle(scene.hud.identity)}
        data-hud-zone="identity"
      >
        <Crown aria-hidden />
        <div>
          <span>GOLDLINE</span>
          <h1>LANTERN CITY</h1>
          <small>REAL CUSTOMERS. A BRIGHTER LOS ANGELES.</small>
        </div>
      </header>
      <aside
        className={styles.quest}
        style={rectStyle(scene.hud.quest)}
        data-hud-zone="quest"
      >
        <strong>TODAY’S QUEST</strong>
        <p>{quest || "Your next chapter awaits."}</p>
        <button onClick={() => onCommand("missions")}>VIEW MISSIONS →</button>
      </aside>
      <aside
        className={styles.controls}
        style={rectStyle(scene.hud.controls)}
        data-hud-zone="controls"
      >
        <time>{date || "Loading city…"}</time>
        <h2>CUSTOMERS</h2>
        {(
          [
            ["active", "Active"],
            ["dimming", "Cooling / fading"],
            ["dark", "Quiet / dormant"],
          ] as const
        ).map(([key, label]) => (
          <div className={styles.count} key={key}>
            <span>{label}</span>
            <b>{counts[key]}</b>
          </div>
        ))}
        <hr />
        {(
          [
            ["territories", "Territory environments"],
            ["lanterns", "Customer lanterns"],
            ["buildings", "Strongholds"],
            ["opportunities", "Opportunities"],
            ["labels", "Show labels"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              type="checkbox"
              checked={scene.controls[key]}
              onChange={e =>
                onControls({ ...scene.controls, [key]: e.target.checked })
              }
            />
          </label>
        ))}
      </aside>
      <nav
        className={styles.deck}
        style={rectStyle(scene.hud.deck)}
        aria-label="Lantern City command deck"
        data-hud-zone="deck"
      >
        {commands.map(([id, label, hint, Icon]) => (
          <button
            key={id}
            onClick={() => onCommand(id)}
            aria-current={id === active ? "page" : undefined}
          >
            <Icon aria-hidden />
            <strong>{label}</strong>
            <small>{hint}</small>
          </button>
        ))}
        <button onClick={onReset}>
          <Crown aria-hidden />
          <strong>Whole city</strong>
          <small>Reset view</small>
        </button>
      </nav>
    </>
  );
}
