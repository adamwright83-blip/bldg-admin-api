/**
 * The seam, on screen — as TWO independent axes, never one verdict.
 *
 * Commercial access says how far into the account you have got. Resident
 * territory says whether the finite population is in play. A building can sit
 * at "Sealed" commercially while its resident board is already active, because
 * those residents predate any mission; Century Park East is exactly that.
 * Labelling the whole building "Sealed" there would be false.
 *
 * The account_won -> board opens transformation is rendered as a real event
 * only where `access === "commercial_win"`. Where residents predate the
 * mission, nothing here claims a win opened anything.
 */
import { useMemo } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import { trpc } from "@/lib/trpc";
import {
  commercialAccessCopy,
  commercialAccessFor,
  projectOccupancyField,
  projectSiegeLadder,
  residentTerritoryCopy,
  residentTerritoryFor,
  winOpenedTheBoard,
  type CommercialAccess,
  type OccupancyField,
  type ResidentTerritory,
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
        aria-label={`${buildingName} aggregate capacity: ${
          field.paidResidents
        } units paying, ${
          field.signupsOnly
        } signed up but not paying, ${
          field.unclaimed
        } not yet a customer, of ${
          field.totalUnits
        } rentable units. Positions do not identify individual apartments${
          field.denominatorVerified
            ? ""
            : "; the unit count is not verified, treat every share as provisional"
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
            <i className="cb-cell is-signup" aria-hidden="true" /> Signed up,
            not paying
          </dt>
          <dd>{field.signupsOnly}</dd>
        </div>
        <div>
          <dt>
            <i className="cb-cell is-unclaimed" aria-hidden="true" /> Not yet a
            customer
          </dt>
          <dd>{field.unclaimed}</dd>
        </div>
      </dl>

      <p className="cb-enrolled">
        {field.paidResidents} paying + {field.signupsOnly} signup-only ={" "}
        <strong>{field.totalEnrolled} enrolled</strong>
      </p>

      <p className="cb-field-note">
        {field.denominatorVerified ? (
          <>
            Each mark represents one unit of aggregate building capacity across{" "}
            {field.totalUnits} rentable units. The coloured position does not
            identify which apartment or customer is paying or signed up — only
            the counts are authoritative.
          </>
        ) : (
          <>
            <strong>Provisional.</strong> {field.totalUnits} units is a
            placeholder that has not been verified, so every share above is an
            estimate rather than a count. Positions still do not identify
            individual apartments.
          </>
        )}
      </p>
    </div>
  );
}

function AxisChip({
  kind,
  state,
  label,
}: {
  kind: "commercial" | "resident";
  state: CommercialAccess | ResidentTerritory;
  label: string;
}) {
  return (
    <span className={`cb-axis-chip is-${kind} is-${state}`}>{label}</span>
  );
}

function BuildingCard({ view }: { view: BuildingView }) {
  const { building } = view;
  const name = building.identity.displayName;

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

  const access = commercialAccessFor(building.siege?.depth ?? null);
  const territory = residentTerritoryFor({
    hasField: field !== null,
    access: building.penetration?.access ?? null,
  });
  const accessCopy = commercialAccessCopy(access);
  const territoryCopy = residentTerritoryCopy(territory);

  return (
    <article className={`cb-building is-access-${access}`} aria-label={name}>
      <header className="cb-building-head">
        <h3>{name}</h3>
        <div className="cb-axes">
          <div className="cb-axis">
            <span className="cb-axis-title">Commercial access</span>
            <AxisChip kind="commercial" state={access} label={accessCopy.label} />
          </div>
          <div className="cb-axis">
            <span className="cb-axis-title">Resident territory</span>
            <AxisChip
              kind="resident"
              state={territory}
              label={territoryCopy.label}
            />
          </div>
        </div>
      </header>

      <div className="cb-body">
        <section className="cb-way-in" aria-label={`Commercial access at ${name}`}>
          <h4>Commercial access</h4>
          <p className="cb-axis-detail">{accessCopy.detail}</p>
          {building.siege ? (
            <SiegeLadder rungs={rungs} />
          ) : (
            <p className="cb-note">
              No commercial mission targets this building, so there is no
              approach to show.
            </p>
          )}
          {view.firstBroken ? (
            <p className="cb-blocked">
              Waiting on{" "}
              <strong>{view.firstBroken.stage.replace(/_/g, " ")}</strong>
              {view.firstBroken.evidence
                ? ` — ${view.firstBroken.evidence}`
                : null}
            </p>
          ) : (
            <p className="cb-complete">
              Traced end to end: prospect through to permanent history.
            </p>
          )}
        </section>

        <section
          className="cb-inside"
          aria-label={`Resident territory at ${name}`}
        >
          <h4>Resident territory</h4>
          <p className="cb-axis-detail">{territoryCopy.detail}</p>
          {field ? (
            <>
              {winOpenedTheBoard(territory) && field.totalEnrolled === 0 ? (
                <p className="cb-note">
                  The board is open and nobody inside is yours yet.
                </p>
              ) : null}
              <OccupancyGrid field={field} buildingName={name} />
            </>
          ) : null}
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
        <h2>Commercial access and resident territory</h2>
        <p>
          Two independent truths per building. Winning an account opens the
          resident board — but a board can also already be open because its
          residents predate any mission.
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
