import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  ArrowRight,
  LockKeyhole,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import { trpc } from "@/lib/trpc";
import { TOWER_WARS_ATTACK_THRESHOLD_CENTS } from "@shared/goldlineGameConfig";
import {
  applyTowerWarsEvent,
  canExecuteTowerWarsPromise,
  initialTowerWarsState,
  type TowerDamageState,
  type TowerWarsBattleState,
  type TowerWarsBuildingId,
} from "@shared/towerWars";
import { towerComparisonState } from "./towerWarsGeometry";
import { CanonicalBuildingArt } from "./CanonicalBuildingArt";
import { useWorldTransition } from "./WorldTransitionProvider";
import { entityFromSearch } from "./worldTransition";
import {
  adoptWithoutSpectacle,
  chargeFraction,
  readSeenCursor,
  writeSeenCursor,
} from "./spectacle";
import type { SettledStratum } from "./facadeScars";

export { damageStateForIncomingAttacks } from "@shared/towerWars";
export type TowerWarsData =
  inferRouterOutputs<AppRouter>["system"]["towerWars"]["today"];
type TowerWarsProps = { onNavigate: (path: string) => void; compact?: boolean };
type Contributor = {
  identityKey: string;
  customerDisplayName: string;
  customerPhone: string | null;
  contributedValueCents: number;
  orderCount: number;
  events: Array<{ occurredAt: string }>;
};

/**
 * Fixed battlefield order. OPUS always holds the left slot and Century Park East the
 * right, because their weapons face each other: OPUS strikes left-to-right, CPE
 * right-to-left. Roles (YOU / RIVAL / leader) are badges and colour only — if role
 * drove the slot, a lead change would make a building physically swap sides and
 * change height, which it previously did.
 */
const ARENA_ORDER: TowerWarsBuildingId[] = ["opus_la", "century_park_east"];

const NAMES: Record<TowerWarsBuildingId, string> = {
  opus_la: "OPUS LA",
  century_park_east: "Century Park East",
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
}

function BuildingArt({
  buildingId,
  strata,
  businessDate,
  incomingToday,
  strikesRevealed,
  charge,
}: {
  buildingId: TowerWarsBuildingId;
  strata: readonly SettledStratum[];
  businessDate: string;
  incomingToday: number;
  strikesRevealed?: number;
  charge: number;
}) {
  // One composition, shared with Home and Lantern City, so the building cannot
  // change identity or weapon between screens.
  return (
    <CanonicalBuildingArt
      buildingId={buildingId}
      businessDate={businessDate}
      strata={strata}
      incomingToday={incomingToday}
      strikesRevealed={strikesRevealed}
      charge={charge}
    />
  );
}

