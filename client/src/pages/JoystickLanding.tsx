import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowRight, Check, Pause, Play, RotateCcw } from "lucide-react";
import { captureProductEvent } from "@/lib/posthog";
import "./joystick-landing.css";

const START_PATH = "/joystick-start";
const MEDIA = "/joystick/gameplay";
// the same sample customer the clip ends on (the game's synthetic preview), so the story lines up
const INITIAL_DRAFT = "Hey Mei! It's been about 42 days since your last pickup. Want us to grab your laundry this week?";
/** the clip reaches Hazel pointing out Mei Lin at about 11.5s; the desk slides up then */
const DESK_AT_SECONDS = 11.5;
const GAMES = [
  {
    id: "silver-lake",
    title: "Silver Lake",
    genre: "A cozy reunion",
    description: "Win back quiet regulars.",
    detail: "A neighbour, a small favour, and a reason to reconnect.",
    alt: "The playable Silver Lake courtyard, with cottages, a fountain and friendly villagers.",
    moment: "A little adventure. A real check-in.",
  },
  {
    id: "beverly-hills",
    title: "Beverly Hills",
    genre: "Glamour. Comedy. Business.",
    description: "Get past the velvet rope.",
    detail: "Meet the characters. Open a conversation with a new commercial client.",
    alt: "The playable Beverly Hills plaza, with a velvet rope, palms and a golden poodle fountain.",
    moment: "Your next client is behind that rope.",
  },
  {
    id: "century-park-east",
    title: "Century Park East",
    genre: "Cozy days. Zombie nights.",
    description: "One building. One errand at a time.",
    detail: "Help the residents, reconnect with customers, and make it to the roof.",
    alt: "The playable Century Park East tower and its rooftop party at night.",
    moment: "There’s a whole world in this building.",
  },
] as const;

type Game = (typeof GAMES)[number];

/** Native video only; the public landing never imports a game runtime or customer API. */
function usePreviewVideo(
  ref: RefObject<HTMLVideoElement | null>,
  autoplay: boolean,
  interested = false,
) {
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [automaticMotion, setAutomaticMotion] = useState(false);
  const [intent, setIntent] = useState<"auto" | "play" | "pause">("auto");
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & {
      connection?: EventTarget & { saveData?: boolean };
    }).connection;
    const updatePreference = () => setAutomaticMotion(!motion.matches && !connection?.saveData);
    const updateVisibility = () => setPageVisible(!document.hidden);
    updatePreference();
    updateVisibility();
    motion.addEventListener("change", updatePreference);
    connection?.addEventListener("change", updatePreference);
    document.addEventListener("visibilitychange", updateVisibility);
    if (!("IntersectionObserver" in window)) {
      setNear(true);
      setVisible(true);
    }
    const preload = "IntersectionObserver" in window
      ? new IntersectionObserver(([entry]) => {
          if (entry.isIntersecting) setNear(true);
        }, { rootMargin: "160px" })
      : null;
    const view = "IntersectionObserver" in window
      ? new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.15 })
      : null;
    preload?.observe(video);
    view?.observe(video);
    return () => {
      preload?.disconnect();
      view?.disconnect();
      motion.removeEventListener("change", updatePreference);
      connection?.removeEventListener("change", updatePreference);
      document.removeEventListener("visibilitychange", updateVisibility);
      video.pause();
    };
  }, [ref]);

  const requested = intent === "play" || (intent === "auto" && automaticMotion && (autoplay || interested));
  const load = near && (automaticMotion || intent === "play");
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (load && visible && pageVisible && requested && !failed) {
      // Autoplay may be refused even when muted. The explicit play control remains.
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [ref, load, visible, pageVisible, requested, failed]);

  return {
    load, playing, failed,
    toggle: () => setIntent(playing ? "pause" : "play"),
    pause: () => setIntent("pause"),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onError: () => { setFailed(true); setPlaying(false); },
  };
}

