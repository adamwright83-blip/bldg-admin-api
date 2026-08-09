import { ArrowRight, Clock3, Coins, Gauge, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

function money(cents:number|null|undefined){return cents==null?"Unknown":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(cents/100)}

export default function GrowView(){
  const grow=trpc.system.grow.get.useQuery();
  const decide=trpc.system.grow.decide.useMutation();
  const utils=trpc.useUtils();
  return <section className="cc-vault"><p className="cc-eyebrow">HQ · Competing growth moves</p><h1 className="cc-section-title">Grow</h1><p className="cc-data-note">Ranked across commercial pipeline and customer recovery. Estimates stay estimates.</p>
    {grow.data?<div className="cc-vault-grid"><div className="cc-customer-card"><Clock3/><p>Owner growth time</p><h3>{grow.data.scarcity.ownerTimeMinutes.value??"Unknown"}</h3></div><div className="cc-customer-card"><Coins/><p>Safe growth spend</p><h3>{money(grow.data.scarcity.growthSpendCents.value)}</h3></div><div className="cc-customer-card"><Gauge/><p>Open capacity</p><h3>{grow.data.scarcity.openCapacityUnits.value??"Unknown"}</h3></div></div>:null}
    <section className="cc-panel" style={{marginTop:20}}><div className="cc-panel-head"><h2>Ranked moves</h2><span className="cc-badge">{grow.data?.moves.length??0} eligible</span></div>{grow.isLoading?<div className="cc-empty">Comparing real opportunities…</div>:grow.data?.moves.length?grow.data.moves.map(move=><article className="cc-move" key={move.id}><p className="cc-eyebrow">{move.moveType.replace(/_/g," ")}</p><h3>{move.title}</h3><p>{move.whyNow}</p><div className="cc-move-meta"><span>{move.expectedTimeMinutes} min</span><span>{money(move.expectedValue.value?.lowCents)}–{money(move.expectedValue.value?.highCents)}</span><span>{move.confidence}</span></div><p>{move.evidence.join(" · ")}</p><div style={{display:"flex",gap:8}}><a href={move.destinationPath} className="cc-button primary" onClick={()=>void decide.mutateAsync({moveId:move.id,sourceType:move.source.type,sourceId:move.source.id,decision:"accepted",requestId:crypto.randomUUID()})}>Open source <ArrowRight size={14}/></a><button className="cc-button" onClick={async()=>{await decide.mutateAsync({moveId:move.id,sourceType:move.source.type,sourceId:move.source.id,decision:"dismissed",requestId:crypto.randomUUID()});await utils.system.grow.get.invalidate()}}><X size={14}/> Dismiss</button></div></article>):<div className="cc-empty">No current move survived source status, expiry, and scarcity filters.</div>}</section>
    {grow.data?<div className="cc-quality">{grow.data.dataQuality.warnings.join(" · ")}</div>:null}
  </section>
}
