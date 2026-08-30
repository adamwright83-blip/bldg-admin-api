/**
 * THE FACADE RECORD — a building's permanent architectural history.
 *
 * The settlement contract gives every completed business day a stratum: the
 * attacks that building absorbed in that day's own match. Rendered oldest at
 * the bottom, the facade reads geologically — the week one tower took a run of
 * hits, the month it was quiet — without an axis, a gridline, or a percentage
 * anywhere, because a real business has no denominator to be a fraction of.
 *
 * Today sits above the settled line and is deliberately separated from it.
 * Today's match is a fight in progress; everything below it is finished and
 * can never change. That separation is the whole point of the daily reset:
 * yesterday cannot fire today's shot, and today cannot rewrite yesterday's
 * stone.
 *
 * Accessibility (Law 4 has a counter-argument and this respects it): the marks
 * carry the meaning pre-verbally, but every stratum is also a real table row
 * for a screen reader, and the exact counts are one disclosure away rather
 * than shouted by default.
 */
import { useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import { trpc } from "@/lib/trpc";
import type { TowerWarsBuildingId } from "@shared/towerWars";

type SettlementData =
  inferRouterOutputs<AppRouter>["system"]["towerWars"]["settlement"];
type BuildingSettlement = SettlementData["settlement"]["buildings"][TowerWarsBuildingId];

const NAMES: Record<TowerWarsBuildingId, string> = {
  opus_la: "OPUS LA",
  century_park_east: "Century Park East",
};

const BUILDING_IDS: TowerWarsBuildingId[] = ["opus_la", "century_park_east"];

/** Intensity band for a day's stratum. Shape carries it; opacity reinforces. */
export function intensityClass(incomingAttacks: number): string {
  if (incomingAttacks >= 4) return "cr-stratum--critical";
  if (incomingAttacks === 3) return "cr-stratum--heavy";
  if (incomingAttacks === 2) return "cr-stratum--cracked";
  return "cr-stratum--chipped";
}

export function shortDate(businessDate: string): string {
  const [, month, day] = businessDate.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function FacadeRecord({
  building,
  showCounts,
}: {
  building: BuildingSettlement;
  showCounts: boolean;
}) {
  const name = NAMES[building.buildingId];
  // Oldest at the bottom: the record is read like rock, not like a feed.
  const strata = useMemo(
    () => [...building.strata].reverse(),
    [building.strata]
  );
  const today = building.today;

  return (
    <article className="cr-facade" aria-label={`${name} facade record`}>
      <header className="cr-facade-head">
        <h3>{name}</h3>
        <p className="cr-facade-sub">
          {building.strata.length === 0
            ? "No settled history yet"
            : `${building.strata.length} settled ${
                building.strata.length === 1 ? "day" : "days"
              } of record`}
        </p>
      </header>

      {/* Today — a live match, held apart from the finished stone below. */}
      <div
        className={`cr-today-band cr-today-band--${today.damage}`}
        aria-label={`Today, ${today.incomingAttacks} incoming ${
          today.incomingAttacks === 1 ? "strike" : "strikes"
        }, ${today.damage.replace("-", " ")}`}
      >
        <span className="cr-today-label">Today</span>
        <span className="cr-today-marks" aria-hidden="true">
          {today.incomingAttacks === 0 ? (
            <span className="cr-today-intact">untouched</span>
          ) : (
            Array.from({ length: Math.min(today.incomingAttacks, 8) }).map(
              (_, index) => <i key={index} className="cr-strike" />
            )
          )}
        </span>
        {today.unspentValueCents > 0 ? (
          <span className="cr-today-charge">
            {money(today.unspentValueCents)} toward the next strike
          </span>
        ) : null}
      </div>

      <div className="cr-settled-rule" role="presentation">
        <span>settled</span>
      </div>

      {strata.length === 0 ? (
        <p className="cr-facade-empty">
          Nothing has settled into this facade yet. Completed days appear here
          permanently.
        </p>
      ) : (
        <ol className="cr-strata" aria-label={`${name} settled strata`}>
          {strata.map(stratum => (
            <li
              key={stratum.businessDate}
              className={`cr-stratum ${intensityClass(stratum.incomingAttacks)}`}
            >
              <span className="cr-stratum-date">
                {shortDate(stratum.businessDate)}
              </span>
              <span className="cr-stratum-marks" aria-hidden="true">
                {Array.from({
                  length: Math.min(stratum.incomingAttacks, 8),
                }).map((_, index) => (
                  <i key={index} className="cr-scar" />
                ))}
              </span>
              <span className="cr-stratum-reading">
                {showCounts
                  ? `${stratum.incomingAttacks} absorbed · ${stratum.damageAtSettlement.replace("-", " ")}`
                  : stratum.damageAtSettlement.replace("-", " ")}
              </span>
            </li>
          ))}
        </ol>
      )}

      <footer className="cr-facade-foot">
        <span>
          {building.settledScars} absorbed across the record
        </span>
        <span aria-label={`Lifetime revenue ${money(building.lifetime.revenueCents)} across ${building.lifetime.orderCount} orders`}>
          {money(building.lifetime.revenueCents)} · {building.lifetime.orderCount}{" "}
          {building.lifetime.orderCount === 1 ? "order" : "orders"}
        </span>
      </footer>
    </article>
  );
}

export function BuildingStrata() {
  const [showCounts, setShowCounts] = useState(false);
  const query = trpc.system.towerWars.settlement.useQuery(undefined, {
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return (
      <section className="cr-strata-panel" aria-busy="true">
        <p className="cr-facade-empty">Reading the facades…</p>
      </section>
    );
  }

  if (query.error) {
    return (
      <section className="cr-strata-panel">
        <p className="cr-facade-empty">
          The facade record could not be read. Retry, or check the Tower Wars
          feed.
        </p>
      </section>
    );
  }

  const data = query.data;
  if (!data) return null;

  return (
    <section className="cr-strata-panel" aria-label="Facade records">
      <header className="cr-strata-head">
        <div>
          <h2>The record</h2>
          <p>
            Today&rsquo;s match sits above the line. Everything below it is
            finished and permanent.
          </p>
        </div>
        <button
          type="button"
          className="cr-strata-toggle"
          aria-pressed={showCounts}
          onClick={() => setShowCounts(value => !value)}
        >
          {showCounts ? "Hide the math" : "Show me the math"}
        </button>
      </header>

      {!data.evidenceSufficient ? (
        <p className="cr-facade-warning">
          Evidence is incomplete — this record is not authoritative right now.
        </p>
      ) : null}

      <div className="cr-facade-grid">
        {BUILDING_IDS.map(buildingId => (
          <FacadeRecord
            key={buildingId}
            building={data.settlement.buildings[buildingId]}
            showCounts={showCounts}
          />
        ))}
      </div>
    </section>
  );
}