function ExampleGame() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playback = usePreviewVideo(videoRef, true);
  const [atDesk, setAtDesk] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [draft, setDraft] = useState(INITIAL_DRAFT);
  const [completed, setCompleted] = useState(false);
  const deskVisible = atDesk || interacting || !playback.playing;

  function holdDesk() {
    setInteracting(true);
    playback.pause();
  }
  function completeExample() {
    holdDesk();
    setCompleted(true);
    captureProductEvent("landing_example_completed", { game: "silver-lake", sample_only: true });
  }

  return (
    <div className="jl-example" data-testid="landing-example">
      <div className="jl-screen-bar">
        <span><span className="jl-sun" aria-hidden="true">✳</span> Silver Lake</span>
        <span className="jl-example-label">Example game</span>
      </div>
      <div className="jl-stage" data-desk-visible={deskVisible}>
        <video
          ref={videoRef}
          className="jl-hero-video"
          src={playback.load ? `${MEDIA}/silver-lake.mp4` : undefined}
          poster={`${MEDIA}/silver-lake.jpg`}
          muted loop playsInline preload="none"
          aria-label="Silver Lake gameplay: wearing a tea cosy as a glove, she shakes the porcupine, dips its shed quill in the ink well, and writes the squirrel a letter to settle its HOA complaint. The squirrel points out a quiet customer, and an editable check-in follows."
          onPlay={playback.onPlay}
          onPause={playback.onPause}
          onError={playback.onError}
          onTimeUpdate={() => setAtDesk((videoRef.current?.currentTime ?? 0) >= DESK_AT_SECONDS)}
        />
        <div className="jl-scene-caption">
          <span className="jl-kicker">THE WIN-BACK GAME</span>
          <p>A little adventure.<br />A real reason to reach out.</p>
        </div>
        <button
          type="button"
          className="jl-play-control"
          onClick={playback.toggle}
          disabled={playback.failed}
          aria-label={playback.failed ? "Gameplay clip unavailable" : playback.playing ? "Pause Silver Lake preview" : "Play Silver Lake preview"}
        >
          {playback.playing ? <Pause size={15} /> : <Play size={15} />}
          {playback.failed ? "Still preview" : playback.playing ? "Pause" : "Play"}
        </button>
        <section className="jl-letter-desk" aria-label="Try the example check-in" onFocusCapture={holdDesk}>
          <header className="jl-desk-heading">
            <span className="jl-kicker">YOUR NEXT MOVE</span>
            <span>Sample customer · Nothing is sent</span>
          </header>
          <div className="jl-desk-content">
            <div className="jl-customer">
              <span className="jl-customer-avatar" aria-hidden="true">M</span>
              <div><h2>Mei L.</h2><p>42 days since the last pickup · 5 orders</p><span>The sample customer from the game above.</span></div>
            </div>
            <div className="jl-draft">
              <label className="jl-draft-label" htmlFor="joystick-example-draft">
                <img src="/assets/sovereign/claire-cockpit-avatar.jpg" alt="" width="26" height="26" />
                Claire’s draft <span>You can edit this</span>
              </label>
              <textarea
                id="joystick-example-draft"
                rows={2}
                value={draft}
                onChange={event => { setDraft(event.target.value); setCompleted(false); }}
                onFocus={holdDesk}
                maxLength={500}
                spellCheck={false}
              />
              <div className="jl-draft-actions">
                <button type="button" className="jl-button jl-send" onClick={completeExample} disabled={!draft.trim() || completed}>
                  {completed ? <><Check size={17} /> Example complete</> : <>Send check-in <ArrowRight size={17} /></>}
                </button>
                {completed && <button type="button" className="jl-reset" aria-label="Reset the example" onClick={() => { setCompleted(false); setDraft(INITIAL_DRAFT); }}><RotateCcw size={16} /></button>}
                <p role="status">{completed ? "Demo only. No message was sent." : "You review every message before it sends."}</p>
              </div>
            </div>
          </div>
        </section>
      </div>
      <p className="jl-capture-note">Actual gameplay. Sample data. Your decisions.</p>
    </div>
  );
}

