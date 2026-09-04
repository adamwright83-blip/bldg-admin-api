import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, ChevronRight, Loader2, LockKeyhole, X } from "lucide-react";
import { Link } from "wouter";
import type { Order } from "@shared/types";
import type { GoldlineEventEmitter } from "../../game/analytics/emitGoldlineEvent";
import cleanOverworldUrl from "@/assets/goldline/generated/goldline-overworld-clean.png";
import {
  loadOverworldCheckpoint,
  saveOverworldCheckpoint,
} from "./overworld/checkpoint";
import { GoldlineOverworldRuntime } from "./overworld/OverworldRuntime";
import { GOLDLINE_OVERWORLD_MAP } from "./overworld/mapDefinition";
import type { LiveAdventureObjective } from "../driver/goldlineDayPlanModel";
import type {
  DestinationStateMap,
  OverworldProximity,
} from "./overworld/types";
import { DriverTerritorySky } from "@/components/goldline/DriverTerritorySky";
import { CampaignHudConnected } from "@/components/goldline/CampaignHud";
import { CampaignOverlandThread } from "@/components/goldline/CampaignWorldLayer";
import { CampaignChapterHost } from "@/components/goldline/CampaignChapterHost";
import { DynamicJoystick } from "./DynamicJoystick";
import { HustlerLever } from "@/components/driver/HustlerLever";
/*
  The Overworld's own layout. Vite only emits a stylesheet something imports,
  so dropping this line does not merely unstyle a detail — it ships the world
  with no stage box at all: the shell loses its background, the stage loses
  its `min(100vw, 430px)` cap and its `height: 100dvh`, and the canvas
  collapses to two pixels tall. The page then renders as an empty cream sheet
  with the HUD text stacked in the corner, which is exactly what production
  showed after 929123a removed it.
*/
import "./goldline-overworld.css";
import type { CampaignHostInvocation } from "@shared/goldlineCampaignRuntime";

export { DynamicJoystick };

function orderName(order: Order) {
  return (
    `${order.firstName ?? ""} ${order.lastName ?? ""}`.trim() ||
    order.address ||
    `Order #${order.id}`
  );
}

