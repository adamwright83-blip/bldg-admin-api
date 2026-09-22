import { useCallback, useEffect, useRef, useState } from "react";
import { getAudioManager } from "@/game/audio/AudioManager";
import {
  arcadeFeedback,
  combatGuardFeedback,
  combatHurtFeedback,
  combatRevealFeedback,
} from "@/game/audio/haptics";
import { ClockheadConstruct, type ConstructMood } from "./ClockheadConstruct";
import { ColosseumControls, useColosseumInput } from "./ColosseumControls";
import { ColosseumStageView, prefersReducedMotion, type StageHandle } from "./ColosseumStageView";
import { TRAILBLAZER_FRAME_URLS, TrailblazerSprite, strideLength } from "./ColosseumSprites";
import {
  CLOCK_ATTACK_ANSWERS,
  CLOCK_ATTACK_NAMES,
  CLOCK_PHASE_NAMES,
  DUEL_BOSS_HP,
  DUEL_TUNING,
  PHASE_FLOOR,
  RECOIL_GUARD_BONUS_MAX,
  createClockDuel,
  mainspringInReach,
  recoilToAnchor,
  stepClockDuel,
  tellProgress,
  type ClockDuel,
  type DuelEvent,
  type DuelPhase,
} from "./clockheadDuelEngine";
import { AVATAR_TUNING, avatarTorso } from "./colosseumAvatar";
import type { FxFrame } from "./colosseumFx";
import {
  ARENA_ANCHOR as ARENA_FEET,
  CLOCKHEAD_CENTER,
  CLOCKHEAD_WINDING_CENTER,
  gameplayFocus,
  stagePercent,
  torsoPoint,
  type StagePoint,
} from "./colosseumStage";
import "./colosseum-arena.css";
import "./clockhead-duel.css";

/**
 * The Clockhead finale.
 *
 * Receives no person record and cannot publish a business outcome. It is only
 * mounted once the real five-site campaign is already complete, and the only
 * thing it can do to the outside world is call `onDefeated` — once, from the
 * victory card, after the fight has actually been won. That callback persists
 * a fantasy unlock (the Wayward route); it records no visit, sale or revenue.
 */

type Scene = "intro" | "fight" | "victory" | "recoil";

const PORTRAIT_SRC = "/assets/goldline/colosseum/clockhead-portrait.webp";
const ROMAN: Record<DuelPhase, string> = { 1: "I", 2: "II", 3: "III" };
const TICK_MS: Record<DuelPhase, number> = { 1: 1000, 2: 760, 3: 560 };

const ARENA_TORSO = torsoPoint(ARENA_FEET);
const INTRO_RIP_MS = 900;
const INTRO_SOLID_MS = 1150;
const INTRO_CARD_MS = 1500;
const VICTORY_TOLL_MS = 380;
const VICTORY_RIP_MS = 1000;
const VICTORY_CARD_MS = 2300;
const RECOIL_YANK_MS = 520;
const RECOIL_CARD_MS = 1150;

type Callout = { id: number; text: string; tone: "perfect" | "hit" | "finisher" | "return" | "info" };

function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
}

/** How far down toward the floor he has sunk to wind himself, 0..1. */
function descent(world: ClockDuel): number {
  if (world.stage !== "exposed") return 0;
  const total = DUEL_TUNING.exposedMs[world.phase] + world.staggerMs;
  const down = easeOut(world.clock / 260);
  const up = easeOut((total - world.clock) / 260);
  return Math.min(down, up);
}

function constructMood(world: ClockDuel, scene: Scene): ConstructMood {
  if (scene === "victory") return "defeated";
  if (scene !== "fight") return "idle";
  switch (world.stage) {
    case "tell":
      return "tell";
    case "attack":
      return "attack";
    case "exposed":
      return "exposed";
    case "phase_break":
      return "break";
    default:
      return "idle";
  }
}

function clockDegreesToward(from: StagePoint, to: StagePoint): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI + 90;
}