function GameTile({ game }: { game: Game }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const playback = usePreviewVideo(videoRef, false, hovered || focused);
  const reported = useRef(false);
  return (
    <article className={`jl-game jl-game--${game.id}`} data-testid={`game-${game.id}`}>
      <div className="jl-game-media" onPointerEnter={event => { if (event.pointerType === "mouse") setHovered(true); }} onPointerLeave={() => setHovered(false)}>
        <video
          ref={videoRef}
          src={playback.load ? `${MEDIA}/${game.id}.mp4` : undefined}
          poster={`${MEDIA}/${game.id}.jpg`}
          muted loop playsInline preload="none"
          aria-label={game.alt}
          onPlay={() => {
            playback.onPlay();
            if (!reported.current) {
              reported.current = true;
              captureProductEvent("landing_game_preview_played", { game: game.id });
            }
          }}
          onPause={playback.onPause}
          onError={playback.onError}
        />
        <span className="jl-game-genre">{game.genre}</span>
        <button
          type="button"
          className="jl-tile-play"
          aria-label={`${playback.playing ? "Pause" : "Play"} ${game.title} game preview`}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onClick={playback.toggle}
          disabled={playback.failed}
        >
          {playback.playing ? <Pause size={19} /> : <Play size={19} />}
        </button>
        <p className="jl-game-moment">{game.moment}</p>
      </div>
      <div className="jl-game-copy">
        <h3>{game.title}</h3>
        <p className="jl-game-purpose">{game.description}</p>
        <p>{game.detail}</p>
      </div>
    </article>
  );
}

export default function JoystickLanding() {
  useEffect(() => {
    captureProductEvent("landing_page_visited", {
      path: window.location.pathname,
      source: "joystick_landing",
      concept: "playable_worlds",
    });
    captureProductEvent("landing_pricing_viewed", {
      monthly_usd: 49,
      trial_days: 7,
      card_required_at_signup: true,
      annual_shown: false,
      checkout_live: false,
      source: "joystick_landing",
    });
    captureProductEvent("landing_checkout_unavailable", {
      checkout_live: false,
      source: "joystick_landing",
    });
  }, []);
  return (
    <main className="joystick-landing" aria-label="Joystick — Your business. A game you can actually win.">
      <header className="jl-header">
        <a className="jl-brand" href="/joystick" aria-label="Joystick home">Joystick</a>
        <nav aria-label="Main navigation">
          <a className="jl-nav-explore" href="#pick-your-game">The games</a>
          <a className="jl-nav-signin" href="/dayforge-login">Sign in</a>
          <a className="jl-button jl-preview-button" href={START_PATH} onClick={() => captureProductEvent("joystick_start_clicked", { source: "landing_header" })}>
            Preview my first game <ArrowRight size={18} aria-hidden="true" />
          </a>
        </nav>
      </header>
      <section className="jl-hero" aria-labelledby="joystick-headline">
        <div className="jl-hero-copy">
          <p className="jl-kicker">REAL BUSINESS. REAL PROGRESS.</p>
          <h1 id="joystick-headline">Your business.<br />A game you can<br />actually win.</h1>
          <p className="jl-lede">Win back customers. Follow up on quotes. Move your business forward. Claire finds the opening. You make the move.</p>
          <p className="jl-editorial">A game brings you in.<br />A real conversation comes out.</p>
        </div>
        <ExampleGame />
      </section>
      <ol className="jl-steps" aria-label="How Joystick works" id="how-it-works">
        <li><span>01</span> Claire spots the opening</li>
        <li><span>02</span> You choose your move</li>
        <li><span>03</span> See your progress</li>
      </ol>
      <p className="jl-preview-note">3 questions. Preview before creating an account.</p>
      <section className="jl-games" id="pick-your-game" aria-labelledby="games-heading">
        <div className="jl-section-heading">
          <div><p className="jl-kicker">DIFFERENT WORLDS. YOUR BUSINESS.</p><h2 id="games-heading">Pick your game.</h2></div>
          <p>Find your kind of adventure.<br />Every one leads to a real next move.</p>
        </div>
        <div className="jl-game-grid">{GAMES.map(game => <GameTile key={game.id} game={game} />)}</div>
        <p className="jl-media-hint">Hover, focus, or tap play to take a look.</p>
      </section>
      <footer className="jl-footer">
        <div><span className="jl-brand">Joystick</span><p>Your business. A game worth playing.</p></div>
        <div className="jl-commercial-terms" data-testid="landing-commercial-terms">
          <p>7-day trial · $49/month · Card required at signup · Cancel anytime</p>
          <p data-testid="landing-checkout-unavailable">Checkout is not open. This does not charge a card.</p>
          <p data-testid="landing-examples-illustration">All customers and messages on this page are fictional examples.</p>
        </div>
      </footer>
    </main>
  );
}
