import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { BeverlyHillsProspect } from "@shared/beverlyHillsProspects";
import { metInPerson } from "@shared/beverlyHillsProspects";
import { createBeverlyHills, type BeverlyHillsHandle, type Interaction } from "./beverlyHillsRuntime";
import { createLoungeMusic, type LoungeMusic } from "./loungeMusic";
import { ProspectDesk } from "./ProspectDesk";
import {
  ADMITTED_LINES,
  BARISTA_LINES,
  PHOTOBOMB_LINES,
  PUG_LINES,
  SHADES_LINES,
  doormanLines,
  initialRope,
  lineClear,
  objectives,
  ropeReducer,
  type Line,
} from "./velvetRope";
import styles from "./beverly-hills-3d.module.css";

/**
 * Lantern City's Beverly Hills level: commercial cold outreach, uptown. Silver Lake is warm outreach to the business's
 * own lapsed customers in regular apartments; Beverly Hills is the business pitching new commercial clients (a hotel,
 * a building's leasing office). The fun is the Velvet Rope (velvetRope.ts); the business is the real prospect behind
 * the door, from the selected business's own records. Nothing is sent from here.
 */

const ASSET_BASE = "/assets/goldline/beverly-hills-3d/";

export default function BeverlyHills3D({ onExit }: { onExit: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<BeverlyHillsHandle | null>(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [rope, dispatch] = useReducer(ropeReducer, undefined, initialRope);
  const [prompt, setPrompt] = useState<{ id: string; label: string } | null>(null);
  // blocking dialogue (the world pauses) and non-blocking reaction bubbles
  const [dialogue, setDialogue] = useState<{ lines: Line[]; i: number; after?: () => void } | null>(null);
  const [bubble, setBubble] = useState<Line[] | null>(null);
  const [claire, setClaire] = useState(false);
  const [deskOpen, setDeskOpen] = useState(false);

  const prospectsQuery = trpc.system.goldlineWorld.beverlyHillsProspects.useQuery(undefined, { staleTime: 30_000 });
  const prospects: BeverlyHillsProspect[] = prospectsQuery.data?.prospects ?? [];
  const brandName = prospectsQuery.data?.brandName ?? "your business";
  const readable = prospectsQuery.data?.readable ?? !prospectsQuery.isError;
  const hotel = useMemo(() => prospects.find(p => /hotel/i.test(p.kind ?? "")) ?? prospects[0] ?? null, [prospects]);
  const buildingName = hotel?.name ?? "the hotel";

  // ---------------------------------------------------------------- music
  const musicRef = useRef<LoungeMusic | null>(null);
  const [musicOn, setMusicOn] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("beverlyHills.music") !== "off";
    } catch {
      return true;
    }
  });
  const startMusic = useCallback(() => {
    if (!musicRef.current) musicRef.current = createLoungeMusic();
    musicRef.current.start();
  }, []);
  useEffect(() => () => {
    musicRef.current?.dispose();
    musicRef.current = null;
  }, []);
  const toggleMusic = () => {
    const next = !musicOn;
    setMusicOn(next);
    try {
      window.localStorage.setItem("beverlyHills.music", next ? "on" : "off");
    } catch {
      /* not remembered */
    }
    if (next) startMusic();
    musicRef.current?.setMuted(!next);
  };

  // ---------------------------------------------------------------- dialogue plumbing
  const say = useCallback((lines: Line[], after?: () => void) => setDialogue({ lines, i: 0, after }), []);
  const advance = useCallback(() => {
    setDialogue(d => {
      if (!d) return d;
      if (d.i + 1 < d.lines.length) return { ...d, i: d.i + 1 };
      queueMicrotask(() => d.after?.());
      return null;
    });
  }, []);
  useEffect(() => {
    runtimeRef.current?.setPaused(Boolean(dialogue) || deskOpen || claire);
  }, [dialogue, deskOpen, claire]);
  useEffect(() => {
    if (!dialogue) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyE" || e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogue, advance]);
  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => setBubble(b => (b && b.length > 1 ? b.slice(1) : null)), 2600);
    return () => clearTimeout(t);
  }, [bubble]);

  // ---------------------------------------------------------------- the rope's state into the world
  const ropeRef = useRef(rope);
  ropeRef.current = rope;
  useEffect(() => {
    runtimeRef.current?.setRope(rope);
  }, [rope]);
  useEffect(() => {
    if (ready && hotel) runtimeRef.current?.setHotelName(hotel.name);
  }, [ready, hotel]);
  const admittedOnce = useRef(false);
  useEffect(() => {
    if (rope.phase !== "admitted" || admittedOnce.current) return;
    admittedOnce.current = true;
    if (rope.skipped) {
      setClaire(true);
      return;
    }
    setBubble(ADMITTED_LINES);
    const t = setTimeout(() => setClaire(true), 3300);
    return () => clearTimeout(t);
  }, [rope.phase, rope.skipped]);

  const onInteract = useCallback(
    (i: Interaction) => {
      const s = ropeRef.current;
      switch (i.kind) {
        case "talk_doorman":
          say(doormanLines(s, buildingName), () => dispatch({ type: "TALK_DOORMAN" }));
          break;
        case "talk_barista":
          if (s.have.juice) say(BARISTA_LINES.done);
          else if (!lineClear(s)) say(BARISTA_LINES.blocked);
          else say(BARISTA_LINES.sell, () => dispatch({ type: "BUY_JUICE" }));
          break;
        case "photobomb":
          setBubble(PHOTOBOMB_LINES[i.who]);
          dispatch({ type: "PHOTOBOMB", who: i.who });
          break;
        case "catch_pug":
          setBubble(PUG_LINES.caught);
          dispatch({ type: "CATCH_PUG" });
          break;
        case "pug_too_slow":
          setBubble(PUG_LINES.tooSlow);
          break;
        case "grab_shades":
          say(SHADES_LINES.grabbed, () => dispatch({ type: "GRAB_SHADES" }));
          break;
        case "enter_door":
          setDeskOpen(true);
          break;
      }
    },
    [buildingName, say]
  );
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;

  // ---------------------------------------------------------------- runtime lifecycle
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let handle: BeverlyHillsHandle | null = null;
    let cancelled = false;
    createBeverlyHills(host, ASSET_BASE, {
      onProgress: setProgress,
      onReady: () => setReady(true),
      onError: m => setFailed(m),
      onPrompt: p => setPrompt(p),
      onInteract: i => onInteractRef.current(i),
    })
      .then(h => {
        if (cancelled) {
          h.dispose();
          return;
        }
        handle = h;
        runtimeRef.current = h;
        h.setRope(ropeRef.current);
      })
      .catch(err => {
        if (!cancelled) setFailed(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      handle?.dispose();
      runtimeRef.current = null;
    };
  }, []);

  const goals = objectives(rope);
  const claireLine = hotel
    ? metInPerson(hotel)
      ? `That's ${hotel.name}. You logged an in-person conversation there${hotel.stage ? `, and it's waiting on a ${hotel.stage.replace(/_/g, " ")}` : ""}. I drafted it.`
      : `That's ${hotel.name}, from your ${hotel.source === "day1_ten_doors" ? "Ten Doors list" : "commercial accounts"}. I drafted an introduction.`
    : readable
      ? `Nobody in Beverly Hills is on file for ${brandName} yet. Log one and I'll have it ready behind this door.`
      : "I couldn't read your prospect records just now. That isn't the same as having none.";

  return (
    <div
      className={styles.root}
      data-testid="beverly-hills-3d"
      data-rope-phase={rope.phase}
      data-music={musicOn ? "on" : "off"}
      onPointerDownCapture={() => {
        if (musicOn) startMusic();
      }}
    >
      <div ref={hostRef} className={styles.stage} />

      {!ready && !failed ? (
        <div className={styles.loading} data-testid="beverly-hills-loading">
          <div className={styles.loadingTitle}>Beverly Hills</div>
          <div className={styles.loadingBar}>
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className={styles.loadingNote}>Rolling out the red carpet…</div>
        </div>
      ) : null}
      {failed ? (
        <div className={styles.loading} data-testid="beverly-hills-unavailable">
          <div className={styles.loadingTitle}>Beverly Hills is closed for a private event</div>
          <div className={styles.loadingNote}>This device couldn't open the 3D level ({failed}). The prospects are still on your Day Line.</div>
          <button type="button" className={styles.hudButton} onClick={onExit}>Return to City</button>
        </div>
      ) : null}

      <header className={styles.hud}>
        <div className={styles.card}>
          <div className={styles.cardKicker}>Lantern City · Commercial Row</div>
          <div className={styles.cardTitle}>Beverly Hills</div>
          <div className={styles.cardSub}>{brandName} · {prospects.length} prospect{prospects.length === 1 ? "" : "s"} behind the rope</div>
          {rope.phase !== "admitted" ? (
            <ol className={styles.goals} data-testid="beverly-hills-goals">
              {goals.map(g => (
                <li key={g.item} className={g.done ? styles.goalDone : ""} data-item={g.item} data-done={g.done ? "true" : "false"}>
                  <span className={styles.goalTick}>{g.done ? "✓" : "○"}</span>
                  <span>
                    <strong>{g.label}</strong>
                    {!g.done && rope.phase !== "arrive" ? <em>{g.hint}</em> : null}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
        <div className={styles.hudRight}>
          <button type="button" className={styles.hudButton} onClick={toggleMusic} aria-pressed={musicOn} data-testid="beverly-hills-music-toggle">
            {musicOn ? "♪ Music on" : "♪ Music off"}
          </button>
          {rope.phase !== "admitted" ? (
            <button type="button" className={styles.hudButton} onClick={() => dispatch({ type: "SKIP" })} data-testid="beverly-hills-skip">
              Skip the rope
            </button>
          ) : (
            <button type="button" className={`${styles.hudButton} ${styles.hudGold}`} onClick={() => setDeskOpen(true)} data-testid="beverly-hills-open-desk">
              Outreach desk
            </button>
          )}
          <button type="button" className={styles.hudButton} onClick={onExit}>
            Return to City
          </button>
        </div>
      </header>

      {prompt && !dialogue && !deskOpen && !claire ? (
        <button type="button" className={styles.prompt} onClick={() => runtimeRef.current?.interact()} data-testid="beverly-hills-prompt" data-prompt={prompt.id}>
          <kbd>E</kbd> {prompt.label}
        </button>
      ) : null}

      <div className={styles.touchButtons}>
        <button type="button" onPointerDown={() => runtimeRef.current?.setSprint(true)} onPointerUp={() => runtimeRef.current?.setSprint(false)} onPointerLeave={() => runtimeRef.current?.setSprint(false)}>
          Sprint
        </button>
        <button type="button" onClick={() => runtimeRef.current?.jump()}>Hop</button>
      </div>

      {ready && !dialogue && !deskOpen ? (
        <div className={styles.controlsHint} aria-hidden>
          <span>WASD to walk</span>
          <span>Shift to sprint</span>
          <span>Space to hop</span>
          <span>E to talk</span>
        </div>
      ) : null}
      {ready && !dialogue && !deskOpen ? (
        <div className={styles.touchHint} aria-hidden>
          <span>Drag left side to walk</span>
          <span>Drag right side to look</span>
        </div>
      ) : null}

      {bubble && bubble[0] ? (
        <div className={styles.bubble} role="status" data-testid="beverly-hills-bubble">
          <strong>{bubble[0].speaker}</strong> {bubble[0].text}
        </div>
      ) : null}

      {dialogue ? (
        <div className={styles.dialogue} role="dialog" aria-label={`${dialogue.lines[dialogue.i].speaker} says`} data-testid="beverly-hills-dialogue">
          <div className={styles.dialogueSpeaker}>{dialogue.lines[dialogue.i].speaker}</div>
          <p className={styles.dialogueText}>{dialogue.lines[dialogue.i].text}</p>
          <button type="button" className={styles.dialogueNext} onClick={advance} data-testid="beverly-hills-dialogue-next">
            {dialogue.i + 1 < dialogue.lines.length ? "Next ▸" : "Okay"}
          </button>
        </div>
      ) : null}

      {claire && !deskOpen ? (
        <div className={styles.claire} role="dialog" aria-label="Claire" data-testid="beverly-hills-claire">
          <div className={styles.claireName}>Claire</div>
          <p>{claireLine}</p>
          <div className={styles.claireActions}>
            <button type="button" className={styles.deskPrimary} onClick={() => { setClaire(false); setDeskOpen(true); }} data-testid="beverly-hills-claire-open">
              Open the outreach desk
            </button>
            <button type="button" className={styles.deskSecondary} onClick={() => setClaire(false)}>Look around first</button>
          </div>
        </div>
      ) : null}

      {deskOpen ? <ProspectDesk prospects={prospects} brandName={brandName} readable={readable} onClose={() => setDeskOpen(false)} /> : null}
    </div>
  );
}
