import { useState } from "react";
import {
  Bell,
  Check,
  ChevronRight,
  Map,
  MapPin,
  Menu,
  PhoneCall,
  ShieldAlert,
  X,
} from "lucide-react";
import type { Order } from "@shared/types";
import type { CommercialMission } from "@shared/commercialMission";
import type {
  FieldMoveCandidate,
  FieldMovesResult,
  FieldTodayItem,
  FieldTodayProjection,
} from "../../../../server/field/types";
import type {
  ArmoryItem,
  ArchetypeSummary,
} from "../../../../server/armory/armoryTypes";
import type { MissionDiamond } from "../../../../server/commercialMissions/driverSalesMotivationService";
import type { DayResolution } from "../../../../server/unload/unloadTypes";
import type { GoldlineLocationSnapshot } from "../driver/goldlineDriverModel";
import {
  GOLDLINE_ROUTE_ANCHORS,
  goldlineAnchorStyle,
} from "./goldlineRouteAnchors";
import world from "@/assets/goldline/goldline-world.png";
import vorgan from "@/assets/goldline/vorgan.png";
import objects from "@/assets/goldline/action-objects.png";
import "./goldline-home.css";

const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

type Panel =
  | "objectives"
  | "calls"
  | "menu"
  | "route"
  | "vorgan"
  | "build"
  | "unload";

type RouteStop = {
  key: string;
  orderId?: number;
  missionId?: number;
  name: string;
  time: string;
  type: "PICKUP" | "DROPOFF" | "PAYMENT BLOCKED" | "SALES CALL" | "SIDE QUEST";
  tone: "gold" | "cyan" | "violet";
  address: string;
  valueLabel?: string;
  sortKey: string;
  navigationUrl?: string;
  destinationPath?: string;
  resolveStatus?: "collected" | "delivered";
  paymentPath?: string;
  move?: FieldMoveCandidate;
};

type RouteCompletion = {
  stopKey: string;
  name: string;
  status: "collected" | "delivered";
  phase: "confirming" | "advancing";
};

type AdaptiveMeter = {
  points: number;
  maxPoints: number;
  progress: number;
  levelLabel: string;
  nextLevelHint: string;
  recentWins: number;
};

type GoldlineArmory = {
  items: ArmoryItem[];
  archetypes: ArchetypeSummary[];
  currentTactic: MissionDiamond;
};

type ActiveDispatch = {
  id: string | number;
  missionId: number;
  queuedAt: string | Date;
  destinationPath: string;
};

type GoldlineHomeProps = {
  pickups?: Order[];
  deliveries?: Order[];
  salesMissions?: CommercialMission[];
  today?: FieldTodayProjection;
  moves?: FieldMovesResult;
  meter?: AdaptiveMeter;
  armory?: GoldlineArmory;
  location: GoldlineLocationSnapshot;
  dayResolution: DayResolution | null;
  activeDispatch?: ActiveDispatch;
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  isLoading?: boolean;
  isResolvingOrder?: boolean;
  isAcceptingMove?: boolean;
  isResolvingDay?: boolean;
  onResolveOrder: (
    orderId: number,
    status: "collected" | "delivered"
  ) => Promise<boolean>;
  onAcceptMove: (move: FieldMoveCandidate) => Promise<void>;
  onOpenWalkIn: () => void;
  onOpenNewOrder: () => void;
  onOpenJournal: () => void;
  onResolveDay: () => Promise<void>;
  onOpenDispatch?: () => Promise<void>;
};

