import { useEffect, useState } from "react";
import { Bell, Check, DoorOpen, Flame, LockKeyhole, Map, Menu, Mic, PackagePlus, PhoneCall, X } from "lucide-react";
import world from "@/assets/goldline/goldline-world.png";
import vorgan from "@/assets/goldline/vorgan.png";
import objects from "@/assets/goldline/action-objects.png";
import "./goldline-home.css";

const stops = [
  { id: 1, name: "BRIGHTLINE BUILDERS", time: "9:00–10:00 AM", type: "PICKUP", tone: "gold" },
  { id: 2, name: "EVERGREEN CPAs", time: "10:30–11:30 AM", type: "DROPOFF", tone: "cyan" },
  { id: 3, name: "PINNACLE LOGISTICS", time: "1:00–2:00 PM", type: "PICKUP", tone: "gold" },
  { id: 4, name: "SUMMIT CAPITAL", time: "2:00–3:30 PM", type: "SALES · $2,400/MO", tone: "violet" },
] as const;

const calls = ["Glacier Tech", "Northpoint Media", "Apex Solutions", "Ironclad Supply", "Summit Wireless"];
const objectives = ["Confirm Summit Capital meeting", "Send Evergreen audit packet", "Follow up on Glacier Tech", "Check in with Brightline foreman", "End the day at The Vault"];
const actions = ["BUILD MISSION", "NEW ORDER", "LOG A WALK-IN", "UNLOAD THE DAY"];
type Panel = "objectives" | "calls" | "menu" | "build" | "order" | "walkin" | "unload";