function useReplay(data: TowerWarsData | undefined) {
  const [mode, setMode] = useState<"live" | "playing" | "paused" | "complete">(
    "live"
  );
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<TowerWarsBattleState>(() =>
    initialTowerWarsState()
  );
  const priorAttackCount = useRef(0);
  const [activeAttack, setActiveAttack] = useState<string | null>(null);
  const ledger = data?.ledger ?? [];

  useEffect(() => {
    if (mode !== "playing") return;
    if (index >= ledger.length) {
      setMode("complete");
      return;
    }
    const timer = window.setTimeout(() => {
      setState(previous => {
        const next = applyTowerWarsEvent(previous, ledger[index]!);
        if (next.attacks.length > priorAttackCount.current) {
          setActiveAttack(next.attacks.at(-1)?.attackerBuildingId ?? null);
          window.setTimeout(() => setActiveAttack(null), 650);
        }
        priorAttackCount.current = next.attacks.length;
        return next;
      });
      setIndex(value => value + 1);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [index, ledger, mode]);

  const restart = () => {
    priorAttackCount.current = 0;
    setState(initialTowerWarsState());
    setIndex(0);
    setActiveAttack(null);
    setMode("playing");
  };
  return {
    mode,
    index,
    state: mode === "live" ? data?.state : state,
    activeAttack,
    restart,
    toggle: () =>
      setMode(value => (value === "playing" ? "paused" : "playing")),
  };
}

export function TowerWars({ onNavigate, compact = false }: TowerWarsProps) {
  const [printPromiseId, setPrintPromiseId] = useState<string | null>(null);
  // The building the camera was moving toward, carried from the city.
  const { approaching, arrive, isArriving } = useWorldTransition();
  const enteredFor =
    approaching ??
    (typeof window !== "undefined"
      ? entityFromSearch(window.location.search)
      : null);
  const pieceRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useLayoutEffect(() => {
    if (!enteredFor) return;
    // Report the real destination geometry so the flyer lands exactly on it.
    arrive(enteredFor, pieceRefs.current[enteredFor] ?? null);
  }, [enteredFor, arrive]);
  const settlementQuery = trpc.system.towerWars.settlement.useQuery(
    undefined,
    { staleTime: 60_000 }
  );
  // Tower Wars was the only admin surface that never polled, so a new order never
  // reached an open tab. Siblings poll at 2.5s-60s.
  const today = trpc.system.towerWars.today.useQuery(undefined, {
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const fulfill = trpc.system.towerWars.fulfillPromise.useMutation({
    onSuccess: () => today.refetch(),
  });
  const activate = trpc.system.towerWars.activatePromise.useMutation();
  // Only authoritative events this viewer has never seen may produce spectacle.
  // The cursor is this viewer's own storage — never server truth.
  const [unseenEvents, setUnseenEvents] = useState<string[]>([]);
  const ledgerKey = (today.data?.ledger ?? [])
    .map(e => e.eventId)
    .join("|");
  useEffect(() => {
    const ids = ledgerKey ? ledgerKey.split("|") : [];
    if (!ids.length) return;
    const { cursor, play } = adoptWithoutSpectacle(ids, readSeenCursor());
    writeSeenCursor(cursor);
    setUnseenEvents(play);
  }, [ledgerKey]);
  const data = today.data;
  const replay = useReplay(data);
  if (today.isLoading)
    return (
      <div className="tw-loading">
        Compiling today’s authoritative battle ledger…
      </div>
    );
  if (!data || today.isError)
    return (
      <div className="cr-empty-state">
        <div>
          <strong>Tower Wars is waiting for revenue truth</strong>
          <p>
            The arena remains inactive because the tenant-scoped ledger could
            not be compiled.
          </p>
        </div>
      </div>
    );

  const state = replay.state ?? data.state;
  const opus = state.buildings.opus_la;
  const century = state.buildings.century_park_east;
  const comparison = towerComparisonState(
    opus.revenueCents,
    century.revenueCents
  );
  const hasLoser = comparison.kind === "lead";
  const youId: TowerWarsBuildingId = hasLoser
    ? comparison.leaderIndex === 0
      ? "century_park_east"
      : "opus_la"
    : "opus_la";
  const rivalId: TowerWarsBuildingId =
    youId === "opus_la" ? "century_park_east" : "opus_la";
  const you = state.buildings[youId];
  const rival = state.buildings[rivalId];
  const openPromises = data.promises.filter(promise => !promise.fulfilledAt);
  const actionDefinitions = [
    {
      title: "Fulfill promise",
      types: ["offer_insert", "other"],
      unavailable: "No active permission-backed promise",
    },
    {
      title: "Arm referral",
      types: ["referral_card"],
      unavailable: "No configured referral action",
    },
    {
      title: "Arm loyalty",
      types: ["loyalty_reward"],
      unavailable: "No configured loyalty rule",
    },
    {
      title: "Upgrade presentation",
      types: ["thank_you_presentation"],
      unavailable: "No presentation instruction",
    },
  ] as const;
  const currentContributors = data.contributors[youId] as Contributor[];

  return (
    <main className={`tw-page ${compact ? "is-compact" : ""}`}>
      <section
        className={`tw-arena ${isArriving ? "tw-arriving" : ""}`}
        data-unseen-events={unseenEvents.length}
        aria-labelledby="tower-wars-title"
      >
        <img
          className="tw-environment"
          src="/assets/admin/control-room/tower-wars/battle-environment.jpg"
          alt="Sunlit Los Angeles Tower Wars arena"
        />
        <div className="tw-arena-shade" />
        <header className="tw-scoreboard">
          <div className="tw-score-you">
            <span>{NAMES[youId]}</span>
            <small>
              {hasLoser ? "You · comeback building" : "Tie · no loser assigned"}
            </small>
            <strong>{money(you.revenueCents)}</strong>
          </div>
          <div className="tw-versus">
            <b>TODAY</b>
            <span>
              {comparison.kind === "lead"
                ? `Trailing by ${money(comparison.delta)}`
                : comparison.kind === "even"
                  ? "Even"
                  : "Awaiting first order"}
            </span>
            <em>
              {data.businessDate} · {data.timeZone}
            </em>
          </div>
          <div className="tw-score-rival">
            <span>{NAMES[rivalId]}</span>
            <small>{hasLoser ? "Current rival" : "Comparison building"}</small>
            <strong>{money(rival.revenueCents)}</strong>
          </div>
        </header>
        <h1 id="tower-wars-title" className="sr-only">
          Tower Wars Today
        </h1>
        {ARENA_ORDER.map(buildingId => {
          const building = state.buildings[buildingId];
          return (
            <div
              key={buildingId}
              ref={el => {
                pieceRefs.current[buildingId] = el;
              }}
              className={`tw-piece ${
                isArriving && buildingId === enteredFor ? "is-inbound" : ""
              } ${buildingId === youId ? "tw-piece-you" : "tw-piece-rival"} ${buildingId === "opus_la" ? "is-opus" : "is-century"} ${replay.activeAttack === buildingId ? "is-firing" : ""}`}
              data-damage={building.damage}
            >
              <span
                className={`tw-possession ${buildingId === youId ? "" : "is-rival"}`}
              >
                {hasLoser ? (buildingId === youId ? "You" : "Rival") : "Tie"}
              </span>
              <BuildingArt
                buildingId={buildingId}
                businessDate={data.businessDate}
                strata={
                  settlementQuery.data?.settlement.buildings[buildingId]
                    .strata ?? []
                }
                /* The replay reducer already yields the prefix count, so damage at
                   event N equals business state after event N for free. */
                incomingToday={building.incomingAttackCount}
                /* The $50 threshold, made physical. unspentValueCents already
                   existed but only ever rendered as text. */
                charge={chargeFraction(
                  building.unspentValueCents,
                  TOWER_WARS_ATTACK_THRESHOLD_CENTS
                )}
              />
              <span
                className="tw-projectile"
                data-weapon={buildingId === "opus_la" ? "golf-ball" : "car"}
                aria-hidden
              />
              <span className="tw-damage-vfx" aria-hidden />
              <span className="tw-piece-label">
                <strong>{NAMES[buildingId]}</strong>
                <small>
                  {building.incomingAttackCount} incoming strikes ·{" "}
                  {building.damage.replace("-", " ")}
                </small>
                {settlementQuery.data
                  ? (() => {
                      const settled =
                        settlementQuery.data.settlement.buildings[buildingId]
                          .settledScars;
                      return settled > 0 ? (
                        <em className="tw-piece-history">
                          {settled} repaired across{" "}
                          {
                            settlementQuery.data.settlement.buildings[
                              buildingId
                            ].strata.length
                          }{" "}
                          settled days
                        </em>
                      ) : null;
                    })()
                  : null}
              </span>
            </div>
          );
        })}
        <aside className="tw-truth-hud">
          <span>
            <i />{" "}
            {replay.mode === "live"
              ? "Live compilation"
              : `Replay event ${replay.index} / ${data.ledger.length}`}
          </span>
          <strong>Real orders create attacks</strong>
          <p>
            {data.ledger.length} qualifying events · {data.exclusions.length}{" "}
            held out
          </p>
          <div className="tw-source-breakdown">
            <span>
              <small>Orders today</small>
              <strong>{you.orderCount}</strong>
            </span>
            <span>
              <small>Attacks fired</small>
              <strong>{you.attackCount}</strong>
            </span>
            <span>
              <small>Last revenue</small>
              <strong>
                {you.lastRevenueEventAt
                  ? new Date(you.lastRevenueEventAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "—"}
              </strong>
            </span>
          </div>
          <div className="tw-threshold">
            <ShieldCheck />
            <span>
              <small>Next strike</small>
              <strong>
                {money(you.unspentValueCents)} /{" "}
                {money(TOWER_WARS_ATTACK_THRESHOLD_CENTS)}
              </strong>
            </span>
          </div>
          <div className="tw-replay-controls">
            <button type="button" onClick={replay.restart}>
              <RotateCcw /> Replay Today
            </button>
            {replay.mode !== "live" ? (
              <button type="button" onClick={replay.toggle}>
                {replay.mode === "playing" ? <Pause /> : <Play />}
                {replay.mode === "playing" ? "Pause" : "Play"}
              </button>
            ) : null}
          </div>
        </aside>
      </section>
      <section className="tw-actions" aria-label="Comeback actions">
        {actionDefinitions.map(action => {
          const promise = openPromises.find(
            item =>
              (action.types as readonly string[]).includes(item.promiseType) &&
              item.buildingId === youId &&
              canExecuteTowerWarsPromise(item)
          );
          return (
            <article
              key={action.title}
              className={promise ? "is-eligible" : "is-locked"}
            >
              {promise ? (
                <ShieldCheck aria-hidden />
              ) : (
                <LockKeyhole aria-hidden />
              )}
              <span>
                <small>Authoritative action class</small>
                <strong>{action.title}</strong>
                <p>{promise ? promise.sourceText : action.unavailable}</p>
              </span>
              {promise ? (
                <button
                  type="button"
                  disabled={fulfill.isPending || activate.isPending}
                  onClick={() => {
                    if (promise.promiseType === "offer_insert") {
                      flushSync(() => setPrintPromiseId(promise.id));
                      window.print();
                      if (
                        window.confirm(
                          "Mark this physical promise fulfilled after printing?"
                        )
                      ) {
                        fulfill.mutate({
                          promiseId: promise.id,
                          fulfillmentEvidence:
                            "Owner confirmed printed fulfillment from Tower Wars",
                        });
                      }
                      setPrintPromiseId(null);
                      return;
                    }
                    activate.mutate({ promiseId: promise.id });
                  }}
                >
                  {promise.promiseType === "offer_insert"
                    ? `Print${promise.quantity ? ` ${promise.quantity}` : ""} inserts`
                    : "Arm in Day Director"}
                </button>
              ) : (
                <b>Unavailable</b>
              )}
            </article>
          );
        })}
      </section>
      <section className="tw-contributors">
        <header>
          <div>
            <span>Who built this tower today?</span>
            <h2>{NAMES[youId]} contributors</h2>
          </div>
          <button type="button" onClick={() => onNavigate("/customers")}>
            Open all customer evidence <ArrowRight />
          </button>
        </header>
        {currentContributors.length ? (
          <div>
            {currentContributors.map(contributor => (
              <article key={contributor.identityKey}>
                <strong>{contributor.customerDisplayName}</strong>
                <span>
                  {money(contributor.contributedValueCents)} ·{" "}
                  {contributor.orderCount}{" "}
                  {contributor.orderCount === 1 ? "order" : "orders"}
                </span>
                <small>
                  {contributor.events
                    .map(event =>
                      new Date(event.occurredAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    )
                    .join(" · ")}
                </small>
                {contributor.customerPhone ? (
                  <button
                    type="button"
                    onClick={() =>
                      onNavigate(
                        `/customers?phone=${encodeURIComponent(contributor.customerPhone!)}`
                      )
                    }
                  >
                    Evidence <ArrowRight />
                  </button>
                ) : (
                  <em>Identity unresolved</em>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p>
            No qualifying customer orders have contributed to this building
            today.
          </p>
        )}
      </section>
      <section className="tw-evidence-strip">
        <div>
          <span>Current possession</span>
          <strong>
            {hasLoser
              ? `${NAMES[youId]} is YOU because it is losing today.`
              : "Today is tied. No building is assigned YOU."}
          </strong>
        </div>
        <div>
          <span>Damage rule</span>
          <strong>
            {you.incomingAttackCount} real incoming strikes ·{" "}
            {you.damage.replace("-", " ")}
          </strong>
        </div>
        <div>
          <span>Combat input</span>
          <strong>{money(you.revenueCents)} real order value today</strong>
        </div>
        <button
          type="button"
          onClick={() => onNavigate("/commercial-pipeline")}
        >
          Engineer the comeback <ArrowRight />
        </button>
      </section>
      <section className="tw-print-sheet" aria-hidden="true">
        <h1>Goldline promise fulfillment sheet</h1>
        <p>
          {data.businessDate} · {data.timeZone} · {NAMES[youId]}
        </p>
        {openPromises
          .filter(promise => promise.id === printPromiseId)
          .map(promise => (
            <article key={promise.id}>
              <h2>{promise.quantity ?? "Recorded"} physical inserts</h2>
              <p>{promise.sourceText}</p>
              <small>Promise evidence ID: {promise.id}</small>
            </article>
          ))}
      </section>
    </main>
  );
}
