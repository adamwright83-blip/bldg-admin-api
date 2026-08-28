import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import { towerComparisonState } from "./towerWarsGeometry";

export type TowerWarsData = inferRouterOutputs<AppRouter>["admin"]["listCustomers"]["contestTotals"];
type Property =
  | TowerWarsData["properties"]["opus_la"]
  | TowerWarsData["properties"]["century_park_east"];
export type TowerDamageState = "pristine" | "chipped" | "cracked" | "heavily-damaged" | "critical";

type TowerWarsProps = { data?: TowerWarsData; loading?: boolean; onNavigate: (path: string) => void; compact?: boolean };

function usd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function damageStateForRevenue(value: number, leaderValue: number): TowerDamageState {
  if (leaderValue <= 0 || value >= leaderValue) return "pristine";
  const ratio = value / leaderValue;
  if (ratio >= 0.8) return "chipped";
  if (ratio >= 0.55) return "cracked";
  if (ratio >= 0.3) return "heavily-damaged";
  return "critical";
}

function RealValueBreakdown({ property }: { property: Property }) {
  return <div className="tw-source-breakdown"><span><small>Stripe verified</small><strong>{usd(property.stripeVerifiedRevenue)}</strong></span><span><small>CleanCloud history</small><strong>{usd(property.legacyCleanCloudRevenue)}</strong></span><span><small>Clearent / XplorPay</small><strong>{usd(property.clearentXplorPayRevenue)}</strong></span></div>;
}

const ACTION_CLASSES = [
  { title: "Fulfill promise", detail: "No active promise records", tone: "blue" },
  { title: "Arm referral", detail: "No permission-backed referral work", tone: "orange" },
  { title: "Arm loyalty", detail: "No configured loyalty rule", tone: "gold" },
  { title: "Upgrade presentation", detail: "No fulfillment instruction configured", tone: "teal" },
] as const;

function BuildingArt({ opus, name, damage }: { opus: boolean; name: string; damage: TowerDamageState }) {
  if (!opus) return <img className="tw-building-layer" src="/assets/admin/control-room/tower-wars/century-bazooka-optimized.png" alt={`${name}, ${damage.replace("-", " ")} damage`} />;
  return <div className="tw-opus-art" role="img" aria-label={`${name}, ${damage.replace("-", " ")} damage, with architectural-scale hinged golf driver`}><div className="tw-opus-tower"><span /></div><div className="tw-opus-annex"><b /></div><i className="tw-driver-pivot" /><i className="tw-driver-shaft" /><i className="tw-driver-head" /></div>;
}

export function TowerWars({ data, loading, onNavigate, compact = false }: TowerWarsProps) {
  if (loading) return <div className="tw-loading">Reading verified building revenue…</div>;
  if (!data) return <div className="cr-empty-state"><div><strong>Tower Wars is waiting for revenue truth</strong><p>The arena remains inactive until the property revenue aggregate is available.</p></div></div>;

  const properties = [data.properties.opus_la, data.properties.century_park_east] as const;
  const comparison = towerComparisonState(properties[0].totalOperationalRevenue, properties[1].totalOperationalRevenue);
  const leaderIndex = comparison.leaderIndex;
  const hasLoser = comparison.kind === "lead";
  const loserIndex = hasLoser ? (leaderIndex === 0 ? 1 : 0) : 0;
  const you = properties[loserIndex];
  const rival = properties[loserIndex === 0 ? 1 : 0];
  const leaderRevenue = Math.max(...properties.map(property => property.totalOperationalRevenue));
  const youDamage = damageStateForRevenue(you.totalOperationalRevenue, leaderRevenue);
  const rivalDamage = damageStateForRevenue(rival.totalOperationalRevenue, leaderRevenue);
  const isOpusYou = you.propertyDisplayName === "OPUS LA";

  return (
    <main className={`tw-page ${compact ? "is-compact" : ""}`}>
      <section className="tw-arena" aria-labelledby="tower-wars-title">
        <img className="tw-environment" src="/assets/admin/control-room/tower-wars/battle-environment.jpg" alt="Sunlit Los Angeles Tower Wars arena" />
        <div className="tw-arena-shade" />
        <header className="tw-scoreboard">
          <div className="tw-score-you"><span>{you.propertyDisplayName}</span><small>{hasLoser ? "You · comeback building" : "Assignment pending"}</small><strong>{usd(you.totalOperationalRevenue)}</strong></div>
          <div className="tw-versus"><b>VS</b><span>{comparison.kind === "lead" ? `Trailing by ${usd(comparison.delta)}` : comparison.kind === "even" ? "Even" : "Awaiting first order"}</span></div>
          <div className="tw-score-rival"><span>{rival.propertyDisplayName}</span><small>{hasLoser ? "Current rival" : "Comparison building"}</small><strong>{usd(rival.totalOperationalRevenue)}</strong></div>
        </header>
        <h1 id="tower-wars-title" className="sr-only">Tower Wars</h1>
        <div className={`tw-piece tw-piece-you ${isOpusYou ? "is-opus" : "is-century"}`} data-damage={youDamage}>
          <span className="tw-possession">{hasLoser ? "You" : "Pending"}</span>
          <BuildingArt opus={isOpusYou} name={you.propertyDisplayName} damage={youDamage} />
          <span className="tw-damage-vfx" aria-hidden />
          <span className="tw-piece-label"><strong>{you.propertyDisplayName}</strong><small>{hasLoser ? `${youDamage.replace("-", " ")} · losing building` : "No losing building derived"}</small></span>
        </div>
        <div className={`tw-piece tw-piece-rival ${isOpusYou ? "is-century" : "is-opus"}`} data-damage={rivalDamage}>
          <span className="tw-possession is-rival">Rival</span>
          <BuildingArt opus={!isOpusYou} name={rival.propertyDisplayName} damage={rivalDamage} />
          <span className="tw-projectile-vfx" aria-hidden />
          <span className="tw-piece-label"><strong>{rival.propertyDisplayName}</strong><small>{hasLoser ? `${rivalDamage.replace("-", " ")} · leading building` : "Comparison building"}</small></span>
        </div>
        <aside className="tw-truth-hud"><span><i /> Live comparison</span><strong>Accumulated real order value</strong><p>No fictional energy or attack currency.</p><RealValueBreakdown property={you} /><div className="tw-threshold"><ShieldCheck /><span><small>Attack threshold</small><strong>Not configured</strong></span></div><button type="button" onClick={() => onNavigate("/customers")}>Open account evidence <ArrowRight /></button></aside>
      </section>
      <section className="tw-actions" aria-label="Comeback actions">
        {ACTION_CLASSES.map(action => <article key={action.title} className={`tone-${action.tone}`}><LockKeyhole aria-hidden /><span><small>Authoritative action class</small><strong>{action.title}</strong><p>{action.detail}</p></span><b>Not configured</b></article>)}
      </section>
      <section className="tw-evidence-strip"><div><span>Current possession</span><strong>{hasLoser ? `${you.propertyDisplayName} is YOU because it is losing.` : "No losing building is currently derived."}</strong></div><div><span>Damage rule</span><strong>Deterministic revenue ratio · {youDamage.replace("-", " ")}</strong></div><div><span>Combat input</span><strong>{usd(you.totalOperationalRevenue)} real order value</strong></div><button type="button" onClick={() => onNavigate("/commercial-pipeline")}>Engineer the comeback <ArrowRight /></button></section>
    </main>
  );
}
