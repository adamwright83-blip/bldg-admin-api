import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAudioManager } from "@/game/audio/AudioManager";
import {
  arcadeFeedback,
  combatGuardFeedback,
  combatHurtFeedback,
  combatRevealFeedback,
} from "@/game/audio/haptics";
import {
  ClockheadConstruct,
  type ConstructHandle,
  type ConstructMood,
  type ConstructSeal,
} from "./ClockheadConstruct";
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
import {
  CLOCK_ATTACK_ANSWERS,
  CLOCK_ATTACK_NAMES,
  CLOCK_PHASE_NAMES,
  DUEL_BOSS_HP,
  DUEL_TUNING,
  PHASE_FLOOR,
  RECOIL_GUARD_BONUS_MAX,
  createClockDuel,
  exposedWindowMs,
  mainspringInReach,
  recoilToAnchor,
  stepClockDuel,
  tellProgress,
  type ClockDuel,
  type DuelEvent,
  type DuelMode,
  type DuelPhase,
} from "./clockheadDuelEngine";
import { AVATAR_TUNING, avatarTorso } from "./colosseumAvatar";
import type { FxFrame } from "./colosseumFx";
import {
  HIT_REACTION,
  contactPoint,
  decayTrauma,
  hitFlashAt,
  rattleAt,
} from "./clockheadHitReaction";
import {
  ARENA_ANCHOR as ARENA_FEET,
  CLOCKHEAD_CENTER,
  CLOCKHEAD_DEFERRALS,
  CLOCKHEAD_WINDING_CENTER,
  SERVICE_ENTRANCE,
  SHIELD_REST,
  gameplayFocus,
  sealPoint,
  stagePercent,
  torsoPoint,
  type StagePoint,
} from "./colosseumStage";
import "./colosseum-arena.css";
import "./clockhead-duel.css";

/**
 * The Clockhead fight, in two cuts.
 *
 * FINALE (the default export). Receives no person record and cannot publish
 * a business outcome. It is only mounted once the real five-site campaign is
 * already complete, and the only thing it can do to the outside world is
 * call `onDefeated` — once, from the victory card, after the fight has
 * actually been won. That callback persists a fantasy unlock (the Wayward
 * route); it records no visit, sale or revenue.
 *
 * PROLOGUE (`ClockheadPrologue`). The first time a player walks into the
 * Colosseum, before any real outcome exists, he is simply there: the same
 * fight, which she cannot lose and he cannot lose either. Her hits land for
 * real; at the end of his first hour he spends a Borrowed Minute, undoes all
 * of it and locks himself behind the five seals only the real hunt can
 * break. It has no way to reach `onDefeated` — it only hands control back.
 */

type Scene = "intro" | "fight" | "victory" | "recoil" | "escape";

type FightProps =
  | { mode: "finale"; onDefeated: () => void }
  | { mode: "prologue"; onSealed: () => void };

const PORTRAIT_SRC = "/assets/goldline/colosseum/clockhead-portrait.webp";
const ROMAN: Record<DuelPhase, string> = { 1: "I", 2: "II", 3: "III" };
const TICK_MS: Record<DuelPhase, number> = { 1: 1000, 2: 760, 3: 560 };
const SEAL_COUNT = 5;
const SEAL_LEGENDS = Array.from(
  { length: SEAL_COUNT },
  (_, index) => CLOCKHEAD_DEFERRALS[index % CLOCKHEAD_DEFERRALS.length]!
);

const ARENA_TORSO = torsoPoint(ARENA_FEET);
/** Finale: the Line reaches the last seal, it breaks, the projection rips, he is here. */
const FINALE_INTRO = { breakMs: 650, ripMs: 1500, solidMs: 1750, cardMs: 2100 } as const;
/** Prologue: there are no seals yet. He is simply here, and notices her. */
const PROLOGUE_INTRO = { noticeMs: 320, cardMs: 950 } as const;
const VICTORY_TOLL_MS = 380;
const VICTORY_RIP_MS = 1000;
const VICTORY_CARD_MS = 2300;
const RECOIL_YANK_MS = 520;
const RECOIL_CARD_MS = 1150;
/** Prologue escape: rage, a Borrowed Minute, five seals, a projection. */
const ESCAPE = {
  rewindAtMs: 420,
  rewindMs: 900,
  sealsAtMs: 1450,
  sealEveryMs: 150,
  sealLockMs: 420,
  projectionMs: 2350,
  cardMs: 2900,
} as const;
/** How long a segment he just lost stays lit on his health bar. */
const CHIP_MS = 480;

