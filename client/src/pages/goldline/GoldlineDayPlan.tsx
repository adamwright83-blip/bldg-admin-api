import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Check,
  ChevronRight,
  CloudUpload,
  Compass,
  Menu,
  X,
  Flame,
} from "lucide-react";
import type { Order } from "@shared/types";
import type { CommercialMission } from "@shared/commercialMission";
import type { ExternalOperationalOrder } from "@shared/externalOperationalOrder";
import type {
  DayDirectorCommitment,
  DayDirectorProposal,
  ProcessingLocation,
} from "@shared/dayDirector";
import type { AuthoredDayRecord } from "@shared/authoredDay";
import type { MissionPlanOutcome } from "@shared/missionDirector";
import {
  executionTypeLabel,
  presentCurrentDayLine,
  type CurrentDayLine,
} from "@shared/currentDayLine";
import type { OpenChannelMission } from "../../../../server/openChannel/openChannelTypes";
import {
  buildDayPlanProjection,
  type DayPlanStop,
  type LiveAdventureObjective,
} from "../driver/goldlineDayPlanModel";
import type { TerritoryBundleHint } from "@shared/goldlineAdventure";
import world from "@/assets/goldline/generated/goldline-world-empty.png";
import operator from "@/assets/goldline/generated/trailblazer-operator.png";
import type { VehicleCargoItem } from "@/components/goldline/VehicleCargo";
import { DriverVehicleDrawer } from "@/components/goldline/DriverVehicleDrawer";
import { DriverStopChapter } from "@/components/goldline/DriverStopChapter";
import { LanternRun } from "@/components/goldline/LanternRun";
import { GoldlineGameNav } from "./GoldlineGameNav";
import "./goldline-day-plan.css";

