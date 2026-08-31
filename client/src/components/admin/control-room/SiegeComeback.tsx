import { ArrowRight, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { TowerWarsBuildingId } from "@shared/towerWars";
import { projectSiegeLadder, projectOccupancyField } from "./canonicalBuildingView";
import { architecturalDepth } from "./worldDepth";
import { CanonicalBuildingArt } from "./CanonicalBuildingArt";

export function SiegeComeback({ buildingId, onClose, onContinue }: {
  buildingId: TowerWarsBuildingId;
  onClose: () => void;
  onContinue: (pipelineId: number) => void;
}) {
  const world = trpc.system.canonicalBuilding.world.useQuery(undefined, { staleTime: 60_000 });
  const view = world.data?.buildings.find(item => item.building.identity.canonicalId === buildingId);
  const depth = view?.building.siege?.depth ?? null;
  const architecture = architecturalDepth(depth);
  const rungs = projectSiegeLadder(depth);
  const next = rungs.find(rung => rung.isNext);
  const penetration = view?.building.penetration;
  const field = penetration ? projectOccupancyField({
    totalUnits: penetration.totalUnits,
    denominatorVerified: penetration.denominatorVerified,
    signups: penetration.signups,
    paidResidents: penetration.paidResidents,
  }) : null;

  return <section className={`tw-comeback is-${architecture.feature}`} aria-label="Engineer the comeback">
    <button className="tw-comeback-close" type="button" onClick={onClose} aria-label="Return to battle"><X /></button>
    <div className="tw-comeback-facade"><CanonicalBuildingArt buildingId={buildingId} showWeapon={false} /><div aria-hidden><i className="tw-depth-callbox"/><i className="tw-depth-doors"/><i className="tw-depth-elevator"/><i className="tw-depth-lights"/></div></div>
    <div className="tw-comeback-copy">
      <small>Weapon layers withdrawn · commercial access</small>
      <h2>{view?.building.identity.displayName ?? (buildingId === "opus_la" ? "OPUS LA" : "Century Park East")}</h2>
      <strong>{architecture.label}</strong>
      <p>{architecture.consequence}</p>
      {world.isLoading ? <em>Holding the architecture while evidence resolves…</em> : null}
      {world.isError || !world.data?.evidenceSufficient ? <em>Confidence reduced. No progress is claimed until the commercial feed is authoritative.</em> : null}
      {next ? <div className="tw-next-rung"><span>Lowest unreached rung</span><b>{next.label}</b><p>{next.reachedBy}</p></div> : <div className="tw-next-rung"><span>Commercial axis</span><b>{depth === "held" ? "Held" : "No verified route"}</b></div>}
      {field ? <p className="tw-territory-truth">Resident territory: {field.paidResidents} paying and {field.signupsOnly} signup-only across {field.totalUnits} aggregate-capacity cells. No cell identifies an apartment.</p> : null}
      <button type="button" disabled={!view?.pipelineId} onClick={() => view?.pipelineId && onContinue(view.pipelineId)}>{view?.pipelineId ? "Continue inside the business work" : "No authoritative business route"} <ArrowRight /></button>
    </div>
  </section>;
}
