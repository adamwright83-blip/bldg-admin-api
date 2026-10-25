import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlayableLetterDesk } from "@/components/admin/control-room/LanternCitySceneV6/PlayableLetterDesk";
import { BusinessSwitcher } from "@/components/admin/BusinessSwitcher";
import type { CozyProjectedTarget } from "@shared/cozyVillagerEvidence";
import { CENTURY_PARK_EAST_TERRITORY } from "@shared/towerOutreachAreas";
import { useSilverLakeOutreach } from "../silverLake3d/useSilverLakeOutreach";
import { hasRealDecision } from "../silverLake3d/reunionQuests";
import { createCozyMusic } from "../silverLake3d/cozyMusic";
import { createZombieLoungeMusic } from "./zombieLoungeMusic";
import { createCenturyParkEast, ERRAND_SLOTS, type CpeHandle, type ErrandPhase, type Interaction, type ItemKind, type PromptId, type Vibe } from "./cpeRuntime";
import { THUMB_RECTS } from "./cpeCctv";
import { centuryParkEastTowerHref } from "./centuryParkEastEntry";
import styles from "./century-park-east-3d.module.css";

/**
 * Century Park East, the game. Up to eight real residents who used to order and have been quiet for 45+ days (the
 * same personal-outreach roster, consent checks and Letter Desk as Silver Lake, scoped to the building's own
 * addresses) each come with a building character who needs something found. Find it, hand it over, and the resident
 * comes down: the Letter Desk opens with the real draft. The next errand opens only on a real decision (scheduled,
 * sent, or passed). Twelve more residents are scenery and never customers. Zombie night or cozy night is the
 * player's choice and is remembered; cozy is the default.
 */

const CAST_BASE = "/assets/goldline/beverly-hills-3d/cast/";
const VIBE_KEY = "centuryParkEast.vibe";
const MUSIC_KEY = "centuryParkEast.music";
const PROGRESS_KEY = "centuryParkEast.progress.v1";

type Line = { who: string; text: string };

const CHARACTERS = ["Bev", "Lionel", "Tamsin", "Ricardo", "Dot", "Felix", "Priya", "Gus"];
const ITEM: Record<ItemKind, { label: string; hint: string; cozy: string; zombie: string }> = {
  robot_vacuum: { label: "robot vacuum", hint: "doing laps in the gym on the amenity floor", cozy: "It has been cleaning one treadmill for six hours.", zombie: "The only thing in this building the zombies are afraid of." },
  garment_bag: { label: "garment bag", hint: "up by the pool, hanging off a sun lounger", cozy: "Somebody's very good suit, sunbathing.", zombie: "A zombie was wearing it. It looked great on him." },
  leash: { label: "dog's leash", hint: "out on the roof by the pool", cozy: "Bedazzled. Of course it's bedazzled.", zombie: "It was being used as a zombie jump rope." },
  suitcase: { label: "suitcase", hint: "in the closet hall on the amenity floor", cozy: "It rode the elevator alone. Twice.", zombie: "Wedged into somebody's barricade. They won't miss it." },
  package: { label: "package", hint: "in the package room on the ground floor", cozy: "Wrong unit number. Again.", zombie: "A zombie was using it as a step stool." },
  yoga_mat: { label: "yoga mat", hint: "on the roof, next to the pool", cozy: "Still warm from the sun.", zombie: "A zombie was attempting downward dog on it. Poorly." },
  cake: { label: "birthday cake", hint: "on the concierge desk in the lobby", cozy: "The note on it says DO NOT EAT. Respect.", zombie: "They were guarding it like it was a brain." },
  spare_key: { label: "spare key", hint: "in the sky lounge on the roof", cozy: "On a keyring shaped like a tiny croissant.", zombie: "Taped under the bar. Smart. Mostly." },
};
const QUIET: { name: string; cozy: string; zombie: string }[] = [
  { name: "Wendy (on a work call)", cozy: "Sorry, I'm on mute. I've been on mute since March.", zombie: "Can you hear me? There's a zombie in my background. No, that's Kevin from finance." },
  { name: "Iris (reading in the lobby)", cozy: "Chapter twelve. Don't spoil it.", zombie: "Chapter twelve. The zombies can wait." },
  { name: "Harold (retired)", cozy: "I walk the building twice a day. I know everything.", zombie: "I've seen worse. 1987. The HOA meeting." },
  { name: "Milo (eleven)", cozy: "Can I ride the elevator with you? I'm not allowed alone.", zombie: "I named the slow one Gerald. Gerald's nice." },
  { name: "Yuki (yoga)", cozy: "Breathe in. The laundry is not your enemy.", zombie: "Breathe in. Do not breathe in near Gerald." },
  { name: "Chad (gym)", cozy: "Leg day. Every day is leg day.", zombie: "Cardio is finally paying off, bro." },
  { name: "Rosa (night nurse)", cozy: "Just got off a double. Don't let anybody talk to me.", zombie: "That one's not a zombie, he's just tired. Wait. No. Zombie." },
  { name: "Pete (DJ)", cozy: "Saving a set for the roof party. You'll know when.", zombie: "If this ends in a dance party, I've got a set ready." },
  { name: "The twins", cozy: "We're doing a building tour for our followers.", zombie: "This is SO good for engagement." },
  { name: "Frank (and his parrot)", cozy: "Lorenzo says hello. Lorenzo, say hello.", zombie: "Lorenzo keeps saying BRAINS. He learned it today." },
  { name: "Simone (lounge)", cozy: "The sky lounge is technically closed. I'm technically here.", zombie: "I locked myself in here with the good wine. Strategic." },
  { name: "Kev (courier)", cozy: "Got a package for 21-something. Nobody knows which.", zombie: "Signature required. From a zombie? Is that legal?" },
];

