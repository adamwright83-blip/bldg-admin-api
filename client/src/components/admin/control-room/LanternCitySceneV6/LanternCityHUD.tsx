import {
  Map,
  Flag,
  Users,
  Building2,
  Wrench,
  Crown,
  DollarSign,
  Lamp,
  CalendarDays,
} from "lucide-react";
import type { CityScene } from "./sceneTypes";
import { rectStyle } from "./LanternCitySceneRenderer";
import { LANTERN_CITY_V5_ASSETS as ASSETS } from "@/components/goldline/lanternCityV5Assets";
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
  ["missions", "Missions", "Active operations", Flag],
  ["customers", "Customers", "Grow your empire", Users],
  ["buildings", "Buildings", "Upgrade & defend", Building2],
  ["arsenal", "Arsenal", "Tools for the city", Wrench],
  ["conquest", "Conquest", "Unlock what’s next", Crown],
] as const;
export type Dossier = {
  territoryId: string;
  territoryName: string;
  counts: { total: number; active: number; dimming: number; dark: number };
  knownLight: null | {
    identityKey: string;
    displayName: string;
    phone: string | null;
    totalOrders: number;
    lastOrderAt: string;
    cadence: {
      state: "active" | "dimming" | "dark";
      expectedCadenceDays?: number | null;
    };
  };
};
export type Overview = {
  businessDate: string;
  timeZone: string;
  scoreboard: {
    customers: number;
    districtsLit: { numerator: number; denominator: number };
    paidRevenueThisWeek: number;
    dormant: { numerator: number; denominator: number };
  };
  featuredOperation: {
    id: string;
    title: string;
    territoryId: string | null;
    territoryName: string;
    briefing: string;
    objectives: Array<{
      id: string;
      label: string;
      current: number;
      target: number;
    }>;
    secondLight: null | { id: string; territoryId: string; status: string };
  };
  otherOpportunityCount: number;
};
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const stateLabel = {
  active: "ACTIVE",
  dimming: "COOLING",
  dark: "DORMANT",
} as const;

