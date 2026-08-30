/**
 * The seam, on screen: a sealed structure you are working into, and — once
 * won — an open one whose finite resident population becomes the next board.
 *
 * The transition is the point. Winning the account does not complete a bar or
 * retire the building; it changes what game the building is in. Under siege
 * the structure is drawn shut with its rungs, and the lowest sealed rung is
 * the next action. Held, the doors open and every real rentable unit appears.
 */
import { useMemo } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import { trpc } from "@/lib/trpc";
import {
  isHeld,
  phaseHeadline,
  projectOccupancyField,
  projectSiegeLadder,
  type BuildingPhase,
  type OccupancyField,
  type SiegeRung,
} from "./canonicalBuildingView";

type WorldData =
  inferRouterOutputs<AppRouter>["system"]["canonicalBuilding"]["world"];
type BuildingView = WorldData["buildings"][number];

function SiegeLadder({ rungs }: { rungs: SiegeRung[] }) {
  // Highest rung at the top: you climb into a building, not down it.
  const ordered = useMemo(() => [...rungs].reverse(), [rungs]);
  return (
    <ol className="cb-ladder" aria-label="Way in">
      {ordered.map(rung => (
        <li
          key={rung.depth}
          className={[
            "cb-rung",
            rung.reached ? "is-open" : "is-sealed",
            rung.isCurrent ? "is-current" : "",
            rung.isNext ? "is-next" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-current={rung.isCurrent ? "step" : undefined}
        >
          <span className="cb-rung-mark" aria-hidden="true" />
          <span className="cb-rung-body">
            <span className="cb-rung-label">{rung.label}</span>
            {rung.isNext ? (
              <span className="cb-rung-next">{rung.reachedBy}</span>
            ) : null}
          </span>
          <span className="cb-rung-state">
            {rung.reached ? "open" : rung.isNext ? "next" : "sealed"}
          </span>
        </li>
      ))}
    </ol>
  );
}

function OccupancyGrid({
  field,
  buildingName,
}: {
  field: OccupancyField;
  buildingName: string;
}) {
  return (
    <div className="cb-occupancy">
      <div
        className={`cb-field ${
          field.denominatorVerified ? "is-verified" : "is-provisional"
        }`}
        style={{ ["--cb-cols" as string]: String(field.columns) }}
        role="img"
        aria-label={`${buildingName}: ${field.paidResidents} paying and ${
          field.signupsOnly
        } signed up, of ${field.totalUnits} rentable units${
          field.denominatorVerified
            ? ""
            : " — unit count not yet verified, treat as provisional"
        }`}
      >
        {field.cells.map((cell, index) => (
          <i key={index} className={`cb-cell is-${cell}`} />
        ))}
      </div>

      <dl className="cb-legend">
        <div>
          <dt>
            <i className="cb-cell is-paid" aria-hidden="true" /> Paying
          </dt>
          <dd>{field.paidResidents}</dd>
        </div>
        <div>
          <dt>
            <i className="cb-cell is-signup" aria-hidden="true" /> Signed up
          </dt>
          <dd>{field.signupsOnly}</dd>
        </div>
        <div>
          <dt>
            <i className="cb-cell is-unclaimed" aria-hidden="true" /> Not yours
          </dt>
          <dd>{field.unclaimed}</dd>
        </div>
      </dl>

      <p className="cb-field-note">
        {field.denominatorVerified ? (
          <>
            {field.totalUnits} rentable units. Each mark is one unit, but the
            arrangement is not a floor plan — the data holds counts, not
            individual apartments.
          </>
        ) : (
          <>
            <strong>Provisional.</strong> {field.totalUnits} units is a
            placeholder that has not been verified, so every share above is an
            estimate rather than a count.
          </>
        )}
      </p>
    </div>
  );
}

function BuildingCard({ view }: { view: BuildingView }) {
  const { building } = view;
  const phase = building.phase as BuildingPhase;
  const rungs = useMemo(
    () => projectSiegeLadder(building.siege?.depth ?? null),
    [building.siege?.depth]
  );
  const field = useMemo(
    () =>
      projectOccupancyField(
        building.penetration
          ? {
              totalUnits: building.penetration.totalUnits,
              denominatorVerified: building.penetration.denominatorVerified,
              signups: building.penetration.signups,
              paidResidents: building.penetration.paidResidents,
            }
          : null
      ),
    [building.penetration]
  );

  const held = isHeld(phase);
  const name = building.identity.displayName;

  return (
    <article className={`cb-building is-${phase}`} aria-label={name}>
      <header className="cb-building-head">
        <div>
          <h3>{name}</h3>
          <p className="cb-phase">{phaseHeadline(phase)}</p>
        </div>
        <span className={`cb-phase-chip is-${held ? "open" : "sealed"}`}>
          {held ? "Doors open" : "Sealed"}
        </span>
      </header>

      <div className="cb-body">
        <section className="cb-way-in" aria-label={`Way into ${name}`}>
          <h4>Getting in</h4>
          {building.siege ? (
            <SiegeLadder rungs={rungs} />
          ) : (
            <p className="cb-note">
              No commercial mission targets this building, so there is no
              approach to show. Its residents predate any account.
            </p>
          )}
          {view.firstBroken ? (
            <p className="cb-blocked">
              Waiting on <strong>{view.firstBroken.stage.replace(/_/g, " ")}</strong>
              {view.firstBroken.evidence ? ` — ${view.firstBroken.evidence}` : null}
            </p>
          ) : (
            <p className="cb-complete">
              Traced end to end: prospect through to permanent history.
            </p>
          )}
        </section>

        <section className="cb-inside" aria-label={`Inside ${name}`}>
          <h4>Inside</h4>
          {field ? (
            <>
              {phase === "held_unpenetrated" ? (
                <p className="cb-note">
                  The account is won and the doors are open. That is the start
                  of the resident game, not the end of anything.
                </p>
              ) : null}
              <OccupancyGrid field={field} buildingName={name} />
              {building.penetration?.access === "preexisting_residents" ? (
                <p className="cb-note cb-access">
                  These residents predate any commercial win here, so nothing
                  claims a mission opened this door.
                </p>
              ) : null}
            </>
          ) : (
            <p className="cb-note">
              No resident unit data for this building yet, so there is no
              population to show.
            </p>
          )}
        </section>
      </div>
    </article>
  );
}

export function CanonicalBuildingSeam() {
  const query = trpc.system.canonicalBuilding.world.useQuery(undefined, {
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return (
      <section className="cb-panel" aria-busy="true">
        <p className="cb-note">Reading the buildings…</p>
      </section>
    );
  }

  if (query.error || !query.data) {
    return (
      <section className="cb-panel">
        <p className="cb-note">
          The buildings could not be read. Retry, or check the commercial
          pipeline feed.
        </p>
      </section>
    );
  }

  const { buildings, evidenceSufficient, registryDisagreements } = query.data;

  return (
    <section className="cb-panel" aria-label="Buildings">
      <header className="cb-panel-head">
        <h2>Getting in, then getting inside</h2>
        <p>
          Winning a building does not finish it. It changes the game from an
          approach into a finite resident population.
        </p>
      </header>

      {!evidenceSufficient ? (
        <p className="cb-warning">
          Evidence is incomplete — treat these buildings as not authoritative
          right now.
        </p>
      ) : null}

      {registryDisagreements.length > 0 ? (
        <p className="cb-warning">
          {registryDisagreements.length} address
          {registryDisagreements.length === 1 ? "" : "es"} resolve in only one
          registry. Orders at those addresses drop out of penetration counts
          until it is reconciled.
        </p>
      ) : null}

      <div className="cb-grid">
        {buildings.map(view => (
          <BuildingCard key={view.building.identity.canonicalId} view={view} />
        ))}
      </div>
    </section>
  );
}
