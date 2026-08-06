import { useState } from "react";
import { X } from "lucide-react";
import { trpc } from "@/lib/trpc";

const relationshipTypes = [
  "unknown",
  "concierge",
  "front_desk",
  "gatekeeper",
  "decision_maker",
  "champion",
] as const;

function relationshipType(value: FormDataEntryValue | null) {
  return relationshipTypes.find(type => type === value) ?? "unknown";
}

function tomorrowMorning() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  value.setHours(9, 0, 0, 0);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function WalkInCapture(props: {
  open: boolean;
  onClose: () => void;
  onSaved?: (result: { missionId: number; missionCode: string }) => void;
}) {
  const mutation = trpc.system.commercialMission.logWalkIn.useMutation();
  const [followUpAt, setFollowUpAt] = useState(tomorrowMorning);
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#07111f] text-white sm:bg-black/75 sm:p-5">
      <form className="mx-auto min-h-full max-w-xl bg-[#07111f] p-4 sm:min-h-0 sm:rounded-3xl sm:border sm:border-white/15 sm:p-6" onSubmit={async event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const requestId = crypto.randomUUID();
        const result = await mutation.mutateAsync({
          idempotencyKey: `walk-in:${requestId}`,
          requestId,
          businessName: String(data.get("businessName")),
          businessType: String(data.get("businessType")),
          address: String(data.get("address")),
          contactName: String(data.get("contactName") || "") || null,
          contactTitle: String(data.get("contactTitle") || "") || null,
          contactEmail: String(data.get("contactEmail") || "") || null,
          contactPhone: String(data.get("contactPhone") || "") || null,
          relationshipType: relationshipType(data.get("relationshipType")),
          conversationNotes: String(data.get("conversationNotes")),
          visitResult: "follow_up",
          nextAction: String(data.get("nextAction")),
          followUpAt: new Date(followUpAt),
          collateralDelivered: data.get("collateralDelivered") === "on",
          quoteRequested: data.get("quoteRequested") === "on",
          pilotRequested: data.get("pilotRequested") === "on",
        });
        if (props.onSaved) {
          props.onSaved(result);
          return;
        }
        window.location.assign(`/commercial-missions?mission=${result.missionId}`);
      }}>
        <header className="mb-5 flex items-start justify-between"><div><p className="text-xs font-black tracking-[.2em] text-orange-400">UNDER 45 SECONDS</p><h2 className="text-2xl font-black">Log a walk-in</h2><p className="text-sm text-slate-400">Save the conversation. DayForge will remember the next move.</p></div><button type="button" aria-label="Close" onClick={props.onClose} className="rounded-xl border border-white/15 p-3"><X /></button></header>
        <div className="space-y-4">
          <label className="block text-sm font-bold">Business name<input name="businessName" required autoFocus placeholder="Maybourne Beverly Hills" className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3 text-base" /></label>
          <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-bold">Business type<select name="businessType" defaultValue="hotel" className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-3"><option value="hotel">Hotel</option><option value="multifamily">Multifamily</option><option value="spa_salon">Spa / salon</option><option value="office">Office</option><option value="other">Other</option></select></label><label className="block text-sm font-bold">Relationship<select name="relationshipType" defaultValue="unknown" className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-3"><option value="unknown">Unknown</option><option value="concierge">Concierge</option><option value="front_desk">Front desk</option><option value="gatekeeper">Gatekeeper</option><option value="decision_maker">Decision maker</option><option value="champion">Champion</option></select></label></div>
          <label className="block text-sm font-bold">Address<input name="address" required autoComplete="street-address" className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3" /></label>
          <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-bold">Contact name<input name="contactName" placeholder="Vincent" className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3" /></label><label className="block text-sm font-bold">Title<input name="contactTitle" placeholder="Concierge" className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3" /></label></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="block text-sm font-bold">Email<input name="contactEmail" type="email" inputMode="email" className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3" /></label><label className="block text-sm font-bold">Phone<input name="contactPhone" type="tel" inputMode="tel" className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3" /></label></div>
          <label className="block text-sm font-bold">What happened?<textarea name="conversationNotes" required rows={2} placeholder="Asked about turnaround time" className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3" /></label>
          <label className="block text-sm font-bold">Next action<input name="nextAction" required defaultValue="Follow up with details" className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3" /></label>
          <label className="block text-sm font-bold">Follow up<input value={followUpAt} onChange={event => setFollowUpAt(event.target.value)} type="datetime-local" required className="mt-1 w-full rounded-xl border border-white/15 bg-slate-900 px-4 py-3" /></label>
          <div className="flex flex-wrap gap-4 text-sm"><label><input name="collateralDelivered" type="checkbox" className="mr-2" />Collateral delivered</label><label><input name="quoteRequested" type="checkbox" className="mr-2" />Quote requested</label><label><input name="pilotRequested" type="checkbox" className="mr-2" />Pilot requested</label></div>
          {mutation.error ? <p role="alert" className="rounded-xl bg-red-500/15 p-3 text-red-200">{mutation.error.message}</p> : null}
          <button disabled={mutation.isPending} className="min-h-16 w-full rounded-2xl bg-orange-500 px-6 text-lg font-black disabled:opacity-50">{mutation.isPending ? "SAVING…" : "SAVE WALK-IN + FOLLOW-UP"}</button>
        </div>
      </form>
    </div>
  );
}
