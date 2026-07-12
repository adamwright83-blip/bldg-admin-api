import { useMemo, useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  CircleDollarSign,
  Clock3,
  FileText,
  MapPin,
  Navigation,
  Phone,
  Printer,
  Shirt,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useLocation, useRoute } from "wouter";
import {
  DEMO_MISSION,
  formatCurrencyFromCents,
  type CommercialMission,
  type CommercialMissionStatus,
} from "@shared/commercialMission";
import { transitionCommercialMission } from "@shared/commercialMissionLifecycle";
import "./commercial-sales-mission.css";

type Screen =
  | "briefing"
  | "prep"
  | "print"
  | "destination"
  | "talk-track"
  | "outcome"
  | "complete";

type VisitOutcome = "follow_up" | "won" | "lost" | null;

const STORAGE_KEY = "dayforge:commercial-sales-mission:demo";

function initialMission(): CommercialMission {
  if (typeof window === "undefined") {
    return { ...DEMO_MISSION, status: "phone_ready" };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEMO_MISSION, status: "phone_ready" };
    const parsed = JSON.parse(raw) as CommercialMission;
    if (parsed.id !== DEMO_MISSION.id) {
      return { ...DEMO_MISSION, status: "phone_ready" };
    }
    return parsed;
  } catch {
    return { ...DEMO_MISSION, status: "phone_ready" };
  }
}

function statusForScreen(screen: Screen): CommercialMissionStatus {
  switch (screen) {
    case "briefing":
      return "phone_ready";
    case "prep":
    case "print":
    case "talk-track":
      return "preparing";
    case "destination":
      return "en_route";
    case "outcome":
      return "arrived";
    case "complete":
      return "visit_completed";
  }
}

function ScreenHeader({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <header className="csm-screen-head">
      <span>{eyebrow}</span>
      <h1>{title}</h1>
      {body ? <p>{body}</p> : null}
    </header>
  );
}