function getLocalYmd(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dateFromYmd(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateLabel(value: string): string {
  return dateFromYmd(value)
    .toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
    .toUpperCase();
}

function weekdayLabel(value: string): string {
  return dateFromYmd(value)
    .toLocaleDateString("en-US", { weekday: "short" })
    .toUpperCase();
}

function orderName(order: Order): string {
  const fullName = `${order.firstName ?? ""} ${order.lastName ?? ""}`.trim();
  return fullName || order.address || `ORDER #${order.id}`;
}

function mapsUrl(address: string | null | undefined): string | undefined {
  return address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : undefined;
}

function toRouteStop(order: Order, type: "PICKUP" | "DROPOFF"): RouteStop {
  const isPickup = type === "PICKUP";
  const blocked = !isPickup && !order.paid;
  const time =
    (isPickup ? order.pickupTimeWindow : order.deliveryTimeWindow) ||
    "TIME TBD";
  return {
    key: `${blocked ? "PAYMENT-BLOCKED" : type}-${order.id}`,
    orderId: order.id,
    name: orderName(order),
    time,
    type: blocked ? "PAYMENT BLOCKED" : type,
    tone: isPickup ? "gold" : "cyan",
    address: order.address || "",
    sortKey: time,
    navigationUrl: mapsUrl(order.address),
    resolveStatus: isPickup ? "collected" : blocked ? undefined : "delivered",
    paymentPath: blocked
      ? `/payment-reconciliation?orderId=${order.id}`
      : undefined,
  };
}

function moneyLabel(cents: number | null | undefined): string | undefined {
  if (!cents || cents <= 0) return undefined;
  return `${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)}/YR EST.`;
}

function missionTimeLabel(mission: CommercialMission): {
  label: string;
  sortKey: string;
} {
  const deadline =
    mission.steps.find(step => step.deadlineAt)?.deadlineAt ??
    mission.expiresAt;
  if (!deadline) return { label: "TODAY", sortKey: "23:59" };
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return { label: "TODAY", sortKey: "23:59" };
  return {
    label: date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }),
    sortKey: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
  };
}

function toSalesStop(mission: CommercialMission): RouteStop {
  const when = missionTimeLabel(mission);
  return {
    key: `SALES-${mission.id}`,
    missionId: mission.id,
    name: mission.account.name || mission.code,
    time: when.label,
    type: "SALES CALL",
    tone: "violet",
    address: mission.account.address || "",
    valueLabel: moneyLabel(mission.opportunity.estimatedAnnualValueCents),
    sortKey: when.sortKey,
    destinationPath: `/driver/sales-mission/${mission.id}`,
  };
}

function toMoveStop(move: FieldMoveCandidate): RouteStop {
  const duration = move.expectedDurationMinutes + (move.travelMinutes ?? 0);
  return {
    key: `MOVE-${move.id}`,
    missionId: move.missionId ?? undefined,
    name: move.target.name,
    time: `${duration} MIN`,
    type: "SIDE QUEST",
    tone: "violet",
    address: move.relevance,
    valueLabel: moneyLabel(move.expectedValue.value?.highCents),
    sortKey: "22:00",
    destinationPath: move.destinationPath,
    move,
  };
}

function formatMoney(cents: number | null): string {
  if (cents == null) return "Amount unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function objectiveDestination(item: FieldTodayItem): string | null {
  return item.actions.find(action => action.href)?.href ?? null;
}

