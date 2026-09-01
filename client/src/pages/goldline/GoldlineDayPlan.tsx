import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  CloudUpload,
  Menu,
  Navigation,
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

  return (
    <main
      className={`gdp-shell${forcedMobileViewport ? " gdp-shell--forced-mobile" : ""}`}
      style={{ "--gdp-world": `url(${world})` } as React.CSSProperties}
    >
      <header className="gdp-header">
        <p>TODAY · {dateHeading(props.businessDate)}</p>
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

      <section className="gdp-route" aria-label="Today's Gold Line">
        <svg
          className="gdp-line"
          viewBox="0 0 100 1000"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M50 0 C18 90 82 145 45 225 S75 365 48 455 S25 610 57 690 S80 825 48 1000" />
          <path
            className="gdp-line-complete"
            pathLength="1"
            strokeDasharray={`${progress} 1`}
            d="M50 0 C18 90 82 145 45 225 S75 365 48 455 S25 610 57 690 S80 825 48 1000"
          />
        </svg>
        {props.isLoading && (
          <div className="gdp-empty">Charting today’s Gold Line…</div>
        )}
        {!props.isLoading &&
          plan.growthCoverage !== "covered" &&
          !proposal &&
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
          <div className="gdp-route-step" key={stop.id}>
            {index === completedCount && (
              <div className="gdp-now">
                <div>
                  <strong>NOW</strong>
                  <span>
                    {now.toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <small>Day-progress position</small>
                </div>
                <img
                  src={operator}
                  alt="Trailblazer at the current point in the day"
                />
              </div>
            )}
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
        {completedCount === plan.stops.length && (
          <div className="gdp-now">
            <div>
              <strong>NOW</strong>
              <span>
                {now.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              <small>Day-progress position</small>
            </div>
            <img
              src={operator}
              alt="Trailblazer at the current point in the day"
            />
          </div>
        )}
      </section>

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
