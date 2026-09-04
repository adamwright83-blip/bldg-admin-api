import type { LocalTopology } from "@shared/goldlineOnboarding";
import { composeWaterLand, knownTerritoryIds } from "@shared/goldlineLocalWorld";
const art="/assets/goldline/procedural-world-v1/";
export function LocalWorld({topology,observedAnchorIds=[]}:{topology:LocalTopology;observedAnchorIds?:string[]}){
 const world=composeWaterLand(topology),known=new Set(knownTerritoryIds(topology,observedAnchorIds));
 return <svg role="img" aria-label={`${topology.label}, ${topology.territories.length} projected territories, ${known.size} known`} viewBox={`0 0 ${world.width} ${world.height}`} className="gl-local-world" data-classification="game_projection">
 <title>Strategic fantasy projection; illustrated buildings are scenery, not customer holdings.</title>
 {world.bridges.map(b=>{const t=b.transform;return <image key={b.id} href={art+b.file} width="768" height="512" transform={`matrix(${t.a} ${t.b} ${t.c} ${t.d} ${t.e} ${t.f})`} />;})}
 {world.islands.map(i=><g key={i.id} transform={`translate(${i.x} ${i.y}) scale(${i.scale})`}>
  <image href={art+"07-coastline-glow-overlay.png"} width="1024" height="768" opacity={known.has(i.id)?1:.35}/>
  <image href={art+"02-territory-island-generic.png"} width="1024" height="768" opacity={known.has(i.id)?1:.48}/>
  {!known.has(i.id)&&<image href={art+"08-cloud-fog-overlay.png"} width="1024" height="512" y="170" opacity=".65"/>}
  <rect x="40" y="652" width="944" height="94" rx="14" fill="#031726" opacity=".93"/>
  <text x="512" y="694" textAnchor="middle" fill="#fff1bb" fontFamily="system-ui" fontSize="33">{i.label.length>46?i.label.slice(0,43)+"…":i.label}</text>
  <text x="512" y="728" textAnchor="middle" fill="#add5d0" fontFamily="system-ui" fontSize="24">{known.has(i.id)?"EVIDENCE RECORDED":"UNMAPPED"}</text>
 </g>)}
 </svg>;
}
