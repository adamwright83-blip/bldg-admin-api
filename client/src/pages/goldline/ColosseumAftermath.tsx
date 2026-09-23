import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { getAudioManager } from "@/game/audio/AudioManager";
import { arcadeFeedback, combatRevealFeedback } from "@/game/audio/haptics";
import { CompanionUnlockReveal } from "@/components/driver/CompanionUnlockReveal";
import { PARTY_COMPANIONS } from "./stages/goldlineParty";
import {
  AFTERMATH_TIMING,
  ROOK_ON_THE_LINE,
  SPEAKER_LABELS,
  readMs,
  speakerPoint,
  typeMs,
  type RadioLine,
} from "./aftermathScript";
import type { StageHandle } from "./ColosseumStageView";
import type { DuelStats } from "./clockheadDuelEngine";

/**
 * What happens after Clockhead falls — fiction, end to end.
 *
 *   LEVEL COMPLETE   lands with the bell: short, unmistakable.
 *   quiet            the arena goes still.
 *   the line         one of his handless dials crackles: someone has been on
 *                    the Republic's clocks the whole time. Rook.
 *   the party        ROOK JOINED THE PARTY, and his mechanic, CONTACT.
 *
 * It can reach the outside world only through `onContinue`, from the party
 * card — the finale's single `onDefeated` path. Recording Rook (same-device
 * fantasy continuity, stages/goldlineParty.ts) is the controller's job at that
 * boundary, never this.
 */

export type AftermathBeat = "stamp" | "quiet" | "radio" | "party";

type LinePhase = "typing" | "cut" | "retyping" | "reading";

type View = {
  beat: AftermathBeat;
  stamped: boolean;
  statsShown: boolean;
  line: number;
  phase: LinePhase;
  typed: number;
  retyped: number;
};

const ROOK = PARTY_COMPANIONS.rook;

export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Where a line is, `elapsed` ms after it started. */
function lineProgress(line: RadioLine, elapsed: number): { phase: LinePhase; typed: number; retyped: number; done: boolean } {
  const t = AFTERMATH_TIMING;
  const typing = typeMs(line.text);
  const typedOf = (text: string, ms: number) => Math.min(text.length, Math.floor(ms / t.typeMsPerChar));
  if (elapsed < typing) return { phase: "typing", typed: typedOf(line.text, elapsed), retyped: 0, done: false };
  if (!line.lieFails) {
    return { phase: "reading", typed: line.text.length, retyped: 0, done: elapsed >= typing + readMs(line.text) };
  }
  const afterCut = elapsed - typing - t.lieStaticMs;
  if (afterCut < 0) return { phase: "cut", typed: line.text.length, retyped: 0, done: false };
  const retyping = typeMs(line.lieFails);
  if (afterCut < retyping) {
    return { phase: "retyping", typed: line.text.length, retyped: typedOf(line.lieFails, afterCut), done: false };
  }
  return {
    phase: "reading",
    typed: line.text.length,
    retyped: line.lieFails.length,
    done: afterCut >= retyping + readMs(line.lieFails),
  };
}

/** Skip to the end of whatever is being typed; if nothing is, to the next line. */
function skipTarget(line: RadioLine, elapsed: number): number {
  const t = AFTERMATH_TIMING;
  const typing = typeMs(line.text);
  if (elapsed < typing) return typing;
  if (!line.lieFails) return Number.POSITIVE_INFINITY;
  const cutEnds = typing + t.lieStaticMs;
  if (elapsed < cutEnds) return cutEnds;
  const retypeEnds = cutEnds + typeMs(line.lieFails);
  if (elapsed < retypeEnds) return retypeEnds;
  return Number.POSITIVE_INFINITY;
}

