import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  CloudUpload,
  Compass,
  Crown,
  Menu,
  Navigation,
  Route,
  ScrollText,
  Shield,
  Swords,
  UserRound,
  X,
} from "lucide-react";
import type { Order } from "@shared/types";
import type { CommercialMission } from "@shared/commercialMission";
import type { ExternalOperationalOrder } from "@shared/externalOperationalOrder";
import type {
  DayDirectorCommitment,
  DayDirectorProposal,
  ProcessingLocation,
} from "@shared/dayDirector";
import type { OpenChannelMission } from "../../../../server/openChannel/openChannelTypes";
import {
  buildDayPlanProjection,
  type DayPlanStop,
  type LiveAdventureObjective,
} from "../driver/goldlineDayPlanModel";
import type { TerritoryBundleHint } from "@shared/goldlineAdventure";
import world from "@/assets/goldline/generated/goldline-world-empty.png";
import operator from "@/assets/goldline/generated/trailblazer-operator.png";
import { VehicleCargo, type VehicleCargoItem } from "@/components/goldline/VehicleCargo";
import "./goldline-day-plan.css";

export type GoldlineDayPlanProps = {
  businessDate: string;
  pickups?: Order[];
  deliveries?: Order[];
  externalOrders?: ExternalOperationalOrder[];
  openChannelMission?: OpenChannelMission | null;
  salesMissions?: CommercialMission[];
  liveObjectives?: LiveAdventureObjective[];
  territoryBundles?: TerritoryBundleHint[];
  campaignTitle?: string | null;
  campaignChapters?: Array<{ objectiveIds: readonly string[] }>;
  nextCommitmentAt?: string | null;
  isLoading?: boolean;
  onOpenImport: () => void;
  onEnterOperations: () => void;
  onEnterWorld: (trackedStopId?: string) => void;
  onEnterColosseum: () => void;
  processingLocation?: ProcessingLocation | null;
  commitments?: DayDirectorCommitment[];
  intelligenceAvailable?: boolean;
  dismissedPromptKeys?: string[];
  onProposeCommitment?: (sourceText: string) => Promise<DayDirectorProposal>;
  onAcceptProposal?: (proposal: DayDirectorProposal) => Promise<void>;
  onDismissProposal?: (promptKey: string) => Promise<void>;
  onCompleteCommitment?: (commitmentId: string) => Promise<void>;
  cargoFixture?: VehicleCargoItem[];
};

const KIND_LABEL = {
  pickup: "PICKUP",
  dropoff: "DROPOFF",
  sales: "SALES STOP",
  prep: "PREP TASK",
  processing: "PROCESSING",
  growth: "GROWTH",
} as const;

function dateHeading(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function shortTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function evidenceTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).toUpperCase();
}

export function isForcedMobileDayPlanViewport(input: {
  layoutWidth: number;
  screenWidth: number;
  coarsePointer: boolean;
  hoverless: boolean;
}) {
  return (
    input.layoutWidth >= 700 &&
    input.screenWidth <= 699 &&
    input.coarsePointer &&
    input.hoverless
  );
}

