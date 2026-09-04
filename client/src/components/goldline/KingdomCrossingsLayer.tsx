import { useMemo, useState } from "react";
import { GOLDLINE_LA_LANDMARKS, projectLatLngToLanternAtlas } from "@shared/lanternCity";
import { strategicCrossings } from "@shared/goldlineCrossings";
import type { PresentedTerritory } from "@shared/goldlineTerritories";
import type { CityWorldEntity } from "../../../../server/goldlineWorld/cityWorldService";

export function KingdomCrossingsLayer({ territories, entities }: { territories: readonly PresentedTerritory[]; entities: readonly CityWorldEntity[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const crossings = useMemo(() => {
    const anchors = GOLDLINE_LA_LANDMARKS.map(landmark => ({ id: landmark.name, ...projectLatLngToLanternAtlas(landmark), evidenceKnown: false, guardianCleared: false }));
    for (const territory of territories) {
      // Bind this GAME territory to its nearest geographic anchor. This does
      // not assert municipal membership or a real-world visit.
      const members = territory.definition.members.flatMap(member => {
        const location = entities.find(e => e.id === member.physicalEntityId)?.location;
        return typeof location?.latitude === "number" && typeof location.longitude === "number" ? [projectLatLngToLanternAtlas({ latitude: location.latitude, longitude: location.longitude })] : [];
      });
      if (!members.length) continue;
      const x = members.reduce((sum, p) => sum + p.x, 0) / members.length;
      const y = members.reduce((sum, p) => sum + p.y, 0) / members.length;
      const anchor = [...anchors].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) || a.id.localeCompare(b.id))[0];
      if (anchor) { anchor.evidenceKnown ||= territory.state.completedMemberIds.length > 0; anchor.guardianCleared ||= territory.state.cleared; }
    }
    return strategicCrossings(anchors);
  }, [territories, entities]);
  const current = crossings.find(c => c.id === selected);
  return <>
    <svg className="gl-kingdom-waterways" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Fictional kingdom waterways and strategic crossings">
      <defs><linearGradient id="kingdom-water" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#084c94"/><stop offset=".5" stopColor="#077eae"/><stop offset="1" stopColor="#163e80"/></linearGradient></defs>
      {crossings.map(c => <g key={c.id}>
        <path d={`M${c.riverStart.x} ${c.riverStart.y} Q${c.x - 2} ${c.y + 2} ${c.riverEnd.x} ${c.riverEnd.y}`} fill="none" stroke="#f0ddac" strokeWidth="3" strokeLinejoin="round" />
        <path d={`M${c.riverStart.x} ${c.riverStart.y} Q${c.x - 2} ${c.y + 2} ${c.riverEnd.x} ${c.riverEnd.y}`} fill="none" stroke="url(#kingdom-water)" strokeWidth="2.3" />
        <path d={`M${c.riverStart.x} ${c.riverStart.y} Q${c.x - 2} ${c.y + 2} ${c.riverEnd.x} ${c.riverEnd.y}`} fill="none" stroke="#80dcf1" strokeWidth=".25" />
      </g>)}
    </svg>
    {crossings.map(c => <button type="button" key={c.id} className={`gl-kingdom-crossing is-${c.state.toLowerCase()}`} style={{ left: `${c.x}%`, top: `${c.y}%` }}
      aria-label={`${c.from} to ${c.to}: ${c.state.toLowerCase()} fictional crossing`} onClick={() => setSelected(c.id)} data-crossing-id={c.id} data-crossing-state={c.state}>╫</button>)}
    {current ? <aside className="gl-crossing-inspector" role="status"><button type="button" onClick={() => setSelected(null)} aria-label="Close crossing">×</button><strong>{current.from} ↔ {current.to}</strong><p>{current.state === "OPEN" ? "Crossing open — territory game clearance is recorded." : current.state === "AVAILABLE" ? "Known territory. Guardian gameplay clearance is still required." : "Unbuilt crossing. Legitimate territory evidence must establish access first."}</p><small>Fantasy geography. Inspecting this bridge records no visit or business evidence.</small></aside> : null}
  </>;
}
