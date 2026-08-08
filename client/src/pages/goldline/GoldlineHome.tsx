import { useEffect, useMemo, useState } from "react";
import { Bell, Check, DoorOpen, Flame, LockKeyhole, Map, Menu, Mic, PackagePlus, PhoneCall, X } from "lucide-react";
import type { Order } from "@shared/types";
import world from "@/assets/goldline/goldline-world.png";
import vorgan from "@/assets/goldline/vorgan.png";
import objects from "@/assets/goldline/action-objects.png";
import "./goldline-home.css";

const calls = ["Glacier Tech", "Northpoint Media", "Apex Solutions", "Ironclad Supply", "Summit Wireless"];
const objectives = ["Confirm Summit Capital meeting", "Send Evergreen audit packet", "Follow up on Glacier Tech", "Check in with Brightline foreman", "End the day at The Vault"];
const actions = ["BUILD MISSION", "NEW ORDER", "LOG A WALK-IN", "UNLOAD THE DAY"];
const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

type Panel = "objectives" | "calls" | "menu" | "route" | "build" | "order" | "walkin" | "unload";
type RouteStop = {
  key: string;
  orderId: number;
  name: string;
  time: string;
  type: "PICKUP" | "DROPOFF";
  tone: "gold" | "cyan";
  address: string;
};

type GoldlineHomeProps = {
  pickups?: Order[];
  deliveries?: Order[];
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  isLoading?: boolean;
};

function dateFromYmd(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateLabel(value: string): string {
  return dateFromYmd(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).toUpperCase();
}

function weekdayLabel(value: string): string {
  return dateFromYmd(value).toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}

function orderName(order: Order): string {
  const fullName = `${order.firstName ?? ""} ${order.lastName ?? ""}`.trim();
  return fullName || order.address || `ORDER #${order.id}`;
}

function toRouteStop(order: Order, type: RouteStop["type"]): RouteStop {
  const isPickup = type === "PICKUP";
  return {
    key: `${type}-${order.id}`,
    orderId: order.id,
    name: orderName(order),
    time: (isPickup ? order.pickupTimeWindow : order.deliveryTimeWindow) || "TIME TBD",
    type,
    tone: isPickup ? "gold" : "cyan",
    address: order.address || "",
  };
}

export default function GoldlineHome({
  pickups,
  deliveries,
  selectedDate,
  onSelectedDateChange,
  isLoading = false,
}: GoldlineHomeProps) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [toast, setToast] = useState("");

  const routeStops = useMemo(() => {
    const combined = [
      ...(pickups ?? []).map(order => toRouteStop(order, "PICKUP")),
      ...(deliveries ?? []).map(order => toRouteStop(order, "DROPOFF")),
    ];
    return combined.sort((a, b) => a.time.localeCompare(b.time));
  }, [pickups, deliveries]);

  const visibleStops = routeStops.slice(0, 4);
  const hiddenStopCount = Math.max(0, routeStops.length - visibleStops.length);
  const pickupCount = routeStops.filter(stop => stop.type === "PICKUP").length;
  const dropoffCount = routeStops.filter(stop => stop.type === "DROPOFF").length;
  const activeWeekday = weekdayLabel(selectedDate);

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
          <label className="date-stone" aria-label="Change working date">
            <strong>{formatDateLabel(selectedDate)}</strong>
            <span>{weekdays.map(day => <i className={day === activeWeekday ? "active" : ""} key={day}>{day}</i>)}</span>
            <input
              className="goldline-date-picker"
              type="date"
              value={selectedDate}
              onChange={event => onSelectedDateChange(event.target.value)}
            />
          </label>
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

        <button className="vault-label" onClick={() => setPanel("route")}>
          <LockKeyhole /><span><b>TODAY’S ROUTE</b><small>{pickupCount} PICKUPS · {dropoffCount} DROPOFFS</small></span><strong>{routeStops.length}</strong>
        </button>

        <div className="route-stops">
          {visibleStops.map((stop, index) => (
            <button
              key={stop.key}
              className={`route-stop stop-${index + 1} is-${stop.tone}`}
              onClick={() => setToast(`${stop.type}: ${stop.name} · ${stop.time}`)}
            >
              <span>{index + 1}</span><b>{stop.name}</b><small>{stop.type} · {stop.time}</small>
            </button>
          ))}
        </div>

        {!isLoading && routeStops.length === 0 && (
          <button className="route-empty" onClick={() => setPanel("route")}>
            <b>NO PICKUPS OR DROPOFFS</b>
            <small>{formatDateLabel(selectedDate)}</small>
          </button>
        )}

        {isLoading && <div className="route-loading">LOADING TODAY’S ROUTE…</div>}

        {hiddenStopCount > 0 && (
          <button className="route-overflow" onClick={() => setPanel("route")}>
            +{hiddenStopCount} MORE {hiddenStopCount === 1 ? "STOP" : "STOPS"}
          </button>
        )}

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
              {panel === "route" && <><p className="drawer-kicker">{formatDateLabel(selectedDate)}</p><h2>Today’s route</h2><div className="route-counts"><b>{pickupCount} PICKUPS</b><b>{dropoffCount} DROPOFFS</b></div>{routeStops.length ? <ul>{routeStops.map((stop, index) => <li key={stop.key} className={`route-list-item is-${stop.tone}`}><span>{index + 1}</span><div><b>{stop.name}</b><small>{stop.type} · {stop.time}{stop.address ? ` · ${stop.address}` : ""}</small></div></li>)}</ul> : <p className="route-drawer-empty">No pickups or dropoffs scheduled for this date.</p>}</>}
              {panel === "objectives" && <><p className="drawer-kicker">TODAY’S QUEST LOG</p><h2>Follow-up objectives</h2><ul>{objectives.map((item, index) => <li key={item}><span>{index + 1}</span>{item}</li>)}</ul></>}
              {panel === "calls" && <><p className="drawer-kicker blue">SIDE ENCOUNTER</p><h2>20 min cold call burst</h2><ul>{calls.map(item => <li key={item}><span><PhoneCall /></span>{item}</li>)}</ul><button className="start-calling" onClick={() => act("START CALLING")}>START CALLING</button></>}
              {panel === "menu" && <><p className="drawer-kicker">GOLDLINE</p><h2>Choose your path</h2><ul><li onClick={() => setPanel("route")}><span><Check /></span>Today’s route · {routeStops.length} stops</li><li><span>{pickupCount}</span>Pickups</li><li><span>{dropoffCount}</span>Dropoffs</li><li><span>87</span>Hustle score</li></ul></>}
              {panel === "build" && <><p className="drawer-kicker">MISSION BUILDER</p><h2>Build today’s mission</h2><div className="mission-preview"><Map /><div><b>{routeStops.length} stops</b><small>{routeStops.length ? routeStops.map(stop => stop.name).join(" → ") : "No route stops scheduled yet"}</small></div></div><label className="goldline-field">Mission focus<select defaultValue="revenue"><option value="revenue">Highest revenue first</option><option value="route">Fastest route</option><option value="balanced">Balanced day</option></select></label><button className="drawer-primary" onClick={() => complete("Mission built — route ready")}>BUILD MY MISSION</button></>}
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