const firstName = (name: string) => name.split(" ")[0] || name;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // a private window: progress lasts the session
  }
}

type Progress = { found: string[]; reunited: string[]; passes: string[] };

export default function CenturyParkEast3D({ onExit }: { onExit?: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<CpeHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [vibe, setVibe] = useState<Vibe>(() => (readJson<string>(VIBE_KEY, "cozy") === "zombie" ? "zombie" : "cozy"));
  const [musicOn, setMusicOn] = useState(() => readJson<string>(MUSIC_KEY, "on") !== "off");
  const [prompt, setPrompt] = useState<{ id: PromptId; label: string } | null>(null);
  const [dialogue, setDialogue] = useState<{ lines: Line[]; i: number; then?: "choice"; slot?: number } | null>(null);
  const [choiceSlot, setChoiceSlot] = useState<number | null>(null);
  const [bubble, setBubble] = useState<Line | null>(null);
  const [bites, setBites] = useState(0);
  const [knockedOut, setKnockedOut] = useState(false);
  const [dogs, setDogs] = useState({ carried: 0, saved: 0, total: 12 });
  const [charges, setCharges] = useState(0);
  const [climbing, setClimbing] = useState<number | null>(null);
  const [camera, setCamera] = useState<{ id: string; label: string; floor: number; thumbs: { id: string; label: string }[] } | null>(null);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    if (!camera) return;
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, [camera]);
  const [floorIdx, setFloorIdx] = useState(0);
  const [trapped, setTrapped] = useState(0);
  const [party, setParty] = useState(false);
  const [progress, setProgress] = useState<Progress>(() => readJson<Progress>(PROGRESS_KEY, { found: [], reunited: [], passes: [] }));

  const o = useSilverLakeOutreach(CENTURY_PARK_EAST_TERRITORY);
  const targets = o.targets as CozyProjectedTarget[];
  const passes = useMemo(() => new Set(progress.passes), [progress.passes]);

  // the chain: real residents in roster order, one slot each; only the first undecided one is open
  const chain = useMemo(() => {
    const list = targets.slice(0, ERRAND_SLOTS.length).filter(t => hasRealDecision(t, passes) || (t.hasConsent && t.communicationState !== "consent_blocked"));
    let activeTaken = false;
    return list.map((t, slot) => {
      let phase: ErrandPhase;
      if (hasRealDecision(t, passes)) phase = "done";
      else if (activeTaken) phase = "locked";
      else {
        activeTaken = true;
        phase = progress.reunited.includes(t.customerId) ? "waiting" : progress.found.includes(t.customerId) ? "carrying" : "need";
      }
      return { slot, target: t, phase };
    });
  }, [targets, passes, progress]);
  const chainRef = useRef(chain);
  chainRef.current = chain;
  const vibeRef = useRef(vibe);
  vibeRef.current = vibe;
  const allDone = chain.length > 0 && chain.every(c => c.phase === "done");
  const rosterSettled = !o.loading;

  const saveProgress = useCallback((next: Progress) => {
    setProgress(next);
    writeJson(PROGRESS_KEY, next);
  }, []);

  // ---------------------------------------------------------------- music
  const musicRef = useRef<{ cozy: ReturnType<typeof createCozyMusic> | null; zombie: ReturnType<typeof createZombieLoungeMusic> | null; started: boolean }>({ cozy: null, zombie: null, started: false });
  const startMusic = useCallback(() => {
    const m = musicRef.current;
    if (!musicOn) return;
    if (vibeRef.current === "zombie") {
      m.cozy?.setMuted(true);
      if (!m.zombie) m.zombie = createZombieLoungeMusic();
      m.zombie.start();
      m.zombie.setMuted(false);
    } else {
      m.zombie?.setMuted(true);
      if (!m.cozy) m.cozy = createCozyMusic();
      m.cozy.start();
      m.cozy.setMuted(false);
    }
    m.started = true;
  }, [musicOn]);
  useEffect(() => {
    const m = musicRef.current;
    if (!musicOn) {
      m.cozy?.setMuted(true);
      m.zombie?.setMuted(true);
    } else if (m.started) startMusic();
  }, [musicOn, vibe, startMusic]);
  useEffect(() => () => {
    musicRef.current.cozy?.dispose();
    musicRef.current.zombie?.dispose();
  }, []);

  // ---------------------------------------------------------------- talking
  const talk = useCallback((slot: number) => {
    const c = chainRef.current[slot];
    const who = CHARACTERS[slot];
    const z = vibeRef.current === "zombie";
    if (!c) {
      setBubble({ who, text: z ? "I'm fine! I've got a bat and a bag of almonds." : "All good here. Lovely evening." });
      return;
    }
    const item = ITEM[ERRAND_SLOTS[slot].item];
    const first = firstName(c.target.displayName);
    if (c.phase === "locked") {
      setBubble({ who, text: z ? "Not now, I'm barricading. Help whoever's waving first." : "Give me a minute, I'm mid-crossword. Help whoever's waving first." });
      return;
    }
    if (c.phase === "done") {
      setBubble({ who, text: `Thank you. ${first} says hi.` });
      return;
    }
    if (c.phase === "need") {
      setDialogue({
        lines: [
          { who, text: z ? `Oh thank god, the manager. I'm ${who}. ${first}'s my neighbour, and they haven't come out since the zombies showed up.` : `Oh, the manager! I'm ${who}. ${first}'s my neighbour. They've been hibernating for weeks.` },
          { who, text: `I lost my ${item.label}. Last I saw it, it was ${item.hint}. Bring it back and I'll get ${first} down here.` },
        ],
        i: 0,
      });
      return;
    }
    if (c.phase === "carrying") {
      setDialogue({
        lines: [
          { who, text: `My ${item.label}! You absolute hero.` },
          { who: "", text: z ? `${who} bangs on the elevator twice. The doors slide open. It's ${c.target.displayName}, holding a laundry bag like a shield.` : `${who} knocks on the elevator twice. The doors slide open. It's ${c.target.displayName}, in slippers.` },
          { who, text: `${first}! It's been ${c.target.daysSinceLastOrder} days since your last pickup. ${c.target.paidOrders} order${c.target.paidOrders === 1 ? "" : "s"}, and then nothing.` },
          { who, text: `The manager should write to you. Go on, manager.` },
        ],
        i: 0,
        then: "choice",
        slot,
      });
      saveProgress({ ...progress, reunited: [...new Set([...progress.reunited, c.target.customerId])] });
      return;
    }
    setChoiceSlot(slot);
  }, [progress, saveProgress]);

  const onInteract = useCallback((i: Interaction) => {
    const z = vibeRef.current === "zombie";
    if (i.kind === "talk") talk(i.slot);
    else if (i.kind === "quiet") {
      const q = QUIET[i.index];
      setBubble({ who: q.name, text: z ? q.zombie : q.cozy });
    } else if (i.kind === "pickup_item") {
      const c = chainRef.current[i.slot];
      const item = ITEM[ERRAND_SLOTS[i.slot].item];
      setBubble({ who: "", text: `Got the ${item.label}. ${z ? item.zombie : item.cozy}` });
      if (c) setProgress(p => {
        const next = { ...p, found: [...new Set([...p.found, c.target.customerId])] };
        writeJson(PROGRESS_KEY, next);
        return next;
      });
    } else if (i.kind === "lock_closet") {
      setTrapped(i.trapped);
      setBubble({ who: "", text: z ? "Broom through the handles. He's not coming out. He seems fine with it." : "Broom through the handles. Sleep tight." });
    } else if (i.kind === "extinguisher") {
      setBubble({ who: "", text: z ? "Fire extinguisher. Spray a zombie to daze him, then he'll shuffle after you. Lead him into a closet." : "Lavender mist. One spritz and a sleepwalker follows you, yawning. Lead them to a closet for their nap." });
    } else if (i.kind === "pump") {
      setBubble({ who: "", text: "Pfff-pfff-pfff. You're 3D again." });
      setBites(0);
    } else if (i.kind === "elevator") {
      setBubble({ who: "Elevator", text: ["Ground floor.", "Amenity floor. Smooth jazz included.", "Roof. Mind the pool."][i.floor] ?? "" });
    } else if (i.kind === "concierge") {
      setBubble({ who: "The concierge (through the mail slot)", text: "I'm fine! I have snacks. Don't open this until everyone's sorted." });
    } else if (i.kind === "rope_top") {
      setBubble({ who: "", text: i.floor === 2 ? "Up through the hole and onto the roof. The pool is very blue." : z ? "Up through the hole. Nobody followed you. Yet." : "Up through the hole. Very fire station. Very brave." });
    } else if (i.kind === "rope_fell") {
      setBubble({ who: "", text: z ? "Grabbed by the ankle! You let go of the rope." : "A sleepwalker hugged your ankles. You let go of the rope." });
    } else if (i.kind === "out_of_foam") {
      setBubble({ who: "", text: z ? "Out of foam. Grab a red extinguisher off the wall: lobby, gym or roof." : "Out of mist. Grab a refill off the wall: lobby, gym or roof." });
    }
  }, [talk]);
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;

  // ---------------------------------------------------------------- the runtime
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let handle: CpeHandle | null = null;
    let cancelled = false;
    createCenturyParkEast(host, CAST_BASE, {
      onProgress: p => setProgressPct(p),
      onPrompt: p => setPrompt(p),
      onInteract: i => onInteractRef.current(i),
      onBite: n => {
        setBites(n);
        const z = vibeRef.current === "zombie";
        if (n === 1) setBubble({ who: "", text: z ? "BITTEN. You're paper now. One more and you're out. (There's a bike pump in the gym.)" : "Hugged flat. You're paper now. One more hug and you're napping. (There's a bike pump in the gym.)" });
        if (n >= 2) setKnockedOut(true);
      },
      onDogs: d => setDogs(d),
      onCharges: n => setCharges(n),
      onFloor: f => setFloorIdx(f),
      onBubble: b => setBubble(b),
      onClimb: c => setClimbing(c === null ? null : Math.round(c * 20) / 20),
      onCamera: c => setCamera(c),
    })
      .then(h => {
        if (cancelled) {
          h.dispose();
          return;
        }
        handle = h;
        runtimeRef.current = h;
        h.setVibe(vibeRef.current);
        h.setErrands(chainRef.current.map(c => ({ slot: c.slot, phase: c.phase })));
        setReady(true);
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

  useEffect(() => {
    runtimeRef.current?.setVibe(vibe);
    writeJson(VIBE_KEY, vibe);
  }, [vibe]);
  useEffect(() => {
    runtimeRef.current?.setErrands(ERRAND_SLOTS.map((_, slot) => ({ slot, phase: chain[slot]?.phase ?? "done" })));
  }, [chain, ready]);
  const deskOpen = !!o.selectedTarget;
  useEffect(() => {
    runtimeRef.current?.setPaused(!!dialogue || deskOpen || knockedOut || choiceSlot !== null);
  }, [dialogue, deskOpen, knockedOut, choiceSlot]);
  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => setBubble(null), 4200);
    return () => clearTimeout(t);
  }, [bubble]);

  // the party: when the last real resident is decided
  const wasAllDone = useRef(allDone);
  useEffect(() => {
    if (allDone && !wasAllDone.current) throwParty();
    wasAllDone.current = allDone;
  }, [allDone]);
  const throwParty = () => {
    setParty(true);
    runtimeRef.current?.finale();
  };

  const advance = () => {
    if (!dialogue) return;
    if (dialogue.i + 1 < dialogue.lines.length) setDialogue({ ...dialogue, i: dialogue.i + 1 });
    else {
      if (dialogue.then === "choice" && dialogue.slot !== undefined) setChoiceSlot(dialogue.slot);
      setDialogue(null);
    }
  };
  useEffect(() => {
    if (!dialogue && choiceSlot === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyE" || e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        if (dialogue) advance();
      }
      if (e.code === "Escape") {
        setDialogue(null);
        setChoiceSlot(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const writeTo = (slot: number) => {
    const c = chain[slot];
    setChoiceSlot(null);
    if (c) o.setSelectedSlotId(c.target.slotId);
  };
  const passOn = (slot: number) => {
    const c = chain[slot];
    setChoiceSlot(null);
    if (c) saveProgress({ ...progress, passes: [...new Set([...progress.passes, c.target.customerId])] });
  };

  const toggleVibe = () => setVibe(v => (v === "zombie" ? "cozy" : "zombie"));
  const toggleMusic = () => {
    const next = !musicOn;
    setMusicOn(next);
    writeJson(MUSIC_KEY, next ? "on" : "off");
  };
  const exit = () => (onExit ? onExit() : window.location.assign(centuryParkEastTowerHref()));
  const respawn = () => {
    setKnockedOut(false);
    setBites(0);
    runtimeRef.current?.respawn();
  };

  const z = vibe === "zombie";
  const floorName = ["Ground floor", "Amenity floor", "Roof"][floorIdx] ?? "";
  const open = chain.find(c => c.phase !== "done" && c.phase !== "locked");
  const rosterNote = o.loadFailed
    ? "Couldn't read the resident list just now. That isn't the same as nobody needing a text."
    : o.withheldReason
      ? o.withheldReason
      : rosterSettled && chain.length === 0
        ? "Nobody here has been quiet for 45+ days with a clear way to text. The building is sorted."
        : null;

  return (
    <div
      className={`${styles.root} ${z ? styles.zombie : styles.cozy}`}
      data-testid="century-park-east-3d"
      data-vibe={vibe}
      data-party={party ? "on" : "off"}
      onPointerDownCapture={() => startMusic()}
    >
      <div ref={hostRef} className={styles.stage} />

      {!ready && !failed ? (
        <div className={styles.loading} data-testid="century-park-east-loading">
          <div className={styles.loadingTitle}>Century Park East</div>
          <div className={styles.loadingBar}>
            <span style={{ width: `${Math.round(progressPct * 100)}%` }} />
          </div>
          <div className={styles.loadingNote}>{z ? "Checking the locks…" : "Fluffing the lobby cushions…"}</div>
        </div>
      ) : null}
      {failed ? (
        <div className={styles.loading} data-testid="century-park-east-unavailable">
          <div className={styles.loadingTitle}>The building is closed for maintenance</div>
          <div className={styles.loadingNote}>This device couldn't open the 3D building ({failed}). The residents are still in the tower view.</div>
          <button type="button" className={styles.hudButton} onClick={exit}>Back to the tower</button>
        </div>
      ) : null}

      <header className={styles.hud}>
        <div className={styles.card}>
          <div className={styles.cardKicker}>Lantern City · {floorName}</div>
          <div className={styles.cardTitle}>Century Park East</div>
          <div className={styles.cardSub}>
            {chain.length ? `${chain.filter(c => c.phase !== "done").length} of ${chain.length} residents need you` : o.loading ? "Reading the residents…" : "Residents quiet 45+ days"}
          </div>
          {chain.length ? (
            <ol className={styles.errands} data-testid="century-park-east-errands">
              {chain.map(c => (
                <li key={c.target.customerId} data-phase={c.phase} className={styles[`phase_${c.phase}`]}>
                  <span className={styles.tick}>{c.phase === "done" ? "✓" : c.phase === "locked" ? "·" : "!"}</span>
                  <span>
                    <strong>{CHARACTERS[c.slot]}'s {ITEM[ERRAND_SLOTS[c.slot].item].label}</strong>
                    {c.phase !== "locked" && c.phase !== "done" ? <em>for {firstName(c.target.displayName)}</em> : null}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          {rosterNote ? (
            <div className={styles.rosterNote} data-testid="century-park-east-roster-note">
              {rosterNote}
              {!o.loadFailed ? <BusinessSwitcher className={styles.switcher} /> : null}
            </div>
          ) : null}
          <div className={styles.stats}>
            <span data-testid="century-park-east-lives" title="Bites">
              {bites === 0 ? "♥ ♥" : "♥ ♡"} <small>{bites === 0 ? "3D" : "paper"}</small>
            </span>
            <span data-testid="century-park-east-dogs">🐶 {dogs.saved}/{dogs.total}{dogs.carried ? ` · ${dogs.carried} on you` : ""}</span>
            <span>{z ? "🧯" : "💜"} {charges}</span>
            {trapped ? <span>{z ? "🧟" : "😴"} {trapped} in closets</span> : null}
          </div>
        </div>
        <div className={styles.hudRight}>
          <button type="button" className={`${styles.hudButton} ${styles.vibeButton}`} onClick={toggleVibe} aria-pressed={z} data-testid="century-park-east-vibe">
            {z ? "🧟 Zombie night" : "🕯️ Cozy night"}
          </button>
          <button type="button" className={styles.hudButton} onClick={toggleMusic} aria-pressed={musicOn}>
            {musicOn ? "♪ Music on" : "♪ Music off"}
          </button>
          {(allDone || (rosterSettled && chain.length === 0)) && !party ? (
            <button type="button" className={`${styles.hudButton} ${styles.gold}`} onClick={throwParty} data-testid="century-park-east-party">
              Throw the roof party
            </button>
          ) : null}
          <button type="button" className={styles.hudButton} onClick={exit}>Back to the tower</button>
        </div>
      </header>

      {camera && ready && !party ? (
        <div className={styles.monitors} aria-hidden data-testid="century-park-east-monitors" data-camera={camera.id}>
          <div className={styles.camLabel}>
            <span className={styles.rec}>● REC</span> CAM {camera.id} · {["GROUND FLOOR", "AMENITY FLOOR", "ROOF"][camera.floor]} · {camera.label}
          </div>
          <div className={styles.camClock}>{clock.toTimeString().slice(0, 8)} · {clock.toISOString().slice(0, 10)}</div>
          {camera.thumbs.map((t, i) => (
            <div key={t.id} className={styles.thumbLabel} style={{ left: `${THUMB_RECTS[i].x * 100}%`, top: `calc(${THUMB_RECTS[i].y * 100}% - 18px)`, width: `${THUMB_RECTS[i].w * 100}%` }}>
              CAM {t.id} · {t.label}
            </div>
          ))}
        </div>
      ) : null}

      {prompt && ready && !dialogue && !deskOpen && choiceSlot === null && !knockedOut ? (
        <button type="button" className={styles.prompt} onClick={() => runtimeRef.current?.interact()} data-testid="century-park-east-prompt" data-prompt={prompt.id}>
          <kbd>E</kbd> {prompt.label}
        </button>
      ) : null}

      <div className={styles.touchButtons}>
        <button type="button" onClick={() => runtimeRef.current?.spray()}>{z ? "Spray" : "Mist"}</button>
        <button type="button" onPointerDown={() => runtimeRef.current?.setSprint(true)} onPointerUp={() => runtimeRef.current?.setSprint(false)} onPointerLeave={() => runtimeRef.current?.setSprint(false)}>Run</button>
        <button type="button" onClick={() => runtimeRef.current?.jump()}>Hop</button>
      </div>
      {ready && !dialogue && !deskOpen ? (
        <div className={styles.controlsHint} aria-hidden>
          <span>WASD to walk</span>
          <span>Shift to run</span>
          <span>F to {z ? "spray" : "mist"}</span>
          <span>E to talk</span>
          <span>Ropes go up a floor</span>
        </div>
      ) : null}

      {climbing !== null ? (
        <div className={styles.climbMeter} role="status" data-testid="century-park-east-climb">
          <b>{z ? "Climb! The zombie is right behind you." : "Climb! Keep pulling."}</b>
          <div className={styles.climbBar}><span style={{ width: `${Math.round(climbing * 100)}%` }} /></div>
          <small>Tap E, Space or the button fast. Stop and you slip. S lets go.</small>
        </div>
      ) : null}

      {bubble && !dialogue ? (
        <div className={styles.bubble} role="status" data-testid="century-park-east-bubble">
          {bubble.who ? <b>{bubble.who}</b> : null} {bubble.text}
        </div>
      ) : null}

      {dialogue ? (
        <div className={styles.dialogue} role="dialog" aria-label="Conversation" data-testid="century-park-east-dialogue">
          {dialogue.lines[dialogue.i].who ? <div className={styles.speaker}>{dialogue.lines[dialogue.i].who}</div> : null}
          <p className={dialogue.lines[dialogue.i].who ? "" : styles.narration}>{dialogue.lines[dialogue.i].text}</p>
          <button type="button" className={styles.dialogueNext} onClick={advance} data-testid="century-park-east-dialogue-next">
            {dialogue.i + 1 < dialogue.lines.length ? "Next" : "OK"}
          </button>
        </div>
      ) : null}

      {choiceSlot !== null && chain[choiceSlot] ? (
        <div className={styles.dialogue} role="dialog" aria-label="Write to them?" data-testid="century-park-east-choice">
          <div className={styles.speaker}>{chain[choiceSlot].target.displayName}</div>
          <p>
            {chain[choiceSlot].target.daysSinceLastOrder} days since their last pickup · {chain[choiceSlot].target.paidOrders} order
            {chain[choiceSlot].target.paidOrders === 1 ? "" : "s"} with you. Claire drafted a personal text from your phone.
          </p>
          <div className={styles.choiceRow}>
            <button type="button" className={styles.primary} onClick={() => writeTo(choiceSlot)} data-testid="century-park-east-write">
              Write to {firstName(chain[choiceSlot].target.displayName)}
            </button>
            <button type="button" className={styles.secondary} onClick={() => passOn(choiceSlot)} data-testid="century-park-east-pass">
              Not now (next resident)
            </button>
          </div>
        </div>
      ) : null}

      {knockedOut ? (
        <div className={styles.ko} role="dialog" aria-label="Knocked out" data-testid="century-park-east-ko">
          <div className={styles.koTitle}>{z ? "You've been zombified." : "Hugged into a nap."}</div>
          <p>{z ? "A Pomeranian is very disappointed in you." : "It was a very good hug. The Pomeranian is judging you anyway."} Your errands are where you left them.</p>
          <button type="button" className={styles.primary} onClick={respawn} data-testid="century-park-east-respawn">
            Wake up in the lobby
          </button>
        </div>
      ) : null}

      {party ? (
        <div className={styles.partyBanner} data-testid="century-park-east-finale">
          <div className={styles.partyTitle}>Century Park East is sorted.</div>
          <div className={styles.partySub}>{z ? "The concierge is out. The zombies have learned a line dance." : "The concierge is back from vacation and is crying a little."}</div>
        </div>
      ) : null}

      {o.selectedTarget ? (
        <div className={styles.deskWrap} data-testid="century-park-east-desk">
          <PlayableLetterDesk
            target={o.selectedTarget}
            targetIndex={o.selectedIndex}
            totalTargets={targets.length}
            objectiveId={o.objectiveId}
            isSending={o.isSending}
            isSynthetic={o.isSyntheticPreview}
            encounterCount={1}
            memoryNote={o.memoryNote}
            neighborhoodMemory={o.neighborhoodMemory}
            tenantId={o.tenantId}
            onSendNow={o.handleSendNow}
            onScheduleSend={o.handleScheduleSend}
            onClose={() => o.setSelectedSlotId(null)}
            onSelectIndex={o.handleSelectIndex}
            onDraftCompleted={o.handleDraftCompleted}
            onSaveUnfinishedDraft={o.handleSaveUnfinishedDraft}
          />
        </div>
      ) : null}
      {open ? <span hidden data-testid="century-park-east-open-slot" data-slot={open.slot} data-phase={open.phase} /> : null}
    </div>
  );
}
