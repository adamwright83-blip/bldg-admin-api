import { useMemo } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, Clock3, MapPin, Phone, Route, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";

function clock(value: string | null) {
  return value ? new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Flex";
}

function money(cents: number | null | undefined) {
  return cents == null ? "Unknown value" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export default function FieldHome() {
  const today = trpc.system.field.today.useQuery();
  const moveInput = useMemo(() => ({ nextCommitmentAt: today.data?.nextFixedCommitment?.scheduledAt ? new Date(today.data.nextFixedCommitment.scheduledAt) : null }), [today.data?.nextFixedCommitment?.scheduledAt]);
  const moves = trpc.system.field.moves.useQuery(moveInput, { enabled: Boolean(today.data) });
  const accept = trpc.system.field.acceptMove.useMutation();
  return <section className="cc-field">
    <p className="cc-eyebrow">Field · {today.data?.businessDate ?? "Today"}</p>
    <h1 className="cc-section-title">What do I do next?</h1>
    <p className="cc-data-note">Built from persisted orders, payment truth, assigned missions, and follow-ups. Flexible means flexible—not fake urgency.</p>
    <div className="cc-field-grid">
      <section className="cc-panel">
        <div className="cc-panel-head"><h2>Today’s route</h2><span className="cc-badge"><Route size={12} /> {today.data?.timeline.length ?? 0} items</span></div>
        {today.isLoading ? <div className="cc-empty">Building the real timeline…</div> : today.error ? <div className="cc-empty">{today.error.message}</div> : today.data?.timeline.length ? <div className="cc-timeline">
          {today.data.timeline.map(item => <article className={`cc-timeline-item ${item.urgency}`} key={item.id}>
            <div className="cc-time"><Clock3 size={15} /><b>{clock(item.scheduledAt)}</b></div>
            <div className="cc-item-copy"><h3>{item.title}</h3><p>{item.subtitle}</p><span className="cc-badge">{item.kind.replace(/_/g," ")} · {item.status}</span></div>
            {item.actions[0]?.href ? <a className={`cc-button ${item.urgency === "blocked" ? "" : "primary"}`} href={item.actions[0].href}>{item.actions[0].type === "navigate" ? <MapPin size={14} /> : item.kind === "follow_up" ? <Phone size={14} /> : <ArrowRight size={14} />}{item.actions[0].label}</a> : null}
          </article>)}
        </div> : <div className="cc-empty">Your real queue is clear. Continue scheduled work or wait for a worthwhile move.</div>}
      </section>
      <aside className="cc-panel">
        <div className="cc-panel-head"><h2>Gap opportunities</h2><Sparkles size={18} color="#7a3fc4" /></div>
        {moves.isLoading ? <div className="cc-empty">Checking feasibility…</div> : moves.data?.recommendedMoves.length ? moves.data.recommendedMoves.map(move => <article className="cc-move" key={move.id}>
          <p className="cc-eyebrow">Optional · {move.moveType.replace(/_/g," ")}</p><h3>{move.title}</h3><p>{move.relevance}</p>
          <div className="cc-move-meta"><span>{move.expectedDurationMinutes + (move.travelMinutes ?? 0)} min</span><span>{money(move.expectedValue.value?.lowCents)}–{money(move.expectedValue.value?.highCents)}</span><span>{move.confidence}</span></div>
          {move.missionId && move.missionVersion ? <button className="cc-button primary" style={{marginTop:12}} disabled={accept.isPending} onClick={async()=>{await accept.mutateAsync({moveId:move.id,missionId:move.missionId!,expectedVersion:move.missionVersion!,requestId:crypto.randomUUID()}); window.location.assign(move.destinationPath)}}>Accept move <ArrowRight size={14}/></button> : null}
        </article>) : <div className="cc-empty"><AlertTriangle size={22} style={{margin:"0 auto 8px"}} /><strong>{moves.data?.reason.replace(/_/g," ") ?? "NO MOVE"}</strong><p>FIELD is allowed to recommend nothing when the evidence or route does not justify a move.</p></div>}
        <div style={{padding:16,display:"grid",gap:8}}><Link href="/product/hunt" className="cc-button primary" style={{width:"100%"}}>Enter HUNT</Link><Link href="/product/unload" className="cc-button" style={{width:"100%"}}>Unload the Day</Link><Link href="/new-order" className="cc-button" style={{width:"100%"}}>Create laundry / dry-cleaning order</Link></div>
      </aside>
    </div>
  </section>;
}