function StopCard({
  stop,
  index,
  onEnterColosseum,
  onEnterWorld,
  onCompleteCommitment,
  completingCommitmentId,
}: {
  stop: DayPlanStop;
  index: number;
  onEnterColosseum: () => void;
  onEnterWorld: (trackedStopId?: string) => void;
  onCompleteCommitment?: (commitmentId: string) => Promise<void>;
  completingCommitmentId: string | null;
}) {
  const completedTime = shortTime(stop.completedAt);
  return (
    <article
      className={`gdp-stop gdp-stop--${stop.kind} gdp-stop--${stop.status} gdp-stop--${index % 2 ? "right" : "left"}`}
      data-testid={`day-plan-stop-${stop.id}`}
    >
      <div className="gdp-node" aria-hidden="true">
        {stop.status === "completed" ? (
          <Check />
        ) : (
          KIND_LABEL[stop.kind].slice(0, 1)
        )}
      </div>
      <div className="gdp-card-copy">
        <div className="gdp-card-kicker">
          <span>
            {index + 1} · {KIND_LABEL[stop.kind]}
          </span>
          {stop.status === "ready" && <strong>READY</strong>}
        </div>
        <h2>{stop.title}</h2>
        <div className="gdp-card-meta">
          <span>{stop.timeLabel}</span>
          {stop.fixed && <span>◷ FIXED WINDOW</span>}
        </div>
        <div className="gdp-source">{stop.sourceLabel}</div>
        {stop.whySurfaced ? (
          <details className="gdp-why" data-testid={`why-${stop.id}`}>
            <summary>WHY IS THIS HERE?</summary>
            <p>{stop.whySurfaced}</p>
            <small>
              {evidenceTime(stop.sourceOccurredAt)
                ? `${evidenceTime(stop.sourceOccurredAt)} · FIELD EVIDENCE`
                : "FIELD EVIDENCE"}
            </small>
          </details>
        ) : null}
        {stop.status === "completed" && (
          <div className="gdp-complete">
            <Check /> COMPLETED{completedTime ? ` · ${completedTime}` : ""}
          </div>
        )}
        {onCompleteCommitment &&
          stop.source === "user_commitment" &&
          stop.status !== "completed" && (
            <div className="gdp-mission-actions">
              <button
                type="button"
                disabled={completingCommitmentId === stop.id}
                onClick={() =>
                  onCompleteCommitment?.(stop.id.replace(/^commitment-/, ""))
                }
              >
                <Check />
                {completingCommitmentId === stop.id
                  ? "COMPLETING…"
                  : "MARK COMPLETE"}
              </button>
            </div>
          )}
        {stop.status === "ready" && stop.missionTarget === "colosseum" && (
          <div className="gdp-mission-actions">
            <button type="button" onClick={onEnterColosseum}>
              ENTER MISSION <ChevronRight />
            </button>
            <button type="button" onClick={() => onEnterWorld(stop.id)}>
              <Navigation /> GO THERE IN WORLD
            </button>
          </div>
        )}
        {stop.status === "ready" && stop.source === "living_world" && (
          <div className="gdp-mission-actions">
            <button type="button" onClick={() => onEnterWorld(stop.id)}><Navigation /> ENTER THIS OBJECTIVE IN WORLD</button>
          </div>
        )}
        {stop.status !== "ready" &&
          stop.status !== "completed" &&
          stop.navigationUrl && (
            <a
              className="gdp-map-link"
              href={stop.navigationUrl}
              target="_blank"
              rel="noreferrer"
            >
              <Navigation /> DIRECTIONS
            </a>
          )}
      </div>
    </article>
  );
}