export default function ClockheadDuel({ onDefeated }: { onDefeated: () => void }) {
  const [scene, setScene] = useState<Scene>("intro");
  // The intro's clock does not start until the painting is on screen.
  const [artReady, setArtReady] = useState(false);
  const artReadyRef = useRef(false);
  const sceneRef = useRef<Scene>("intro");
  const sceneStartRef = useRef(performance.now());
  const [frame, setFrame] = useState(() => ({ world: createClockDuel(), spin: 0, stride: 0, now: 0 }));
  const worldRef = useRef(frame.world);
  const spinRef = useRef(0);
  const strideRef = useRef(0);
  const dodgeFromRef = useRef<StagePoint | null>(null);
  const bossFlashUntil = useRef(0);
  const hurtUntil = useRef(0);
  const zoomUntil = useRef(0);
  const toneUntil = useRef(0);
  const tickClock = useRef(0);
  const tickParity = useRef(false);
  const tollPlayed = useRef(false);
  const introRipped = useRef(false);
  const recoilFrom = useRef<StagePoint | null>(null);
  const completed = useRef(false);
  const stageRef = useRef<StageHandle>(null);
  const reduced = useRef(prefersReducedMotion());
  const [muted, setMuted] = useState(() => getAudioManager().isMuted);
  const [callout, setCallout] = useState<Callout | null>(null);
  const [banner, setBanner] = useState<{ id: number; phase: DuelPhase } | null>(null);
  const calloutId = useRef(0);
  const input = useColosseumInput(scene === "fight");

  useEffect(() => {
    getAudioManager().primeOnGesture(window);
    for (const src of [PORTRAIT_SRC, ...TRAILBLAZER_FRAME_URLS]) {
      const image = new Image();
      image.decoding = "async";
      image.src = src;
    }
  }, []);

  const goTo = useCallback((next: Scene) => {
    sceneRef.current = next;
    sceneStartRef.current = performance.now();
    setScene(next);
  }, []);

  const pop = useCallback((text: string, tone: Callout["tone"]) => {
    calloutId.current += 1;
    setCallout({ id: calloutId.current, text, tone });
  }, []);

  const handleEvent = useCallback(
    (event: DuelEvent, world: ClockDuel, now: number) => {
      const audio = getAudioManager();
      const stage = stageRef.current;
      const fx = stage?.fx;
      const torso = avatarTorso(world.avatar);
      switch (event.type) {
        case "tell":
          audio.play(event.pattern === "sweep" ? "clockhead_sweep" : "clockhead_charge");
          break;
        case "launch":
          audio.play("clockhead_fire");
          fx?.ring(CLOCKHEAD_CENTER, 9, "#ffd36b", 260);
          stage?.shake(0.08);
          break;
        case "hang":
          audio.play("bolt_hang");
          break;
        case "resume":
          audio.play("bolt_resume");
          fx?.ring(event.at, 5, "#ffffff", 220);
          break;
        case "rewind":
          audio.play("clockhead_sweep");
          toneUntil.current = now + 650;
          stage?.shake(0.22);
          pop("REWOUND", "info");
          break;
        case "sweep":
          audio.play("clockhead_sweep");
          stage?.shake(0.14);
          break;
        case "deadline_mark":
          audio.play("clockhead_charge");
          break;
        case "deadline_slam":
          audio.play("deadline_slam");
          fx?.dust(event.at, 10, 6);
          fx?.ring(event.at, 13, event.deferred ? "#c9a2ff" : "#ffb15a", 380);
          stage?.shake(0.34);
          break;
        case "block":
          if (event.perfect) {
            audio.play("perfect_block");
            arcadeFeedback();
            fx?.glint(event.at, 7);
            fx?.sparks(event.at, 16, "#fff6cf", 52);
            pop(event.force >= AVATAR_TUNING.forceMax ? "RETURN READY" : "PERFECT", "perfect");
          } else {
            audio.play("shield_clang");
            combatGuardFeedback();
            fx?.sparks(event.at, 10, "#ffd36b", 40);
          }
          stage?.shake(event.perfect ? 0.18 : 0.1);
          break;
        case "parry":
          audio.play("strike_hit");
          fx?.sparks(event.at, 9, "#fff6cf", 42);
          break;
        case "slash":
          audio.play("lineblade_slash");
          fx?.slash(torso, 1, false);
          break;
        case "strike_hit": {
          audio.play("lineblade_hit");
          combatRevealFeedback();
          fx?.slash(torso, event.combo, true);
          fx?.sparks(event.at, 16 + event.combo * 6, "#fff6cf", 64);
          fx?.debris(event.at, event.finisher ? 16 : 5);
          if (event.finisher) fx?.ring(event.at, 22, "#9ffcff", 420);
          stage?.shake(event.finisher ? 0.5 : 0.24);
          bossFlashUntil.current = now + (event.finisher ? 200 : 110);
          pop(event.finisher ? "FINISHER" : `HIT ${event.combo}`, event.finisher ? "finisher" : "hit");
          break;
        }
        case "return":
          audio.play("return_wave");
          combatRevealFeedback();
          fx?.shockwave(event.at);
          stage?.shake(0.62);
          bossFlashUntil.current = now + 220;
          pop("RETURN", "return");
          break;
        case "hurt":
          audio.play("player_hurt");
          combatHurtFeedback();
          fx?.sparks(event.at, 12, "#ff7a4a", 46);
          stage?.shake(0.46);
          hurtUntil.current = now + 360;
          break;
        case "dodge":
          audio.play("dodge");
          fx?.dust(world.avatar.feet, 5, 2.6);
          dodgeFromRef.current = { ...event.at };
          break;
        case "exposed":
          // The callsign already says "knocked off schedule"; the RETURN pop
          // from the same frame keeps the moment.
          audio.play("mechanism_align");
          break;
        case "phase_break":
          audio.play("phase_break");
          combatRevealFeedback();
          fx?.debris(CLOCKHEAD_CENTER, 24);
          fx?.ring(CLOCKHEAD_CENTER, 34, "#fff4c8", 620);
          stage?.shake(0.72);
          zoomUntil.current = now + 1250;
          setBanner({ id: now, phase: event.phase });
          break;
        case "defeated":
          audio.play("hostile_down");
          combatRevealFeedback();
          stage?.shake(0.6);
          fx?.debris(CLOCKHEAD_WINDING_CENTER, 18);
          tollPlayed.current = false;
          goTo("victory");
          break;
        case "recoil":
          audio.play("recoil_snap");
          combatHurtFeedback();
          recoilFrom.current = { ...world.avatar.feet };
          goTo("recoil");
          break;
        case "recovered":
          break;
      }
    },
    [goTo, pop]
  );

  // One loop owns simulation, presentation clocks, camera and effects.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(50, Math.max(0, now - last));
      last = now;
      if (!document.hidden) {
        const current = sceneRef.current;
        const since = now - sceneStartRef.current;
        let world = worldRef.current;

        if (current === "fight") {
          world = stepClockDuel(world, dt, input.consume());
          worldRef.current = world;
          for (const event of world.events) handleEvent(event, world, now);
          if (sceneRef.current === "fight" && (world.stage === "tell" || world.stage === "attack" || world.stage === "exposed")) {
            tickClock.current += dt;
            const interval = TICK_MS[world.phase] * (world.stage === "tell" ? 0.5 : 1);
            if (tickClock.current >= interval) {
              tickClock.current = 0;
              tickParity.current = !tickParity.current;
              getAudioManager().play(tickParity.current ? "clock_tick" : "clock_tock");
            }
          }
          if (world.avatar.dodgeMs === 0) dodgeFromRef.current = null;
        }

        // Intro: the projection glitches, the Line rips it, he turns solid.
        if (current === "intro" && artReadyRef.current && !reduced.current && !introRipped.current && since >= INTRO_RIP_MS) {
          introRipped.current = true;
          getAudioManager().play("target_reveal");
          stageRef.current?.shake(0.55);
          stageRef.current?.fx.debris(CLOCKHEAD_CENTER, 14, ["#9ff6ff", "#e9fbff", "#ffd36b"]);
        }

        // Victory: the minute hand reaches the hour and the bell tolls.
        if (current === "victory" && !tollPlayed.current && since >= VICTORY_TOLL_MS) {
          tollPlayed.current = true;
          getAudioManager().play("clock_toll");
          stageRef.current?.shake(0.8);
          stageRef.current?.fx.debris(CLOCKHEAD_CENTER, 34);
          stageRef.current?.fx.ring(CLOCKHEAD_CENTER, 60, "#fff4c8", 900);
        }

        // Ring tempo is presentation: spin up in the wind-up, crawl while winding.
        const spinRate =
          current === "victory"
            ? Math.max(0, 240 * (1 - since / 600))
            : current !== "fight"
              ? 16
              : world.stage === "tell"
                ? 24 + 300 * tellProgress(world)
                : world.stage === "attack"
                  ? 110
                  : world.stage === "exposed"
                    ? 5
                    : world.stage === "phase_break"
                      ? 420 * Math.max(0.1, 1 - world.clock / DUEL_TUNING.phaseBreakMs)
                      : 18;
        spinRef.current += (spinRate * dt) / 1000;

        const speed = Math.hypot(world.avatar.velocity.x, world.avatar.velocity.y);
        strideRef.current += (speed * dt) / 1000 / strideLength(world.avatar.feet.y);

        const torso = avatarTorso(world.avatar);
        const bossFocus = { x: CLOCKHEAD_CENTER.x, y: CLOCKHEAD_CENTER.y + 22 };
        const cinematic =
          current === "intro" || (current === "victory" && since < VICTORY_CARD_MS) || now < zoomUntil.current;
        const focus = cinematic ? bossFocus : gameplayFocus(world.avatar.feet);
        const zoom = cinematic ? 1.1 : 1;

        const fxFrame: FxFrame = {
          origin: CLOCKHEAD_CENTER,
          projectiles: current === "fight" ? world.projectiles : [],
          hologram: false,
          handLength: DUEL_TUNING.secondHandLength,
          handHalfWidth: DUEL_TUNING.secondHandHalfWidth,
          sweep:
            current === "fight" && world.sweep
              ? { angle: world.sweep.angle, live: world.sweep.livePass != null, direction: world.sweep.direction }
              : null,
          sweepTell:
            current === "fight" && world.stage === "tell" && world.pattern === "sweep"
              ? (() => {
                  const direction = world.sequence % 2 === 1 ? 1 : -1;
                  return {
                    from: direction === 1 ? DUEL_TUNING.sweepFromDeg : DUEL_TUNING.sweepToDeg,
                    to: direction === 1 ? DUEL_TUNING.sweepToDeg : DUEL_TUNING.sweepFromDeg,
                    progress: tellProgress(world),
                  };
                })()
              : null,
          deadlines:
            current === "fight"
              ? world.deadlines.map(mark => ({
                  id: mark.id,
                  at: mark.at,
                  fuseMs: mark.fuseMs,
                  fuseTotalMs: mark.fuseTotalMs,
                  deferred: mark.fuseTotalMs === DUEL_TUNING.deferredFuseMs,
                }))
              : [],
          deadlineRadius: DUEL_TUNING.deadlineRadius,
          deadlineTell:
            current === "fight" && world.stage === "tell" && world.pattern === "deadline"
              ? { at: world.avatar.feet, progress: tellProgress(world) }
              : null,
          goldLine:
            current === "recoil" && recoilFrom.current && since > 180 && since < RECOIL_CARD_MS
              ? { from: torso, to: ARENA_TORSO, t: Math.min(1, (since - 180) / RECOIL_YANK_MS), mode: "taut" }
              : null,
          reachRing:
            current === "fight" && world.stage === "exposed"
              ? { at: torso, radius: 3.4, ready: mainspringInReach(world) }
              : null,
        };
        stageRef.current?.tick(dt, {
          focus,
          zoom,
          fx: fxFrame,
          insets: { top: current === "fight" ? 76 : 0, bottom: current === "fight" ? 24 : 0 },
        });

        setFrame({ world, spin: spinRef.current, stride: strideRef.current, now });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [handleEvent, input]);

  useEffect(() => {
    if (!callout) return;
    const timer = window.setTimeout(() => setCallout(current => (current?.id === callout.id ? null : current)), 820);
    return () => window.clearTimeout(timer);
  }, [callout]);

  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(current => (current?.id === banner.id ? null : current)), 1600);
    return () => window.clearTimeout(timer);
  }, [banner]);

  const begin = () => {
    getAudioManager().play("clockhead_charge");
    const fresh = createClockDuel();
    worldRef.current = fresh;
    stageRef.current?.fx.clear();
    input.reset();
    goTo("fight");
  };

  const retryFromAnchor = () => {
    const back = recoilToAnchor(worldRef.current);
    worldRef.current = back;
    recoilFrom.current = null;
    stageRef.current?.fx.clear();
    stageRef.current?.snap();
    input.reset();
    getAudioManager().play("corridor_transition");
    goTo("fight");
  };

  const takeWaywardRoute = () => {
    if (completed.current) return;
    completed.current = true;
    onDefeated();
  };

  const { world, spin, stride, now } = frame;
  const since = scene === "intro" && !artReady ? 0 : now - sceneStartRef.current;
  const introSolid = scene !== "intro" || reduced.current || since >= INTRO_SOLID_MS;
  const introCard = scene === "intro" && (reduced.current || since >= INTRO_CARD_MS);
  const victoryCard = scene === "victory" && (reduced.current || since >= VICTORY_CARD_MS);
  const recoilCard = scene === "recoil" && (reduced.current || since >= RECOIL_CARD_MS);
  const fighting = scene === "fight";
  const mood = constructMood(world, scene);
  const drop = scene === "fight" ? descent(world) : 0;
  const damage = 1 - world.bossHp / DUEL_BOSS_HP;
  const reach = fighting && mainspringInReach(world);
  const minuteHand =
    fighting && world.sweep
      ? world.sweep.angle + 90
      : fighting && world.stage === "tell" && world.pattern === "sweep"
        ? 354 - 90 * tellProgress(world)
        : null;
  const hourHand =
    fighting && world.pattern === "deadline" && (world.stage === "tell" || world.stage === "attack")
      ? clockDegreesToward(CLOCKHEAD_CENTER, world.avatar.feet)
      : null;
  const tone = scene === "recoil" ? "drained" : now < toneUntil.current ? "rewind" : "normal";
  const centre = stagePercent(CLOCKHEAD_CENTER);
  const avatar =
    scene === "recoil" && recoilFrom.current
      ? {
          ...world.avatar,
          feet: (() => {
            const t = Math.min(1, Math.max(0, (since - 180) / RECOIL_YANK_MS));
            const eased = t * t * t;
            const from = recoilFrom.current!;
            return { x: from.x + (ARENA_FEET.x - from.x) * eased, y: from.y + (ARENA_FEET.y - from.y) * eased };
          })(),
          moving: false,
        }
      : world.avatar;

  const phaseLabel = CLOCK_PHASE_NAMES[world.phase];
  const bossSegments = Array.from({ length: DUEL_BOSS_HP }, (_, index) => index < world.bossHp);
  const attackName = CLOCK_ATTACK_NAMES[world.pattern];
  const attackAnswer =
    world.pattern === "deadline" && world.phase === 3 ? "LEAVE THE MARK — AND STAY OUT" : CLOCK_ATTACK_ANSWERS[world.pattern];

  return (
    <main
      className={`clock-duel is-${scene} stage-${world.stage}${now < hurtUntil.current ? " is-hurt" : ""}`}
      data-testid="clockhead-duel"
      data-scene={scene}
      data-phase={world.phase}
      data-stage={world.stage}
      data-hp={world.hp}
      data-boss-hp={world.bossHp}
    >
      <ColosseumStageView
        ref={stageRef}
        tone={tone}
        onReady={() => {
          artReadyRef.current = true;
          sceneStartRef.current = performance.now();
          setArtReady(true);
        }}
        overlay={
          <>
            {scene === "intro" && !reduced.current && since >= INTRO_RIP_MS - 80 && since < INTRO_RIP_MS + 700 && (
              <div className="cz-rip is-live" aria-hidden="true" />
            )}
            {scene === "victory" && !reduced.current && since >= VICTORY_RIP_MS && since < VICTORY_RIP_MS + 800 && (
              <div className="cz-rip cz-rip--victory is-live" aria-hidden="true" />
            )}
            {scene === "victory" && since >= VICTORY_TOLL_MS && since < VICTORY_TOLL_MS + 420 && (
              <div className="cz-flash" aria-hidden="true" />
            )}
          </>
        }
      >
        <div
          className="cd-boss-anchor"
          style={{
            left: centre.left,
            top: centre.top,
            ["--descend" as string]: drop.toFixed(3),
            ["--descend-units" as string]: (CLOCKHEAD_WINDING_CENTER.y - CLOCKHEAD_CENTER.y).toFixed(3),
          }}
        >
          <ClockheadConstruct
            variant={introSolid ? "solid" : "hologram"}
            mood={mood}
            spin={spin}
            charge={fighting ? tellProgress(world) : 0}
            minuteHand={minuteHand}
            hourHand={hourHand}
            damage={scene === "victory" ? 1 : damage}
            flash={now < bossFlashUntil.current}
            seals={scene === "intro" && !introSolid ? FIVE_BROKEN : undefined}
            signal={1}
          />
          {fighting && world.stage === "exposed" && (
            <span className={`cd-mainspring-tag${reach ? " is-reach" : ""}`}>
              {reach ? "STRIKE" : "CLOSE IN"}
            </span>
          )}
        </div>
        <TrailblazerSprite
          avatar={avatar}
          stride={stride}
          carriesShield
          drained={scene === "recoil"}
          dodgeFrom={dodgeFromRef.current}
          showStatus={scene === "fight"}
        />
      </ColosseumStageView>

      {/* ---------------- HUD ---------------- */}
      {scene !== "intro" && (
        <header className="cd-boss-plate" aria-label={`Clockhead, ${phaseLabel}, ${world.bossHp} of ${DUEL_BOSS_HP}`}>
          <img className="cd-portrait" src={PORTRAIT_SRC} alt="" />
          <div className="cd-boss-meta">
            <div className="cd-boss-name">
              <strong>CLOCKHEAD</strong>
              <span>
                {ROMAN[world.phase]} · {phaseLabel}
              </span>
            </div>
            <div className="cd-boss-bar" aria-hidden="true">
              {bossSegments.map((alive, index) => (
                <i
                  key={index}
                  className={`${alive ? "is-live" : ""}${
                    index === PHASE_FLOOR[1] || index === PHASE_FLOOR[2] ? " is-hour" : ""
                  }`}
                />
              ))}
            </div>
          </div>
        </header>
      )}

      <p className="cd-line" role="status" aria-live="polite">
        {scene === "intro" ? "It isn’t time." : world.line}
      </p>

      {fighting && (world.stage === "tell" || world.stage === "attack") && (
        <div className={`cd-callsign is-${world.stage} is-${world.pattern}`} key={`${world.sequence}-${world.pattern}`}>
          <strong>{attackName}</strong>
          <span>{attackAnswer}</span>
        </div>
      )}
      {fighting && world.stage === "exposed" && (
        <div className={`cd-callsign is-exposed${reach ? " is-reach" : ""}`}>
          <strong>{world.staggerMs > 0 ? "KNOCKED OFF SCHEDULE" : "WINDING"}</strong>
          <span>{reach ? "STRIKE THE MAINSPRING — NOW" : "CLOSE IN ON THE MAINSPRING"}</span>
        </div>
      )}

      {callout && (
        <div key={callout.id} className={`cd-pop is-${callout.tone}`} aria-hidden="true">
          {callout.text}
        </div>
      )}

      {banner && (
        <div key={banner.id} className="cd-hour-banner" role="status">
          <span>HOUR {ROMAN[banner.phase]}</span>
          <strong>{CLOCK_PHASE_NAMES[banner.phase]}</strong>
        </div>
      )}

      {scene === "fight" && (
        <p className="cz-sr-only" role="status">
          Guard {world.hp} of {world.avatar.maxGuardPips}. Force {world.avatar.force} of {AVATAR_TUNING.forceMax}
          {world.avatar.force >= AVATAR_TUNING.forceMax ? ", RETURN ready." : "."}
        </p>
      )}

      <button
        type="button"
        className="cz-mute"
        onClick={() => {
          getAudioManager().setMuted(!muted);
          setMuted(!muted);
        }}
        aria-pressed={muted}
      >
        {muted ? "SOUND OFF" : "SOUND ON"}
      </button>

      {(scene === "fight" || scene === "recoil") && (
        <ColosseumControls
          input={input}
          disabled={scene !== "fight" || world.stage === "phase_break"}
          showActions
          canGuard
          returnReady={world.avatar.force >= AVATAR_TUNING.forceMax}
          dodgeReady={world.avatar.dodgeCooldownMs === 0}
          strikeHot={reach}
        />
      )}
      {fighting && <p className="cz-keys">WASD MOVE · J STRIKE · L HOLD GUARD · K DODGE · Q RETURN</p>}

      {/* ---------------- Cards ---------------- */}
      {introCard && (
        <section className="cd-card cd-card--intro" aria-labelledby="clockhead-title">
          <small className="cd-card-kicker">FIELD TRACE VERIFIED · FICTIONAL ENCOUNTER</small>
          <img className="cd-card-portrait" src={PORTRAIT_SRC} alt="Clockhead, a fictional clock-headed antagonist" />
          <h1 id="clockhead-title">CLOCKHEAD</h1>
          <p className="cd-card-sub">VELLUM KAI · WARDEN OF THE CORRECT TIME</p>
          <blockquote>“Nothing happens before the correct time.”</blockquote>
          <p className="cd-card-rules">
            Read his wind-up. <b>Guard</b> as a bolt arrives — raised late, it is perfect.
            <b> Dodge</b> the Second Hand. When he stops to <b>wind</b>, close in and <b>strike</b>.
          </p>
          <button type="button" className="cd-cta" onClick={begin} autoFocus>
            Face Clockhead
          </button>
        </section>
      )}

      {recoilCard && (
        <section className="cd-card cd-card--recoil" aria-labelledby="recoil-title">
          <small className="cd-card-kicker">THE LINE CAUGHT YOU</small>
          <h2 id="recoil-title">RECOIL</h2>
          <p className="cd-card-sub">
            Back to the anchor at the start of Hour {ROMAN[phaseForHp(world.anchorBossHp)]}. Nothing real was lost.
          </p>
          {world.anchorRecoils < RECOIL_GUARD_BONUS_MAX && (
            <p className="cd-card-assist">The Line holds tighter: +1 guard on your next attempt.</p>
          )}
          <blockquote>“Time’s up. Shall we reschedule?”</blockquote>
          <p className="cd-card-rules">Read the tell, move, then close in during winding.</p>
          <button type="button" className="cd-cta" onClick={retryFromAnchor} autoFocus>
            Retry Clockhead
          </button>
        </section>
      )}

      {victoryCard && (
        <section className="cd-card cd-card--victory" aria-labelledby="victory-title">
          <small className="cd-card-kicker">THE CORRECT TIME HAS ARRIVED</small>
          <h2 id="victory-title">THE FINAL HOUR IS YOURS</h2>
          <dl className="cd-stats">
            <div>
              <dt>TIME</dt>
              <dd>{formatClock(world.stats.elapsedMs)}</dd>
            </div>
            <div>
              <dt>PERFECT BLOCKS</dt>
              <dd>{world.stats.perfectBlocks}</dd>
            </div>
            <div>
              <dt>RETURNS</dt>
              <dd>{world.stats.returns}</dd>
            </div>
            <div>
              <dt>RECOILS</dt>
              <dd>{world.stats.recoils}</dd>
            </div>
          </dl>
          <p className="cd-truth">
            The Wayward route is unlocked. This victory records no visit, sale, or revenue.
          </p>
          <button type="button" className="cd-cta" onClick={takeWaywardRoute} autoFocus>
            Take the Wayward route
          </button>
        </section>
      )}
    </main>
  );
}

const FIVE_BROKEN = Array.from({ length: 5 }, () => ({ legend: "", broken: true }));

function phaseForHp(bossHp: number): DuelPhase {
  if (bossHp > PHASE_FLOOR[1]) return 1;
  if (bossHp > PHASE_FLOOR[2]) return 2;
  return 3;
}

