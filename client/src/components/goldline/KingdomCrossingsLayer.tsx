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
    {/*
      THE INVENTED WATERWAYS ARE GONE, AND MUST NOT COME BACK.

      This layer used to draw a three-stroke blue river with a bridge glyph for
      every crossing, over a map of real Los Angeles. Two things were wrong with
      it. It invented geography — canals and bridges that do not exist, laid
      across streets that do — and the actual geographic layer is authoritative,
      so nothing here is allowed to add a waterway to it. And visually it was
      the loudest thing on the screen: thick straight strokes with a repeating
      node stamped along them, which is what a debug polyline looks like.

      The crossing itself is a real game object with real state and is kept in
      full: same anchors, same territory-derived state, same inspector. Only its
      PRESENTATION changed. It is now a thin dashed thread between two real
      neighbourhood anchors plus a small angular gate — legible as a link
      between two places, which is what it is, and impossible to mistake for a
      river, a road or a bridge, which is what it is not.
    */}
    <svg className="gl-kingdom-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden focusable="false">
      {crossings.map(c => <line key={c.id} className={`is-${c.state.toLowerCase()}`}
        x1={c.riverStart.x} y1={c.riverStart.y} x2={c.riverEnd.x} y2={c.riverEnd.y}
        vectorEffect="non-scaling-stroke" />)}
    </svg>
    {crossings.map(c => <button type="button" key={c.id} className={`gl-kingdom-crossing is-${c.state.toLowerCase()}`} style={{ left: `${c.x}%`, top: `${c.y}%` }}
      aria-label={`${c.from} to ${c.to}: ${c.state.toLowerCase()} fictional crossing`} onClick={() => setSelected(c.id)} data-crossing-id={c.id} data-crossing-state={c.state}><i aria-hidden /></button>)}
    {current ? <aside className="gl-crossing-inspector" role="status"><button type="button" onClick={() => setSelected(null)} aria-label="Close crossing">×</button><strong>{current.from} ↔ {current.to}</strong><p>{current.state === "OPEN" ? "Crossing open — territory game clearance is recorded." : current.state === "AVAILABLE" ? "Known territory. Guardian gameplay clearance is still required." : "Unbuilt crossing. Legitimate territory evidence must establish access first."}</p><small>Fantasy geography. Inspecting this bridge records no visit or business evidence.</small></aside> : null}
  </>;
}