type Callout = { id: number; text: string; tone: "perfect" | "hit" | "finisher" | "return" | "info" };
type Banner = { id: number; kicker: string; title: string };

function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - clamp01(t), 3);
}

function easeInOut(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function lerpPoint(from: StagePoint, to: StagePoint, t: number): StagePoint {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** How far down toward the floor he has sunk to wind himself, 0..1. */
function descent(world: ClockDuel): number {
  if (world.stage !== "exposed") return 0;
  const total = exposedWindowMs(world);
  const down = easeOut(world.clock / 260);
  const up = easeOut((total - world.clock) / 260);
  return Math.min(down, up);
}

/** Where his face is drawn right now, given how far he has sunk. */
function faceAt(drop: number): StagePoint {
  return lerpPoint(CLOCKHEAD_CENTER, CLOCKHEAD_WINDING_CENTER, drop);
}

/** 0..1 through the escape's Borrowed Minute. */
function rewindProgress(since: number): number {
  return easeInOut((since - ESCAPE.rewindAtMs) / ESCAPE.rewindMs);
}

function sealSlamAt(index: number): number {
  return ESCAPE.sealsAtMs + index * ESCAPE.sealEveryMs;
}

function constructMood(world: ClockDuel, scene: Scene, since: number): ConstructMood {
  if (scene === "victory") return "defeated";
  if (scene === "escape") return since < ESCAPE.rewindAtMs ? "break" : "idle";
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

/**
 * Seal states as one short string (h hidden, l locking, s sealed, b broken,
 * u unbroken), so the memoised seal list only changes when a seal does.
 */
function sealsFromKey(key: string): ConstructSeal[] | undefined {
  if (!key) return undefined;
  return [...key].map((state, index) => ({
    legend: SEAL_LEGENDS[index]!,
    broken: state === "b",
    hidden: state === "h",
    locking: state === "l",
  }));
}

export default function ClockheadDuel({ onDefeated }: { onDefeated: () => void }) {
  return <ClockFight mode="finale" onDefeated={onDefeated} />;
}

/**
 * First entry only (the gate decides when). Cannot be won, cannot be lost,
 * and has no way to call the finale's unlock: all it can do is hand back.
 */
export function ClockheadPrologue({ onSealed }: { onSealed: () => void }) {
  return <ClockFight mode="prologue" onSealed={onSealed} />;
}

function ClockFight(props: FightProps) {
  const mode: DuelMode = props.mode;
  const prologue = mode === "prologue";
  const [scene, setScene] = useState<Scene>("intro");
  // The intro's clock does not start until the painting is on screen.
  const [artReady, setArtReady] = useState(false);
  const artReadyRef = useRef(false);
  const sceneRef = useRef<Scene>("intro");
  const sceneStartRef = useRef(performance.now());
  const [frame, setFrame] = useState(() => ({ world: createClockDuel({ mode }), stride: 0, now: 0 }));
  const worldRef = useRef(frame.world);
  const spinRef = useRef(0);
  const strideRef = useRef(0);
  const dropRef = useRef(0);
  const dodgeFromRef = useRef<StagePoint | null>(null);
  const hurtUntil = useRef(0);
  const zoomUntil = useRef(0);
  const toneUntil = useRef(0);
  const tickClock = useRef(0);
  const tickParity = useRef(false);
  /** One-shot beats of the current scene's timeline (cleared on every scene change). */
  const beats = useRef(new Set<string>());
  const recoilFrom = useRef<StagePoint | null>(null);
  const escapeFrom = useRef<{ feet: StagePoint; bossHp: number; damage: number; drop: number } | null>(null);
  const completed = useRef(false);
  const stageRef = useRef<StageHandle>(null);
  const constructRef = useRef<ConstructHandle>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const bossTrauma = useRef(0);
  const bossHit = useRef<{ at: number; heavy: boolean } | null>(null);
  const chip = useRef<{ from: number; to: number; at: number } | null>(null);
  const reduced = useRef(prefersReducedMotion());
  const [callout, setCallout] = useState<Callout | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const calloutId = useRef(0);
  const input = useColosseumInput(scene === "fight");
  // The loop reads the latest callbacks without restarting for a new identity.
  const propsRef = useRef(props);
  propsRef.current = props;

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
    beats.current.clear();
    setScene(next);
  }, []);

  const pop = useCallback((text: string, tone: Callout["tone"]) => {
    calloutId.current += 1;
    setCallout({ id: calloutId.current, text, tone });
  }, []);

  /** The Lineblade (or a RETURN) connected: he rattles, flushes white then red. */
  const hitBoss = useCallback((now: number, heavy: boolean) => {
    bossTrauma.current = Math.min(
      1,
      bossTrauma.current + (heavy ? HIT_REACTION.trauma.finisher : HIT_REACTION.trauma.hit)
    );
    bossHit.current = { at: now, heavy };
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
          // The prologue's last hit is the one that makes him run: it lands
          // as hard as a finisher.
          const heavy = event.finisher || world.stage === "escaped";
          const contact = contactPoint(faceAt(dropRef.current), torso, event.combo);
          audio.play("clockface_impact", {
            pitch: 0.97 + Math.random() * 0.06 + (event.combo - 1) * 0.035,
          });
          audio.play(heavy ? "clockhead_roar" : "clockhead_howl", {
            delayMs: heavy ? 60 : 45,
            pitch: 0.95 + Math.random() * 0.08 + (heavy ? 0 : (event.combo - 1) * 0.06),
          });
          combatRevealFeedback();
          hitBoss(now, heavy);
          fx?.slash(torso, event.combo, true);
          fx?.impact(torso, contact, heavy ? 1.6 : 1 + (event.combo - 1) * 0.15);
          stage?.shake(heavy ? 0.5 : 0.24);
          // His heartbeat skips when he is hit.
          tickClock.current = -260;
          pop(event.finisher ? "FINISHER" : `HIT ${event.combo}`, event.finisher ? "finisher" : "hit");
          break;
        }
        case "return":
          audio.play("return_wave");
          audio.play("clockhead_roar", { delayMs: 160 });
          combatRevealFeedback();
          fx?.shockwave(event.at);
          stage?.shake(0.62);
          hitBoss(now + 120, true);
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
          setBanner({ id: now, kicker: `HOUR ${ROMAN[event.phase]}`, title: CLOCK_PHASE_NAMES[event.phase] });
          break;
        case "defeated":
          audio.play("hostile_down");
          combatRevealFeedback();
          stage?.shake(0.6);
          fx?.debris(CLOCKHEAD_WINDING_CENTER, 18);
          goTo("victory");
          break;
        case "recoil":
          audio.play("recoil_snap");
          combatHurtFeedback();
          recoilFrom.current = { ...world.avatar.feet };
          goTo("recoil");
          break;
        case "escape":
          escapeFrom.current = {
            feet: { ...world.avatar.feet },
            bossHp: world.bossHp,
            damage: 1 - world.bossHp / DUEL_BOSS_HP,
            drop: dropRef.current,
          };
          // A cornered escape already roared with the hit that caused it.
          if (event.reason === "timeout") audio.play("clockhead_charge");
          goTo("escape");
          break;
        case "recovered":
          break;
      }
    },
    [goTo, hitBoss, pop]
  );

  // One loop owns simulation, presentation clocks, camera and effects.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const once = (key: string, run: () => void) => {
      if (beats.current.has(key)) return;
      beats.current.add(key);
      run();
    };
    const tick = (now: number) => {
      const dt = Math.min(50, Math.max(0, now - last));
      last = now;
      if (!document.hidden) {
        const current = sceneRef.current;
        const since = now - sceneStartRef.current;
        const stage = stageRef.current;
        const audio = getAudioManager();
        const calm = reduced.current;
        let world = worldRef.current;

        if (current === "fight") {
          const hpBefore = world.bossHp;
          world = stepClockDuel(world, dt, input.consume());
          worldRef.current = world;
          if (world.bossHp < hpBefore) chip.current = { from: hpBefore, to: world.bossHp, at: now };
          for (const event of world.events) handleEvent(event, world, now);
          if (sceneRef.current === "fight" && (world.stage === "tell" || world.stage === "attack" || world.stage === "exposed")) {
            tickClock.current += dt;
            const interval = TICK_MS[world.phase] * (world.stage === "tell" ? 0.5 : 1);
            if (tickClock.current >= interval) {
              tickClock.current = 0;
              tickParity.current = !tickParity.current;
              audio.play(tickParity.current ? "clock_tick" : "clock_tock");
            }
          }
          if (world.avatar.dodgeMs === 0) dodgeFromRef.current = null;
        }

        // ---- Scene timelines: each beat fires once. ----
        if (current === "intro" && artReadyRef.current && !calm) {
          if (propsRef.current.mode === "finale") {
            if (since >= FINALE_INTRO.breakMs) {
              once("seal", () => {
                // The fifth seal breaks on screen: the finale opens on the
                // moment the real hunt finished.
                audio.play("seal_break");
                combatRevealFeedback();
                stage?.shake(0.45);
                const seal = sealPoint(SEAL_COUNT - 1, SEAL_COUNT);
                stage?.fx.debris(seal, 16, ["#ffd36b", "#c89a4a", "#fff4c8"]);
                stage?.fx.sparks(seal, 18, "#fff6cf", 50);
                setBanner({ id: now, kicker: "TRACE COMPLETE", title: "LOCATED" });
              });
            }
            if (since >= FINALE_INTRO.ripMs) {
              once("rip", () => {
                audio.play("target_reveal");
                stage?.shake(0.55);
                stage?.fx.debris(CLOCKHEAD_CENTER, 14, ["#9ff6ff", "#e9fbff", "#ffd36b"]);
              });
            }
          } else if (since >= PROLOGUE_INTRO.noticeMs) {
            once("notice", () => {
              audio.play("clockhead_charge");
              stage?.shake(0.16);
              stage?.fx.ring(CLOCKHEAD_CENTER, 30, "#ffd36b", 520);
            });
          }
        }

        // Victory: the minute hand reaches the hour and the bell tolls.
        if (current === "victory" && since >= VICTORY_TOLL_MS) {
          once("toll", () => {
            audio.play("clock_toll");
            stage?.shake(0.8);
            stage?.fx.debris(CLOCKHEAD_CENTER, 34);
            stage?.fx.ring(CLOCKHEAD_CENTER, 60, "#fff4c8", 900);
          });
        }

        // Prologue escape: he spends a Borrowed Minute and seals himself away.
        if (current === "escape" && !calm) {
          if (since >= ESCAPE.rewindAtMs) {
            once("rewind", () => {
              audio.play("borrowed_minute");
              stage?.shake(0.3);
              stage?.fx.ring(CLOCKHEAD_CENTER, 40, "#b9e8ff", 900);
              toneUntil.current = now + ESCAPE.rewindMs + 160;
            });
          }
          const from = escapeFrom.current?.bossHp ?? DUEL_BOSS_HP;
          const refilled = Math.round(from + (DUEL_BOSS_HP - from) * rewindProgress(since));
          for (let hp = from + 1; hp <= refilled; hp += 1) {
            once(`hp-${hp}`, () => audio.play("clock_tick"));
          }
          for (let index = 0; index < SEAL_COUNT; index += 1) {
            if (since < sealSlamAt(index)) break;
            once(`seal-${index}`, () => {
              audio.play("seal_lock");
              combatGuardFeedback();
              stage?.shake(0.2);
              const at = sealPoint(index, SEAL_COUNT);
              stage?.fx.sparks(at, 12, "#ffd36b", 44);
              stage?.fx.ring(at, 5, "#fff4c8", 260);
            });
          }
          if (since >= ESCAPE.projectionMs) {
            once("projection", () => {
              audio.play("target_reveal");
              stage?.fx.debris(CLOCKHEAD_CENTER, 12, ["#9ff6ff", "#e9fbff", "#8ff3ff"]);
            });
          }
        }

        // ---- Presentation clocks ----
        const rewinding =
          current === "escape" && since >= ESCAPE.rewindAtMs && since < ESCAPE.rewindAtMs + ESCAPE.rewindMs;
        // Ring tempo: spin up in the wind-up, crawl while winding, run backwards in a Borrowed Minute.
        const spinRate =
          current === "victory"
            ? Math.max(0, 240 * (1 - since / 600))
            : current === "escape"
              ? since < ESCAPE.rewindAtMs
                ? 60
                : rewinding
                  ? -720
                  : 14
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

        const drop =
          current === "fight"
            ? descent(world)
            : current === "escape"
              ? (escapeFrom.current?.drop ?? 0) * (1 - rewindProgress(since))
              : 0;
        dropRef.current = drop;
        anchorRef.current?.style.setProperty("--descend", drop.toFixed(3));

        const fighting = current === "fight";
        const minuteHand =
          current === "escape" && since >= ESCAPE.rewindAtMs
            ? 354 - 720 * rewindProgress(since)
            : fighting && world.sweep
              ? world.sweep.angle + 90
              : fighting && world.stage === "tell" && world.pattern === "sweep"
                ? 354 - 90 * tellProgress(world)
                : null;
        const hourHand =
          current === "escape" && since >= ESCAPE.rewindAtMs
            ? 359.5 - 60 * rewindProgress(since)
            : fighting && world.pattern === "deadline" && (world.stage === "tell" || world.stage === "attack")
              ? clockDegreesToward(CLOCKHEAD_CENTER, world.avatar.feet)
              : null;

        bossTrauma.current = decayTrauma(bossTrauma.current, dt);
        const hit = bossHit.current;
        const flash = hit ? hitFlashAt(now - hit.at, hit.heavy) : { red: 0, white: 0 };
        constructRef.current?.setMotion({
          spin: spinRef.current,
          charge: fighting ? tellProgress(world) : 0,
          minuteHand,
          hourHand,
          rattle: calm ? undefined : rattleAt(bossTrauma.current, now),
          // Reduced motion keeps the meaning (he was hurt) without the pop.
          hurt: calm ? flash.red * 0.55 : flash.red,
          pop: calm ? 0 : flash.white,
        });

        const speed = Math.hypot(world.avatar.velocity.x, world.avatar.velocity.y);
        strideRef.current += (speed * dt) / 1000 / strideLength(world.avatar.feet.y);

        // ---- Camera and effects ----
        const torso = avatarTorso(world.avatar);
        const bossFocus = { x: CLOCKHEAD_CENTER.x, y: CLOCKHEAD_CENTER.y + 22 };
        const escapeSettled = current === "escape" && (calm || since >= ESCAPE.projectionMs);
        const cinematic =
          current === "intro" ||
          (current === "victory" && since < VICTORY_CARD_MS) ||
          (current === "escape" && !escapeSettled) ||
          now < zoomUntil.current;
        // The escape ends on exactly the shot the search arena opens with.
        const focus = cinematic ? bossFocus : escapeSettled ? gameplayFocus(ARENA_FEET) : gameplayFocus(world.avatar.feet);
        const zoom = cinematic ? 1.1 : 1;
        const finaleIntro = current === "intro" && propsRef.current.mode === "finale" && !calm;

        const fxFrame: FxFrame = {
          origin: CLOCKHEAD_CENTER,
          projectiles: fighting ? world.projectiles : [],
          hologram: false,
          handLength: DUEL_TUNING.secondHandLength,
          handHalfWidth: DUEL_TUNING.secondHandHalfWidth,
          sweep:
            fighting && world.sweep
              ? { angle: world.sweep.angle, live: world.sweep.livePass != null, direction: world.sweep.direction }
              : null,
          sweepTell:
            fighting && world.stage === "tell" && world.pattern === "sweep"
              ? (() => {
                  const direction = world.sequence % 2 === 1 ? 1 : -1;
                  return {
                    from: direction === 1 ? DUEL_TUNING.sweepFromDeg : DUEL_TUNING.sweepToDeg,
                    to: direction === 1 ? DUEL_TUNING.sweepToDeg : DUEL_TUNING.sweepFromDeg,
                    progress: tellProgress(world),
                  };
                })()
              : null,
          deadlines: fighting
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
            fighting && world.stage === "tell" && world.pattern === "deadline"
              ? { at: world.avatar.feet, progress: tellProgress(world) }
              : null,
          goldLine:
            finaleIntro && artReadyRef.current && since < FINALE_INTRO.breakMs + 250
              ? {
                  from: SERVICE_ENTRANCE,
                  to: sealPoint(SEAL_COUNT - 1, SEAL_COUNT),
                  t: Math.min(1, since / FINALE_INTRO.breakMs),
                  mode: "grow",
                }
              : current === "recoil" && recoilFrom.current && since > 180 && since < RECOIL_CARD_MS
                ? { from: torso, to: ARENA_TORSO, t: Math.min(1, (since - 180) / RECOIL_YANK_MS), mode: "taut" }
                : null,
          reachRing:
            fighting && world.stage === "exposed"
              ? { at: torso, radius: 3.4, ready: mainspringInReach(world) }
              : null,
        };
        stage?.tick(dt, {
          focus,
          zoom,
          fx: fxFrame,
          insets: fighting
            ? { top: 76, bottom: 24 }
            : escapeSettled
              ? { top: 72, bottom: 118 }
              : { top: 0, bottom: 0 },
        });

        setFrame({ world, stride: strideRef.current, now });
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
    const fresh = createClockDuel({ mode });
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
    const current = propsRef.current;
    if (current.mode === "finale") current.onDefeated();
  };

  const enterColosseum = () => {
    if (completed.current) return;
    completed.current = true;
    getAudioManager().play("corridor_transition");
    const current = propsRef.current;
    if (current.mode === "prologue") current.onSealed();
  };

  const { world, stride, now } = frame;
  const calm = reduced.current;
  const since = scene === "intro" && !artReady ? 0 : now - sceneStartRef.current;
  const introSolid = prologue || scene !== "intro" || calm || since >= FINALE_INTRO.solidMs;
  const introCard =
    scene === "intro" && (calm || since >= (prologue ? PROLOGUE_INTRO.cardMs : FINALE_INTRO.cardMs));
  const victoryCard = scene === "victory" && (calm || since >= VICTORY_CARD_MS);
  const recoilCard = scene === "recoil" && (calm || since >= RECOIL_CARD_MS);
  const escapeProjected = scene === "escape" && (calm || since >= ESCAPE.projectionMs);
  const sealedCard = scene === "escape" && (calm || since >= ESCAPE.cardMs);
  const fighting = scene === "fight";
  const mood = constructMood(world, scene, since);
  const rewound = scene === "escape" ? (calm ? 1 : rewindProgress(since)) : 0;
  const escapeStart = escapeFrom.current;

  // His health as the bar shows it: in the escape it visibly refills.
  const shownBossHp =
    scene === "escape" && escapeStart
      ? Math.round(escapeStart.bossHp + (DUEL_BOSS_HP - escapeStart.bossHp) * rewound)
      : world.bossHp;
  const damage =
    scene === "victory"
      ? 1
      : scene === "escape" && escapeStart
        ? // Quantised, so the clock only re-renders when a crack heals.
          Math.floor(escapeStart.damage * (1 - rewound) * 10) / 10
        : 1 - world.bossHp / DUEL_BOSS_HP;
  const reach = fighting && mainspringInReach(world);

  const sealsKey =
    scene === "escape"
      ? SEAL_LEGENDS.map((_, index) =>
          calm || since >= sealSlamAt(index) + ESCAPE.sealLockMs ? "s" : since >= sealSlamAt(index) ? "l" : "h"
        ).join("")
      : scene === "intro" && !introSolid
        ? since >= FINALE_INTRO.breakMs
          ? "bbbbb"
          : "bbbbu"
        : "";
  const seals = useMemo(() => sealsFromKey(sealsKey), [sealsKey]);
  const breakingSeal =
    scene === "intro" && !prologue && !calm && since >= FINALE_INTRO.breakMs && since < FINALE_INTRO.breakMs + 700
      ? SEAL_COUNT - 1
      : null;

  const tone = scene === "recoil" ? "drained" : now < toneUntil.current ? "rewind" : "normal";
  const centre = stagePercent(CLOCKHEAD_CENTER);
  const avatar =
    scene === "recoil" && recoilFrom.current
      ? {
          ...world.avatar,
          feet: (() => {
            const t = Math.min(1, Math.max(0, (since - 180) / RECOIL_YANK_MS));
            return lerpPoint(recoilFrom.current!, ARENA_FEET, t * t * t);
          })(),
          moving: false,
        }
      : scene === "victory"
        ? // The simulation stops at the win; don't freeze her mid-flinch.
          // She faces what she just stopped. Sometimes she just looks.
          { ...world.avatar, hurtMs: 0, dodgeMs: 0, slashMs: 0, guarding: false, moving: false, facing: "back" as const }
        : scene === "escape" && escapeStart
          ? // The Borrowed Minute rewinds her too: back to where she came in.
            {
              ...world.avatar,
              feet: lerpPoint(escapeStart.feet, ARENA_FEET, rewound),
              hurtMs: 0,
              dodgeMs: 0,
              slashMs: 0,
              guarding: false,
              moving: false,
              facing: "back" as const,
            }
          : world.avatar;
  // …and takes her shield back to the sun it was lying on.
  const shieldLeftAt = ESCAPE.rewindAtMs + 120;
  const shieldFlight =
    scene === "escape" && escapeStart && (calm || since >= shieldLeftAt)
      ? lerpPoint(
          torsoPoint(escapeStart.feet),
          SHIELD_REST,
          calm ? 1 : easeInOut((since - shieldLeftAt) / (ESCAPE.rewindMs - 120))
        )
      : null;
  const carriesShield = scene !== "escape" || shieldFlight == null;

  const phaseLabel = CLOCK_PHASE_NAMES[world.phase];
  const chipNow = chip.current && now - chip.current.at < CHIP_MS ? chip.current : null;
  const bossSegments = Array.from({ length: DUEL_BOSS_HP }, (_, index) => ({
    alive: index < shownBossHp,
    chip: chipNow != null && index >= chipNow.to && index < chipNow.from,
    refill: scene === "escape" && escapeStart != null && index >= escapeStart.bossHp && index < shownBossHp,
  }));
  const attackName = CLOCK_ATTACK_NAMES[world.pattern];
  const attackAnswer =
    world.pattern === "deadline" && world.phase === 3 ? "LEAVE THE MARK — AND STAY OUT" : CLOCK_ATTACK_ANSWERS[world.pattern];
  const line =
    scene === "intro"
      ? prologue
        ? "You’re early. Nobody is ever early."
        : "It isn’t time."
      : escapeProjected
        ? "Not yet. It isn’t the correct time."
        : world.line;

  return (
    <main
      className={`clock-duel is-${scene} stage-${world.stage}${now < hurtUntil.current ? " is-hurt" : ""}`}
      data-testid="clockhead-duel"
      data-mode={mode}
      data-scene={scene}
      data-phase={world.phase}
      data-stage={world.stage}
      data-hp={world.hp}
      data-boss-hp={shownBossHp}
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
            {scene === "intro" && !prologue && !calm && since >= FINALE_INTRO.ripMs - 80 && since < FINALE_INTRO.ripMs + 700 && (
              <div className="cz-rip is-live" aria-hidden="true" />
            )}
            {scene === "escape" && !calm && since >= ESCAPE.projectionMs - 80 && since < ESCAPE.projectionMs + 700 && (
              <div className="cz-rip is-live" aria-hidden="true" />
            )}
            {scene === "victory" && !calm && since >= VICTORY_RIP_MS && since < VICTORY_RIP_MS + 800 && (
              <div className="cz-rip cz-rip--victory is-live" aria-hidden="true" />
            )}
            {scene === "victory" && since >= VICTORY_TOLL_MS && since < VICTORY_TOLL_MS + 420 && (
              <div className="cz-flash" aria-hidden="true" />
            )}
          </>
        }
      >
        <div
          ref={anchorRef}
          className="cd-boss-anchor"
          style={{
            left: centre.left,
            top: centre.top,
            ["--descend-units" as string]: (CLOCKHEAD_WINDING_CENTER.y - CLOCKHEAD_CENTER.y).toFixed(3),
          }}
        >
          <ClockheadConstruct
            ref={constructRef}
            variant={scene === "escape" ? (escapeProjected ? "hologram" : "solid") : introSolid ? "solid" : "hologram"}
            mood={mood}
            damage={damage}
            seals={seals}
            breakingSeal={breakingSeal}
            // A projection with no seal broken yet is as faint as the arena shows it.
            signal={scene === "escape" ? 0 : 1}
          />
          {fighting && world.stage === "exposed" && (
            <span className={`cd-mainspring-tag${reach ? " is-reach" : ""}`}>
              {reach ? "STRIKE" : "CLOSE IN"}
            </span>
          )}
        </div>
        {shieldFlight && (
          <div
            className={`cs-shield-rest cd-shield-return${rewound >= 1 ? " is-home" : ""}`}
            style={{ ...stagePercent(shieldFlight), zIndex: depthIndex(shieldFlight.y) }}
            aria-hidden="true"
          >
            <i className="cs-shield-glow" />
            <ShieldGlyph className="cs-shield-art" />
          </div>
        )}
        <TrailblazerSprite
          avatar={avatar}
          stride={stride}
          carriesShield={carriesShield}
          drained={scene === "recoil"}
          dodgeFrom={dodgeFromRef.current}
          showStatus={scene === "fight"}
        />
      </ColosseumStageView>

      {/* ---------------- HUD ---------------- */}
      {scene !== "intro" && !sealedCard && (
        <header
          className={`cd-boss-plate${chipNow ? " is-struck" : ""}`}
          aria-label={`Clockhead, ${phaseLabel}, ${shownBossHp} of ${DUEL_BOSS_HP}`}
        >
          <img className="cd-portrait" src={PORTRAIT_SRC} alt="" />
          <div className="cd-boss-meta">
            <div className="cd-boss-name">
              <strong>CLOCKHEAD</strong>
              <span>
                {ROMAN[world.phase]} · {phaseLabel}
              </span>
            </div>
            <div className="cd-boss-bar" aria-hidden="true">
              {bossSegments.map((segment, index) => (
                <i
                  key={index}
                  className={[
                    segment.alive ? "is-live" : "",
                    segment.chip ? "is-chip" : "",
                    segment.refill ? "is-refill" : "",
                    index === PHASE_FLOOR[1] || index === PHASE_FLOOR[2] ? "is-hour" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              ))}
            </div>
          </div>
        </header>
      )}

      <p className="cd-line" role="status" aria-live="polite">
        {/* Once the seals start slamming shut the shot is his; the card has the last word. */}
        {scene === "escape" && !calm && since >= ESCAPE.sealsAtMs ? "" : sealedCard ? "" : line}
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
      {scene === "escape" && !calm && since >= ESCAPE.rewindAtMs && since < ESCAPE.projectionMs && (
        <div className="cd-callsign is-attack is-rewind cd-callsign--story">
          <strong>BORROWED MINUTE</strong>
          <span>HE IS UNDOING EVERY HIT</span>
        </div>
      )}

      {callout && (
        <div key={callout.id} className={`cd-pop is-${callout.tone}`} aria-hidden="true">
          {callout.text}
        </div>
      )}

      {banner && (
        <div key={banner.id} className="cd-hour-banner" role="status">
          <span>{banner.kicker}</span>
          <strong>{banner.title}</strong>
        </div>
      )}

      {scene === "fight" && (
        <p className="cz-sr-only" role="status">
          Guard {world.hp} of {world.avatar.maxGuardPips}. Force {world.avatar.force} of {AVATAR_TUNING.forceMax}
          {world.avatar.force >= AVATAR_TUNING.forceMax ? ", RETURN ready." : "."}
        </p>
      )}

      <ColosseumMuteButton />

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
          <small className="cd-card-kicker">
            {prologue ? "FIRST ENTRY · FICTIONAL ENCOUNTER" : "FIELD TRACE VERIFIED · FICTIONAL ENCOUNTER"}
          </small>
          <img className="cd-card-portrait" src={PORTRAIT_SRC} alt="Clockhead, a fictional clock-headed antagonist" />
          <h1 id="clockhead-title">CLOCKHEAD</h1>
          <p className="cd-card-sub">VELLUM KAI · WARDEN OF THE CORRECT TIME</p>
          <blockquote>{prologue ? "“You’re early. Nobody is ever early.”" : "“Nothing happens before the correct time.”"}</blockquote>
          <p className="cd-card-rules">
            Read his wind-up. <b>Guard</b> as a bolt arrives — raised late, it is perfect.
            {!prologue && (
              <>
                <b> Dodge</b> the Second Hand.
              </>
            )}{" "}
            When he stops to <b>wind</b>, close in and <b>strike</b>.
          </p>
          <button type="button" className="cd-cta" onClick={begin} autoFocus>
            Face Clockhead
          </button>
        </section>
      )}

      {sealedCard && (
        <section className="cd-card cd-card--sealed" aria-labelledby="sealed-title">
          <small className="cd-card-kicker">THE HOUR WAS REWOUND</small>
          <h2 id="sealed-title">HE SEALED HIMSELF AWAY</h2>
          <p className="cd-card-sub">
            Every hit you landed, undone. Five seals now hold him out of reach — one for each real property.
          </p>
          <blockquote>“Not yet. It isn’t the correct time.”</blockquote>
          <p className="cd-card-rules">
            Visit the five real properties and record what actually happened at each. <b>Every outcome you record
            breaks a seal.</b> Break all five, and he has nowhere left to hide.
          </p>
          <button type="button" className="cd-cta" onClick={enterColosseum} autoFocus>
            Enter the Colosseum
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

function phaseForHp(bossHp: number): DuelPhase {
  if (bossHp > PHASE_FLOOR[1]) return 1;
  if (bossHp > PHASE_FLOOR[2]) return 2;
  return 3;
}