export function ColosseumAftermath({
  startedAt,
  stats,
  reduced,
  broadcast,
  beatRef,
  stageRef,
  onContinue,
}: {
  /** performance.now() when he fell. */
  startedAt: number;
  stats: DuelStats;
  reduced: boolean;
  /** Written every frame: how hard the speaking dial glows, 0..1. */
  broadcast: MutableRefObject<number>;
  /** Written every frame: which beat is playing, for the camera. */
  beatRef: MutableRefObject<AftermathBeat>;
  stageRef: RefObject<StageHandle | null>;
  onContinue: () => void;
}) {
  const [view, setView] = useState<View>({
    beat: "stamp",
    stamped: reduced,
    statsShown: reduced,
    line: -1,
    phase: "typing",
    typed: 0,
    retyped: 0,
  });
  // The line clock lives in refs: taps move it, the loop reads it.
  const lineIndex = useRef(-1);
  const lineStartedAt = useRef(0);
  const partyAt = useRef<number | null>(null);
  const beats = useRef(new Set<string>());
  const stampCutAt = useRef<number | null>(null);

  const once = useCallback((key: string, run: () => void) => {
    if (beats.current.has(key)) return;
    beats.current.add(key);
    run();
  }, []);

  const startLine = useCallback(
    (index: number, now: number) => {
      lineIndex.current = index;
      lineStartedAt.current = now;
      const line = ROOK_ON_THE_LINE[index];
      if (!line || line.speaker === "trailblazer") return;
      once(`line-${index}`, () => {
        getAudioManager().play("radio_chirp");
        stageRef.current?.fx.ring(speakerPoint(), 8, "#8dffb4", 640);
      });
    },
    [once, stageRef]
  );

  const advance = useCallback(() => {
    const now = performance.now();
    const since = now - startedAt;
    const t = AFTERMATH_TIMING;
    if (partyAt.current != null) return;
    if (lineIndex.current < 0) {
      // The stamp can be cut short once it has landed; the quiet is short anyway.
      if (since >= t.stampSkippableAtMs && since < t.stampOutMs) stampCutAt.current = now;
      return;
    }
    const line = ROOK_ON_THE_LINE[lineIndex.current]!;
    const elapsed = now - lineStartedAt.current;
    const target = skipTarget(line, elapsed);
    if (Number.isFinite(target)) {
      lineStartedAt.current = now - target;
      return;
    }
    const next = lineIndex.current + 1;
    if (next < ROOK_ON_THE_LINE.length) startLine(next, now);
    else partyAt.current = now;
  }, [startLine, startedAt]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      // A focused button handles its own Enter/Space; don't advance twice.
      if (partyAt.current != null || event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      advance();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance]);

  useEffect(() => {
    let raf = 0;
    const t = AFTERMATH_TIMING;
    const tick = (now: number) => {
      const audio = getAudioManager();
      const stage = stageRef.current;
      // A tapped-through stamp moves the whole timeline forward.
      const shift = stampCutAt.current != null ? Math.max(0, t.stampOutMs - (stampCutAt.current - startedAt)) : 0;
      const since = now - startedAt + shift;
      const dial = speakerPoint();

      if (since >= t.stampAtMs) {
        once("stamp", () => {
          audio.play("level_complete");
          combatRevealFeedback();
        });
      }
      if (since >= t.crackleAtMs) {
        once("crackle", () => {
          audio.play("radio_static");
          stage?.fx.sparks(dial, 10, "#b9ffd2", 18);
        });
      }
      if (lineIndex.current < 0 && since >= t.firstLineAtMs) startLine(0, now);

      let phase: LinePhase = "typing";
      let typed = 0;
      let retyped = 0;
      const index = lineIndex.current;
      const party = partyAt.current != null && now >= partyAt.current;
      if (index >= 0 && !party) {
        const line = ROOK_ON_THE_LINE[index]!;
        const progress = lineProgress(line, now - lineStartedAt.current);
        ({ phase, typed, retyped } = progress);
        if (line.lieFails && phase !== "typing") {
          once(`cut-${index}`, () => {
            audio.play("voice_cut");
            stage?.shake(0.12);
            stage?.fx.sparks(dial, 16, "#e8fff0", 34);
          });
        }
        // The last line stays up while the party card waits its beat.
        if (progress.done && partyAt.current == null) {
          if (index + 1 < ROOK_ON_THE_LINE.length) startLine(index + 1, now);
          else partyAt.current = now + t.partyAfterLastLineMs;
        }
      }
      if (party) {
        once("party", () => {
          audio.play("companion_join");
          arcadeFeedback();
        });
      }

      const beat: AftermathBeat = party
        ? "party"
        : index >= 0 || since >= t.crackleAtMs
          ? "radio"
          : since >= t.stampOutMs
            ? "quiet"
            : "stamp";
      beatRef.current = beat;

      // The speaking dial: silent, then crackling, then carrying his voice.
      const line = index >= 0 ? ROOK_ON_THE_LINE[index] : null;
      const flicker = reduced ? 0.5 : Math.random();
      let level = 0;
      if (party) level = 0.3;
      else if (line?.speaker === "trailblazer") level = 0.22;
      else if (line && phase === "cut") level = reduced ? 0.6 : flicker;
      else if (line && (phase === "typing" || phase === "retyping")) {
        level = reduced ? 0.7 : 0.55 + 0.4 * Math.abs(Math.sin(now / 55)) * (0.6 + 0.4 * flicker);
        if (!reduced && Math.floor(now / 320) !== Math.floor((now - 17) / 320)) {
          stage?.fx.ring(dial, 5.5, "#8dffb4", 720);
        }
      } else if (line) level = 0.35;
      else if (since >= t.crackleAtMs) level = reduced ? 0.4 : flicker * 0.65;
      broadcast.current = level;

      setView(current => {
        const next: View = {
          beat,
          stamped: reduced || since >= t.stampAtMs,
          statsShown: reduced || since >= t.statsAtMs,
          line: party ? ROOK_ON_THE_LINE.length : index,
          phase,
          typed,
          retyped,
        };
        return current.beat === next.beat &&
          current.stamped === next.stamped &&
          current.statsShown === next.statsShown &&
          current.line === next.line &&
          current.phase === next.phase &&
          current.typed === next.typed &&
          current.retyped === next.retyped
          ? current
          : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      broadcast.current = 0;
    };
  }, [beatRef, broadcast, once, reduced, stageRef, startLine, startedAt]);

  const line = view.line >= 0 && view.line < ROOK_ON_THE_LINE.length ? ROOK_ON_THE_LINE[view.line]! : null;
  const onAir = line != null && line.speaker !== "trailblazer";

  return (
    <>
      {(view.beat === "stamp" || view.beat === "quiet" || view.beat === "radio") && (
        <button
          type="button"
          className="cd-aftermath-tap"
          aria-label={view.beat === "radio" ? "Next line" : "Continue"}
          onClick={advance}
        />
      )}

      {view.beat === "stamp" && view.stamped && (
        <div className="cd-level-complete" role="status">
          <span className="cd-lc-kicker">THE COLOSSEUM · CLOCKHEAD DEFEATED</span>
          <strong className="cd-lc-title">
            LEVEL
            <br />
            COMPLETE
          </strong>
          {view.statsShown && (
            <dl className="cd-lc-stats">
              <div>
                <dt>TIME</dt>
                <dd>{formatClock(stats.elapsedMs)}</dd>
              </div>
              <div>
                <dt>PERFECT</dt>
                <dd>{stats.perfectBlocks}</dd>
              </div>
              <div>
                <dt>RETURNS</dt>
                <dd>{stats.returns}</dd>
              </div>
              <div>
                <dt>RECOILS</dt>
                <dd>{stats.recoils}</dd>
              </div>
            </dl>
          )}
        </div>
      )}

      {view.beat === "radio" && line && (
        <div
          className={`cd-radio is-${line.speaker}${view.phase === "cut" ? " is-cut" : ""}`}
          role="status"
          aria-live="polite"
          key={view.line}
        >
          {/* Announced once, whole; the typewriter below is for the eyes. */}
          <p className="cz-sr-only">
            {SPEAKER_LABELS[line.speaker]}: {line.text}
            {line.lieFails ? ` Static. ${line.lieFails}` : ""}
          </p>
          <header className="cd-radio-head" aria-hidden="true">
            <span className="cd-radio-who">{SPEAKER_LABELS[line.speaker]}</span>
            {onAir && (
              <span className="cd-radio-signal" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
            )}
            {onAir && <small className="cd-radio-freq">UNLICENSED SIGNAL</small>}
          </header>
          <p className="cd-radio-text" aria-hidden="true">
            <span className={line.lieFails && view.phase !== "typing" ? "cd-radio-lie" : undefined}>
              {line.text.slice(0, view.typed)}
            </span>
            {view.phase === "cut" && <span className="cd-radio-static" aria-hidden="true" />}
            {line.lieFails && view.retyped > 0 && (
              <>
                <br />
                <span>{line.lieFails.slice(0, view.retyped)}</span>
              </>
            )}
          </p>
          <span className="cd-radio-hint" aria-hidden="true">
            TAP
          </span>
        </div>
      )}

      {view.beat === "party" && (
        <CompanionUnlockReveal
          id="rook"
          className="cd-party"
          kicker="COMPANION"
          title="ROOK JOINED THE PARTY"
          subtitle="ROOK VENN · TALKS TO EVERYONE · OWES HALF OF THEM"
          actionLabel="Take the Wayward route"
          onAction={onContinue}
        >
          <div className="cd-party-ability">
            <b>{ROOK.mechanic}</b>
            <span>{ROOK.mechanicSummary}</span>
            <q>I&rsquo;d knock again.</q>
          </div>
          <p className="cd-party-caution">
            Since the Sunder his voice fails on a direct lie. That doesn&rsquo;t mean he tells you everything.
          </p>
          <p className="cd-truth">The Wayward route is unlocked. This victory records no visit, sale, or revenue.</p>
        </CompanionUnlockReveal>
      )}
    </>
  );
}