export default function GoldlineHome({
  pickups,
  deliveries,
  salesMissions,
  today,
  moves,
  meter,
  armory,
  location,
  dayResolution,
  activeDispatch,
  selectedDate,
  onSelectedDateChange,
  isLoading = false,
  isResolvingOrder = false,
  isAcceptingMove = false,
  isResolvingDay = false,
  onResolveOrder,
  onAcceptMove,
  onOpenWalkIn,
  onOpenNewOrder,
  onOpenJournal,
  onResolveDay,
  onOpenDispatch,
}: GoldlineHomeProps) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [selectedStop, setSelectedStop] = useState<RouteStop | null>(null);
  const [completedStopKeys, setCompletedStopKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [routeCompletion, setRouteCompletion] =
    useState<RouteCompletion | null>(null);

  const recommendedMoves = moves?.recommendedMoves ?? [];
  const callMoves = recommendedMoves.filter(
    move => move.moveType === "commercial_call"
  );
  const visitMoves = recommendedMoves.filter(
    move => move.moveType === "nearby_commercial_visit"
  );
  const liveObjectives = (today?.timeline ?? []).filter(item =>
    [
      "follow_up",
      "mission_dispatch",
      "route_exception",
      "payment_blocker",
    ].includes(item.kind)
  );

  const orderStops = [
    ...(pickups ?? []).map(order => toRouteStop(order, "PICKUP")),
    ...(deliveries ?? []).map(order => toRouteStop(order, "DROPOFF")),
  ];
  const currentDay = selectedDate === getLocalYmd();
  const salesStops = currentDay ? (salesMissions ?? []).map(toSalesStop) : [];
  const existingMissionIds = new Set(
    salesStops.map(stop => stop.missionId).filter(Boolean)
  );
  const contextualStops = currentDay
    ? visitMoves
        .filter(move => !existingMissionIds.has(move.missionId ?? undefined))
        .map(toMoveStop)
    : [];
  const routeStops = [...orderStops, ...salesStops, ...contextualStops]
    .filter(stop => !completedStopKeys.has(stop.key))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const visibleStops = routeStops.slice(0, 4);
  const hiddenStopCount = Math.max(0, routeStops.length - visibleStops.length);
  const pickupCount = routeStops.filter(stop => stop.type === "PICKUP").length;
  const dropoffCount = routeStops.filter(
    stop => stop.type === "DROPOFF"
  ).length;
  const blockerCount = routeStops.filter(
    stop => stop.type === "PAYMENT BLOCKED"
  ).length;
  const salesCount = routeStops.filter(stop =>
    ["SALES CALL", "SIDE QUEST"].includes(stop.type)
  ).length;
  const activeWeekday = weekdayLabel(selectedDate);
  const hustleProgress = meter ? Math.round(meter.progress * 100) : null;
  const activeArchetype = armory?.archetypes
    .slice()
    .sort((left, right) => right.count - left.count)[0];

  function openRoute(stop?: RouteStop) {
    setSelectedStop(stop ?? null);
    setPanel("route");
  }

  function openDestination(path: string | null | undefined) {
    if (path) window.location.assign(path);
  }

  async function resolveSelectedStop(stop: RouteStop) {
    if (!stop.orderId || !stop.resolveStatus) return;
    const resolved = await onResolveOrder(stop.orderId, stop.resolveStatus);
    if (!resolved) return;
    setCompletedStopKeys(current => {
      const next = new Set(current);
      next.add(stop.key);
      return next;
    });
    setRouteCompletion({
      stopKey: stop.key,
      name: stop.name,
      status: stop.resolveStatus,
      phase: "confirming",
    });
  }

  function beginLaraAdvance() {
    setPanel(null);
    setSelectedStop(null);
    setRouteCompletion(current =>
      current ? { ...current, phase: "advancing" } : null
    );
  }

  const actionItems = [
    { label: "BUILD MISSION", action: () => setPanel("build") },
    { label: "NEW ORDER", action: onOpenNewOrder },
    { label: "LOG A WALK-IN", action: onOpenWalkIn },
    { label: "UNLOAD THE DAY", action: () => setPanel("unload") },
  ];

  return (
    <main className="goldline-shell">
      <section
        className={
          routeCompletion?.phase === "advancing"
            ? "goldline is-route-progressing"
            : "goldline"
        }
        aria-label="Goldline daily adventure map"
      >
        <div className="goldline-world-layer">
          <img
            className="goldline-world"
            src={world}
            alt="Sunlit canyon city crossed by a turquoise route river"
          />
        </div>
        <div className="goldline-sunwash" aria-hidden="true" />
        <div className="goldline-ambient" aria-hidden="true">
          <i className="ambient-1" />
          <i className="ambient-2" />
          <i className="ambient-3" />
          <i className="ambient-4" />
          <i className="ambient-5" />
        </div>

        {routeCompletion?.phase === "advancing" ? (
          <div
            className="goldline-progress-trail"
            aria-hidden="true"
            onAnimationEnd={() => setRouteCompletion(null)}
          >
            <i />
            <i />
            <i />
          </div>
        ) : null}

        <header className="goldline-topbar">
          <button
            className="round-button"
            onClick={() => setPanel("menu")}
            aria-label="Open menu"
          >
            <Menu />
          </button>
          <label className="date-stone" aria-label="Change working date">
            <strong>{formatDateLabel(selectedDate)}</strong>
            <span>
              {weekdays.map(day => (
                <i className={day === activeWeekday ? "active" : ""} key={day}>
                  {day}
                </i>
              ))}
            </span>
            <input
              className="goldline-date-picker"
              type="date"
              value={selectedDate}
              onChange={event => onSelectedDateChange(event.target.value)}
            />
          </label>
          <button
            className={
              liveObjectives.length ? "round-button has-alert" : "round-button"
            }
            onClick={() => setPanel("objectives")}
            aria-label="Open objectives"
          >
            <Bell />
          </button>
        </header>

        {activeDispatch && onOpenDispatch ? (
          <button
            type="button"
            className="goldline-live-dispatch"
            onClick={() => void onOpenDispatch()}
          >
            <small>
              LIVE MISSION ·{" "}
              {new Date(activeDispatch.queuedAt).toLocaleTimeString()}
            </small>
            <strong>MISSION #{activeDispatch.missionId} READY</strong>
            <span>TAP TO BEGIN →</span>
          </button>
        ) : null}

        <button
          className="route-summary"
          onClick={() => openRoute()}
          aria-label="Open today's route"
        >
          <b>TODAY’S ROUTE</b>
          <span>
            <strong className="summary-pickup">{pickupCount}</strong> PICKUPS
            <i>·</i>
            <strong className="summary-dropoff">{dropoffCount}</strong> DROPOFFS
            {blockerCount > 0 ? (
              <>
                <i>·</i>
                <strong className="summary-blocked">{blockerCount}</strong>{" "}
                BLOCKED
              </>
            ) : null}
            {salesCount > 0 ? (
              <>
                <i>·</i>
                <strong className="summary-sales">{salesCount}</strong> SALES
              </>
            ) : null}
          </span>
        </button>

        <section
          className="hustle"
          aria-label={
            hustleProgress == null
              ? "Adaptive sales momentum unavailable"
              : `Sucker to Hustler progress: ${hustleProgress} percent`
          }
        >
          <div className="hustle-labels">
            <span>SUCKER</span>
            <b>{hustleProgress == null ? "—" : `${hustleProgress}%`}</b>
            <span>HUSTLER</span>
          </div>
          <div className="hustle-track">
            <i style={{ width: `${hustleProgress ?? 0}%` }} />
          </div>
          <em className="is-quiet">30-DAY MOMENTUM</em>
        </section>

        <button
          className="vorgan-card"
          onClick={() => setPanel("vorgan")}
          aria-label="Open sourced resistance intelligence"
        >
          <img src={vorgan} alt="Vorgan, the resistance archetype guide" />
          <span className="vorgan-copy">
            <b>VORGAN</b>
            <em>{activeArchetype?.archetype ?? "RESISTANCE QUIET"}</em>
            <small>
              {activeArchetype
                ? `${activeArchetype.count} sourced pattern${activeArchetype.count === 1 ? "" : "s"}`
                : "No personal objection pattern yet"}
            </small>
          </span>
          <ChevronRight className="vorgan-chevron" aria-hidden="true" />
        </button>

        <div className="goldline-route-layer">
          <div className="route-energy-nodes" aria-hidden="true">
            {visibleStops.map((stop, index) => {
              const anchor = GOLDLINE_ROUTE_ANCHORS[index];
              return (
                <i
                  key={stop.key}
                  className={`energy-node is-${stop.tone}`}
                  data-route-anchor={anchor.id}
                  style={{
                    ...goldlineAnchorStyle(anchor),
                    animationDelay: `${index * -0.5}s`,
                  }}
                />
              );
            })}
          </div>

          <div className="route-stops">
            {visibleStops.map((stop, index) => {
              const anchor = GOLDLINE_ROUTE_ANCHORS[index];
              return (
                <button
                  key={stop.key}
                  className={`route-stop is-${stop.tone}${stop.type === "PAYMENT BLOCKED" ? " is-blocked" : ""}`}
                  data-route-anchor={anchor.id}
                  data-label-placement={anchor.labelPlacement}
                  style={goldlineAnchorStyle(anchor)}
                  onClick={() => openRoute(stop)}
                >
                  <span className="route-stop-number">{index + 1}</span>
                  <span className="route-stop-copy">
                    <small className="route-stop-type">{stop.type}</small>
                    <b>{stop.name}</b>
                    <em>
                      {stop.time}
                      {stop.valueLabel ? ` · ${stop.valueLabel}` : ""}
                    </em>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {!isLoading && routeStops.length === 0 ? (
          <button className="route-empty" onClick={() => openRoute()}>
            <b>NO SOURCED ROUTE STOPS</b>
            <small>{formatDateLabel(selectedDate)}</small>
          </button>
        ) : null}

        {isLoading ? (
          <div className="route-loading">LOADING TODAY’S ROUTE…</div>
        ) : null}

        {hiddenStopCount > 0 ? (
          <button className="route-overflow" onClick={() => openRoute()}>
            +{hiddenStopCount} MORE {hiddenStopCount === 1 ? "STOP" : "STOPS"}{" "}
            <ChevronRight />
          </button>
        ) : null}

        {callMoves.length > 0 ? (
          <button className="call-shrine" onClick={() => setPanel("calls")}>
            <PhoneCall />
            <span>
              <b>{callMoves.length} REAL</b>
              <small>
                COLD CALL {callMoves.length === 1 ? "TARGET" : "TARGETS"}
              </small>
            </span>
          </button>
        ) : null}

        <button
          className="objectives-tab"
          onClick={() => setPanel("objectives")}
        >
          FOLLOW-UP
          <br />
          OBJECTIVES <span>{liveObjectives.length}</span>
        </button>

        <nav className="action-bar" aria-label="Primary actions">
          {actionItems.map((item, index) => (
            <button key={item.label} onClick={item.action}>
              <i
                style={{
                  backgroundImage: `url(${objects})`,
                  backgroundPosition: `${index * 33.333}% center`,
                }}
              />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {panel ? (
          <div className="drawer-backdrop" onClick={() => setPanel(null)}>
            <section
              className="goldline-drawer"
              onClick={event => event.stopPropagation()}
            >
              <button
                className="drawer-close"
                onClick={() => setPanel(null)}
                aria-label="Close"
              >
                <X />
              </button>

              {panel === "vorgan" ? (
                <>
                  <p className="drawer-kicker danger">SOURCED RESISTANCE</p>
                  <div className="vorgan-drawer-hero">
                    <img src={vorgan} alt="Vorgan" />
                    <div>
                      <h2>Vorgan</h2>
                      <b>
                        {activeArchetype?.archetype ?? "NO PATTERN EVIDENCED"}
                      </b>
                    </div>
                  </div>
                  <p className="vorgan-drawer-copy">
                    {activeArchetype?.explanation ??
                      "Vorgan stays dormant until your persisted field journals reveal a real resistance pattern."}
                  </p>
                  <div className="rival-readout">
                    <span>
                      <b>{activeArchetype?.count ?? 0}</b>
                      <small>Sourced objections</small>
                    </span>
                    <span>
                      <b>
                        {hustleProgress == null ? "—" : `${hustleProgress}%`}
                      </b>
                      <small>Real momentum</small>
                    </span>
                  </div>
                  <section className="goldline-intel-card">
                    <small>
                      LOADED TACTIC ·{" "}
                      {armory?.currentTactic.provenance.replaceAll("_", " ") ??
                        "unavailable"}
                    </small>
                    <h3>
                      {armory?.currentTactic.title ?? "No tactic available"}
                    </h3>
                    <p>
                      {armory?.currentTactic.response ??
                        "Persist field evidence to load grounded coaching."}
                    </p>
                    {armory?.currentTactic.sourceLabel ? (
                      <em>{armory.currentTactic.sourceLabel}</em>
                    ) : null}
                  </section>
                  {armory?.items.slice(0, 3).map(item => (
                    <section className="goldline-intel-card" key={item.id}>
                      <small>
                        {item.provenance.replaceAll("_", " ")} ·{" "}
                        {item.outcome.replaceAll("_", " ")}
                      </small>
                      <h3>{item.title}</h3>
                      <p>{item.response}</p>
                    </section>
                  ))}
                  <button
                    className="drawer-primary"
                    onClick={() => setPanel(null)}
                  >
                    BACK TO THE GOLDLINE
                  </button>
                </>
              ) : null}

              {panel === "route" ? (
                <>
                  <p className="drawer-kicker">
                    {formatDateLabel(selectedDate)}
                  </p>
                  <h2>Today’s route</h2>
                  <div className="route-counts">
                    <b>{pickupCount} PICKUPS</b>
                    <b>{dropoffCount} DROPOFFS</b>
                    {blockerCount > 0 ? <b>{blockerCount} BLOCKED</b> : null}
                    {salesCount > 0 ? <b>{salesCount} SALES</b> : null}
                  </div>
                  {routeCompletion?.phase === "confirming" ? (
                    <div
                      className="goldline-route-completion"
                      role="status"
                      aria-live="polite"
                      onAnimationEnd={beginLaraAdvance}
                    >
                      <span>
                        <Check />
                      </span>
                      <small>ROUTE ACTION COMPLETE</small>
                      <b>{routeCompletion.name}</b>
                      <strong>
                        {routeCompletion.status === "collected"
                          ? "PICKUP SECURED"
                          : "DELIVERY COMPLETE"}
                      </strong>
                      <em>Goldline advancing…</em>
                    </div>
                  ) : selectedStop ? (
                    <div
                      className={`route-focus-card is-${selectedStop.tone}${selectedStop.type === "PAYMENT BLOCKED" ? " is-blocked" : ""}`}
                    >
                      <small>{selectedStop.type}</small>
                      <b>{selectedStop.name}</b>
                      <strong>
                        {selectedStop.time}
                        {selectedStop.valueLabel
                          ? ` · ${selectedStop.valueLabel}`
                          : ""}
                      </strong>
                      {selectedStop.address ? (
                        <span>{selectedStop.address}</span>
                      ) : null}
                      <div className="goldline-route-actions">
                        {selectedStop.navigationUrl ? (
                          <a
                            href={selectedStop.navigationUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <MapPin /> NAVIGATE
                          </a>
                        ) : null}
                        {selectedStop.resolveStatus && selectedStop.orderId ? (
                          <button
                            type="button"
                            disabled={isResolvingOrder}
                            onClick={() =>
                              void resolveSelectedStop(selectedStop)
                            }
                          >
                            <Check />{" "}
                            {selectedStop.resolveStatus === "collected"
                              ? "MARK COLLECTED"
                              : "MARK DELIVERED"}
                          </button>
                        ) : null}
                        {selectedStop.paymentPath ? (
                          <button
                            type="button"
                            className="is-danger"
                            onClick={() =>
                              openDestination(selectedStop.paymentPath)
                            }
                          >
                            <ShieldAlert /> RESOLVE PAYMENT
                          </button>
                        ) : null}
                        {selectedStop.move ? (
                          <button
                            type="button"
                            disabled={isAcceptingMove}
                            onClick={() =>
                              void onAcceptMove(selectedStop.move!)
                            }
                          >
                            ACCEPT REAL SIDE QUEST
                          </button>
                        ) : null}
                        {!selectedStop.move && selectedStop.destinationPath ? (
                          <button
                            type="button"
                            onClick={() =>
                              openDestination(selectedStop.destinationPath)
                            }
                          >
                            OPEN LIVE MISSION
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {routeCompletion?.phase ===
                  "confirming" ? null : routeStops.length ? (
                    <ul>
                      {routeStops.map((stop, index) => (
                        <li
                          key={stop.key}
                          className={`route-list-item is-${stop.tone}${stop.type === "PAYMENT BLOCKED" ? " is-blocked" : ""}`}
                          onClick={() => setSelectedStop(stop)}
                        >
                          <span>{index + 1}</span>
                          <div>
                            <b>{stop.name}</b>
                            <small>
                              {stop.type} · {stop.time}
                              {stop.valueLabel ? ` · ${stop.valueLabel}` : ""}
                              {stop.address ? ` · ${stop.address}` : ""}
                            </small>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="route-drawer-empty">
                      No sourced route stops for this date. No side quest is
                      fabricated.
                    </p>
                  )}
                  {routeCompletion?.phase !== "confirming" &&
                  today?.nextFixedCommitment ? (
                    <section className="goldline-intel-card">
                      <small>NEXT FIXED COMMITMENT · VERIFIED</small>
                      <h3>{today.nextFixedCommitment.title}</h3>
                      <p>{today.nextFixedCommitment.subtitle}</p>
                    </section>
                  ) : null}
                </>
              ) : null}

              {panel === "objectives" ? (
                <>
                  <p className="drawer-kicker">TODAY’S QUEST LOG</p>
                  <h2>Follow-up objectives</h2>
                  {liveObjectives.length ? (
                    <ul>
                      {liveObjectives.map((item, index) => {
                        const destination = objectiveDestination(item);
                        return (
                          <li
                            key={item.id}
                            className={destination ? "is-actionable" : ""}
                            onClick={() => openDestination(destination)}
                          >
                            <span>{index + 1}</span>
                            <div>
                              <b>{item.title}</b>
                              <small>
                                {item.subtitle} · {item.urgency} ·{" "}
                                {item.verificationClass}
                              </small>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="route-drawer-empty">
                      No sourced follow-up objective is due right now.
                    </p>
                  )}
                </>
              ) : null}

              {panel === "calls" ? (
                <>
                  <p className="drawer-kicker blue">SIDE ENCOUNTER</p>
                  <h2>Real cold call targets</h2>
                  <p className="drawer-truth-note">
                    FIELD feasibility and contact permission have already been
                    applied.
                  </p>
                  <div className="goldline-move-list">
                    {callMoves.map(move => (
                      <article key={move.id}>
                        <PhoneCall />
                        <div>
                          <b>{move.target.name}</b>
                          <small>
                            {move.expectedDurationMinutes} min ·{" "}
                            {move.relevance}
                          </small>
                          <em>
                            {moneyLabel(move.expectedValue.value?.highCents) ??
                              "Value unavailable"}
                          </em>
                        </div>
                        <button
                          type="button"
                          disabled={isAcceptingMove}
                          onClick={() => void onAcceptMove(move)}
                        >
                          ACCEPT
                        </button>
                      </article>
                    ))}
                  </div>
                  <p className="drawer-truth-note">
                    {location.status === "available"
                      ? `Current location snapshot available${location.accuracyMeters == null ? "" : ` · ±${location.accuracyMeters}m`}. It is not continuously tracked.`
                      : (moves?.reason?.replaceAll("_", " ") ??
                        "Location unavailable; backend constraints remain authoritative.")}
                  </p>
                </>
              ) : null}

              {panel === "menu" ? (
                <>
                  <p className="drawer-kicker">GOLDLINE</p>
                  <h2>Live field truth</h2>
                  <ul>
                    <li onClick={() => openRoute()}>
                      <span>
                        <Check />
                      </span>
                      Today’s route · {routeStops.length} sourced stops
                    </li>
                    <li>
                      <span>{pickupCount}</span>Pickups
                    </li>
                    <li>
                      <span>{dropoffCount}</span>Paid dropoffs
                    </li>
                    <li>
                      <span>{blockerCount}</span>Payment blockers
                    </li>
                    <li>
                      <span>{callMoves.length + visitMoves.length}</span>
                      Contextual moves
                    </li>
                    <li>
                      <span>{hustleProgress ?? "—"}</span>Adaptive momentum
                    </li>
                  </ul>
                  <p className="drawer-truth-note">
                    {today?.dataQuality.warnings.join(" · ") ??
                      "FIELD Today is unavailable for the selected date."}
                  </p>
                </>
              ) : null}

              {panel === "build" ? (
                <>
                  <p className="drawer-kicker">MISSION LOADOUT</p>
                  <h2>Today’s sourced mission</h2>
                  <div className="mission-preview">
                    <Map />
                    <div>
                      <b>{routeStops.length} real stops</b>
                      <small>
                        {routeStops.length
                          ? routeStops.map(stop => stop.name).join(" → ")
                          : "No route stops or worthwhile contextual moves are sourced."}
                      </small>
                    </div>
                  </div>
                  <p className="drawer-truth-note">
                    Route order reflects verified schedules and existing mission
                    state. Goldline does not claim to optimize travel until live
                    routing data exists.
                  </p>
                  {moves && moves.reason !== "MOVES_AVAILABLE" ? (
                    <section className="goldline-intel-card">
                      <small>CONTEXTUAL MOVE ENGINE</small>
                      <h3>{moves.reason.replaceAll("_", " ")}</h3>
                      <p>
                        The world stays calm when the backend cannot justify an
                        extra move.
                      </p>
                    </section>
                  ) : null}
                </>
              ) : null}

              {panel === "unload" ? (
                <>
                  <p className="drawer-kicker">END-OF-DAY RESOLVER</p>
                  <h2>Unload the real day</h2>
                  <p className="drawer-truth-note">
                    Resolution reads durable work, payment, mission, recovery,
                    and journal events. Reopening the same date returns the same
                    resolution.
                  </p>
                  <button className="voice-capture" onClick={onOpenJournal}>
                    <ShieldAlert />
                    <span>
                      <b>RECORD FIELD JOURNAL</b>
                      <small>Voice or type persisted coaching evidence</small>
                    </span>
                  </button>
                  <button
                    className="drawer-primary"
                    disabled={isResolvingDay}
                    onClick={() => void onResolveDay()}
                  >
                    {isResolvingDay
                      ? "RESOLVING SOURCED EVENTS…"
                      : "RESOLVE THIS BUSINESS DAY"}
                  </button>
                  {dayResolution ? (
                    <div className="goldline-resolution">
                      <section>
                        <b>{dayResolution.completedWork.length}</b>
                        <small>Completed work</small>
                      </section>
                      <section>
                        <b>{dayResolution.moneyEvents.length}</b>
                        <small>Verified money events</small>
                      </section>
                      <section>
                        <b>{dayResolution.commercialEvents.length}</b>
                        <small>Commercial changes</small>
                      </section>
                      <section>
                        <b>{dayResolution.tomorrowState.itemCount}</b>
                        <small>Tomorrow items</small>
                      </section>
                      <section>
                        <b>{dayResolution.tomorrowState.blockerCount}</b>
                        <small>Tomorrow blockers</small>
                      </section>
                      <section>
                        <b>
                          {dayResolution.journal.status.replaceAll("_", " ")}
                        </b>
                        <small>Journal status</small>
                      </section>
                      {dayResolution.moneyEvents.map(event => (
                        <article key={event.id}>
                          <b>{event.title}</b>
                          <span>
                            {formatMoney(event.amountCents)} ·{" "}
                            {event.verificationClass}
                          </span>
                        </article>
                      ))}
                      {dayResolution.worldDeltas.map(delta => (
                        <article key={delta.id}>
                          <b>{delta.title}</b>
                          <span>{delta.verificationClass}</span>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
