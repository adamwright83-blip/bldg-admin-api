import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Day1FieldMission, {
  type Day1TenDoorsMissionView,
} from "./Day1FieldMission";
import {
  COLOSSEUM_VILLAIN_TARGET_ID,
  projectColosseumMission,
} from "./colosseumCampaign";
import ClockheadDuel, { ClockheadPrologue } from "./ClockheadDuel";
import { browserStorage, markPrologueSeen, shouldPlayPrologue } from "./colosseumPrologue";
import { getAudioManager } from "../../game/audio/AudioManager";
import {
  arcadeFeedback,
  combatGuardFeedback,
  combatHurtFeedback,
  combatRevealFeedback,
  taskCompleteFeedback,
} from "../../game/audio/haptics";
import type { Day1TargetOutcome } from "../../../../shared/day1TenDoors";
import { ClockheadConstruct, type ConstructHandle, type ConstructMood } from "./ClockheadConstruct";
import { ColosseumControls, useColosseumInput } from "./ColosseumControls";
import { ColosseumMuteButton } from "./ColosseumMuteButton";
import { ColosseumStageView, prefersReducedMotion, type StageHandle } from "./ColosseumStageView";
import {
  ShieldGlyph,
  TRAILBLAZER_FRAME_URLS,
  TrailblazerSprite,
  depthIndex,
  strideLength,
} from "./ColosseumSprites";
import { AVATAR_TUNING, avatarTorso } from "./colosseumAvatar";
import type { FxFrame } from "./colosseumFx";
import {
  SEARCH_TUNING,
  createSearchArena,
  doorProgress,
  holdSearchArena,
  shieldInReach,
  stepSearchArena,
  type SearchArena,
  type SearchEvent,
} from "./colosseumSearchEngine";
import {
  ARENA_ANCHOR,
  CLOCKHEAD_CENTER,
  COLOSSEUM_DOORS,
  FLOOR_FORESHORTENING,
  SERVICE_ENTRANCE,
  SHIELD_REST,
  STAGE_HEIGHT,
  artPoint,
  gameplayFocus,
  projectColosseumArena,
  sealPoint,
  stagePercent,
  torsoPoint,
  type ColosseumDoorId,
  type StagePoint,
} from "./colosseumStage";
import "./colosseum-arena.css";

type Props = {
  mission: Day1TenDoorsMissionView;
  isRecordingOutcome: boolean;
  onRecordOutcome: (targetId: string, outcome: Day1TargetOutcome) => void;
  onBossDefeated: () => void;
};

export { ColosseumBossLoading } from "./ColosseumLoading";

/**
 * The business contract lives in these three branches and nowhere else:
 * the finale is reachable only when the authoritative five-site campaign is
 * complete, the real hunt is the unmodified field mission, and everything
 * below `ColosseumSearchArena` is fiction layered on top of it.
 *
 * The first-entry prologue is fiction too, and sits after all three: it only
 * plays before the campaign has a single recorded outcome, it cannot reach
 * the finale's unlock, and all it can do is hand the player to the arena.
 */
