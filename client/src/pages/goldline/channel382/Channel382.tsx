import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTION,
  BRAND,
  CELEBRATE,
  EXPORT_LINES,
  FRAME_EMPTY,
  FRAME_GOOD,
  HOOK_REACTION,
  HOOKS,
  INTRO,
  LIGHT_REACTION,
  LIGHTS,
  PROP_REACTION,
  PROPS,
  WAITING,
  canExport,
  captionFor,
  claimsFor,
  fillLine,
  hookById,
  type HookId,
  type LightId,
  type Line,
  type PropId,
} from "./channel382Copy";
import { createChannel382, DEFAULT_LENS, type Channel382Handle, type FrameInfo, type Lens, type Mood } from "./channel382Runtime";
import { composeAd, loadAdFonts } from "./adComposer";
import styles from "./channel-382.module.css";

/**
 * CHANNEL 382: a tiny, chaotic TV station whose one commercial is a real Laundry Farm ad.
 *
 * You direct: pick a hook, dress the set, light it, frame it, call ACTION, and the frame you capture is the ad. Every
 * claim in it must be approved before it can leave the building. The ON AIR sign stays dark until you've put it out
 * there yourself; what you tell us you did ("posted on the feed" or "started a paid promotion") is recorded as what
 * you said, never as verified reach. Nothing here writes to the server, sends, posts, or spends.
 */

type Phase = "intro" | "hook" | "dress" | "light" | "frame" | "action" | "review" | "air" | "on";
type OnAirKind = "posted_feed" | "paid_promotion";
type Saved = { followers: number | null; broadcasts: { kind: OnAirKind; at: string; headline: string }[] };
const STORE = "channel382.v1";

function load(): Saved {
  try {
    const raw = window.localStorage.getItem(STORE);
    if (raw) return JSON.parse(raw) as Saved;
  } catch {
    // private window: the station forgets you, cheerfully
  }
  return { followers: null, broadcasts: [] };
}
function save(s: Saved) {
  try {
    window.localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    // nothing to do
  }
}

const STEPS: { phase: Phase; n: number; label: string }[] = [
  { phase: "hook", n: 1, label: "The hook" },
  { phase: "dress", n: 2, label: "Dress the set" },
  { phase: "light", n: 3, label: "Light it" },
  { phase: "frame", n: 4, label: "Frame the shot" },
  { phase: "action", n: 5, label: "Action!" },
];
const ORDER: Phase[] = ["intro", "hook", "dress", "light", "frame", "action", "review", "air", "on"];

