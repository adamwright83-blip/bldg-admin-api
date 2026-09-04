import type { LocalTopology, WorldAnchor, WorldSkin } from "./goldlineOnboarding";
import { stableHash } from "./goldlineTerritories";
export const WATER_LAND: WorldSkin = { id:"WATER_LAND", supportedModes:["LOCAL_PHYSICAL"], tags:{climate:["generic"],foliage:["lush"],density:["urban"],architecture:["goldline"],terrain:["island"]} };
export const WORLD_SKINS: Record<string,WorldSkin> = { WATER_LAND };
/** No skin, transform, invented customer, or authoritative boundary enters topology. */
export function compileLocalWorld(input: {tenantId:string; label:string; anchors:WorldAnchor[]; extentKm?:number}): LocalTopology {
 const anchors=[...input.anchors].sort((a,b)=>a.id.localeCompare(b.id));
 const geographicExtent = anchors.length > 1 ? Math.max(...anchors.map(a=>Math.hypot((a.latitude-anchors[0].latitude)*111,(a.longitude-anchors[0].longitude)*111*Math.cos(a.latitude*Math.PI/180)))) : 0;
 const extent=Math.max(input.extentKm ?? 0,geographicExtent);
 const count=Math.max(1,Math.min(9,Math.max(Math.ceil(extent/8),Math.ceil(anchors.length/3))));
 const key=`local-${stableHash(JSON.stringify([input.tenantId,input.label,anchors.map(a=>[a.id,a.latitude,a.longitude]),count])).toString(36)}`;
 const territories=Array.from({length:count},(_,i)=>({id:`${key}-${i}`,label:count===1?input.label:`${input.label} · Reach ${i+1}`,anchorIds:[] as string[]}));
 anchors.forEach((a,i)=>territories[i%count].anchorIds.push(a.id));
 const side=Math.ceil(Math.sqrt(count));
 const adjacency:[string,string][]=[];
 territories.forEach((t,i)=>{if(i%side<side-1&&i+1<count)adjacency.push([t.id,territories[i+1].id]);if(i+side<count)adjacency.push([t.id,territories[i+side].id]);});
 return {id:key,revision:1,mode:"LOCAL_PHYSICAL",label:input.label,classification:"game_projection",territories,adjacency,anchors};
}
export function knownTerritoryIds(topology:LocalTopology, observedAnchorIds:readonly string[] = []) {
 const known=new Set([...topology.anchors.filter(a=>a.evidenceId && a.provenance!=="geocoded_declaration").map(a=>a.id),...observedAnchorIds]);
 return topology.territories.filter(t=>t.anchorIds.some(id=>known.has(id))).map(t=>t.id);
}
export type Point={x:number;y:number};
/** Asset coordinates measured against visible shoreline, not the transparent canvas extremities. */
export const ISLAND_SOCKETS={NE:{x:735,y:294},SE:{x:741,y:474},SW:{x:291,y:478},NW:{x:280,y:288}};
export const BRIDGE_GEOMETRIES={
 NE_SW:{file:"03-bridge-ne-sw.png",start:{x:133,y:365},end:{x:606,y:174},derivative:"04-bridge-sw-ne.png",derivativeRotation:180},
 NW_SE:{file:"05-bridge-nw-se.png",start:{x:138,y:165},end:{x:635,y:370},derivative:"06-bridge-se-nw.png",derivativeRotation:180},
};
/** Similarity transform maps BOTH measured deck sockets exactly. */
export function snapBridge(start:Point,end:Point,from:Point,to:Point){
 const ux=end.x-start.x,uy=end.y-start.y,vx=to.x-from.x,vy=to.y-from.y,den=ux*ux+uy*uy;
 const a=(vx*ux+vy*uy)/den,b=(vy*ux-vx*uy)/den;
 return {a,b,c:-b,d:a,e:from.x-a*start.x+b*start.y,f:from.y-b*start.x-a*start.y};
}
export function composeWaterLand(topology:LocalTopology){
 const side=Math.ceil(Math.sqrt(topology.territories.length));const scale=.31;
 const islands=topology.territories.map((t,i)=>{const col=i%side,row=Math.floor(i/side);return {id:t.id,label:t.label,x:80+(col-row+side-1)*235,y:20+(col+row)*130,scale};});
 const byId=new Map(islands.map(t=>[t.id,t]));
 const socket=(t:typeof islands[number],p:Point)=>({x:t.x+p.x*scale,y:t.y+p.y*scale});
 const bridges=topology.adjacency.map(([a,b])=>{const first=byId.get(a)!,last=byId.get(b)!;const right=last.x>first.x;const geometry=right?BRIDGE_GEOMETRIES.NW_SE:BRIDGE_GEOMETRIES.NE_SW;
 const from=socket(first,right?ISLAND_SOCKETS.SE:ISLAND_SOCKETS.SW),to=socket(last,right?ISLAND_SOCKETS.NW:ISLAND_SOCKETS.NE);
 const transform=right?snapBridge(geometry.start,geometry.end,from,to):snapBridge(geometry.start,geometry.end,to,from);
 return {id:`${a}:${b}`,file:geometry.file,transform,from,to};});
 return {islands,bridges,width:Math.max(...islands.map(i=>i.x+1024*scale))+80,height:Math.max(...islands.map(i=>i.y+768*scale))+65};
}