export default function GoldlineDayPlan(props: GoldlineDayPlanProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [directorOpen, setDirectorOpen] = useState(false);
  const [truthText, setTruthText] = useState("");
  const [proposal, setProposal] = useState<DayDirectorProposal | null>(null);
  const [directorBusy, setDirectorBusy] = useState(false);
  const [directorError, setDirectorError] = useState<string | null>(null);
  const [completingCommitmentId, setCompletingCommitmentId] = useState<
    string | null
  >(null);
  const [now, setNow] = useState(() => new Date());
  const [forcedMobileViewport, setForcedMobileViewport] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const updateViewportMode = () => {
      const fixtureOverride =
        import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1" &&
        new URLSearchParams(window.location.search).has(
          "goldlineForcedMobileViewport"
        );
      setForcedMobileViewport(
        fixtureOverride ||
          isForcedMobileDayPlanViewport({
            layoutWidth: window.innerWidth,
            screenWidth: window.screen.width,
            coarsePointer: window.matchMedia("(pointer: coarse)").matches,
            hoverless: window.matchMedia("(hover: none)").matches,
          })
      );
    };
    updateViewportMode();
    window.addEventListener("resize", updateViewportMode);
    return () => window.removeEventListener("resize", updateViewportMode);
  }, []);
  const plan = useMemo(
    () =>
      buildDayPlanProjection({
        businessDate: props.businessDate,
        pickups: props.pickups,
        deliveries: props.deliveries,
        externalOrders: props.externalOrders,
        openChannelMission: props.openChannelMission,
        salesMissions: props.salesMissions,
        liveObjectives: props.liveObjectives,
        territoryBundles: props.territoryBundles,
        campaignChapters: props.campaignChapters,
        nextCommitmentAt: props.nextCommitmentAt,
        processingLocation: props.processingLocation,
        commitments: props.commitments,
        now,
      }),
    [
      props.businessDate,
      props.pickups,
      props.deliveries,
      props.externalOrders,
      props.openChannelMission,
      props.salesMissions,
      props.liveObjectives,
      props.territoryBundles,
      props.campaignChapters,
      props.nextCommitmentAt,
      props.processingLocation,
      props.commitments,
      now,
    ]
  );
  const completedCount = plan.stops.filter(
    stop => stop.status === "completed"
  ).length;
  const progress = plan.stops.length ? completedCount / plan.stops.length : 0;
  const routeStopCount = Math.max(plan.stops.length, 1);
  const nextStop = plan.stops.find(stop => stop.status !== "completed" && stop.status !== "cancelled") ?? null;
  const startNext = () => {
    if (!nextStop) return props.onEnterWorld();
    if (nextStop.missionTarget === "colosseum") return props.onEnterColosseum();
    props.onEnterWorld(nextStop.id);
  };

  return (
    <main
      className={`gdp-shell${forcedMobileViewport ? " gdp-shell--forced-mobile" : ""}`}
      style={{ "--gdp-world": `url(${world})` } as React.CSSProperties}
    >
      <header className="gdp-header">
        <div className="gdp-brand"><Crown /><strong>GOLDLINE DRIVER</strong><small>YOUR DAY. YOUR QUEST.</small></div>
        <p>
          {props.campaignTitle ? `${props.campaignTitle} · ` : "TODAY · "}
          {dateHeading(props.businessDate)}
        </p>
        <button
          className="gdp-menu-button"
          type="button"
          onClick={() => setMenuOpen(value => !value)}
          aria-label="Open menu"
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
        {menuOpen && (
          <div className="gdp-menu">
            <button type="button" onClick={props.onEnterOperations}>
              FIELD OPERATIONS
            </button>
            <button type="button" onClick={() => props.onEnterWorld()}>
              ENTER OVERWORLD
            </button>
          </div>
        )}
        <div className="gdp-counts">
          <div>
            <strong>{plan.counts.pickup}</strong>
            <span>PICKUPS</span>
          </div>
          <div>
            <strong>{plan.counts.dropoff}</strong>
            <span>DROPOFFS</span>
          </div>
          <div>
            <strong>{plan.counts.sales}</strong>
            <span>SALES STOPS</span>
          </div>
          <div>
            <strong>{plan.counts.prep}</strong>
            <span>PREP TASKS</span>
          </div>
        </div>
        <div className="gdp-summary">
          <span>{plan.stops.length} STOPS</span>
          <i>•</i>
          <span>{plan.fixedWindowCount} FIXED WINDOWS</span>
          <i>•</i>
          <span className={plan.cleanCloudCount ? "is-synced" : "is-needed"}>
            {plan.cleanCloudCount
              ? `${plan.cleanCloudCount} CLEANCloud SYNCED`
              : "IMPORT NEEDED"}
          </span>
        </div>
        <button
          className={`gdp-import ${plan.cleanCloudCount ? "is-synced" : ""}`}
          type="button"
          onClick={props.onOpenImport}
        >
          <CloudUpload />
          <span>
            <strong>{plan.cleanCloudCount ? "CLEANCloud" : "IMPORT"}</strong>
            {plan.cleanCloudCount
              ? `${plan.cleanCloudCount} STOPS SYNCED`
              : "TODAY'S ROUTE"}
          </span>
        </button>
      </header>

      <aside className="gdp-player-rail" aria-label="Driver status">
        <div className="gdp-player-card"><img src={operator} alt="Trailblazer" /><span><strong>TRAILBLAZER</strong><small>ON TODAY'S LINE</small></span></div>
        <div className="gdp-status-card"><Shield /><span><strong>LINE STATUS</strong><small>{completedCount} OF {plan.stops.length} STOPS COMPLETE</small></span><i><b style={{ width: `${Math.round(progress * 100)}%` }} /></i></div>
      </aside>
      <VehicleCargo mode="hero" fixtureCargo={props.cargoFixture} />

      <section className="gdp-route" aria-label="Today's Gold Line">
        <svg
          className="gdp-line"
          viewBox="0 0 100 1000"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M18 0 C8 82 84 88 76 190 S12 270 20 370 S91 448 78 560 S8 650 23 760 S89 844 52 1000" />
          <path
            className="gdp-line-complete"
            pathLength="1"
            strokeDasharray={`${progress} 1`}
            d="M18 0 C8 82 84 88 76 190 S12 270 20 370 S91 448 78 560 S8 650 23 760 S89 844 52 1000"
          />
          {[190, 370, 560, 760, 915].map((y, index) => (
            <rect
              key={y}
              className="gdp-checkpoint"
              x={index % 2 ? 72 : 15}
              y={y}
              width="5"
              height="5"
              rx="1"
              transform={`rotate(45 ${index % 2 ? 74.5 : 17.5} ${y + 2.5})`}
            />
          ))}
        </svg>
        <div className="gdp-trailblazer" aria-label="Trailblazer at the current point in the day">
          <img src={operator} alt="" />
          <span>NOW</span>
        </div>
        {plan.growthCoverage !== "covered" &&
          !props.dismissedPromptKeys?.includes("growth-intake") && (
            <button
              className="gdp-director-toggle"
              type="button"
              aria-expanded={directorOpen || Boolean(proposal)}
              onClick={() => setDirectorOpen(value => !value)}
            >
              <Compass /> DAY DIRECTOR
            </button>
          )}
        {props.isLoading && (
          <div className="gdp-empty">Charting today’s Gold Line…</div>
        )}
        {!props.isLoading &&
          plan.growthCoverage !== "covered" &&
          !proposal &&
          directorOpen &&
          !props.dismissedPromptKeys?.includes("growth-intake") && (
            <aside className="gdp-director" data-testid="day-director-intake">
              <strong>DAY DIRECTOR</strong>
              <p>What has to move forward today?</p>
              {!props.intelligenceAvailable && (
                <small>
                  Planning intelligence unavailable — operational route
                  preserved. Add today’s commitment manually.
                </small>
              )}
              <textarea
                aria-label="Today's commitment"
                value={truthText}
                onChange={event => setTruthText(event.target.value)}
                placeholder="Tell me what you committed to, promised, need to sell, or need to finish."
              />
              <div>
                <button
                  type="button"
                  disabled={directorBusy || !truthText.trim()}
                  onClick={async () => {
                    if (!props.onProposeCommitment) return;
                    setDirectorBusy(true);
                    try {
                      setProposal(await props.onProposeCommitment(truthText));
                    } finally {
                      setDirectorBusy(false);
                    }
                  }}
                >
                  {props.intelligenceAvailable ? "REVIEW PLAN" : "ADD MANUALLY"}
                </button>
                <button
                  type="button"
                  disabled={directorBusy}
                  onClick={async () => {
                    await props.onDismissProposal?.("growth-intake");
                    setProposal(null);
                    setDirectorOpen(false);
                  }}
                >
                  NOT NOW
                </button>
              </div>
            </aside>
          )}
        {proposal &&
          !props.dismissedPromptKeys?.includes(proposal.promptKey) && (
            <aside className="gdp-director" data-testid="day-director-proposal">
              <strong>DAY DIRECTOR</strong>
              <p>
                {proposal.title}
                {proposal.quantity ? ` · ${proposal.quantity}` : ""}
              </p>
              {proposal.question && <small>{proposal.question}</small>}
              {directorError && (
                <small className="gdp-director-error" role="alert">
                  {directorError}
                </small>
              )}
              <div>
                <button
                  type="button"
                  disabled={directorBusy}
                  onClick={async () => {
                    setDirectorBusy(true);
                    try {
                      setDirectorError(null);
                      await props.onAcceptProposal?.(proposal);
                      setProposal(null);
                      setTruthText("");
                      setDirectorOpen(false);
                    } catch {
                      setDirectorError(
                        "Could not add this to Today. Please try again."
                      );
                    } finally {
                      setDirectorBusy(false);
                    }
                  }}
                >
                  ADD TO PLAN
                </button>
                <button
                  type="button"
                  disabled={directorBusy}
                  onClick={async () => {
                    setDirectorBusy(true);
                    try {
                      setDirectorError(null);
                      await props.onDismissProposal?.(proposal.promptKey);
                      setProposal(null);
                      setDirectorOpen(false);
                    } catch {
                      setDirectorError(
                        "Could not dismiss this prompt. Please try again."
                      );
                    } finally {
                      setDirectorBusy(false);
                    }
                  }}
                >
                  NOT NOW
                </button>
              </div>
            </aside>
          )}
        {!props.isLoading && plan.stops.length === 0 && (
          <div className="gdp-empty">
            <strong>Your route is open.</strong>
            <span>No pickups or dropoffs are scheduled yet.</span>
          </div>
        )}
        {plan.stops.map((stop, index) => (
          <div
            className="gdp-route-step"
            key={stop.id}
            style={{
              "--gdp-stop-index": index,
              "--gdp-stop-position": `${
                routeStopCount === 1
                  ? 28
                  : 12 + (index * 74) / Math.max(routeStopCount - 1, 1)
              }%`,
            } as React.CSSProperties}
          >
            <StopCard
              stop={stop}
              index={index}
              onEnterColosseum={props.onEnterColosseum}
              onEnterWorld={props.onEnterWorld}
              completingCommitmentId={completingCommitmentId}
              onCompleteCommitment={async commitmentId => {
                const stopId = `commitment-${commitmentId}`;
                setCompletingCommitmentId(stopId);
                try {
                  await props.onCompleteCommitment?.(commitmentId);
                } finally {
                  setCompletingCommitmentId(null);
                }
              }}
            />
          </div>
        ))}
      </section>

      <section className="gdp-next-up" data-testid="day-plan-next-up">
        <div><small>NEXT UP</small><strong>{nextStop?.title ?? "THE LINE IS OPEN"}</strong><span>{nextStop ? `${KIND_LABEL[nextStop.kind]} · ${nextStop.timeLabel}` : "NO SCHEDULED STOP"}</span></div>
        <button type="button" onClick={startNext} disabled={!nextStop}>START EXPEDITION <ChevronRight /></button>
      </section>

      <nav className="gdp-game-nav" aria-label="Goldline navigation">
        <button className="is-active" type="button"><ScrollText /><span>QUESTS</span></button>
        <button type="button" onClick={() => props.onEnterWorld()}><Compass /><span>MAP</span></button>
        <button type="button" onClick={startNext}><Swords /><span>EXPEDITION</span></button>
        <button type="button" onClick={() => props.onEnterWorld()}><Route /><span>GOLD LINE</span></button>
        <button type="button" onClick={props.onEnterOperations}><Shield /><span>RELICS</span></button>
        <button type="button" onClick={() => setMenuOpen(value => !value)}><UserRound /><span>PROFILE</span></button>
      </nav>

      <footer className="gdp-world-entry">
        <button type="button" onClick={() => props.onEnterWorld()}>
          <span>ENTER</span>
          <span>THE WORLD</span>
          <ChevronRight />
        </button>
      </footer>
    </main>
  );
}
