import { useMemo, useState, type ReactNode } from "react";
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
  COMMERCIAL_MISSION_DEMO_STORAGE_KEY,
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

type PrepKey = "polo" | "quote" | "collateral";

type PrepItem = {
  key: PrepKey;
  icon: ReactNode;
  title: string;
  body: string;
};

const PREP_ITEMS: PrepItem[] = [
  {
    key: "polo",
    icon: <Shirt />,
    title: "Clean polo + jeans",
    body: "Presentable, practical, operator-ready.",
  },
  {
    key: "quote",
    icon: <FileText />,
    title: "Quote sheet",
    body: "Pricing and service outline checked.",
  },
  {
    key: "collateral",
    icon: <BriefcaseBusiness />,
    title: "Leave-behind",
    body: "Branded flyer and contact card ready.",
  },
];

function isCommercialMission(value: unknown): value is CommercialMission {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CommercialMission>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.code === "string" &&
    typeof candidate.accountName === "string" &&
    typeof candidate.estimatedAnnualValueCents === "number" &&
    typeof candidate.status === "string" &&
    !!candidate.decisionMaker &&
    Array.isArray(candidate.discoveryQuestions) &&
    Array.isArray(candidate.objections)
  );
}

function initialMission(): CommercialMission {
  const fallback = { ...DEMO_MISSION, status: "phone_ready" as const };
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(
      COMMERCIAL_MISSION_DEMO_STORAGE_KEY
    );
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!isCommercialMission(parsed)) return fallback;
    if (parsed.status === "won" || parsed.status === "lost") {
      return { ...parsed, status: "phone_ready" };
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function statusForScreen(screen: Screen): CommercialMissionStatus {
  switch (screen) {
    case "briefing":
      return "phone_ready";
    case "prep":
    case "print":
      return "preparing";
    case "destination":
      return "en_route";
    case "talk-track":
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
  children: ReactNode;
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

function safeTransition(
  mission: CommercialMission,
  toStatus: CommercialMissionStatus,
  metadata: Record<string, unknown>
): CommercialMission {
  if (mission.status === toStatus) return mission;
  try {
    return transitionCommercialMission(mission, toStatus, {
      actorType: "driver",
      actorId: "demo-operator",
      metadata,
    }).mission;
  } catch {
    return { ...mission, status: toStatus };
  }
}

export default function CommercialSalesMission() {
  const [, params] = useRoute("/driver/sales-mission/:missionId");
  const [, setLocation] = useLocation();
  const [screen, setScreen] = useState<Screen>("briefing");
  const [mission, setMission] = useState<CommercialMission>(initialMission);
  const [prep, setPrep] = useState<Record<PrepKey, boolean>>({
    polo: false,
    quote: false,
    collateral: false,
  });
  const [printReady, setPrintReady] = useState(false);
  const [outcome, setOutcome] = useState<VisitOutcome>(null);
  const [notes, setNotes] = useState("");

  const annualValue = useMemo(
    () => formatCurrencyFromCents(mission.estimatedAnnualValueCents),
    [mission.estimatedAnnualValueCents]
  );
  const missionId = params?.missionId ?? String(mission.id);
  const allPrepDone = Object.values(prep).every(Boolean);

  function persist(next: CommercialMission) {
    setMission(next);
    window.localStorage.setItem(
      COMMERCIAL_MISSION_DEMO_STORAGE_KEY,
      JSON.stringify(next)
    );
  }

  function move(nextScreen: Screen) {
    const next = safeTransition(mission, statusForScreen(nextScreen), {
      fromScreen: screen,
      toScreen: nextScreen,
    });
    persist(next);
    setScreen(nextScreen);
  }

  function finishVisit(nextOutcome: Exclude<VisitOutcome, null>) {
    setOutcome(nextOutcome);
    let next = safeTransition(mission, "visit_completed", { notes });
    next = safeTransition(next, nextOutcome, { notes });
    persist(next);
    setScreen("complete");
  }

  function resetDemo() {
    window.localStorage.removeItem(COMMERCIAL_MISSION_DEMO_STORAGE_KEY);
    setMission({ ...DEMO_MISSION, status: "phone_ready" });
    setPrep({ polo: false, quote: false, collateral: false });
    setPrintReady(false);
    setOutcome(null);
    setNotes("");
    setScreen("briefing");
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
          <button
            type="button"
            onClick={() => setLocation("/territory-preview")}
            aria-label="Back to territory preview"
          >
            <ChevronLeft />
          </button>
          <div>
            <small>{mission.code}</small>
            <b>{mission.accountName}</b>
          </div>
          <span className="csm-live-dot">LIVE</span>
        </nav>

        <div className="csm-progress" aria-label={`Mission ${mission.status}`}>
          {["briefing", "prep", "print", "destination", "talk-track", "outcome"].map(
            (step, index) => {
              const currentIndex = [
                "briefing",
                "prep",
                "print",
                "destination",
                "talk-track",
                "outcome",
                "complete",
              ].indexOf(screen);
              return (
                <i
                  key={step}
                  className={index <= currentIndex ? "is-done" : ""}
                />
              );
            }
          )}
        </div>

        <section className="csm-screen">
          {screen === "briefing" ? (
            <>
              <ScreenHeader
                eyebrow="MISSION UNLOCKED"
                title={`${mission.accountName} is ready for the field.`}
                body="The same account you played for on desktop is now on your phone."
              />
              <div className="csm-hero-card">
                <div className="csm-hero-icon">
                  <Building2 />
                </div>
                <div>
                  <small>{mission.accountType.toUpperCase()}</small>
                  <h2>{mission.accountName}</h2>
                  <p>
                    {mission.accountLocationCount} location
                    {mission.accountLocationCount === 1 ? "" : "s"} · {mission.primarySignal}
                  </p>
                </div>
                <strong>
                  {annualValue}
                  <small>EST. ANNUAL VALUE</small>
                </strong>
              </div>
              <div className="csm-facts">
                <article>
                  <UserRound />
                  <span>
                    <small>ASK FOR</small>
                    <b>{mission.decisionMaker.name ?? "Operations manager"}</b>
                    <em>{mission.decisionMaker.title ?? "Decision-maker"}</em>
                  </span>
                </article>
                <article>
                  <Sparkles />
                  <span>
                    <small>WHY NOW</small>
                    <b>{mission.primarySignal}</b>
                    <em>Strong fit for recurring fluff-and-fold</em>
                  </span>
                </article>
                <article>
                  <MapPin />
                  <span>
                    <small>WHY IT FITS</small>
                    <b>{mission.reasons[0] ?? "Inside your service area"}</b>
                    <em>{mission.reasons[1] ?? "Capacity and route fit look strong"}</em>
                  </span>
                </article>
              </div>
              <ActionButton onClick={() => move("prep")}>
                Start mission prep <ArrowRight />
              </ActionButton>
            </>
          ) : null}

          {screen === "prep" ? (
            <>
              <ScreenHeader
                eyebrow="STEP 1 OF 5"
                title="Look ready before you walk in."
                body="The mission starts with how you show up."
              />
              <div className="csm-checklist">
                {PREP_ITEMS.map(item => (
                  <button
                    type="button"
                    key={item.key}
                    className={prep[item.key] ? "is-complete" : ""}
                    onClick={() =>
                      setPrep(current => ({
                        ...current,
                        [item.key]: !current[item.key],
                      }))
                    }
                  >
                    <span className="csm-check-icon">{item.icon}</span>
                    <span>
                      <b>{item.title}</b>
                      <small>{item.body}</small>
                    </span>
                    <i>{prep[item.key] ? <Check /> : null}</i>
                  </button>
                ))}
              </div>
              <ActionButton onClick={() => move("print")}>
                Continue to print stop <ArrowRight />
              </ActionButton>
              {!allPrepDone ? (
                <p className="csm-hint">
                  You can continue, but the mission is strongest when all three are checked.
                </p>
              ) : null}
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
                <span>
                  <Printer />
                </span>
                <div>
                  <small>PRINT PICKUP</small>
                  <h2>FedEx Office · Beverly Blvd</h2>
                  <p>On the way to {mission.accountName}</p>
                </div>
                <em>{printReady ? "READY" : "PROCESSING"}</em>
              </div>
              <div className="csm-print-code">
                <small>PICKUP CODE</small>
                <strong>DF-{String(mission.id).slice(-3).padStart(3, "0")}</strong>
                <p>1 branded commercial laundry proposal · 5 leave-behind flyers</p>
              </div>
              {!printReady ? (
                <ActionButton onClick={() => setPrintReady(true)}>
                  <Clock3 /> Mark print job ready
                </ActionButton>
              ) : (
                <ActionButton onClick={() => move("destination")}>
                  <Navigation /> Navigate to print stop
                </ActionButton>
              )}
            </>
          ) : null}

          {screen === "destination" ? (
            <>
              <ScreenHeader
                eyebrow="STEP 3 OF 5"
                title="Now go finish the mission."
                body={`The game ended on the screen. The same mission continues at ${mission.accountName}.`}
              />
              <div className="csm-map-card">
                <div className="csm-map-grid" />
                <span className="csm-map-route" />
                <i className="csm-map-origin">
                  <Printer />
                </i>
                <i className="csm-map-destination">
                  <Building2 />
                </i>
              </div>
              <div className="csm-route-summary">
                <span>
                  <Navigation />
                </span>
                <div>
                  <small>DESTINATION</small>
                  <b>{mission.accountName}</b>
                  <em>
                    Ask for {mission.decisionMaker.name ?? "the operations manager"}
                  </em>
                </div>
                <strong>11 MIN</strong>
              </div>
              <ActionButton onClick={() => move("talk-track")}>
                <MapPin /> I’m outside
              </ActionButton>
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
                {mission.discoveryQuestions.map(question => (
                  <p key={question}>{question}</p>
                ))}
              </div>
              <div className="csm-objections">
                <h3>BE READY FOR</h3>
                <div>
                  {mission.objections.map(objection => (
                    <span key={objection}>{objection}</span>
                  ))}
                </div>
              </div>
              <ActionButton onClick={() => move("outcome")}>
                <Phone /> Record what happened
              </ActionButton>
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
                <textarea
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  placeholder="Met the operations manager. They want pricing for three locations first…"
                  rows={5}
                />
              </label>
              <div className="csm-outcomes">
                <button type="button" onClick={() => finishVisit("won")}>
                  <CheckCircle2 />
                  <span>
                    <b>Account won</b>
                    <small>Agreement or verbal yes</small>
                  </span>
                </button>
                <button type="button" onClick={() => finishVisit("follow_up")}>
                  <Clock3 />
                  <span>
                    <b>Follow-up needed</b>
                    <small>Quote, callback, or second visit</small>
                  </span>
                </button>
                <button type="button" onClick={() => finishVisit("lost")}>
                  <BriefcaseBusiness />
                  <span>
                    <b>Not a fit</b>
                    <small>Record why and improve the radar</small>
                  </span>
                </button>
              </div>
            </>
          ) : null}

          {screen === "complete" ? (
            <>
              <div className={`csm-complete${outcome === "won" ? " is-won" : ""}`}>
                <span>{outcome === "won" ? <CheckCircle2 /> : <Clock3 />}</span>
                <small>{mission.code}</small>
                <h1>
                  {outcome === "won"
                    ? "Account won."
                    : outcome === "follow_up"
                      ? "Follow-up mission created."
                      : "Mission learned from."}
                </h1>
                <p>{mission.accountName}</p>
                {outcome === "won" ? (
                  <strong>
                    <CircleDollarSign /> {annualValue} estimated annual value
                  </strong>
                ) : null}
              </div>
              <div className="csm-summary">
                <article>
                  <small>MISSION STATUS</small>
                  <b>{mission.status.replace("_", " ").toUpperCase()}</b>
                </article>
                <article>
                  <small>ACCOUNT</small>
                  <b>{mission.accountName}</b>
                </article>
                <article>
                  <small>VISIT NOTES</small>
                  <b>{notes || "No notes recorded"}</b>
                </article>
              </div>
              <ActionButton onClick={() => setLocation("/territory-preview")}>
                Return to territory <ArrowRight />
              </ActionButton>
              <ActionButton secondary onClick={resetDemo}>
                Replay demo mission
              </ActionButton>
            </>
          ) : null}
        </section>

        <footer className="csm-footer">
          <span>
            <Sparkles /> Same mission on every screen
          </span>
          <small>ID {missionId}</small>
        </footer>
      </div>
    </main>
  );
}
