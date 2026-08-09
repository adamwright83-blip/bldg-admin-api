import { Building2, CircleDollarSign, Factory, House, MapPinned, TriangleAlert } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

function dollars(cents: number | null | undefined) { return cents == null ? "Unknown" : new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(cents/100); }

export default function WorldView() {
  const [,navigate] = useLocation();
  const world = trpc.system.businessWorld.get.useQuery();
  if (world.isLoading) return <section className="cc-world"><div className="cc-empty">Projecting your real business world…</div></section>;
  if (!world.data) return <section className="cc-world"><div className="cc-empty">{world.error?.message ?? "WORLD unavailable"}</div></section>;
  const data = world.data;
  const resolved = [data.hq,...data.properties,...data.commercialAssets,...data.territorySignals].filter(point=>point.geoStatus==="resolved"&&point.latitude!=null&&point.longitude!=null);
  const unresolved = [...data.properties,...data.commercialAssets].filter(point=>point.geoStatus==="unresolved");
  const lats=resolved.map(point=>point.latitude!), lngs=resolved.map(point=>point.longitude!);
  const minLat=Math.min(...lats,0), maxLat=Math.max(...lats,0), minLng=Math.min(...lngs,0), maxLng=Math.max(...lngs,0);
  const position=(lat:number,lng:number)=>({left:`${10+((lng-minLng)/Math.max(.0001,maxLng-minLng))*80}%`,top:`${86-((lat-minLat)/Math.max(.0001,maxLat-minLat))*72}%`});
  return <section className="cc-world">
    <header className="cc-world-head"><div className="cc-world-heading"><p className="cc-eyebrow">HQ · Persistent world</p><h1>{data.business.brandName}</h1><span className="cc-badge">{data.business.stage.replace(/_/g," ")}</span></div>
      <div className="cc-stat"><small>Collected revenue</small><b>{dollars(data.financialSummary.collectedRevenue.value)}</b></div>
      <div className="cc-stat"><small>Receivables</small><b>{dollars(data.financialSummary.receivables.value)}</b></div>
      <div className="cc-stat"><small>At-risk signals</small><b>{data.openThreats.length}</b></div>
    </header>
    <div className="cc-world-layout"><div className="cc-map" aria-label="Verified geographic business world">
      {resolved.map(point=>{const Icon=point.kind==="hq"?Factory:point.kind==="customer"?House:point.kind==="commercial"?Building2:MapPinned;return <button type="button" className={`cc-map-point ${point.kind}`} key={point.id} style={position(point.latitude!,point.longitude!)} onClick={()=>point.detailPath&&navigate(point.detailPath)}><Icon size={21}/><span>{point.name}</span></button>})}
      {!resolved.length?<div className="cc-empty">No verified coordinates yet. Records remain visible below without fabricated map placement.</div>:null}
    </div><aside className="cc-world-rail">
      <section className="cc-rail-card"><h2><TriangleAlert size={16}/> Open threats</h2><div className="cc-rail-list">{data.openThreats.length?data.openThreats.slice(0,6).map(threat=><span className="cc-rail-row" key={threat.id}>{threat.title}<small style={{display:"block",color:"#7b8995",marginTop:3}}>{threat.sourceReference}</small></span>):<span className="cc-data-note">No sourced threats.</span>}</div></section>
      <section className="cc-rail-card"><h2><CircleDollarSign size={16}/> Recent changes</h2><div className="cc-rail-list">{data.recentChanges.slice(0,6).map(change=><span className="cc-rail-row" key={change.id}>{change.title}<small style={{display:"block",color:"#7b8995",marginTop:3}}>{new Date(change.occurredAt).toLocaleString()} · {change.verificationClass}</small></span>)}</div></section>
    </aside></div>
    {unresolved.length?<section className="cc-rail-card cc-unresolved"><h2>Known records without coordinates</h2><p className="cc-data-note">These are real customer/account records. They are deliberately not placed on the map until coordinates are verified.</p><div className="cc-unresolved-list">{unresolved.map(point=><button className="cc-button" key={point.id} onClick={()=>point.detailPath&&navigate(point.detailPath)}>{point.name}</button>)}</div></section>:null}
    <div className="cc-quality">Data quality: {data.dataQuality.status}. {data.dataQuality.warnings.join(" · ")}</div>
  </section>;
}