export function LanternCityHUD({
  scene,
  overview,
  dossier,
  selectedTarget,
  active,
  onCommand,
  onLaunch,
  onKnownLight,
}: {
  scene: CityScene;
  overview?: Overview;
  dossier?: Dossier | null;
  selectedTarget?: "district" | "second_light";
  active: Command;
  onCommand: (command: Command) => void;
  onLaunch: () => void;
  onKnownLight: (identityKey: string) => void;
}) {
  const operation = overview?.featuredOperation;
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
          <small>REAL BUSINESSES. A BRIGHTER LOS ANGELES.</small>
        </div>
      </header>
      <section
        className={styles.scoreboard}
        style={rectStyle(scene.hud.topBar)}
        data-hud-zone="topBar"
        aria-label="Real business scoreboard"
      >
        <div>
          <Users aria-hidden />
          <span>
            CUSTOMERS<b>{overview?.scoreboard.customers ?? "—"}</b>
          </span>
        </div>
        <div>
          <Building2 aria-hidden />
          <span>
            DISTRICTS LIT
            <b>
              {overview
                ? `${overview.scoreboard.districtsLit.numerator} / ${overview.scoreboard.districtsLit.denominator}`
                : "—"}
            </b>
          </span>
        </div>
        <div>
          <DollarSign aria-hidden />
          <span>
            PAID REVENUE · THIS WEEK
            <b>
              {overview
                ? money.format(overview.scoreboard.paidRevenueThisWeek)
                : "—"}
            </b>
          </span>
        </div>
        <div>
          <Lamp aria-hidden />
          <span>
            DORMANT CUSTOMERS
            <b>
              {overview
                ? `${overview.scoreboard.dormant.numerator} / ${overview.scoreboard.dormant.denominator}`
                : "—"}
            </b>
          </span>
        </div>
        <div className={styles.dateContext}>
          <CalendarDays aria-hidden />
          <span>
            {overview?.businessDate
              ? date.format(new Date(`${overview.businessDate}T12:00:00Z`))
              : "Loading…"}
            <small>LOS ANGELES</small>
          </span>
        </div>
      </section>
      <aside
        className={styles.operation}
        style={rectStyle(scene.hud.leftOperation)}
        data-hud-zone="leftOperation"
      >
        <h2>FEATURED OPERATION</h2>
        <div className={styles.operationHero} aria-hidden>
          {operation?.territoryId ? (
            <img
              src={`/assets/goldline/lantern-city/v6/territories/${operation.territoryId}/infested.png`}
              alt=""
            />
          ) : null}
        </div>
        <div className={styles.operationBody}>
          <h3>{operation?.title ?? "CITY STANDING BY"}</h3>
          <strong>{operation?.territoryName ?? "Los Angeles"}</strong>
          <p>{operation?.briefing ?? "Loading real work…"}</p>
          <div className={styles.objectives}>
            {operation?.objectives.map(objective => (
              <div key={objective.id}>
                <Lamp aria-hidden />
                <span>
                  {objective.label}
                  <i>
                    <em
                      style={{
                        width: `${Math.min(100, (objective.current / objective.target) * 100)}%`,
                      }}
                    />
                  </i>
                </span>
                <b>
                  {objective.current}/{objective.target}
                </b>
              </div>
            ))}
          </div>
          <button
            className={styles.launch}
            onClick={onLaunch}
            disabled={!operation}
          >
            LAUNCH OPERATION <span>→</span>
          </button>
          <button
            className={styles.other}
            onClick={() => onCommand("missions")}
          >
            ☷ &nbsp; Other opportunities (
            {overview?.otherOpportunityCount ?? 0}) <span>›</span>
          </button>
        </div>
      </aside>
      <aside
        className={styles.dossier}
        style={rectStyle(scene.hud.rightDossier)}
        data-hud-zone="rightDossier"
      >
        <header>
          <h2>
            {dossier?.territoryName ??
              operation?.territoryName ??
              "LANTERN CITY"}
          </h2>
          <span>{dossier?.counts.dark ? "NEEDS ATTENTION" : "HOLDING"}</span>
        </header>
        <section>
          <h3>DISTRICT STATUS</h3>
          <div className={styles.statusGrid}>
            <div>
              <Users aria-hidden />
              <b>{dossier?.counts.total ?? 0}</b>
              <small>customers</small>
            </div>
            <div>
              <Lamp aria-hidden />
              <b>{dossier?.counts.dark ?? 0}</b>
              <small>dormant</small>
            </div>
            <div>
              <Lamp aria-hidden />
              <b>{dossier?.counts.dimming ?? 0}</b>
              <small>fading lanterns</small>
            </div>
            <div>
              <Lamp aria-hidden />
              <b>{dossier?.counts.active ?? 0}</b>
              <small>active lights</small>
            </div>
          </div>
        </section>
        {dossier?.knownLight ? (
          <section>
            <h3>KNOWN LIGHTS</h3>
            <button
              className={styles.knownLight}
              onClick={() => onKnownLight(dossier.knownLight!.identityKey)}
            >
              <img src={ASSETS.lanterns.quiet} alt="" />
              <span>
                <b>{dossier.knownLight.displayName}</b>
                <mark>{stateLabel[dossier.knownLight.cadence.state]}</mark>
                <small>
                  Last order:{" "}
                  {date.format(new Date(dossier.knownLight.lastOrderAt))}
                </small>
                <small>Orders: {dossier.knownLight.totalOrders}</small>
                {dossier.knownLight.cadence.expectedCadenceDays ? (
                  <small>
                    Observed cadence: ~
                    {dossier.knownLight.cadence.expectedCadenceDays} days
                  </small>
                ) : null}
              </span>
            </button>
          </section>
        ) : null}
        {operation?.secondLight &&
        (selectedTarget === "second_light" ||
          dossier?.territoryId === operation.secondLight.territoryId) ? (
          <section className={styles.target}>
            <h3>TARGET OBJECT</h3>
            <div>
              <img src={ASSETS.lanterns.quiet} alt="" />
              <span>
                <b>THE SECOND LIGHT</b>
                <p>
                  Represents the next real customer established in{" "}
                  {dossier?.territoryName}. Lights only when a real new customer
                  appears.
                </p>
              </span>
            </div>
          </section>
        ) : null}
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
      </nav>
    </>
  );
}