export default function ColosseumBossGate({
  mission,
  isRecordingOutcome,
  onRecordOutcome,
  onBossDefeated,
}: Props) {
  const campaign = useMemo(() => projectColosseumMission(mission), [mission]);
  const [fieldMode, setFieldMode] = useState(false);
  const [duelStarted, setDuelStarted] = useState(false);
  // Presentation memory only: has this device had its first taste of the fight?
  const [prologue, setPrologue] = useState(() =>
    shouldPlayPrologue(browserStorage(), campaign.missionId, campaign.visitedCount)
  );
  if (duelStarted) {
    return <ClockheadDuel onDefeated={onBossDefeated} />;
  }

  if (fieldMode) {
    return (
      <div className="colosseum-field-mode">
        <button
          type="button"
          className="colosseum-return"
          onClick={() => setFieldMode(false)}
        >
          ← RETURN TO COLOSSEUM
        </button>
        <Day1FieldMission
          mission={campaign}
          isRecordingOutcome={isRecordingOutcome}
          onRecordOutcome={onRecordOutcome}
          onDismiss={() => setFieldMode(false)}
          presentation={{
            eyebrow: "THE SIGNAL IS BLIND INSIDE THE ARENA",
            title: `${campaign.totalCount} REAL SITES`,
            missionLine: `Visit all ${campaign.totalCount} real properties. Record what actually happened. The arena cannot reveal the villain until the trace is complete.`,
          }}
        />
      </div>
    );
  }

  if (prologue && campaign.visitedCount === 0) {
    return (
      <ClockheadPrologue
        onSealed={() => {
          markPrologueSeen(browserStorage(), campaign.missionId);
          setPrologue(false);
        }}
      />
    );
  }

  return (
    <ColosseumSearchArena
      mission={campaign}
      onBeginHunt={() => setFieldMode(true)}
      onVillainFound={() => setDuelStarted(true)}
    />
  );
}

/* ======================================================================== */
/* The search arena — fiction only                                          */
/* ======================================================================== */

const PORTRAIT_SRC = "/assets/goldline/colosseum/clockhead-portrait.webp";
const PAINTED_DOOR_IDS: readonly Exclude<ColosseumDoorId, "VI">[] = [
  "I",
  "II",
  "III",
  "IV",
  "V",
];

/**
 * The painted doors, measured from arena-background-hd.webp (percent of the
 * painting). Used only to swing the painted leaves open; triggers live in
 * `COLOSSEUM_DOORS`.
 */
const DOOR_LEAVES: Record<Exclude<ColosseumDoorId, "VI">, { x0: number; x1: number; y0: number; y1: number }> = {
  I: { x0: 9.7, x1: 17.0, y0: 36.2, y1: 46.3 },
  II: { x0: 27.9, x1: 35.3, y0: 35.6, y1: 45.1 },
  III: { x0: 45.9, x1: 53.8, y0: 35.5, y1: 44.6 },
  IV: { x0: 64.1, x1: 71.4, y0: 35.6, y1: 45.0 },
  V: { x0: 82.4, x1: 89.8, y0: 36.2, y1: 46.3 },
};

const DOOR_VI_PLAQUE = artPoint(78.6, 77.4);

/**
 * The Gold Line's trace around the painted sun emblem: it closes by one fifth
 * per real recorded outcome, read-only from the campaign.
 */
const TRACE_RING_CENTER = artPoint(50, 60.5);
const TRACE_RING_WIDTH = 34;

const SEAL_BREAK_AT_MS = 650;
const SEAL_REVEAL_MS = 1700;
const HUNT_WAKES_AFTER_MS = 14_000;

type Toast = { id: number; kicker: string; title: string; body?: string; tone: "door" | "seal" | "recoil" | "info" };

function seenKey(missionId: string): string {
  return `goldline:colosseum:seen-traces:${missionId}`;
}