function CurrentDayLineBlock({ line }: { line: CurrentDayLine }) {
  const presented = presentCurrentDayLine(line);
  return (
    <div data-testid="current-day-line" data-ranking-status={presented.rankingStatus}>
      <p>
        <strong>Today</strong>
      </p>
      {presented.items.length ? (
        <ol>
          {presented.items.map(item => (
            <li
              key={item.id}
              data-day-line-id={item.id}
              data-execution-type={item.executionType ?? "unspecified"}
            >
              {executionTypeLabel(item.executionType)} · {item.title}
            </li>
          ))}
        </ol>
      ) : (
        <p data-testid="current-day-line-status">{presented.statusText}</p>
      )}
      {presented.designated ? (
        <p data-testid="current-day-line-designated">
          {executionTypeLabel(presented.designated.executionType)} · {presented.designated.title}
        </p>
      ) : null}
    </div>
  );
}

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
  loadError?: string | null;
  onRetry?: () => void;
  onResolveStop?: (stop: DayPlanStop) => Promise<boolean>;
  onArchiveStop?: (stop: DayPlanStop) => Promise<boolean>;
  onOpenJournal?: () => void;
  onOpenFirstMission?: () => void;
  onOpenImport: () => void;
  onEnterOperations: () => void;
  onEnterWorld: (trackedStopId?: string) => void;
  onEnterColosseum: () => void;
  /** Opens the Week brochure. Day Line stays the launch surface. */
  onOpenWeek?: () => void;
  processingLocation?: ProcessingLocation | null;
  commitments?: DayDirectorCommitment[];
  intelligenceAvailable?: boolean;
  dismissedPromptKeys?: string[];
  onProposeCommitment?: (sourceText: string) => Promise<DayDirectorProposal>;
  onAcceptProposal?: (proposal: DayDirectorProposal) => Promise<void>;
  onDismissProposal?: (promptKey: string) => Promise<void>;
  onCompleteCommitment?: (commitmentId: string) => Promise<void>;
  authoredDay?: Pick<
    AuthoredDayRecord,
    "headline" | "framing" | "lines" | "status"
  > | null;
  cargoFixture?: VehicleCargoItem[];
  /** Slice 4/5: the Mission Director's plan for tomorrow, surfaced unprompted. */
  missionPlan?: MissionPlanOutcome | null;
  /** Today's prioritized line, already ordered by Mission Director. */
  currentDayLine?: CurrentDayLine | null;
  /** Slice 5 §5.4: shown when Kingdom 2 has unlocked (Kingdom 1 complete). */
  onEnterChapter?: () => void;
  /** Compact Campaign Run identity on the Day Line, when a run exists. */
  campaignRunCard?: {
    title: string;
    iconSrc: string;
    onOpen: () => void;
  } | null;
  rescueMissionCard?: {
    title: string;
    status: string;
    onOpen: () => void;
  } | null;
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
  return parsed
    .toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
    .toUpperCase();
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
  onOpen,
}: {
  stop: DayPlanStop;
  index: number;
  onOpen: () => void;
}) {
  return (
    <article
      className={`gdp-stop gdp-stop--${stop.kind} gdp-stop--${stop.status} gdp-stop--${index % 2 ? "right" : "left"}${
        stop.attentionState === "needs_details"
          ? " gdp-stop--needs-details"
          : ""
      }`}
      data-testid={`day-plan-stop-${stop.id}`}
    >
      <div className="gdp-node" aria-hidden="true">
        {stop.status === "completed" ? <Check /> : index + 1}
      </div>
      <div className="gdp-card-copy">
        <div className="gdp-card-kicker">
          <span>{KIND_LABEL[stop.kind]}</span>
          <strong>
            {stop.status === "completed"
              ? "SEALED"
              : stop.status === "blocked"
                ? "BLOCKED"
                : stop.attentionState === "needs_details"
                  ? "NEEDS DETAILS"
                  : "OPEN"}
          </strong>
        </div>
        <h2>
          <button
            type="button"
            className="gdp-stop-open"
            onClick={onOpen}
            aria-label={`Open ${stop.title}`}
          >
            {stop.title}
            <ChevronRight size={17} />
          </button>
        </h2>
        <div className="gdp-card-meta">
          <span>{stop.timeLabel}</span>
        </div>
        <div className="gdp-source">{stop.sourceLabel}</div>
        {stop.status === "completed" && (
          <div className="gdp-complete">
            <Check /> COMPLETED
            {shortTime(stop.completedAt)
              ? ` · ${shortTime(stop.completedAt)}`
              : ""}
          </div>
        )}
      </div>
    </article>
  );
}
export default function GoldlineDayPlan(props: GoldlineDayPlanProps) {
  const callClaireForMission = trpc.system.claire.callBeforeDrive.useMutation();
  const [activeStop, setActiveStop] = useState<DayPlanStop | null>(null);
  const [playing, setPlaying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [truthText, setTruthText] = useState("");
  const [proposal, setProposal] = useState<DayDirectorProposal | null>(null);
  const [directorBusy, setDirectorBusy] = useState(false);
  const [directorError, setDirectorError] = useState<string | null>(null);
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
        authoredDay: props.authoredDay,
        missionPlan: props.missionPlan,
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
      props.missionPlan,
      props.campaignChapters,
      props.nextCommitmentAt,
      props.processingLocation,
      props.commitments,
      props.authoredDay,
      now,
    ]
  );
  const completedCount = plan.stops.filter(
    stop => stop.status === "completed"
  ).length;
  const progress = plan.stops.length ? completedCount / plan.stops.length : 0;
  const nextStop =
    plan.stops.find(
      stop =>
        stop.status !== "completed" &&
        stop.status !== "cancelled" &&
        stop.status !== "blocked"
    ) ?? null;
  const startNext = () => {
    if (!nextStop) return props.onOpenImport();
    setActiveStop(nextStop);
  };

  return (
    <main
      className={`gdp-shell${forcedMobileViewport ? " gdp-shell--forced-mobile" : ""}`}
      style={{ "--gdp-world": `url(${world})` } as React.CSSProperties}
    >
      <header className="gdp-header">
        <div className="gdp-brand">
          <Compass />
          <strong>GOLDLINE DRIVER</strong>
          <small>SMALL ACTIONS. A WORLD CHANGED.</small>
        </div>
        <p>
          {plan.authoredDay?.headline ??
            (props.campaignTitle ? `${props.campaignTitle} · ` : "TODAY · ")}
          {!plan.authoredDay?.headline && dateHeading(props.businessDate)}
          {plan.authoredDay?.headline
            ? ` · ${dateHeading(props.businessDate)}`
            : null}
        </p>
        {plan.authoredDay?.framing ? (
          <p
            className="gdp-authored-framing"
            data-testid="authored-day-framing"
          >
            {plan.authoredDay.framing}
          </p>
        ) : null}
        {plan.missionPlan ? (
          <div className="gdp-mission-plan" data-testid="mission-director-plan">
            {plan.missionPlan.status === "planned" ? (
              <>
                <p>
                  <strong>Tomorrow's growth mission:</strong>{" "}
                  {plan.missionPlan.primary.title}
                </p>
                <p className="gdp-mission-explanation">
                  {plan.missionPlan.explanation}
                </p>
                <p className="gdp-mission-fallback">
                  If the day changes: {plan.missionPlan.fallback.title}
                </p>
              </>
            ) : plan.missionPlan.status === "fallback_only" ? (
              <>
                <p>
                  <strong>Tomorrow's fallback mission:</strong>{" "}
                  {plan.missionPlan.fallback.title}
                </p>
                <p className="gdp-mission-explanation">
                  {plan.missionPlan.explanation}
                </p>
              </>
            ) : (
              <p className="gdp-mission-explanation">
                {plan.missionPlan.remedy}
              </p>
            )}
          </div>
        ) : null}
        {props.currentDayLine ? (
          <CurrentDayLineBlock line={props.currentDayLine} />
        ) : null}
        {props.onEnterChapter ? (
          <button
            type="button"
            className="gdp-chapter-entry"
            onClick={props.onEnterChapter}
            data-testid="enter-chapter-button"
          >
            A new Kingdom has opened — enter The Last Valet
          </button>
        ) : null}
        {props.campaignRunCard ? (
          <button
            type="button"
            className="gdp-campaign-run-card"
            onClick={props.campaignRunCard.onOpen}
            data-testid="bio-containment-day-line-card"
          >
            <img src={props.campaignRunCard.iconSrc} alt="" />
            <span>
              <small>CAMPAIGN RUN</small>
              <b>{props.campaignRunCard.title}</b>
            </span>
          </button>
        ) : null}
        {props.rescueMissionCard ? (
          <button
            type="button"
            className="gdp-campaign-run-card"
            onClick={props.rescueMissionCard.onOpen}
            data-testid="spirit-human-day-line-card"
          >
            <span>
              <small>RESCUE · {props.rescueMissionCard.status.toUpperCase()}</small>
              <b>{props.rescueMissionCard.title}</b>
            </span>
          </button>
        ) : null}
        <button
          className="gdp-menu-button"
          type="button"
          onClick={() => setMenuOpen(value => !value)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
        {menuOpen && (
          <div className="gdp-menu">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                props.onOpenImport();
              }}
            >
              IMPORT ROUTE
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                props.onEnterOperations();
              }}
            >
              FIELD OPERATIONS
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                props.onEnterWorld();
              }}
            >
              EXPLORE OVERLAND
            </button>
            {props.onOpenFirstMission && (
              <button type="button" onClick={props.onOpenFirstMission}>
                SIDE QUEST · THE FIRST SPARK
              </button>
            )}
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

      <DriverVehicleDrawer
        completed={completedCount}
        total={plan.stops.length}
        cargo={props.cargoFixture}
      />
      <div className="gdp-chapter-invite">
        <span>
          <Flame />
          <strong>THE LANTERN RUN</strong>
          <small>Three lanterns. Find your rhythm.</small>
        </span>
        <button type="button" onClick={() => setPlaying(true)}>
          PLAY <ChevronRight size={15} />
        </button>
      </div>
      {props.loadError && (
        <div className="gdp-load-error" role="alert">
          <strong>Your route needs a connection.</strong>
          <p>{props.loadError}</p>
          <button onClick={props.onRetry}>RETRY ROUTE</button>
        </div>
      )}
      <div className="gdp-trail-heading">
        <span>DAILY LINE</span>
        <span>
          {completedCount} / {plan.stops.length} COMPLETE
        </span>
      </div>

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
        {directorError && !proposal && (
          <div className="gdp-director-error" role="alert">
            {directorError}
          </div>
        )}
        {!props.isLoading &&
          plan.growthCoverage !== "covered" &&
          !proposal &&
          !props.dismissedPromptKeys?.includes("growth-intake") && (
            <details className="gdp-director" data-testid="day-director-intake">
              <summary>
                ADD A COMMITMENT <ChevronRight size={16} />
              </summary>
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
                      setDirectorError(null);
                      setProposal(await props.onProposeCommitment(truthText));
                    } catch {
                      setDirectorError(
                        "Could not prepare this commitment. Your text is kept; please try again."
                      );
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
                    try {
                      await props.onDismissProposal?.("growth-intake");
                      setProposal(null);
                    } catch {
                      setDirectorError(
                        "Could not dismiss this prompt. Please try again."
                      );
                    }
                  }}
                >
                  NOT NOW
                </button>
              </div>
            </details>
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
        {!props.isLoading && !props.loadError && plan.stops.length === 0 && (
          <div className="gdp-empty">
            <strong>A blank page. Your next chapter.</strong>
            <span>
              No stops are scheduled yet. Bring in your route, capture a field
              opportunity, or warm up with a Lantern Run.
            </span>
            <button type="button" onClick={props.onOpenImport}>
              IMPORT OR ADD STOPS <ChevronRight size={16} />
            </button>
            <button
              type="button"
              onClick={props.onOpenJournal ?? props.onEnterOperations}
            >
              OPEN FIELD JOURNAL
            </button>
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
              onOpen={() => setActiveStop(stop)}
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

      <section className="gdp-next-up" data-testid="day-plan-next-up">
        <div>
          <small>NEXT UP</small>
          <strong>{nextStop?.title ?? "THE LINE IS OPEN"}</strong>
          <span>
            {nextStop
              ? `${KIND_LABEL[nextStop.kind]} · ${nextStop.timeLabel}`
              : "NO SCHEDULED STOP"}
          </span>
        </div>
        <button type="button" onClick={startNext} disabled={props.isLoading}>
          {nextStop ? "OPEN CHAPTER" : "ADD STOPS"} <ChevronRight />
        </button>
      </section>

      <GoldlineGameNav
        active="day"
        onYourDay={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        onWeek={props.onOpenWeek}
        onPlay={() => setPlaying(true)}
        onJournal={props.onOpenJournal ?? props.onEnterOperations}
      />
      {activeStop && (
        <DriverStopChapter
          stop={activeStop}
          onClose={() => setActiveStop(null)}
          onResolve={props.onResolveStop}
          onArchive={props.onArchiveStop}
          onCallClaireForMission={async missionId => {
            await callClaireForMission.mutateAsync({
              missionId,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
          }}
          onEnter={() => {
            props.onEnterWorld(activeStop.id);
            setActiveStop(null);
          }}
          onJournal={() => {
            setActiveStop(null);
            (props.onOpenJournal ?? props.onEnterOperations)();
          }}
          onPlay={() => {
            setActiveStop(null);
            setPlaying(true);
          }}
        />
      )}
      {playing && <LanternRun onClose={() => setPlaying(false)} />}

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