export default function GoldlineHome() {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function act(label: string) {
    if (label === "START CALLING") {
      setToast("Cold-call burst armed — 20:00");
      setPanel(null);
      return;
    }
    const panels: Record<string, Panel> = {
      "BUILD MISSION": "build",
      "NEW ORDER": "order",
      "LOG A WALK-IN": "walkin",
      "UNLOAD THE DAY": "unload",
    };
    setPanel(panels[label]);
  }

  function complete(message: string) {
    setPanel(null);
    setToast(message);
  }

  return (
    <main className="goldline-shell">
      <section className="goldline" aria-label="Goldline daily adventure map">
        <img className="goldline-world" src={world} alt="Sunlit canyon city crossed by a turquoise route river" />
        <div className="goldline-sunwash" aria-hidden="true" />

        <header className="goldline-topbar">
          <button className="round-button" onClick={() => setPanel("menu")} aria-label="Open menu"><Menu /></button>
          <div className="date-stone">
            <strong>MAY 23, 2025</strong>
            <span>{["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map(day => <i className={day === "FRI" ? "active" : ""} key={day}>{day}</i>)}</span>
          </div>
          <button className="round-button has-alert" onClick={() => setPanel("objectives")} aria-label="Open objectives"><Bell /></button>
        </header>

        <section className="hustle" aria-label="Sucker to Hustler progress: 87 percent, on fire">
          <div className="hustle-labels"><span>SUCKER</span><b>87%</b><span>HUSTLER</span></div>
          <div className="hustle-track"><i /></div>
          <em>ON FIRE <Flame /></em>
        </section>

        <button className="vorgan-card" onClick={() => setToast("Vorgan: Deals in Doubt. Feeds on Excuses.")}>
          <img src={vorgan} alt="Vorgan in an ivory suit" />
          <span><b>VORGAN</b><small>Deals in Doubt.<br />Feeds on Excuses.</small></span>
        </button>

        <button className="vault-label" onClick={() => setToast("The Vault is sealed — clear 4 stops")}>
          <LockKeyhole /><span><b>THE VAULT</b><small>SEALED UNTIL ALL STOPS CLEARED</small></span><strong>0/4</strong>
        </button>

        <div className="route-stops">
          {stops.map(stop => (
            <button key={stop.id} className={`route-stop stop-${stop.id} is-${stop.tone}`} onClick={() => setToast(`${stop.name} selected`)}>
              <span>{stop.id}</span><b>{stop.name}</b><small>{stop.time} · {stop.type}</small>
            </button>
          ))}
        </div>

        <button className="call-shrine" onClick={() => setPanel("calls")}>
          <PhoneCall /><span><b>20 MIN</b><small>COLD CALL BURST</small></span>
        </button>

        <button className="objectives-tab" onClick={() => setPanel("objectives")}>FOLLOW-UP<br />OBJECTIVES <span>5</span></button>

        <nav className="action-bar" aria-label="Primary actions">
          {actions.map((label, index) => (
            <button key={label} onClick={() => act(label)}>
              <i style={{ backgroundImage: `url(${objects})`, backgroundPosition: `${index * 33.333}% center` }} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {panel && (
          <div className="drawer-backdrop" onClick={() => setPanel(null)}>
            <section className="goldline-drawer" onClick={event => event.stopPropagation()}>
              <button className="drawer-close" onClick={() => setPanel(null)} aria-label="Close"><X /></button>
              {panel === "objectives" && <><p className="drawer-kicker">TODAY’S QUEST LOG</p><h2>Follow-up objectives</h2><ul>{objectives.map((item, index) => <li key={item}><span>{index + 1}</span>{item}</li>)}</ul></>}
              {panel === "calls" && <><p className="drawer-kicker blue">SIDE ENCOUNTER</p><h2>20 min cold call burst</h2><ul>{calls.map(item => <li key={item}><span><PhoneCall /></span>{item}</li>)}</ul><button className="start-calling" onClick={() => act("START CALLING")}>START CALLING</button></>}
              {panel === "menu" && <><p className="drawer-kicker">GOLDLINE</p><h2>Choose your path</h2><ul><li><span><Check /></span>Today’s route</li><li><span>4</span>Active stops</li><li><span>87</span>Hustle score</li></ul></>}
              {panel === "build" && <><p className="drawer-kicker">MISSION BUILDER</p><h2>Build today’s mission</h2><div className="mission-preview"><Map /><div><b>4 stops · 18.6 miles</b><small>Brightline → Evergreen → Pinnacle → Summit</small></div></div><label className="goldline-field">Mission focus<select defaultValue="revenue"><option value="revenue">Highest revenue first</option><option value="route">Fastest route</option><option value="balanced">Balanced day</option></select></label><button className="drawer-primary" onClick={() => complete("Mission built — route ready")}>BUILD MY MISSION</button></>}
              {panel === "order" && <><p className="drawer-kicker">QUICK CAPTURE</p><h2>New order</h2><label className="goldline-field">Customer<input placeholder="Customer or business name" /></label><div className="field-grid"><label className="goldline-field">Service<select><option>Pickup & delivery</option><option>Wash & fold</option><option>Dry cleaning</option></select></label><label className="goldline-field">Due<input type="time" defaultValue="17:00" /></label></div><button className="drawer-primary" onClick={() => complete("New order saved")}>CREATE ORDER <PackagePlus /></button></>}
              {panel === "walkin" && <><p className="drawer-kicker">FIELD INTEL</p><h2>Log a walk-in</h2><label className="goldline-field">Business<input placeholder="Where did you stop?" /></label><label className="goldline-field">What happened?<textarea placeholder="Contact, interest, objection, next step…" /></label><button className="drawer-primary" onClick={() => complete("Walk-in logged — momentum added")}>LOG WALK-IN <DoorOpen /></button></>}
              {panel === "unload" && <><p className="drawer-kicker">END-OF-DAY DEBRIEF</p><h2>Unload the day</h2><button className="voice-capture" onClick={() => setToast("Voice capture ready — start talking")}><Mic /><span><b>HOLD TO RECORD</b><small>Wins, objections, promises, follow-ups</small></span></button><label className="goldline-field">Or type a quick debrief<textarea placeholder="What did today teach you?" /></label><button className="drawer-primary" onClick={() => complete("Day unloaded — intelligence saved")}>SAVE DEBRIEF</button></>}
            </section>
          </div>
        )}

        {toast && <div className="goldline-toast" role="status">{toast}</div>}
      </section>
    </main>
  );
}