export default function GoldlineOverworld({
  pickups = [],
  deliveries = [],
  isLoading = false,
  activeObjective = null,
  onOpenDayBriefing,
  dayObjectiveCount = 0,
  greystarActive,
  greystarCompleted = false,
  waywardUnlocked = false,
  playerIdentity = null,
  isResolvingOrder = false,
  onEmitEvent,
  onEnterOperations,
  onEnterCampaignHost,
  onEnterGreystar,
  onEnterWayward,
  onResolveOrder,
  suppressCampaignChrome = false,
  onFirstMissionTraversal,
  briefingLabel,
}: {
  pickups?: Order[];
  deliveries?: Order[];
  isLoading?: boolean;
  activeObjective?: LiveAdventureObjective | null;
  /** Opens today's briefing over the world, without leaving it. */
  onOpenDayBriefing?: () => void;
  dayObjectiveCount?: number;
  greystarActive: boolean;
  greystarCompleted?: boolean;
  waywardUnlocked?: boolean;
  playerIdentity?: string | null;
  isResolvingOrder?: boolean;
  onEmitEvent?: GoldlineEventEmitter;
  onEnterOperations?: () => void;
  onEnterCampaignHost?: (hosted: CampaignHostInvocation) => void;
  onEnterGreystar: () => void;
  onEnterWayward?: () => void;
  onResolveOrder: (
    orderId: number,
    status: "collected" | "delivered"
  ) => Promise<boolean>;
  suppressCampaignChrome?: boolean;
  onFirstMissionTraversal?: (traversalId: string) => void;
  briefingLabel?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<GoldlineOverworldRuntime | null>(null);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [guardianPlaying, setGuardianPlaying] = useState(false);
  const [leverOpen, setLeverOpen] = useState(false);
  const [driving, setDriving] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [proximity, setProximity] = useState<OverworldProximity>(null);
  const [lockedMessage, setLockedMessage] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const sessionStartedAt = useRef(performance.now());
  const orderCount = pickups.length + deliveries.length;
  const destinationStates = useMemo<DestinationStateMap>(
    () => ({
      ...Object.fromEntries(GOLDLINE_OVERWORLD_MAP.destinations.filter(destination =>
        GOLDLINE_OVERWORLD_MAP.traversals.some(node => node.id === destination.traversalId && node.kind === "linehook")
      ).map(destination => [destination.id, "active" as const])),
      "greystar-6": greystarCompleted
        ? "completed"
        : greystarActive
          ? "active"
          : "locked",
      "wayward-approach": waywardUnlocked ? "active" : "locked",
    }),
    [greystarActive, greystarCompleted, waywardUnlocked]
  );
  const destinationStatesRef = useRef(destinationStates);
  destinationStatesRef.current = destinationStates;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let runtime: GoldlineOverworldRuntime | null = null;
    void GoldlineOverworldRuntime.create({
      host,
      backgroundUrl: cleanOverworldUrl,
      checkpoint: loadOverworldCheckpoint(playerIdentity),
      destinationStates,
      callbacks: {
        onProximityChange: next => {
          setProximity(next);
          if (next?.canAct) {
            onEmitEvent?.({
              eventName: "mission_approached",
              sessionId,
              properties: {
                sessionId,
                missionState: next.availability,
                overworldDestination: next.destination.id,
              },
            });
          }
        },
        onCheckpoint: checkpoint =>
          saveOverworldCheckpoint(checkpoint, playerIdentity),
        onFirstMove: () =>
          onEmitEvent?.({
            eventName: "corridor_transition_started",
            sessionId,
            properties: { sessionId, corridorId: "overworld-first-movement" },
          }),
        onTraversalComplete: traversalId => {
          onFirstMissionTraversal?.(traversalId);
          onEmitEvent?.({
            eventName: "corridor_transition_completed",
            sessionId,
            properties: { sessionId, corridorId: traversalId },
          });
        },
      },
    })
      .then(created => {
        if (cancelled) {
          void created.destroy();
          return;
        }
        runtime = created;
        runtimeRef.current = created;
        created.setDestinationStates(destinationStatesRef.current);
        setRuntimeReady(true);
        onEmitEvent?.({
          eventName: "goldline_session_started",
          sessionId,
          properties: { sessionId, entryPoint: "global-overworld" },
        });
      })
      .catch(() => {
        if (!cancelled) setRuntimeError(true);
      });
    return () => {
      cancelled = true;
      setRuntimeReady(false);
      runtimeRef.current = null;
      if (runtime) void runtime.destroy();
      onEmitEvent?.({
        eventName: "goldline_session_ended",
        sessionId,
        properties: {
          sessionId,
          durationMs: Math.round(performance.now() - sessionStartedAt.current),
        },
      });
    };
    // Availability is updated through setDestinationStates below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerIdentity]);

  useEffect(() => {
    runtimeRef.current?.setDestinationStates(destinationStates);
  }, [destinationStates]);

  useEffect(() => {
    runtimeRef.current?.setPaused(ordersOpen);
  }, [ordersOpen]);

  useEffect(() => {
    const pressed = new Set<string>();
    const update = () => {
      const x =
        Number(pressed.has("arrowright") || pressed.has("d")) -
        Number(pressed.has("arrowleft") || pressed.has("a"));
      const y =
        Number(pressed.has("arrowdown") || pressed.has("s")) -
        Number(pressed.has("arrowup") || pressed.has("w"));
      const magnitude = Math.hypot(x, y) || 1;
      runtimeRef.current?.setInput(x / magnitude, y / magnitude);
    };
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (
        ![
          "arrowright",
          "arrowleft",
          "arrowdown",
          "arrowup",
          "w",
          "a",
          "s",
          "d",
        ].includes(key)
      )
        return;
      event.preventDefault();
      pressed.add(key);
      update();
    };
    const up = (event: KeyboardEvent) => {
      pressed.delete(event.key.toLowerCase());
      update();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const setRuntimeInput = useCallback((x: number, y: number) => {
    runtimeRef.current?.setInput(x, y);
    setDriving(Math.hypot(x, y) > 0.12);
  }, []);

  function performContextAction() {
    const result = runtimeRef.current?.performContextAction() ?? "none";
    if (result === "entered" && proximity?.destination.id === "greystar-6") {
      onEmitEvent?.({
        eventName: "mission_engaged",
        sessionId,
        properties: {
          sessionId,
          missionState: proximity.availability,
          archetype: "greystar-6-colosseum",
        },
      });
      onEnterGreystar();
    } else if (result === "entered" && proximity?.destination.id === "wayward-approach") {
      onEnterWayward?.();
    } else if (result === "locked") {
      setLockedMessage(
        proximity?.availability === "completed"
          ? `${proximity.destination.name} CONQUERED`
          : `${proximity?.destination.name ?? "THIS DESTINATION"} IS NOT YET REACHABLE`
      );
      window.setTimeout(() => setLockedMessage(null), 2200);
    }
  }

  return (
    <main className="goldline-overworld-shell">
      <section
        className="goldline-overworld"
        aria-label="Goldline global overworld"
      >
        <div ref={hostRef} className="goldline-overworld-runtime" />
        <div className="goldline-overworld-vignette" aria-hidden="true" />

        {!runtimeReady ? (
          <div className="overworld-loading">
            {runtimeError ? (
              <>
                <span>GOLDLINE COULD NOT LOAD</span>
                <button onClick={() => window.location.reload()}>RETRY</button>
              </>
            ) : (
              <>
                <Loader2 /> ENTERING GOLDLINE…
              </>
            )}
          </div>
        ) : null}

        {orderCount > 0 ? (
          <button
            className="overworld-order-count"
            onClick={() => setOrdersOpen(true)}
            aria-label={`Open today's ${orderCount} pickup and dropoff orders`}
          >
            {orderCount}
          </button>
        ) : null}

        {onEnterOperations ? (
          <button
            className="overworld-operations"
            type="button"
            onClick={onEnterOperations}
            aria-label="Open Field Operations"
          >
            FIELD OPS
          </button>
        ) : null}

        {/*
          The lever lives in the world, not behind the briefing. Its whole
          purpose is manufacturing a real sales action mid-play, which a doorway
          you have to go looking for cannot do. Hidden while driving for the
          same reason every other attention-demanding control is.
        */}
        {!driving ? (
          <button
            className="overworld-lever-open"
            type="button"
            onClick={() => setLeverOpen(true)}
            aria-label="Open the Hustler lever"
          >
            HUSTLE
          </button>
        ) : null}
        {leverOpen ? (
          <div className="overworld-lever-layer" role="dialog" aria-modal="true">
            <HustlerLever onClose={() => setLeverOpen(false)} />
          </div>
        ) : null}

        <DriverTerritorySky driving={driving} onEncounterChange={setGuardianPlaying} />
        <CampaignOverlandThread />
        {suppressCampaignChrome ? null : (
          <>
            <CampaignHudConnected compact />
            <CampaignChapterHost
              driving={driving}
              atDestination={Boolean(proximity?.canAct)}
              onHostCurrentChapter={onEnterCampaignHost}
            />
          </>
        )}

        <DynamicJoystick
          disabled={ordersOpen || !runtimeReady || guardianPlaying}
          onInput={setRuntimeInput}
        />

        {/*
          Today's real work, already visible in the world. Tapping it opens the
          fuller briefing over Overland rather than navigating away, so the day
          never reads as a task list bolted onto the side of the game.
        */}
        {activeObjective || dayObjectiveCount > 0 ? (
          <div className="overworld-objective" aria-live="polite">
            {activeObjective ? (
              <>
                <small>{activeObjective.sourceLabel}</small>
                <b>{activeObjective.title}</b>
                {activeObjective.address ? <span>{activeObjective.address}</span> : null}
                {activeObjective.physicalEntityId ? (
                  <Link
                    className="overworld-objective-reveal"
                    href={`/growth/lantern-city?entity=${activeObjective.physicalEntityId}`}
                  >
                    REVEAL THIS PLACE IN THE CITY
                  </Link>
                ) : null}
                <i>{activeObjective.sourceEvidenceReference}</i>
              </>
            ) : (
              <>
                <small>Today</small>
                <b>{dayObjectiveCount} objective{dayObjectiveCount === 1 ? "" : "s"} standing</b>
              </>
            )}
            {onOpenDayBriefing ? (
              <button
                type="button"
                className="overworld-briefing-open"
                onClick={onOpenDayBriefing}
              >
                {briefingLabel ?? "READ TODAY’S BRIEFING"}
              </button>
            ) : null}
          </div>
        ) : null}

        {proximity ? (
          <div className={`overworld-context is-${proximity.availability}`}>
            <small>{proximity.destination.subtitle}</small>
            <b>{proximity.destination.name}</b>
            {proximity.canAct ? (
              <button type="button" onClick={performContextAction}>
                {proximity.availability === "active"
                  ? proximity.destination.id === "greystar-6"
                    ? "ENTER GREYSTAR 6"
                    : proximity.destination.id === "wayward-approach"
                      ? "CROSS THE TETHER"
                      : GOLDLINE_OVERWORLD_MAP.traversals.find(node => node.id === proximity.destination.traversalId)?.label ?? "CONTINUE"
                  : proximity.availability === "completed"
                    ? "CONQUERED"
                    : "INSPECT"}
                {proximity.availability === "locked" ? (
                  <LockKeyhole />
                ) : (
                  <ChevronRight />
                )}
              </button>
            ) : (
              <span>MOVE TO THE ENTRANCE</span>
            )}
          </div>
        ) : null}

        {lockedMessage ? (
          <div className="overworld-locked-message">{lockedMessage}</div>
        ) : null}

        {ordersOpen ? (
          <OrdersOverlay
            pickups={pickups}
            deliveries={deliveries}
            isLoading={isLoading}
            isResolvingOrder={isResolvingOrder}
            onClose={() => setOrdersOpen(false)}
            onResolveOrder={onResolveOrder}
          />
        ) : null}
      </section>
    </main>
  );
}

function OrdersOverlay({
  pickups,
  deliveries,
  isLoading,
  isResolvingOrder,
  onClose,
  onResolveOrder,
}: {
  pickups: Order[];
  deliveries: Order[];
  isLoading: boolean;
  isResolvingOrder: boolean;
  onClose: () => void;
  onResolveOrder: (
    orderId: number,
    status: "collected" | "delivered"
  ) => Promise<boolean>;
}) {
  const orderCount = pickups.length + deliveries.length;
  return (
    <section
      className="overworld-orders"
      aria-label="Today's pickups and dropoffs"
    >
      <header>
        <div>
          <small>TODAY'S ROUTE</small>
          <h1>
            {orderCount} {orderCount === 1 ? "ORDER" : "ORDERS"}
          </h1>
        </div>
        <button onClick={onClose} aria-label="Close orders">
          <X />
        </button>
      </header>
      {isLoading ? (
        <div className="overworld-orders-loading">
          <Loader2 /> SYNCING ORDERS…
        </div>
      ) : (
        <div className="overworld-order-list">
          {pickups.map(order => (
            <article key={`pickup-${order.id}`}>
              <span className="is-pickup">PICKUP</span>
              <div>
                <b>{orderName(order)}</b>
                <small>{order.pickupTimeWindow || "TIME TBD"}</small>
                <p>{order.address || "Address unavailable"}</p>
              </div>
              <button
                disabled={isResolvingOrder}
                onClick={() => void onResolveOrder(order.id, "collected")}
              >
                <Check /> COLLECTED
              </button>
            </article>
          ))}
          {deliveries.map(order => (
            <article key={`dropoff-${order.id}`}>
              <span className="is-dropoff">DROPOFF</span>
              <div>
                <b>{orderName(order)}</b>
                <small>{order.deliveryTimeWindow || "TIME TBD"}</small>
                <p>{order.address || "Address unavailable"}</p>
              </div>
              <button
                disabled={isResolvingOrder || !order.paid}
                onClick={() => void onResolveOrder(order.id, "delivered")}
              >
                <Check /> {order.paid ? "DELIVERED" : "PAYMENT BLOCKED"}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