function readSeen(missionId: string): number | null {
  try {
    const raw = window.localStorage.getItem(seenKey(missionId));
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeSeen(missionId: string, traced: number) {
  try {
    window.localStorage.setItem(seenKey(missionId), String(traced));
  } catch {
    // Presentation memory only; the arena still renders the truth without it.
  }
}

function searchMood(state: SearchArena): ConstructMood {
  switch (state.stage) {
    case "tell":
      return "tell";
    case "attack":
      return "attack";
    case "disrupted":
      return "disrupted";
    default:
      return "idle";
  }
}

function ColosseumSearchArena({
  mission,
  onBeginHunt,
  onVillainFound,
}: {
  mission: Day1TenDoorsMissionView;
  onBeginHunt: () => void;
  onVillainFound: () => void;
}) {
  // READ-ONLY: the real campaign's own counts, turned into scenery.
  const projection = useMemo(
    () =>
      projectColosseumArena({
        visitedCount: mission.visitedCount,
        totalCount: mission.totalCount,
        isComplete: mission.isComplete,
      }),
    [mission.visitedCount, mission.totalCount, mission.isComplete]
  );

  const unlockedDoors = useMemo(() => {
    const access = new Set<ColosseumDoorId>();
    mission.targets.forEach((target, index) => {
      const doorId = PAINTED_DOOR_IDS[index];
      if (
        doorId &&
        Object.prototype.hasOwnProperty.call(mission.outcomes, target.id)
      ) {
        access.add(doorId);
      }
    });
    return access;
  }, [mission.outcomes, mission.targets]);

  const villainDoorId = useMemo<ColosseumDoorId | null>(() => {
    const index = mission.targets.findIndex(
      target => target.id === COLOSSEUM_VILLAIN_TARGET_ID
    );
    return index >= 0 ? PAINTED_DOOR_IDS[index] ?? null : null;
  }, [mission.targets]);

  const [frame, setFrame] = useState(() => ({ arena: createSearchArena(), stride: 0, now: 0 }));
  const arenaRef = useRef(frame.arena);
  const stageRef = useRef<StageHandle>(null);
  const constructRef = useRef<ConstructHandle>(null);
  const heldRef = useRef(false);
  const spinRef = useRef(0);
  const strideRef = useRef(0);
  const dodgeFromRef = useRef<StagePoint | null>(null);
  const mountedAt = useRef(performance.now());
  const reduced = useRef(prefersReducedMotion());
  const [toast, setToast] = useState<Toast | null>(null);
  const toastId = useRef(0);
  const [tauntVisible, setTauntVisible] = useState(true);
  const [huntAwake, setHuntAwake] = useState(projection.tracedCount > 0);
  const [leaving, setLeaving] = useState(false);

  // Seals that broke since this device last looked at the arena get their
  // moment; the count itself is always the real one.
  // Computed during the first render (not in an effect) so a pending seal is
  // never shown broken for a frame before its reveal.
  const [revealQueue, setRevealQueue] = useState<number[]>(() => {
    const seen = readSeen(mission.missionId);
    const traced = projection.tracedCount;
    if (seen == null || traced <= seen) return [];
    const from = Math.max(0, seen);
    return Array.from({ length: traced - from }, (_, i) => from + i);
  });
  const lastSeenRef = useRef(projection.tracedCount);
  const projectionRef = useRef(projection);
  projectionRef.current = projection;
  const [revealing, setRevealing] = useState<{ index: number; startedAt: number } | null>(null);

  const input = useColosseumInput(!leaving && revealing == null);
  const leavingRef = useRef(false);
  const villainFoundRef = useRef(false);
  const revealingRef = useRef<typeof revealing>(null);
  revealingRef.current = revealing;

  useEffect(() => {
    getAudioManager().primeOnGesture(window);
    for (const src of [PORTRAIT_SRC, ...TRAILBLAZER_FRAME_URLS]) {
      const image = new Image();
      image.decoding = "async";
      image.src = src;
    }
  }, []);

  // Remember what this device has now seen, and queue any seal that breaks
  // while the arena is open (a recorded outcome arriving from elsewhere).
  useEffect(() => {
    const traced = projection.tracedCount;
    const previous = lastSeenRef.current;
    if (traced > previous) {
      setRevealQueue(queue => [
        ...queue,
        ...Array.from({ length: traced - previous }, (_, i) => previous + i),
      ]);
    }
    lastSeenRef.current = traced;
    writeSeen(mission.missionId, traced);
  }, [mission.missionId, projection.tracedCount]);

  const say = useCallback((next: Omit<Toast, "id">) => {
    toastId.current += 1;
    setToast({ ...next, id: toastId.current });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(current => (current?.id === toast.id ? null : current)), toast.tone === "door" ? 2600 : 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setTauntVisible(true);
    const timer = window.setTimeout(() => setTauntVisible(false), 5200);
    return () => window.clearTimeout(timer);
  }, [projection.mood]);

  useEffect(() => {
    if (huntAwake) return;
    const timer = window.setTimeout(() => setHuntAwake(true), HUNT_WAKES_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [huntAwake]);

  // Dequeue the next seal once the previous reveal has finished…
  useEffect(() => {
    if (revealing || revealQueue.length === 0) return;
    const [index, ...rest] = revealQueue;
    setRevealing({ index: index!, startedAt: performance.now() });
    setRevealQueue(rest);
  }, [revealQueue, revealing]);

  // …then play it: the Line runs up from the service entrance, the seal breaks.
  useEffect(() => {
    if (!revealing) return;
    const { index } = revealing;
    const legend = projection.seals[index]?.legend ?? "NOT YET";
    const breakTimer = window.setTimeout(() => {
      getAudioManager().play("seal_break");
      // A real, already-confirmed visit is being shown: the task-complete
      // tier, never the business-victory one.
      taskCompleteFeedback();
      stageRef.current?.shake(0.45);
      const seal = sealPoint(index, projection.seals.length);
      stageRef.current?.fx.debris(seal, 16, ["#ffd36b", "#c89a4a", "#fff4c8"]);
      stageRef.current?.fx.sparks(seal, 18, "#fff6cf", 50);
      say({
        kicker: "REAL SITE TRACED",
        title: `“${legend}” HAS STOPPED`,
        body: "One of his clocks will never run again.",
        tone: "seal",
      });
    }, reduced.current ? 0 : SEAL_BREAK_AT_MS);
    const doneTimer = window.setTimeout(
      () => setRevealing(null),
      reduced.current ? 400 : SEAL_REVEAL_MS
    );
    return () => {
      window.clearTimeout(breakTimer);
      window.clearTimeout(doneTimer);
    };
  }, [projection.seals, revealing, say]);

  const handleEvent = useCallback(
    (event: SearchEvent, arena: SearchArena) => {
      const audio = getAudioManager();
      const stage = stageRef.current;
      const fx = stage?.fx;
      switch (event.type) {
        case "shield_taken":
          audio.play("vault");
          arcadeFeedback();
          fx?.ring(SHIELD_REST, 8, "#ffd36b", 420);
          fx?.sparks(torsoPoint(arena.avatar.feet), 16, "#fff6cf", 40);
          say({
            kicker: "SHIELD TAKEN",
            title: "HOLD GUARD AS A BOLT ARRIVES",
            body: "Raised late, a block is perfect. Three perfect blocks make a RETURN.",
            tone: "info",
          });
          break;
        case "tell":
          audio.play(event.pattern === "sweep" ? "clockhead_sweep" : "clockhead_charge");
          break;
        case "launch":
          audio.play("clockhead_fire");
          fx?.ring(CLOCKHEAD_CENTER, 8, "#8ff3ff", 240);
          break;
        case "hang":
          audio.play("bolt_hang");
          break;
        case "resume":
          audio.play("bolt_resume");
          fx?.ring(event.at, 5, "#ffffff", 220);
          break;
        case "sweep":
          audio.play("clockhead_sweep");
          stage?.shake(0.12);
          break;
        case "block":
          if (event.perfect) {
            audio.play("perfect_block");
            arcadeFeedback();
            fx?.glint(event.at, 6);
            fx?.sparks(event.at, 14, "#fff6cf", 48);
          } else {
            audio.play("shield_clang");
            combatGuardFeedback();
            fx?.sparks(event.at, 9, "#ffd36b", 38);
          }
          stage?.shake(event.perfect ? 0.16 : 0.08);
          break;
        case "parry":
          audio.play("strike_hit");
          fx?.sparks(event.at, 8, "#fff6cf", 40);
          break;
        case "slash":
          audio.play("lineblade_slash");
          fx?.slash(event.at, 1, false);
          break;
        case "hurt":
          audio.play("player_stagger");
          combatHurtFeedback();
          fx?.sparks(event.at, 10, "#ff7a4a", 42);
          stage?.shake(0.4);
          break;
        case "dodge":
          audio.play("dodge");
          fx?.dust(arena.avatar.feet, 5, 2.4);
          dodgeFromRef.current = { ...event.at };
          break;
        case "return":
          audio.play("return_wave");
          combatRevealFeedback();
          fx?.shockwave(event.at);
          stage?.shake(0.6);
          say({ kicker: "RETURN", title: "PROJECTION DISRUPTED", body: "It flickers. He isn’t here to hurt.", tone: "info" });
          break;
        case "door_locked": {
          audio.play("arcade_miss");
          say({
            kicker: `DOOR ${event.door} SEALED`,
            title:
              event.door === "VI"
                ? "NO REAL-WORLD TRACE EXISTS FOR THIS DOOR."
                : "REAL-WORLD TRACE REQUIRED.",
            body:
              event.door === "VI"
                ? "The Republic can argue about Door VI forever. It is not one of the five real targets."
                : "Visit the matching real property first. Then this door can open.",
            tone: "door",
          });
          break;
        }
        case "door_open": {
          audio.play("door_creak");
          if (
            event.door === villainDoorId &&
            projectionRef.current.located &&
            !villainFoundRef.current
          ) {
            villainFoundRef.current = true;
            say({
              kicker: `DOOR ${event.door}`,
              title: "THE TRACE ENDS HERE.",
              body: "You found him.",
              tone: "door",
            });
            setHuntAwake(true);
            window.setTimeout(onVillainFound, reduced.current ? 0 : 420);
            break;
          }
          const door = COLOSSEUM_DOORS.find(candidate => candidate.id === event.door)!;
          say({ kicker: `DOOR ${door.id}`, title: door.claim, tone: "door" });
          setHuntAwake(true);
          break;
        }
        case "door_empty":
          audio.play("arcade_miss");
          stage?.shake(0.12);
          say({
            kicker: `DOOR ${event.door}`,
            title: "THERE IS NOTHING BEHIND IT.",
            body: event.door === "VI" ? "There never was. The real passage is the service entrance beneath the arena." : "He is not in the arena. The trace is out there.",
            tone: "door",
          });
          break;
        case "door_close":
          audio.play("shield_clang");
          break;
        case "recoil_start":
          audio.play("recoil_snap");
          combatHurtFeedback();
          setHuntAwake(true);
          break;
        case "recoil_land":
          audio.play("land");
          fx?.dust(ARENA_ANCHOR, 8, 4);
          stage?.shake(0.3);
          say({ kicker: "RECOIL", title: "THE LINE CAUGHT YOU", body: "Back at the anchor. Nothing real was lost.", tone: "recoil" });
          break;
      }
    },
    [onVillainFound, say, villainDoorId]
  );

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(50, Math.max(0, now - last));
      last = now;
      if (!document.hidden) {
        let arena = arenaRef.current;
        // A seal reveal (or the descent to the real hunt) locks her controls,
        // so the fight itself holds still: whatever was in the air is called
        // off and the simulation does not advance until it is over. Camera
        // and effects keep running.
        const frozen = leavingRef.current || revealingRef.current != null;
        if (frozen) {
          if (!heldRef.current) {
            heldRef.current = true;
            arena = holdSearchArena(arena);
            arenaRef.current = arena;
          }
        } else {
          heldRef.current = false;
          arena = stepSearchArena(arena, dt, input.consume(), unlockedDoors);
          arenaRef.current = arena;
          for (const event of arena.events) handleEvent(event, arena);
        }
        if (arena.avatar.dodgeMs === 0) dodgeFromRef.current = null;

        const spinRate = arena.stage === "tell" ? 160 : arena.stage === "attack" ? 90 : arena.stage === "disrupted" ? 4 : 14;
        spinRef.current += (spinRate * dt) / 1000;
        constructRef.current?.setMotion({
          spin: spinRef.current,
          charge: arena.stage === "tell" ? Math.min(1, arena.clock / SEARCH_TUNING.tellMs) : 0,
          minuteHand: arena.sweep ? arena.sweep.angle + 90 : null,
        });
        const speed = Math.hypot(arena.avatar.velocity.x, arena.avatar.velocity.y);
        strideRef.current += (speed * dt) / 1000 / strideLength(arena.avatar.feet.y);

        const torso = avatarTorso(arena.avatar);
        const revealingNow = revealingRef.current != null;
        const focus = revealingNow
          ? { x: CLOCKHEAD_CENTER.x, y: CLOCKHEAD_CENTER.y + 20 }
          : gameplayFocus(arena.avatar.feet);
        const recoil = arena.stage === "recoil" ? arena.clock : null;
        const fxFrame: FxFrame = {
          origin: CLOCKHEAD_CENTER,
          projectiles: arena.projectiles,
          hologram: true,
          handLength: SEARCH_TUNING.secondHandLength,
          handHalfWidth: SEARCH_TUNING.secondHandHalfWidth,
          sweep: arena.sweep ? { angle: arena.sweep.angle, live: arena.sweep.live, direction: arena.sweep.direction } : null,
          sweepTell:
            arena.stage === "tell" && arena.pattern === "sweep"
              ? (() => {
                  const direction = (arena.sequence + 1) % 2 === 0 ? 1 : -1;
                  return {
                    from: direction === 1 ? SEARCH_TUNING.sweepFromDeg : SEARCH_TUNING.sweepToDeg,
                    to: direction === 1 ? SEARCH_TUNING.sweepToDeg : SEARCH_TUNING.sweepFromDeg,
                    progress: Math.min(1, arena.clock / SEARCH_TUNING.tellMs),
                  };
                })()
              : null,
          deadlines: [],
          deadlineRadius: 10,
          deadlineTell: null,
          goldLine:
            revealingNow && revealingRef.current
              ? {
                  from: SERVICE_ENTRANCE,
                  to: sealPoint(revealingRef.current.index, projectionRef.current.seals.length),
                  t: Math.min(1, (now - revealingRef.current.startedAt) / SEAL_BREAK_AT_MS),
                  mode: "grow",
                }
              : recoil != null &&
                  recoil > SEARCH_TUNING.recoil.drainMs - 120 &&
                  recoil < SEARCH_TUNING.recoil.drainMs + SEARCH_TUNING.recoil.yankMs + 80
                ? {
                    from: torso,
                    to: torsoPoint(ARENA_ANCHOR),
                    t: Math.min(1, Math.max(0, (recoil - SEARCH_TUNING.recoil.drainMs + 120) / SEARCH_TUNING.recoil.yankMs)),
                    mode: "taut",
                  }
                : null,
          reachRing: null,
        };
        stageRef.current?.tick(dt, {
          focus,
          zoom: revealingNow ? 1.1 : 1,
          fx: fxFrame,
          insets: { top: 72, bottom: 118 },
        });
        setFrame({ arena, stride: strideRef.current, now });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [handleEvent, input, unlockedDoors]);

  const beginHunt = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    getAudioManager().play("corridor_transition");
    window.setTimeout(onBeginHunt, reduced.current ? 0 : 480);
  };

  const { arena, stride, now } = frame;
  const door = doorProgress(arena);
  const mood = searchMood(arena);
  const centre = stagePercent(CLOCKHEAD_CENTER);
  const shieldSpot = stagePercent(SHIELD_REST);
  // Memoised: the clock only re-renders when a seal's state actually changes.
  const revealingIndex = revealing?.index ?? null;
  const displayedSeals = useMemo(
    () =>
      projection.seals.map((seal, index) => ({
        ...seal,
        broken: seal.broken && !revealQueue.includes(index) && revealingIndex !== index,
      })),
    [projection.seals, revealQueue, revealingIndex]
  );
  const breakingSeal =
    revealing && now - revealing.startedAt >= (reduced.current ? 0 : SEAL_BREAK_AT_MS) ? revealing.index : null;
  const disrupted = arena.stage === "disrupted";
  const drained = arena.stage === "recoil" && arena.clock < SEARCH_TUNING.recoil.drainMs + SEARCH_TUNING.recoil.yankMs;
  const inReach = shieldInReach(arena);
  const sinceMount = now - mountedAt.current;
  const huntLabel = projection.tracedCount > 0 ? "CONTINUE THE REAL-WORLD HUNT" : "BEGIN REAL-WORLD HUNT";
  const signal = disrupted ? 0.15 : projection.signal;

  return (
    <main
      className={`colosseum-shell colosseum-search${leaving ? " is-leaving" : ""}${revealing ? " is-revealing" : ""}${
        arena.shieldTaken ? " has-shield" : ""
      }`}
      data-testid="colosseum-boss-gate"
      data-mood={projection.mood}
      data-traced={projection.tracedCount}
      data-stage={arena.stage}
      data-guard={arena.avatar.guardPips}
      data-revealing={revealing ? "1" : undefined}
    >
      <ColosseumStageView
        ref={stageRef}
        tone={drained ? "drained" : "normal"}
        onReady={() => {
          mountedAt.current = performance.now();
        }}
      >
        {(Object.keys(DOOR_LEAVES) as Array<keyof typeof DOOR_LEAVES>).map(id => {
          const rect = DOOR_LEAVES[id];
          const active = door?.door.id === id;
          const open = active && !door!.closing;
          const unlocked = unlockedDoors.has(id);
          return (
            <div
              key={id}
              className={`cs-door${open ? " is-open" : ""}${active ? " is-active" : ""}${
                arena.doorsChecked.includes(id) ? " is-checked" : ""
              }${unlocked ? " is-unlocked" : " is-locked"}`}
              style={
                {
                  left: `${rect.x0}%`,
                  top: `${rect.y0}%`,
                  width: `${rect.x1 - rect.x0}%`,
                  height: `${rect.y1 - rect.y0}%`,
                  "--door-x": rect.x0,
                  "--door-y": (rect.y0 / 100) * STAGE_HEIGHT,
                  "--door-w": rect.x1 - rect.x0,
                } as CSSProperties
              }
              aria-hidden="true"
            >
              <i className="cs-door-nothing" />
              <i className="cs-door-leaf cs-door-leaf--left" />
              <i className="cs-door-leaf cs-door-leaf--right" />
              <b className="cs-door-numeral">{id}</b>
            </div>
          );
        })}

        <div
          className={`cs-plaque${door?.door.id === "VI" ? " is-active" : ""}${arena.doorsChecked.includes("VI") ? " is-checked" : ""}`}
          style={{ ...stagePercent(DOOR_VI_PLAQUE), zIndex: depthIndex(DOOR_VI_PLAQUE.y) - 2 }}
          aria-hidden="true"
        >
          <span>VI</span>
        </div>

        <div
          className={`cs-trace-ring${projection.tracedCount > 0 ? " is-lit" : ""}`}
          style={
            {
              ...stagePercent(TRACE_RING_CENTER),
              width: `${TRACE_RING_WIDTH}%`,
              height: `${(TRACE_RING_WIDTH * FLOOR_FORESHORTENING * 100) / STAGE_HEIGHT}%`,
              "--trace": projection.signal,
            } as CSSProperties
          }
          aria-hidden="true"
        />

        <div className="cd-boss-anchor cs-boss-anchor" style={{ left: centre.left, top: centre.top }}>
          <ClockheadConstruct
            ref={constructRef}
            variant="hologram"
            mood={mood}
            seals={displayedSeals}
            breakingSeal={breakingSeal}
            signal={signal}
          />
          <span className="cs-signal-tag">
            {disrupted
              ? "SIGNAL LOST"
              : `LOCATION UNKNOWN · TRACE ${projection.tracedCount}/${projection.totalCount}`}
          </span>
        </div>

        {!arena.shieldTaken && (
          <div
            className={`cs-shield-rest${inReach ? " is-near" : ""}`}
            style={{ left: shieldSpot.left, top: shieldSpot.top, zIndex: depthIndex(SHIELD_REST.y) }}
            aria-hidden="true"
          >
            <i className="cs-shield-glow" />
            <ShieldGlyph className="cs-shield-art" />
          </div>
        )}

        <TrailblazerSprite
          avatar={arena.avatar}
          stride={stride}
          carriesShield={arena.shieldTaken}
          drained={drained}
          dodgeFrom={dodgeFromRef.current}
          showStatus={arena.shieldTaken}
        />
      </ColosseumStageView>

      {/* ---------------- HUD ---------------- */}
      <header className="cs-objective">
        <div className="cs-objective-row">
          <span>THE HUNT</span>
          <div className="cs-seal-pips" aria-hidden="true">
            {displayedSeals.map((seal, index) => (
              <i key={index} className={seal.broken ? "is-broken" : ""} />
            ))}
          </div>
        </div>
        <strong>FIND THE REAL VILLAIN</strong>
        <small>
          {projection.tracedCount} / {projection.totalCount} REAL SITES TRACED
        </small>
      </header>

      <ColosseumMuteButton />

      <p
        className={`cs-taunt${tauntVisible || sinceMount < 5200 ? " is-visible" : ""}`}
        role="status"
        aria-live="polite"
        onClick={() => setTauntVisible(false)}
      >
        <img src={PORTRAIT_SRC} alt="" />
        <span>
          <b>CLOCKHEAD</b>
          {projection.taunt}
        </span>
      </p>

      {toast && (
        <div key={toast.id} className={`cs-toast is-${toast.tone}`} role="status">
          <span>{toast.kicker}</span>
          <strong>{toast.title}</strong>
          {toast.body && <small>{toast.body}</small>}
        </div>
      )}

      {arena.shieldTaken && (
        <p className="cz-sr-only" role="status">
          Guard {arena.avatar.guardPips} of {arena.avatar.maxGuardPips}. Force {arena.avatar.force} of {AVATAR_TUNING.forceMax}
          {arena.avatar.force >= AVATAR_TUNING.forceMax ? ", RETURN ready." : "."}
        </p>
      )}

      {!arena.shieldTaken && (
        <div className={`colosseum-shield-prompt${inReach ? " is-ready" : ""}`}>
          <span>{inReach ? "THE SHIELD IS IN REACH" : "THE SHIELD LIES ON THE SUN"}</span>
          {inReach && (
            <button
              type="button"
              onClick={() => input.press("takeShield")}
              data-testid="colosseum-search-grab-shield"
            >
              TAKE SHIELD
            </button>
          )}
        </div>
      )}

      <ColosseumControls
        input={input}
        disabled={leaving || revealing != null || arena.stage === "door" || arena.stage === "recoil"}
        showActions={arena.shieldTaken}
        canGuard={arena.shieldTaken}
        returnReady={arena.avatar.force >= AVATAR_TUNING.forceMax}
        dodgeReady={arena.avatar.dodgeCooldownMs === 0}
      />

      <div className={`colosseum-hunt-call${huntAwake || projection.located ? " is-awake" : ""}`}>
        {projection.located ? (
          <>
            <span>THE FINAL TRACE IS COMPLETE</span>
            <b>THE VILLAIN IS BEHIND AN UNSEALED DOOR.</b>
          </>
        ) : (
          <>
            <span>{huntAwake ? "THE ANSWER IS OUTSIDE THE ARENA" : "THE SIGNAL IS BLIND"}</span>
            <button type="button" onClick={beginHunt} data-testid="colosseum-begin-hunt">
              <small>SERVICE ENTRANCE ↓</small>
              {huntLabel}
            </button>
          </>
        )}
      </div>

      {leaving && <div className="cs-descend" aria-hidden="true" />}
    </main>
  );
}