function ActionButton({
  children,
  onClick,
  secondary = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  secondary?: boolean;
}) {
  return (
    <button
      type="button"
      className={`csm-action${secondary ? " is-secondary" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function CommercialSalesMission() {
  const [, params] = useRoute("/driver/sales-mission/:missionId");
  const [, setLocation] = useLocation();
  const [screen, setScreen] = useState<Screen>("briefing");
  const [mission, setMission] = useState<CommercialMission>(initialMission);
  const [prep, setPrep] = useState({ polo: false, quote: false, collateral: false });
  const [printReady, setPrintReady] = useState(false);
  const [outcome, setOutcome] = useState<VisitOutcome>(null);
  const [notes, setNotes] = useState("");

  const annualValue = useMemo(
    () => formatCurrencyFromCents(mission.estimatedAnnualValueCents),
    [mission.estimatedAnnualValueCents]
  );
  const missionId = params?.missionId ?? String(mission.id);
  const allPrepDone = prep.polo && prep.quote && prep.collateral;

  function persist(next: CommercialMission) {
    setMission(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  }

  function move(nextScreen: Screen) {
    const targetStatus = statusForScreen(nextScreen);
    if (targetStatus === mission.status) {
      setScreen(nextScreen);
      return;
    }

    try {
      const transitioned = transitionCommercialMission(mission, targetStatus, {
        actorType: "driver",
        actorId: "demo-operator",
        metadata: { fromScreen: screen, toScreen: nextScreen },
      });
      persist(transitioned.mission);
    } catch {
      persist({ ...mission, status: targetStatus });
    }
    setScreen(nextScreen);
  }

  function finishVisit(nextOutcome: Exclude<VisitOutcome, null>) {
    setOutcome(nextOutcome);
    let nextMission = { ...mission, status: "visit_completed" as const };
    try {
      nextMission = transitionCommercialMission(mission, "visit_completed", {
        actorType: "driver",
        actorId: "demo-operator",
        metadata: { notes },
      }).mission;
    } catch {
      nextMission = { ...mission, status: "visit_completed" };
    }

    const finalStatus: CommercialMissionStatus = nextOutcome;
    try {
      nextMission = transitionCommercialMission(nextMission, finalStatus, {
        actorType: "operator",
        actorId: "demo-operator",
        metadata: { notes },
      }).mission;
    } catch {
      nextMission = { ...nextMission, status: finalStatus };
    }
    persist(nextMission);
    setScreen("complete");
  }

  return (
    <main className="csm-root">
      <div className="csm-phone-shell">
        <div className="csm-statusbar" aria-hidden="true">
          <span>9:41</span>
          <span>DAYFORGE</span>
          <span>100%</span>
        </div>

        <nav className="csm-nav">
          <button type="button" onClick={() => setLocation("/territory-preview")}>
            <ChevronLeft />
          </button>
          <div>
            <small>{mission.code}</small>
            <b>{mission.accountName}</b>
          </div>
          <span className="csm-live-dot">LIVE</span>
        </nav>

        <div className="csm-progress" aria-label={`Mission ${mission.status}`}>
          {[
            "briefing",
            "prep",
            "print",
            "destination",
            "talk-track",
            "outcome",
          ].map((step, index) => {
            const currentIndex = [
              "briefing",
              "prep",
              "print",
              "destination",
              "talk-track",
              "outcome",
              "complete",
            ].indexOf(screen);
            return <i key={step} className={index <= currentIndex ? "is-done" : ""} />;
          })}
        </div>

        <section className="csm-screen">
          {screen === "briefing" ? (
            <>
              <ScreenHeader
                eyebrow="MISSION UNLOCKED"
                title="Westview is ready for the field."
                body="The same account you played for on desktop is now on your phone."
              />
              <div className="csm-hero-card">
                <div className="csm-hero-icon"><Building2 /></div>
                <div>
                  <small>PROPERTY MANAGEMENT</small>
                  <h2>{mission.accountName}</h2>
                  <p>{mission.accountLocationCount} buildings · {mission.primarySignal}</p>
                </div>
                <strong>{annualValue}<small>EST. ANNUAL VALUE</small></strong>
              </div>
              <div className="csm-facts">
                <article><UserRound /><span><small>ASK FOR</small><b>{mission.decisionMaker.name}</b><em>{mission.decisionMaker.title}</em></span></article>
                <article><Sparkles /><span><small>WHY NOW</small><b>{mission.primarySignal}</b><em>Strong fit for recurring fluff-and-fold</em></span></article>
                <article><MapPin /><span><small>ROUTE FIT</small><b>0.6 miles from current route</b><em>Tuesday + Thursday capacity open</em></span></article>
              </div>
              <ActionButton onClick={() => move("prep")}>Start mission prep <ArrowRight /></ActionButton>
            </>
          ) : null}

          {screen === "prep" ? (
            <>
              <ScreenHeader
                eyebrow="STEP 1 OF 5"
                title="Look ready before you walk in."
                body="The mission does not begin at the front door. It begins with how you show up."
              />
              <div className="csm-checklist">
                {[
                  { key: "polo" as const, icon: <Shirt />, title: "Clean polo + jeans", body: "Presentable, practical, operator-ready." },
                  { key: "quote" as const, icon: <FileText />, title: "Quote sheet", body: "Pricing and service outline checked." },
                  { key: "collateral" as const, icon: <BriefcaseBusiness />, title: "Leave-behind", body: "Branded flyer and contact card ready." },
                ].map(item => (
                  <button
                    type="button"
                    key={item.key}
                    className={prep[item.key] ? "is-complete" : ""}
                    onClick={() => setPrep(current => ({ ...current, [item.key]: !current[item.key] }))}
                  >
                    <span className="csm-check-icon">{item.icon}</span>
                    <span><b>{item.title}</b><small>{item.body}</small></span>
                    <i>{prep[item.key] ? <Check /> : null}</i>
                  </button>
                ))}
              </div>
              <ActionButton onClick={() => move("print")}>
                Continue to print stop <ArrowRight />
              </ActionButton>
              {!allPrepDone ? <p className="csm-hint">You can continue, but the mission is strongest when all three are checked.</p> : null}
            </>
          ) : null}

          {screen === "print" ? (
            <>
              <ScreenHeader
                eyebrow="STEP 2 OF 5"
                title="Your leave-behind is waiting."
                body="DayForge prepared the collateral and placed the pickup on your route."
              />
              <div className="csm-stop-card">
                <span><Printer /></span>
                <div><small>PRINT PICKUP</small><h2>FedEx Office · Beverly Blvd</h2><p>1.2 miles · on the way to Westview</p></div>
                <em>{printReady ? "READY" : "PROCESSING"}</em>
              </div>
              <div className="csm-print-code">
                <small>PICKUP CODE</small>
                <strong>DF-042</strong>
                <p>1 branded commercial laundry proposal · 5 leave-behind flyers</p>
              </div>
              {!printReady ? (
                <ActionButton onClick={() => setPrintReady(true)}><Clock3 /> Mark print job ready</ActionButton>
              ) : (
                <ActionButton onClick={() => move("destination")}><Navigation /> Navigate to print stop</ActionButton>
              )}
            </>
          ) : null}

          {screen === "destination" ? (
            <>
              <ScreenHeader
                eyebrow="STEP 3 OF 5"
                title="Now go finish the mission."
                body="The game ended on the screen. The same mission continues at Westview."
              />
              <div className="csm-map-card">
                <div className="csm-map-grid" />
                <span className="csm-map-route" />
                <i className="csm-map-origin"><Printer /></i>
                <i className="csm-map-destination"><Building2 /></i>
              </div>
              <div className="csm-route-summary">
                <span><Navigation /></span>
                <div><small>DESTINATION</small><b>{mission.accountName}</b><em>Ask for {mission.decisionMaker.name}, {mission.decisionMaker.title}</em></div>
                <strong>11 MIN</strong>
              </div>
              <ActionButton onClick={() => move("talk-track")}><MapPin /> I’m outside Westview</ActionButton>
            </>
          ) : null}

          {screen === "talk-track" ? (
            <>
              <ScreenHeader
                eyebrow="STEP 4 OF 5"
                title="Walk in with the opener ready."
                body="Use the words as written or make them sound like you. You stay in control."
              />
              <div className="csm-script">
                <small>OPENING LINE</small>
                <blockquote>“{mission.openingLine}”</blockquote>
                <small>BEST ANGLE</small>
                <p>{mission.salesAngle}</p>
              </div>
              <div className="csm-question-list">
                <h3>DISCOVERY QUESTIONS</h3>
                {mission.discoveryQuestions.map(question => <p key={question}>{question}</p>)}
              </div>
              <div className="csm-objections">
                <h3>BE READY FOR</h3>
                <div>{mission.objections.map(objection => <span key={objection}>{objection}</span>)}</div>
              </div>
              <ActionButton onClick={() => move("outcome")}><Phone /> Record what happened</ActionButton>
            </>
          ) : null}

          {screen === "outcome" ? (
            <>
              <ScreenHeader
                eyebrow="STEP 5 OF 5"
                title="What happened inside?"
                body="The result teaches DayForge what to rank and how to prepare next time."
              />
              <label className="csm-notes">
                <span>VISIT NOTES</span>
                <textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Met Dana. She wants pricing for three buildings first…" rows={5} />
              </label>
              <div className="csm-outcomes">
                <button type="button" onClick={() => finishVisit("won")}><CheckCircle2 /><span><b>Account won</b><small>Agreement or verbal yes</small></span></button>
                <button type="button" onClick={() => finishVisit("follow_up")}><Clock3 /><span><b>Follow-up needed</b><small>Quote, callback, or second visit</small></span></button>
                <button type="button" onClick={() => finishVisit("lost")}><BriefcaseBusiness /><span><b>Not a fit</b><small>Record why and improve the radar</small></span></button>
              </div>
            </>
          ) : null}

          {screen === "complete" ? (
            <>
              <div className={`csm-complete${outcome === "won" ? " is-won" : ""}`}>
                <span>{outcome === "won" ? <CheckCircle2 /> : <Clock3 />}</span>
                <small>{mission.code}</small>
                <h1>{outcome === "won" ? "Account won." : outcome === "follow_up" ? "Follow-up mission created." : "Mission learned from."}</h1>
                <p>{mission.accountName}</p>
                {outcome === "won" ? <strong><CircleDollarSign /> {annualValue} estimated annual value</strong> : null}
              </div>
              <div className="csm-summary">
                <article><small>MISSION STATUS</small><b>{mission.status.replace("_", " ").toUpperCase()}</b></article>
                <article><small>ACCOUNT</small><b>{mission.accountName}</b></article>
                <article><small>VISIT NOTES</small><b>{notes || "No notes recorded"}</b></article>
              </div>
              <ActionButton onClick={() => setLocation("/territory-preview")}>Return to territory <ArrowRight /></ActionButton>
              <ActionButton secondary onClick={() => {
                window.localStorage.removeItem(STORAGE_KEY);
                setMission({ ...DEMO_MISSION, status: "phone_ready" });
                setPrep({ polo: false, quote: false, collateral: false });
                setPrintReady(false);
                setOutcome(null);
                setNotes("");
                setScreen("briefing");
              }}>Replay demo mission</ActionButton>
            </>
          ) : null}
        </section>

        <footer className="csm-footer">
          <span><Sparkles /> Same mission on every screen</span>
          <small>ID {missionId}</small>
        </footer>
      </div>
    </main>
  );
}
