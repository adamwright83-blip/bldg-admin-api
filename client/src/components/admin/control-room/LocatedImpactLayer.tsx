import type { TowerImpact } from "@shared/towerWarsImpacts";

/** Same art space and bottom anchoring as the canonical facade plate. */
export function LocatedImpactLayer({ impacts }: { impacts: readonly TowerImpact[] }) {
  if (!impacts.length) return null;
  return <svg className="tw-scar-layer" viewBox="0 0 800 1200" preserveAspectRatio="xMidYMax meet" role="img" aria-label={`${impacts.length} permanent located impacts`}>
    {impacts.map(impact => <g key={impact.attackId} data-impact-id={impact.attackId} data-repair-state={impact.repairState} transform={`translate(${impact.impactX * 8} ${impact.impactY * 12})`}>
      <title>{`${impact.woundType} · ${impact.occurredAt} · ${impact.repairState}`}</title>
      {impact.repairState === "repaired" ? <g fill={impact.defenderBuildingId === "opus_la" ? "#8e79ae" : "#b8ad94"} stroke="#e0cfa1" strokeWidth="2">
        <rect x="-20" y="-24" width="40" height="48" />
        <path d={impact.woundType === "cavity" ? "M-4-24V24M4-24V24" : impact.woundType === "fracture" ? "M-20 0H20M0-24V24" : "M-20-8H20M-20 10H20M-6-24V-8M8 10V24"} fill="none" stroke="#716654" />
      </g> : <g fill={impact.woundType === "scorch" ? "#282126" : "#120e1e"} stroke={impact.defenderBuildingId === "opus_la" ? "#b997e1" : "#d3c7ae"} strokeWidth="2">
        {impact.woundType === "scorch" ? <><ellipse rx="26" ry="29" fill="#282126" opacity=".65" stroke="none" /><ellipse rx="13" ry="17" fill="#0d0a10" stroke="#675047" /></> : impact.woundType === "chip" ? <path d="M-15-8L-4-17L13-8L18 9L2 15L-11 7ZM-24 16L-18 22L-25 25Z" /> : impact.woundType === "fracture" ? <path d="M-28-28L-8-8L0 0L22-30M0 0L29 25M0 0L-27 29M-8-8L-28 3M8-10L24-4M9 8L22 8M-10 10L-5 27" fill="none" strokeWidth="3" /> : <><path d="M-22-8L-10-23L2-14L18-20L15-3L24 8L8 12L-3 25L-10 11L-25 16L-17 1Z" /><path d="M-28-28L-10-12M22-30L9-12M29 25L12 10M-27 29L-12 11" fill="none" /></>}
      </g>}
    </g>)}
  </svg>;
}