export default function Channel382({ onExit }: { onExit?: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rt = useRef<Channel382Handle | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved>(() => load());
  const [phase, setPhase] = useState<Phase>("intro");
  const [followersInput, setFollowersInput] = useState(() => (saved.followers ? String(saved.followers) : ""));
  const [hook, setHook] = useState<HookId | null>(null);
  const [light, setLight] = useState<LightId>("morning");
  const [props, setProps] = useState<Record<PropId, boolean>>({ van: true, bags: true, towels: true, washer: true, palms: true });
  const [lens, setLens] = useState<Lens>(DEFAULT_LENS);
  const [frame, setFrame] = useState<FrameInfo>({ van: true, subjects: 3 });
  const [lines, setLines] = useState<Line[]>([]);
  const [lineIdx, setLineIdx] = useState(0);
  const [headline, setHeadline] = useState("");
  const [subline, setSubline] = useState("");
  const [offer, setOffer] = useState("");
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [checkedAll, setCheckedAll] = useState(false);
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [adUrl, setAdUrl] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const [copied, setCopied] = useState(false);
  const [flash, setFlash] = useState(false);
  const [onAir, setOnAir] = useState<OnAirKind | null>(null);

  const channel = useMemo(() => {
    const n = saved.followers;
    return n && n > 0 ? n.toLocaleString("en-US") : "382";
  }, [saved.followers]);

  // ---------------------------------------------------------------- the studio
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let h: Channel382Handle | null = null;
    try {
      h = createChannel382(host, { onFrame: f => setFrame(f) });
      rt.current = h;
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
    void loadAdFonts();
    return () => {
      h?.dispose();
      rt.current = null;
    };
  }, []);
  useEffect(() => rt.current?.setChannel(channel), [channel]);
  useEffect(() => rt.current?.setLight(light), [light]);
  useEffect(() => {
    for (const p of PROPS) rt.current?.setProp(p.id, props[p.id]);
  }, [props]);
  useEffect(() => rt.current?.setLens(lens), [lens]);
  useEffect(() => rt.current?.setView(phase === "frame" ? "lens" : "studio"), [phase]);

  // ---------------------------------------------------------------- Bertrand talks
  const say = useCallback((next: Line[], mood: Mood = "talk") => {
    setLines(next);
    setLineIdx(0);
    rt.current?.bertrand(mood);
  }, []);
  const line = lines[lineIdx];
  useEffect(() => {
    if (!line) {
      rt.current?.bertrand(onAir ? "joy" : "idle");
      return;
    }
    const t = setTimeout(() => setLineIdx(i => i + 1), Math.max(2600, line.text.length * 55));
    return () => clearTimeout(t);
  }, [line, onAir]);
  useEffect(() => {
    say(INTRO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // a word on the framing, when it changes from good to empty or back
  const framedOnce = useRef(false);
  useEffect(() => {
    if (phase !== "frame") return;
    if (!framedOnce.current) {
      framedOnce.current = true;
      return;
    }
    say([frame.van ? FRAME_GOOD : FRAME_EMPTY], frame.van ? "joy" : "angry");
  }, [frame.van, phase, say]);

  // ---------------------------------------------------------------- the steps
  const go = (p: Phase) => setPhase(p);
  const saveFollowers = () => {
    const n = Number(followersInput.replace(/[^\d]/g, ""));
    const next = { ...saved, followers: n > 0 ? n : null };
    setSaved(next);
    save(next);
    go("hook");
  };
  const chooseHook = (id: HookId) => {
    setHook(id);
    const h = hookById(id);
    setHeadline(h.headline);
    setSubline(h.subline);
    setApproved(new Set());
    setCheckedAll(false);
    say(HOOK_REACTION[id], id === "offer" ? "angry" : id === "relief" ? "cry" : "talk");
  };
  const toggleProp = (id: PropId) => {
    const on = !props[id];
    setProps(p => ({ ...p, [id]: on }));
    const r = PROP_REACTION[id];
    say([on ? r.on : r.off], on ? "talk" : "angry");
  };
  const chooseLight = (id: LightId) => {
    setLight(id);
    say([LIGHT_REACTION[id]], id === "spotlight" ? "joy" : "talk");
  };

  const runAction = async () => {
    if (!hook || !rt.current) return;
    go("action");
    say(ACTION[hook], hook === "relief" ? "cry" : hook === "offer" ? "angry" : "joy");
    await rt.current.action(hook);
    await loadAdFonts();
    setFlash(true);
    setTimeout(() => setFlash(false), 260);
    const shot = rt.current.capture();
    setPhoto(shot);
    go("review");
  };

  // the ad recomposes as the words change
  useEffect(() => {
    if (!photo) return;
    const c = composeAd(photo, { headline, subline, offer });
    setAdUrl(c.toDataURL("image/png"));
  }, [photo, headline, subline, offer]);

  const claims = hook ? claimsFor(hook, offer) : [];
  const ready = hook ? canExport(hook, offer, approved, checkedAll) : false;
  const caption = captionFor(headline, subline, offer);

  const toggleClaim = (id: string) =>
    setApproved(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const download = () => {
    if (!adUrl || !ready) return;
    const a = document.createElement("a");
    a.href = adUrl;
    a.download = "laundry-farm-ad.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setExported(true);
  };
  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // the caption is on screen to copy by hand
    }
  };
  const share = async () => {
    if (!adUrl || !ready) return;
    try {
      const blob = await (await fetch(adUrl)).blob();
      const file = new File([blob], "laundry-farm-ad.png", { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], text: caption });
        setExported(true);
      } else download();
    } catch {
      // cancelled; nothing happened
    }
  };
  const canShareFiles = typeof navigator !== "undefined" && "share" in navigator;

  const toAir = () => {
    go("air");
    say([...EXPORT_LINES, WAITING], "talk");
  };
  const declare = (kind: OnAirKind) => {
    const next = { ...saved, broadcasts: [...saved.broadcasts, { kind, at: new Date().toISOString(), headline: headline.replace(/\n/g, " ") }] };
    setSaved(next);
    save(next);
    setOnAir(kind);
    rt.current?.setOnAir(true);
    rt.current?.celebrate();
    say(CELEBRATE[kind], "joy");
    go("on");
  };
  const another = () => {
    setPhoto(null);
    setAdUrl(null);
    setExported(false);
    setOnAir(null);
    rt.current?.setOnAir(false);
    setHook(null);
    go("hook");
  };

  const stepIdx = ORDER.indexOf(phase);

  return (
    <div className={styles.root} data-testid="channel-382" data-phase={phase} data-on-air={onAir ?? "dark"}>
      <div ref={hostRef} className={styles.stage} />
      {phase === "frame" ? <div className={styles.lensGuide} aria-hidden data-testid="channel-382-lens-guide"><span>4:5 · this is the ad</span></div> : null}
      {flash ? <div className={styles.flash} aria-hidden /> : null}
      {failed ? (
        <div className={styles.failed} data-testid="channel-382-unavailable">
          <b>The studio couldn't open on this device ({failed}).</b>
          <button type="button" onClick={onExit}>Back to the city</button>
        </div>
      ) : null}

      <header className={styles.top}>
        <div className={styles.station}>
          <span className={styles.channel}>CHANNEL {channel}</span>
          <span className={styles.motto}>Broadcasting to practically nobody since this morning</span>
        </div>
        <div className={styles.topRight}>
          <span className={`${styles.onAir} ${onAir ? styles.onAirLit : ""}`} data-testid="channel-382-on-air">ON AIR</span>
          <button type="button" className={styles.ghost} onClick={onExit}>Back to the city</button>
        </div>
      </header>

      {phase !== "intro" && phase !== "review" && phase !== "air" && phase !== "on" ? (
        <aside className={styles.sheet} aria-label="Call sheet" data-testid="channel-382-sheet">
          <div className={styles.sheetTitle}>Call sheet · {BRAND.name}</div>
          <ol className={styles.steps}>
            {STEPS.map(s => (
              <li key={s.phase} data-state={ORDER.indexOf(s.phase) < stepIdx ? "done" : s.phase === phase ? "now" : "next"}>
                <span>{ORDER.indexOf(s.phase) < stepIdx ? "✓" : s.n}</span> {s.label}
              </li>
            ))}
          </ol>

          {phase === "hook" ? (
            <div className={styles.panel}>
              <p className={styles.ask}>Claire drafted three hooks from what Laundry Farm already says. Pick one; you'll approve every word before it airs.</p>
              {HOOKS.map(h => (
                <button key={h.id} type="button" className={`${styles.choice} ${hook === h.id ? styles.choiceOn : ""}`} onClick={() => chooseHook(h.id)} data-testid={`channel-382-hook-${h.id}`}>
                  <b>{h.label}</b>
                  <em>{h.headline.replace("\n", " ")}</em>
                  <small>{h.pitch}</small>
                </button>
              ))}
              <button type="button" className={styles.next} disabled={!hook} onClick={() => go("dress")} data-testid="channel-382-next">Next: dress the set →</button>
            </div>
          ) : null}

          {phase === "dress" ? (
            <div className={styles.panel}>
              <p className={styles.ask}>What's in the shot? (The van is the star. The van has an agent.)</p>
              <div className={styles.toggles}>
                {PROPS.map(p => (
                  <button key={p.id} type="button" className={`${styles.toggle} ${props[p.id] ? styles.toggleOn : ""}`} aria-pressed={props[p.id]} onClick={() => toggleProp(p.id)} data-testid={`channel-382-prop-${p.id}`}>
                    {p.label}
                  </button>
                ))}
              </div>
              <button type="button" className={styles.next} onClick={() => go("light")} data-testid="channel-382-next">Next: light it →</button>
            </div>
          ) : null}

          {phase === "light" ? (
            <div className={styles.panel}>
              <p className={styles.ask}>Three lights. One budget. Choose.</p>
              {LIGHTS.map(l => (
                <button key={l.id} type="button" className={`${styles.choice} ${light === l.id ? styles.choiceOn : ""}`} onClick={() => chooseLight(l.id)} data-testid={`channel-382-light-${l.id}`}>
                  <b>{l.label}</b>
                  <small>{l.note}</small>
                </button>
              ))}
              <button type="button" className={styles.next} onClick={() => go("frame")} data-testid="channel-382-next">Next: frame the shot →</button>
            </div>
          ) : null}

          {phase === "frame" ? (
            <div className={styles.panel}>
              <p className={styles.ask}>You're behind the camera. The box is the ad.</p>
              <label className={styles.slider}>Swing
                <input type="range" min={-0.55} max={0.55} step={0.01} value={lens.az} onChange={e => setLens(l => ({ ...l, az: Number(e.target.value) }))} data-testid="channel-382-lens-az" />
              </label>
              <label className={styles.slider}>Height
                <input type="range" min={0.6} max={3.8} step={0.01} value={lens.height} onChange={e => setLens(l => ({ ...l, height: Number(e.target.value) }))} data-testid="channel-382-lens-height" />
              </label>
              <label className={styles.slider}>Push in
                <input type="range" min={5.2} max={12} step={0.01} value={17.2 - lens.dist} onChange={e => setLens(l => ({ ...l, dist: 17.2 - Number(e.target.value) }))} data-testid="channel-382-lens-dist" />
              </label>
              <p className={frame.van ? styles.good : styles.warn} data-testid="channel-382-frame-check">
                {frame.van ? `The van's in. ${frame.subjects} thing${frame.subjects === 1 ? "" : "s"} in shot.` : "The van isn't in the shot."}
              </p>
              <button type="button" className={`${styles.next} ${styles.action}`} onClick={() => void runAction()} data-testid="channel-382-action">🎬 ACTION!</button>
            </div>
          ) : null}

          {phase === "action" ? <div className={styles.panel}><p className={styles.ask}>Rolling…</p></div> : null}
        </aside>
      ) : null}

      {phase === "intro" ? (
        <div className={styles.introCard} data-testid="channel-382-intro">
          <div className={styles.kicker}>A Laundry Farm production</div>
          <h1>CHANNEL 382</h1>
          <p>Make one commercial. Get it on the air.</p>
          <label className={styles.followers}>
            How many Instagram followers does Laundry Farm have?
            <input inputMode="numeric" placeholder="e.g. 382" value={followersInput} onChange={e => setFollowersInput(e.target.value)} data-testid="channel-382-followers" />
            <small>That's your channel number. It's what you tell us; we don't check Instagram.</small>
          </label>
          <button type="button" className={styles.next} onClick={saveFollowers} data-testid="channel-382-start">Enter the studio →</button>
        </div>
      ) : null}

      {phase === "review" && hook ? (
        <div className={styles.review} data-testid="channel-382-review">
          <div className={styles.reviewAd}>
            {adUrl ? <img src={adUrl} alt="Your Laundry Farm ad" data-testid="channel-382-ad" /> : null}
            <span className={styles.adLabel}>1080 × 1350 · Instagram feed</span>
          </div>
          <div className={styles.reviewSide}>
            <div className={styles.kicker}>The commercial · {BRAND.name}</div>
            <label className={styles.field}>Headline
              <textarea rows={2} value={headline} maxLength={70} onChange={e => { setHeadline(e.target.value); setCheckedAll(false); }} data-testid="channel-382-headline" />
            </label>
            <label className={styles.field}>Line under it
              <input value={subline} maxLength={70} onChange={e => { setSubline(e.target.value); setCheckedAll(false); }} data-testid="channel-382-subline" />
            </label>
            <label className={styles.field}>Your offer (optional; yours alone)
              <input value={offer} maxLength={44} placeholder="e.g. $10 off your first pickup" onChange={e => { setOffer(e.target.value); setCheckedAll(false); }} data-testid="channel-382-offer" />
            </label>
            <div className={styles.claims} data-testid="channel-382-claims">
              <b>Before it airs, confirm each is true for Laundry Farm today:</b>
              {claims.map(c => (
                <label key={c.id} className={styles.claim}>
                  <input type="checkbox" checked={approved.has(c.id)} onChange={() => toggleClaim(c.id)} data-testid={`channel-382-claim-${c.id}`} />
                  <span>{c.text}<small>{c.source}</small></span>
                </label>
              ))}
              <label className={styles.claim}>
                <input type="checkbox" checked={checkedAll} onChange={e => setCheckedAll(e.target.checked)} data-testid="channel-382-checked-all" />
                <span>I've read every word of this ad, and it's true.</span>
              </label>
            </div>
            <div className={styles.exportRow}>
              <button type="button" className={styles.next} disabled={!ready} onClick={download} data-testid="channel-382-download">Download the ad</button>
              {canShareFiles ? <button type="button" className={styles.ghostDark} disabled={!ready} onClick={() => void share()}>Share to Instagram…</button> : null}
              <button type="button" className={styles.ghostDark} onClick={() => void copyCaption()} data-testid="channel-382-copy-caption">{copied ? "Caption copied ✓" : "Copy caption"}</button>
            </div>
            <pre className={styles.caption} data-testid="channel-382-caption">{caption}</pre>
            <div className={styles.exportRow}>
              <button type="button" className={`${styles.next} ${styles.action}`} disabled={!exported} onClick={toAir} data-testid="channel-382-to-air">Take it to air →</button>
              <button type="button" className={styles.ghostDark} onClick={() => { setPhoto(null); go("frame"); }}>Reshoot</button>
            </div>
            {!exported ? <small className={styles.hint}>Download (or share) the ad first. Nothing is posted by JOYSTICK.</small> : null}
          </div>
        </div>
      ) : null}

      {phase === "air" ? (
        <div className={styles.airCard} data-testid="channel-382-air">
          <div className={styles.kicker}>Standing by</div>
          <h2>The ON AIR sign is dark.</h2>
          <p>Post it on Laundry Farm's Instagram, or put money behind it in Ads Manager. Then come back and tell Bertrand which.</p>
          <div className={styles.exportRow}>
            <button type="button" className={styles.next} onClick={() => declare("posted_feed")} data-testid="channel-382-posted-feed">I posted it on the feed</button>
            <button type="button" className={styles.next} onClick={() => declare("paid_promotion")} data-testid="channel-382-paid">I started a paid promotion</button>
          </div>
          <small className={styles.hint}>This records what you tell us. It doesn't check Instagram or count anyone.</small>
        </div>
      ) : null}

      {phase === "on" && onAir ? (
        <div className={styles.airCard} data-testid="channel-382-on">
          <div className={styles.kicker}>{onAir === "posted_feed" ? "Posted on the feed · as you told us" : "Paid promotion started · as you told us"}</div>
          <h2>CHANNEL {channel} is on the air.</h2>
          <div className={styles.ratings} data-testid="channel-382-ratings">
            <b>Ratings</b>
            <span>Waiting for real numbers. When Instagram results are connected, Bertrand reads them here; until then, nobody counts anybody.</span>
          </div>
          <div className={styles.exportRow}>
            <button type="button" className={styles.next} onClick={another}>Make another commercial</button>
            <button type="button" className={styles.ghostDark} onClick={onExit}>Back to the city</button>
          </div>
        </div>
      ) : null}

      {line && phase !== "review" ? (
        <div className={styles.subtitle} role="status" data-testid="channel-382-line" onClick={() => setLineIdx(i => i + 1)}>
          <span className={styles.speaker}>{line.who === "bertrand" ? "BERTRAND" : line.who === "rival" ? "SUDSCO ONE" : "THE STAFF"}</span>
          <span>{fillLine(line.text, channel)}</span>
        </div>
      ) : null}
    </div>
  );
}
