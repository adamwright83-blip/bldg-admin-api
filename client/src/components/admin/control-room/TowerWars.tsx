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
import { BUILDINGS } from "@shared/buildings";
import {
  applyTowerWarsEvent,
  compileTowerWarsState,
  canExecuteTowerWarsPromise,
  initialTowerWarsState,
  type TowerDamageState,
  type TowerWarsBattleState,
  type TowerWarsBuildingId,
} from "@shared/towerWars";
import { towerComparisonState } from "./towerWarsGeometry";
import { CanonicalBuildingArt } from "./CanonicalBuildingArt";
import {
  datedCollectedOrders,
  projectRegeneration,
  type RegenerationProjection,
} from "./facadeRegeneration";
import { useWorldTransition } from "./WorldTransitionProvider";
import { entityFromSearch } from "./worldTransition";
import {
  chargeFraction,
  markSeen,
  projectLiveEvent,
  readSeenCursor,
  unseenEventIds,
  writeSeenCursor,
} from "./spectacle";
import type { SettledStratum } from "./facadeScars";
import { SiegeComeback } from "./SiegeComeback";
import { impactForAttack, type TowerImpact } from "@shared/towerWarsImpacts";

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
  regeneration,
  impacts,
}: {
  buildingId: TowerWarsBuildingId;
  strata: readonly SettledStratum[];
  businessDate: string;
  incomingToday: number;
  strikesRevealed?: number;
  charge: number;
  regeneration?: RegenerationProjection;
  impacts?: readonly TowerImpact[];
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
      regeneration={regeneration}
      impacts={impacts}
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
  const [businessDate, setBusinessDate] = useState("");
  return <>
    <section aria-label="Battle date" style={{ background: "#fff9e9", color: "#173d47", padding: "64px 20px 20px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
      <label style={{ display: "grid", gap: 8, fontWeight: 700 }}>View sales by payment day <input style={{ background: "#fff", color: "#173d47", colorScheme: "light", border: "2px solid #987321", borderRadius: 8, padding: 10, minHeight: 44, fontSize: 16 }} aria-label="Battle payment date" type="date" value={businessDate} onChange={event => setBusinessDate(event.target.value)} /></label>
      <button style={{ background: "#f7cf68", color: "#173d47", borderRadius: 8, padding: "12px 20px", minHeight: 44, fontWeight: 700 }} type="button" onClick={() => setBusinessDate("")}>Today</button>
      <span>{businessDate ? "Historical battle · real sales, not new revenue. Press Replay selected day to watch." : "Today's totals exclude earlier payments. Select their payment date to see imported sales and residents."}</span>
    </section>
    <TowerWarsDay key={businessDate || "today"} onNavigate={onNavigate} compact={compact} businessDate={businessDate} />
  </>;
}

function TowerWarsDay({ onNavigate, compact = false, businessDate }: TowerWarsProps & { businessDate: string }) {
  const [printPromiseId, setPrintPromiseId] = useState<string | null>(null);
  const [comebackBuilding, setComebackBuilding] = useState<TowerWarsBuildingId | null>(null);
  // The building the camera was moving toward, carried from the city.
  const { approaching, arrive, isArriving, begin, returnPath } = useWorldTransition();
  const enteredFor =
    approaching ??
    (typeof window !== "undefined"
      ? entityFromSearch(window.location.search)
      : null);
  const [isEstablishing, setIsEstablishing] = useState(() => Boolean(!approaching && enteredFor));
  useEffect(() => {
    if (!isEstablishing) return;
    const timer = window.setTimeout(() => setIsEstablishing(false), 420);
    return () => window.clearTimeout(timer);
  }, [isEstablishing]);
  const pieceRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Dated pickup evidence per building. Paired with the settlement's strata to
  // decide how far each facade has been repaired — see facadeRegeneration.ts.
  const buildingWorld = trpc.system.canonicalBuilding.world.useQuery(undefined, {
    staleTime: 60_000,
  });
  const settlementQuery = trpc.system.towerWars.settlement.useQuery(
    undefined,
    { staleTime: 30_000, refetchInterval: 30_000 }
  );
  // Tower Wars was the only admin surface that never polled, so a new order never
  // reached an open tab. Siblings poll at 2.5s-60s.
  const today = trpc.system.towerWars.today.useQuery(businessDate ? { businessDate } : undefined, {
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const trustedData = useRef<TowerWarsData | undefined>(undefined);
  if (today.data) trustedData.current = today.data;
  const fulfill = trpc.system.towerWars.fulfillPromise.useMutation({
    onSuccess: () => today.refetch(),
  });
  const activate = trpc.system.towerWars.activatePromise.useMutation();
  // Only authoritative events this viewer has never seen may produce spectacle.
  // The cursor is this viewer's own storage — never server truth.
  const [unseenEvents, setUnseenEvents] = useState<string[]>([]);
  const [activeSpectacle, setActiveSpectacle] = useState<{
    eventId: string;
    phase: "revenue" | "discharge" | "settle";
    revealedDischarges: number;
  } | null>(null);
  const adoptedThisMount = useRef(false);
  const ledgerKey = (today.data?.ledger ?? [])
    .map(e => e.eventId)
    .join("|");
  const ledgerRevision = today.data
    ? `${today.data.businessDate}|${ledgerKey}`
    : "loading";
  useEffect(() => {
    if (!today.data) return;
    const ids = ledgerKey ? ledgerKey.split("|") : [];
    if (businessDate) return;
    const cursor = readSeenCursor();
    // Every mount adopts its initial authoritative ledger silently. A remount or
    // afternoon direct load is not a new economic event.
    if (!adoptedThisMount.current) {
      adoptedThisMount.current = true;
      writeSeenCursor(markSeen(ids, cursor));
      return;
    }
    const play = unseenEventIds(ids, cursor);
    setUnseenEvents(existing => [
      ...existing,
      ...play.filter(id => id !== activeSpectacle?.eventId && !existing.includes(id)),
    ]);
  }, [ledgerRevision, activeSpectacle?.eventId]);
  const data = today.data ?? trustedData.current;

  /**
   * Report the real destination geometry so the flyer lands exactly on it.
   *
   * This must run AFTER `data` exists, and must be retried when it appears.
   * Tower Wars early-returns a "waiting for revenue truth" panel while `data`
   * is null, so on a cold cache the arena — and therefore every entry in
   * `pieceRefs` — does not exist on first render. arrive() was previously
   * called once on mount with `pieceRefs.current[enteredFor] ?? null`, took the
   * null, silently declined to build a flight, and never ran again because its
   * dependencies never changed.
   *
   * That is why Home -> Tower Wars played the journey and Lantern City ->
   * Tower Wars did not: AdminHome already queries towerWars.today, so the cache
   * was warm and the arena rendered on the first paint, while Lantern City does
   * not query it at all. The traversal was being lost to query cache
   * temperature rather than to anything about the journey itself.
   */
  useLayoutEffect(() => {
    if (!enteredFor) return;
    const destEl = pieceRefs.current[enteredFor];
    // Not laid out yet — wait to be re-run rather than reporting no geometry.
    if (!destEl) return;
    arrive(enteredFor, destEl);
  }, [enteredFor, arrive, data]);
  useEffect(() => {
    if (today.isError || activeSpectacle || unseenEvents.length === 0) return;
    setActiveSpectacle({ eventId: unseenEvents[0]!, phase: "revenue", revealedDischarges: 0 });
    setUnseenEvents(existing => existing.slice(1));
  }, [activeSpectacle, today.isError, unseenEvents]);

  useEffect(() => {
    if (!activeSpectacle || today.isError || !data) return;
    const event = data.ledger.find(item => item.eventId === activeSpectacle.eventId);
    if (!event) return;
    const prior = compileTowerWarsState(
      data.ledger.filter(item => readSeenCursor().seen.includes(item.eventId))
    );
    const total = projectLiveEvent({
      prior,
      event,
      revealedDischarges: activeSpectacle.revealedDischarges,
      thresholdCents: TOWER_WARS_ATTACK_THRESHOLD_CENTS,
    }).totalDischarges;
    const timer = window.setTimeout(() => {
      if (activeSpectacle.phase === "revenue") {
        setActiveSpectacle(current => current && ({
          ...current,
          phase: total > 0 ? "discharge" : "settle",
          revealedDischarges: total > 0 ? 1 : 0,
        }));
        return;
      }
      if (activeSpectacle.phase === "discharge" && activeSpectacle.revealedDischarges < total) {
        setActiveSpectacle(current => current && ({ ...current, revealedDischarges: current.revealedDischarges + 1 }));
        return;
      }
      if (activeSpectacle.phase !== "settle") {
        setActiveSpectacle(current => current && ({ ...current, phase: "settle" }));
        return;
      }
      const cursor = markSeen([event.eventId], readSeenCursor());
      writeSeenCursor(cursor);
      setActiveSpectacle(null);
    }, activeSpectacle.phase === "settle" ? 450 : 700);
    return () => window.clearTimeout(timer);
  }, [activeSpectacle, data, today.isError]);
  const replay = useReplay(data);
  /*
    MUST stay above the early returns below. This was originally placed after
    them, which made it a conditional hook: on a loading render React saw
    fewer hooks than on a loaded one and threw error #310, so Tower Wars
    crashed to the error boundary instead of rendering the arena.
  */
  /**
   * How far this building's settled scars have been repaired.
   *
   * Pairs the settlement's dated strata with dated pickup evidence for the same
   * building. Both halves are authoritative and both are dated, which is what
   * lets a collection be placed before or after a given day's damage. A
   * building with no evidence yields undefined and renders exactly as it always
   * has — full-weight scars.
   */
  const regenerationFor = useMemo(() => {
    const evidence = buildingWorld.data?.restorationEvidence ?? {};
    const settlement = settlementQuery.data?.settlement;
    return (buildingId: TowerWarsBuildingId): RegenerationProjection | undefined => {
      const strata = settlement?.buildings[buildingId]?.strata ?? [];
      if (!strata.length) return undefined;
      const slug = BUILDINGS.find(b => b.id === buildingId)?.slug;
      const rows = slug ? (evidence[slug] ?? []) : [];
      if (!rows.length) return undefined;
      return projectRegeneration({
        orders: datedCollectedOrders(
          rows.map(row => ({ id: row.orderId, status: row.orderStatus })),
          rows.map(row => ({
            orderId: row.orderId,
            sourceEventType: "pickup_completed",
            actualEventTimestamp: row.actualEventTimestamp,
          }))
        ),
        strata,
      });
    };
  }, [buildingWorld.data, settlementQuery.data]);

  if (today.isLoading && !data)
    return (
      <main className="tw-page">
        <section className="tw-cold-world" aria-busy="true">
          <img className="tw-environment" src="/assets/admin/control-room/tower-wars/battle-environment.jpg" alt="Sunlit Los Angeles establishing architecture" />
          <div className="tw-arena-shade" />
          <div className="tw-cold-building">
            {enteredFor ? <CanonicalBuildingArt buildingId={enteredFor} /> : <><CanonicalBuildingArt buildingId="opus_la" /><CanonicalBuildingArt buildingId="century_park_east" /></>}
          </div>
          <div className="tw-cold-copy"><strong>Establishing the building</strong><span>Revenue, winner, charge, and damage remain unclaimed until authoritative truth arrives.</span></div>
        </section>
      </main>
    );
  if (!data)
    return (
      <div className="cr-empty-state">
        <div>
          <strong>Tower Wars is waiting for revenue truth</strong>
          <p>
            {today.error?.message || "The arena remains inactive because the tenant-scoped ledger could not be compiled."}
          </p>
        </div>
      </div>
    );

  const liveSpectacleEvent = activeSpectacle
    ? data.ledger.find(item => item.eventId === activeSpectacle.eventId) ?? null
    : null;
  const spectaclePrior = liveSpectacleEvent
    ? compileTowerWarsState(data.ledger.filter(item => readSeenCursor().seen.includes(item.eventId)))
    : null;
  const spectacleProjection = liveSpectacleEvent && spectaclePrior
    ? projectLiveEvent({
        prior: spectaclePrior,
        event: liveSpectacleEvent,
        revealedDischarges: activeSpectacle?.revealedDischarges ?? 0,
        thresholdCents: TOWER_WARS_ATTACK_THRESHOLD_CENTS,
      })
    : null;
  const state = replay.mode === "live"
    ? spectacleProjection?.state ?? data.state
    : replay.state ?? data.state;
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
  const openPromises = businessDate ? [] : data.promises.filter(promise => !promise.fulfilledAt);
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
      {today.isError ? <div className="tw-confidence" role="status">Live feed interrupted · holding the last trusted world · new claims and mutating actions are suppressed</div> : null}
      {comebackBuilding ? <SiegeComeback buildingId={comebackBuilding} onClose={() => setComebackBuilding(null)} onContinue={pipelineId => onNavigate(`/commercial-pipeline?pipeline=${pipelineId}`)} /> : null}
      <section
        className={`tw-arena ${isArriving || isEstablishing ? "tw-arriving" : ""} ${
          activeSpectacle?.phase === "discharge" ? "is-impact" : ""
        }`}
        data-unseen-events={unseenEvents.length + (activeSpectacle ? 1 : 0)}
        aria-labelledby="tower-wars-title"
      >
        <img
          className="tw-environment"
          src="/assets/admin/control-room/tower-wars/battle-environment.jpg"
          alt="Sunlit Los Angeles Tower Wars arena"
        />
        <div className="tw-arena-shade" />
        {isEstablishing && enteredFor ? <div className="tw-establishing" aria-live="polite"><CanonicalBuildingArt buildingId={enteredFor}/><span>Direct arrival · establishing {NAMES[enteredFor]} in Los Angeles</span></div> : null}
        <header className="tw-scoreboard">
          <div className="tw-score-you">
            <span>{NAMES[youId]}</span>
            <small>
              {hasLoser ? "You · comeback building" : "Tie · no loser assigned"}
            </small>
            <strong>{money(you.revenueCents)}</strong>
          </div>
          <div className="tw-versus">
            <b>{businessDate ? "HISTORY" : "TODAY"}</b>
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
              } ${buildingId === youId ? "tw-piece-you" : "tw-piece-rival"} ${buildingId === "opus_la" ? "is-opus" : "is-century"} ${replay.activeAttack === buildingId || (activeSpectacle?.phase === "discharge" && liveSpectacleEvent?.buildingId === buildingId) ? "is-firing" : ""} ${activeSpectacle?.phase === "revenue" && liveSpectacleEvent?.buildingId === buildingId ? "is-revenue-arriving" : ""}`}
              data-damage={building.damage}
            >
              <span
                className={`tw-possession ${buildingId === youId ? "" : "is-rival"}`}
              >
                {hasLoser ? (buildingId === youId ? "You" : "Rival") : "Tie"}
              </span>
              <BuildingArt
                buildingId={buildingId}
                impacts={(businessDate || replay.mode !== "live"
                  ? state.attacks.map(attack => impactForAttack(attack))
                  : settlementQuery.data?.impacts ?? state.attacks.map(attack => impactForAttack(attack)))
                  .filter(impact => impact.defenderBuildingId === buildingId)}
                businessDate={data.businessDate}
                strata={
                  !businessDate && !settlementQuery.data?.impacts.length ? settlementQuery.data?.settlement.buildings[buildingId]
                    .strata ?? [] : []
                }
                regeneration={businessDate ? undefined : regenerationFor(buildingId)}
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
              {activeSpectacle?.phase === "revenue" && liveSpectacleEvent?.buildingId === buildingId ? <span className="tw-live-revenue" role="status">+{money(liveSpectacleEvent.realOrderValueCents)} real order</span> : null}
              <span className="tw-piece-label">
                <strong>{NAMES[buildingId]}</strong>
                <small>
                  {building.incomingAttackCount} incoming strikes ·{" "}
                  {building.damage.replace("-", " ")}
                </small>
                {!businessDate && settlementQuery.data
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
              ? businessDate ? "Historical compilation" : "Live compilation"
              : `Replay event ${replay.index} / ${data.ledger.length}`}
          </span>
          <strong>Real orders create attacks</strong>
          <p>
            {data.ledger.length} qualifying events · {data.exclusions.length}{" "}
            held out
          </p>
          <div className="tw-source-breakdown">
            <span>
              <small>{businessDate ? "Orders this day" : "Orders today"}</small>
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
              <RotateCcw /> {businessDate ? "Replay selected day" : "Replay Today"}
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
                  disabled={today.isError || fulfill.isPending || activate.isPending}
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
          disabled={!hasLoser || Boolean(businessDate)}
          onClick={() => setComebackBuilding(youId)}
        >
          {hasLoser ? "Engineer the comeback" : "No comeback assigned on a tie"} <ArrowRight />
        </button>
        <button type="button" onClick={() => {
          begin({ entityId: youId, from: "building", to: "city", sourceEl: pieceRefs.current[youId], returnPath, kind: "reverse" });
          onNavigate(returnPath ?? "/growth/lantern-city");
        }}>Return to the city <ArrowRight /></button>
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
