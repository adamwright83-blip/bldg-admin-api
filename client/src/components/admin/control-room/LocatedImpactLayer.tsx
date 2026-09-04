import type { TowerImpact } from "@shared/towerWarsImpacts";

/** Same art space and bottom anchoring as the canonical facade plate. */
export function LocatedImpactLayer({ impacts }: { impacts: readonly TowerImpact[] }) {
  if (!impacts.length) return null;
  return <svg className="tw-scar-layer" viewBox="0 0 800 1200" preserveAspectRatio="xMidYMax meet" role="img" aria-label={`${impacts.length} permanent located impacts`}>
    {impacts.map(impact => <g key={impact.attackId} data-impact-id={impact.attackId} data-repair-state={impact.repairState} transform={`translate(${impact.impactX * 8} ${impact.impactY * 12})`}>
      <title>{`${impact.woundType} · ${impact.occurredAt} · ${impact.repairState}`}</title>
      {impact.repairState === "repaired" ? <g fill={impact.defenderBuildingId === "opus_la" ? "#8e79ae" : "#b8ad94"} stroke="#e0cfa1" strokeWidth="2">
        <rect x="-20" y="-24" width="40" height="48" />
        <path d="M-20 0H20M0-24V24" fill="none" stroke="#716654" />
      </g> : <g fill={impact.woundType === "scorch" ? "#282126" : "#120e1e"} stroke={impact.defenderBuildingId === "opus_la" ? "#b997e1" : "#d3c7ae"} strokeWidth="2">
        <path d="M-22-8L-10-23L2-14L18-20L15-3L24 8L8 12L-3 25L-10 11L-25 16L-17 1Z" />
        <path d="M-28-28L-10-12M22-30L9-12M29 25L12 10M-27 29L-12 11" fill="none" />
      </g>}
    </g>)}
  </svg>;
}
