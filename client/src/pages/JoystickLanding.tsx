/* LEGACY DAYFORGE COMPATIBILITY: route literal retained for the existing tenant-provisioning endpoint; customer-facing product is JOYSTICK. */
import { useEffect, useReducer, useState } from "react";
import { captureProductEvent } from "@/lib/posthog";
import {
  FADE_DURATION_MS,
  HOW_IT_WORKS_STEPS,
  PERSONAS,
  ROTATION_PERIOD_MS,
  initialPersonaState,
  personaReducer,
} from "./joystickPersonaData";
import "./joystick-landing.css";

const START_PATH = "/joystick-start";

function renderPortrait(key: string, label: string) {
  switch (key) {
    case "adam":
      return (
        <svg
          viewBox="0 0 240 300"
          width="420"
          height="525"
          role="img"
          aria-label={label}
          style={{ display: "block" }}
        >
          <g
            fill="none"
            stroke="#111"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M70 300 C 70 240, 90 215, 118 210 C 150 205, 172 232, 172 300" />
            <path d="M118 210 C 90 200, 72 170, 76 132 C 80 90, 110 66, 138 70 C 168 74, 182 104, 176 140 C 172 176, 150 204, 128 210" />
            <path d="M80 118 C 96 96, 120 84, 150 88 C 168 90, 178 100, 180 112" />
            <path d="M100 140 q8 -6 16 0 M138 140 q8 -6 16 0" />
            <path d="M120 150 c 4 10, 2 18, -6 20" />
            <path d="M106 176 q18 12 36 0" />
          </g>
        </svg>
      );
    case "daisy":
      return (
        <svg
          viewBox="0 0 240 300"
          width="420"
          height="525"
          role="img"
          aria-label={label}
          style={{ display: "block" }}
        >
          <g
            fill="none"
            stroke="#111"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M66 300 C 66 244, 92 220, 120 216 C 152 212, 176 236, 176 300" />
            <path d="M120 216 C 94 210, 78 182, 80 148 C 82 110, 104 86, 130 86 C 160 86, 178 112, 176 150 C 174 184, 152 212, 128 216" />
            <path d="M78 150 C 60 120, 70 70, 108 60 C 140 52, 180 66, 184 100 C 186 118, 178 130, 170 136 C 190 96, 160 70, 128 76 C 100 82, 84 112, 78 150 Z" />
            <path d="M118 62 c-10 -18, 14 -30, 24 -14 c 8 12 -8 22 -12 12" />
            <path d="M102 152 q8 -6 16 0 M140 152 q8 -6 16 0" />
            <path d="M124 160 c 4 10, 2 18, -6 20" />
            <path d="M108 186 q16 12 34 0" />
          </g>
        </svg>
      );
    case "shawn":
      return (
        <svg
          viewBox="0 0 240 300"
          width="420"
          height="525"
          role="img"
          aria-label={label}
          style={{ display: "block" }}
        >
          <g
            fill="none"
            stroke="#111"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M68 300 C 68 242, 92 218, 120 214 C 152 210, 174 234, 174 300" />
            <path d="M120 214 C 94 206, 78 178, 80 144 C 82 108, 104 84, 130 86 C 160 88, 178 114, 176 150 C 174 184, 152 210, 128 214" />
            <path d="M72 118 C 72 84, 100 62, 134 64 C 162 66, 184 84, 186 110 L 72 118 Z" />
            <path d="M186 110 L 212 102 C 216 110, 208 116, 190 118" />
            <path d="M104 150 q8 -6 16 0 M142 150 q8 -6 16 0" />
            <path d="M126 158 c 4 10, 2 18, -6 20" />
            <path d="M110 184 q16 10 32 0" />
          </g>
        </svg>
      );
    case "tj":
      return (
        <svg
          viewBox="0 0 240 300"
          width="420"
          height="525"
          role="img"
          aria-label={label}
          style={{ display: "block" }}
        >
          <g
            fill="none"
            stroke="#111"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M64 300 C 64 240, 90 214, 120 210 C 154 206, 178 232, 178 300" />
            <path d="M120 210 C 94 202, 78 174, 80 140 C 82 104, 104 80, 130 82 C 160 84, 178 110, 176 146 C 174 180, 152 206, 128 210" />
            <path d="M80 126 C 88 92, 112 76, 140 80 C 164 84, 176 102, 178 122 C 160 108, 140 104, 118 112 C 102 118, 90 124, 80 126 Z" />
            <path d="M92 226 C 86 250, 84 276, 86 300 M154 226 C 160 250, 162 276, 160 300" />
            <path d="M104 146 q8 -6 16 0 M142 146 q8 -6 16 0" />
            <path d="M126 154 c 4 10, 2 18, -6 20" />
            <path d="M110 180 q16 10 32 0" />
          </g>
        </svg>
      );
    default:
      return null;
  }
}

function renderCompanion(key: string, label: string, accent: string) {
  switch (key) {
    case "adam":
      return (
        <svg
          viewBox="0 0 180 200"
          width="200"
          height="222"
          role="img"
          aria-label={label}
        >
          <g
            fill="none"
            stroke="#111"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d="M56 54 C 56 36, 76 26, 96 28 C 118 30, 132 42, 132 56 L 48 60 Z"
              fill={accent}
            />
            <path d="M48 60 C 70 56, 110 56, 136 60" />
            <circle cx="84" cy="72" r="9" />
            <circle cx="106" cy="72" r="9" />
            <path d="M93 72 h4" />
            <path d="M70 80 C 66 100, 74 112, 92 114 C 110 112, 118 100, 114 80" />
            <path d="M114 88 L 150 96 L 116 102" />
            <path d="M92 114 C 70 122, 58 142, 60 168 C 62 184, 78 192, 92 192 C 108 192, 122 184, 124 168 C 126 142, 114 122, 92 114 Z" />
            <path d="M60 150 C 42 146, 36 160, 46 170" />
            <path d="M72 136 L 112 132 L 114 156 L 74 160 Z" fill="#fbfaf6" />
            <path d="M82 192 L 80 200 M104 192 L 106 200 M70 200 h16 M98 200 h16" />
          </g>
        </svg>
      );
    case "daisy":
      return (
        <svg
          viewBox="0 0 180 200"
          width="200"
          height="222"
          role="img"
          aria-label={label}
        >
          <g
            fill="none"
            stroke="#111"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d="M90 22 C 70 22, 60 40, 66 58 C 70 70, 82 76, 90 76 C 100 76, 112 68, 114 54 C 116 36, 106 22, 90 22 Z"
              fill={accent}
            />
            <path d="M84 48 q4 -4 8 0 M98 48 q4 -4 8 0 M88 62 q6 4 12 0" />
            <path d="M90 76 C 76 90, 70 110, 70 140 L 70 196 M90 76 C 108 90, 116 110, 116 140 L 116 196" />
            <path d="M70 100 C 50 104, 40 118, 38 134 M116 100 C 136 104, 146 118, 148 134" />
            <path d="M34 124 L 92 124 L 92 170 L 34 170 Z" fill="#fbfaf6" />
            <path d="M44 138 h38 M44 150 h38 M44 162 h22" />
            <path d="M60 196 h20 M106 196 h20" />
          </g>
        </svg>
      );
    case "shawn":
      return (
        <svg
          viewBox="0 0 180 200"
          width="200"
          height="222"
          role="img"
          aria-label={label}
        >
          <g
            fill="none"
            stroke="#111"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d="M90 20 C 68 20, 58 42, 66 60 C 72 72, 82 76, 90 76 C 100 76, 110 70, 114 56 C 118 38, 108 20, 90 20 Z"
              fill={accent}
            />
            <path d="M78 22 C 72 10, 84 4, 92 10 C 100 4, 112 12, 104 22" />
            <path d="M84 48 q4 -4 8 0 M98 48 q4 -4 8 0 M88 62 q6 4 12 0" />
            <path d="M90 76 C 76 90, 70 110, 70 140 L 70 196 M90 76 C 108 90, 116 110, 116 140 L 116 196" />
            <path d="M116 96 L 160 92 L 160 150 L 116 152" fill="#fbfaf6" />
            <path d="M126 112 C 134 104, 148 110, 150 120 C 152 130, 140 138, 132 132" />
            <path d="M70 100 C 52 108, 46 128, 50 144" />
            <path d="M60 196 h20 M106 196 h20" />
          </g>
        </svg>
      );
    case "tj":
      return (
        <svg
          viewBox="0 0 180 200"
          width="200"
          height="222"
          role="img"
          aria-label={label}
        >
          <g
            fill="none"
            stroke="#111"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d="M78 24 C 58 24, 48 44, 56 62 C 62 74, 72 78, 80 78 C 92 78, 102 70, 104 56 C 106 38, 96 24, 78 24 Z"
              fill={accent}
            />
            <path d="M72 50 q4 -4 8 0 M86 50 q4 -4 8 0 M76 64 q6 4 12 0" />
            <path d="M80 78 C 66 92, 60 112, 60 142 L 60 196 M80 78 C 98 92, 106 112, 106 142 L 106 196" />
            <path d="M106 104 C 120 100, 130 104, 136 112" />
            <path d="M146 40 L 146 196" />
            <path
              d="M146 60 L 176 60 L 168 72 L 146 72 Z M146 86 L 118 86 L 126 98 L 146 98 Z"
              fill="#fbfaf6"
            />
            <path d="M50 196 h20 M96 196 h20 M136 196 h20" />
          </g>
        </svg>
      );
    default:
      return null;
  }
}

function renderPanelFooter(key: string, accent: string) {
  switch (key) {
    case "adam":
      return (
        <svg
          viewBox="0 0 180 36"
          width="180"
          height="36"
          aria-hidden="true"
          style={{ marginTop: "auto" }}
        >
          <g stroke={accent} strokeWidth="3" strokeLinecap="round">
            <path d="M6 18 v0 M16 12 v12 M26 6 v24 M36 14 v8 M46 9 v18 M56 16 v4 M66 4 v28 M76 12 v12 M86 8 v20 M96 15 v6 M106 10 v16 M116 5 v26 M126 13 v10 M136 17 v2 M146 9 v18 M156 12 v12 M166 16 v4 M174 14 v8" />
          </g>
        </svg>
      );
    case "daisy":
      return (
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            gap: "6px",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: accent,
            }}
          />
          <div style={{ fontSize: "11px", color: "#666" }}>
            78 days quiet · on the Day Line tonight
          </div>
        </div>
      );
    case "shawn":
      return (
        <div style={{ marginTop: "auto", display: "flex", gap: "6px" }}>
          <div
            style={{
              flex: 1,
              height: "26px",
              border: "1.5px solid #111",
              borderRadius: "4px",
              background: accent,
            }}
          />
          <div
            style={{
              flex: 1,
              height: "26px",
              border: "1.5px solid #111",
              borderRadius: "4px",
            }}
          />
          <div
            style={{
              flex: 1,
              height: "26px",
              border: "1.5px solid #111",
              borderRadius: "4px",
            }}
          />
        </div>
      );
    case "tj":
      return (
        <svg
          viewBox="0 0 180 44"
          width="180"
          height="44"
          aria-hidden="true"
          style={{ marginTop: "auto" }}
        >
          <path
            d="M8 36 C 40 10, 60 40, 90 18 C 120 -4, 140 34, 172 12"
            fill="none"
            stroke={accent}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="6 5"
          />
          <circle cx="8" cy="36" r="4" fill="#111" />
          <circle
            cx="172"
            cy="12"
            r="4"
            fill="none"
            stroke="#111"
            strokeWidth="2"
          />
        </svg>
      );
    default:
      return null;
  }
}

const PARTY_LEDE =
  "Each one has the thing you don't, and a flaw of their own. You earn them by doing the work.";

interface GameCapture {
  key: string;
  title: string;
  line: string;
  note: string;
  poster: string;
  video: string | null;
  alt: string;
}

const GAMES: readonly GameCapture[] = [
  {
    key: "silver-lake",
    title: "Silver Lake",
    line: "Your quiet customers live here. Walk over and say hi.",
    note: "Real gameplay. Nothing here is sent without you.",
    poster: "/joystick/gameplay/silver-lake.jpg",
    video: "/joystick/gameplay/silver-lake.mp4",
    alt: "Silver Lake: a cozy courtyard of neighbours, a bear in a scarf, and a porcupine beside a cottage",
  },
  {
    key: "beverly-hills",
    title: "Beverly Hills",
    line: "Real prospects behind the velvet rope.",
    note: "Real gameplay. Cold outreach is drafted, never sent for you.",
    poster: "/joystick/gameplay/beverly-hills.jpg",
    video: "/joystick/gameplay/beverly-hills.mp4",
    alt: "Beverly Hills: a sunlit plaza with string lights, a pink awning and three passers-by",
  },
  {
    key: "channel-382",
    title: "CHANNEL 382",
    line: "The commercial you film is a real ad.",
    note: "Real gameplay capture. Every word is approved before it airs.",
    poster: "/joystick/gameplay/channel-382.jpg",
    video: null,
    alt: "CHANNEL 382: a clay television studio with a tiny Laundry Farm van on set and a call sheet of three hooks",
  },
  {
    key: "century-park-east",
    title: "Century Park East",
    line: "One tower. The residents who went quiet.",
    note: "Real gameplay. Letters go out only after you approve them.",
    poster: "/joystick/gameplay/century-park-east.jpg",
    video: "/joystick/gameplay/century-park-east.mp4",
    alt: "Century Park East: a cutaway apartment tower at night with lit rooms and residents on every floor",
  },
] as const;

function forTheOneWho(caption: string): string {
  const flaw = caption.split(". ")[1] ?? "";
  if (!flaw) return "";
  return `For the one who ${flaw.charAt(0).toLowerCase()}${flaw.slice(1)}`;
}

function stepTitle(title: string): string {
  return title.replace(/^\d+\.\s*/, "");
}

export default function JoystickLanding() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [state, dispatch] = useReducer(
    (current: typeof initialPersonaState, action: Parameters<typeof personaReducer>[1]) =>
      personaReducer(current, action),
    initialPersonaState
  );
  const [isHoveringHero, setIsHoveringHero] = useState(false);
  const [timerResetKey, setTimerResetKey] = useState(0);
  const [flippedCompanions, setFlippedCompanions] = useState<Record<string, boolean>>({});

  useEffect(() => {
    captureProductEvent("landing_page_visited", {
      path:
        typeof window !== "undefined" ? window.location.pathname : "/joystick",
      source: "joystick_landing",
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

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Persona selection never loses its fade-completion timer when rotation pauses.
  useEffect(() => {
    if (!state.fading) return;
    const timeout = window.setTimeout(() => {
      dispatch({ type: "COMPLETE_SWAP" });
    }, FADE_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [state.fading, state.pendingIndex]);

  useEffect(() => {
    if (reducedMotion || isHoveringHero) return;
    const timer = window.setInterval(() => {
      dispatch({ type: "TICK_FADE" });
    }, ROTATION_PERIOD_MS);
    return () => window.clearInterval(timer);
  }, [reducedMotion, isHoveringHero, state.index, timerResetKey]);

  const handleDotClick = (index: number) => {
    if (index === state.index && !state.fading) return;
    dispatch({ type: "START_FADE", nextIndex: index });
    setTimerResetKey((prev) => prev + 1);
  };

  const toggleCompanion = (key: string) => {
    setFlippedCompanions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const currentPersona = PERSONAS[state.index];
  const fadeOpacity = state.fading ? 0 : 1;
  const humanFlipClass = state.isFlippedHuman ? "is-flipped" : "";
  const [claireStep, partyStep, gamesStep] = HOW_IT_WORKS_STEPS;
  const [featuredGame, ...otherGames] = GAMES;

  const renderCapture = (game: GameCapture, featured: boolean) => {
    const showVideo = game.video !== null && !reducedMotion;
    return (
      <figure
        key={game.key}
        className={`jl-capture ${featured ? "jl-capture-featured" : ""}`}
      >
        {showVideo ? (
          <video
            className="jl-shot"
            muted
            loop
            playsInline
            autoPlay
            preload={featured ? "auto" : "metadata"}
            poster={game.poster}
            aria-label={game.alt}
          >
            <source src={game.video ?? undefined} type="video/mp4" />
          </video>
        ) : (
          <img
            className="jl-shot"
            src={game.poster}
            alt={game.alt}
            loading={featured ? "eager" : "lazy"}
          />
        )}
        <figcaption className="jl-capture-caption">
          <span className="jl-capture-line">
            {game.title}. {game.line}
          </span>
          <span className="jl-capture-note">{game.note}</span>
        </figcaption>
      </figure>
    );
  };

  return (
    <main
      className="joystick-landing"
      data-testid="joystick-marketing"
      aria-label="Joystick — Knows your business, then makes your next move a game."
    >
      {/* 1. NAV */}
      <nav className="jl-nav jl-wrap" aria-label="Main navigation">
        <div className="jl-nav-brand">
          <span className="jl-nav-title">Joystick</span>
          <span className="jl-nav-tagline">Real work. Playable.</span>
        </div>
        <div className="jl-nav-links">
          <a href="#games">The games</a>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="/dayforge-login" id="signin">
            Sign in
          </a>
        </div>
      </nav>

      {/* 2. HERO: one sentence, one object */}
      <section
        className="jl-hero-section jl-wrap"
        aria-label="Joystick hero"
        onPointerEnter={() => setIsHoveringHero(true)}
        onPointerLeave={() => setIsHoveringHero(false)}
      >
        <div className="jl-hero-row">
          <div className="jl-headline-block">
            <div>Knows your</div>
            <div className="jl-headline-underlined">
              business,
              <svg
                className="jl-headline-underline"
                viewBox="0 0 420 40"
                preserveAspectRatio="none"
                aria-hidden="true"
                style={{ opacity: fadeOpacity }}
              >
                <path
                  d="M6 24 C 80 10, 160 30, 240 16 C 300 6, 360 24, 412 12"
                  fill="none"
                  stroke={currentPersona.accent}
                  strokeWidth="7"
                  strokeLinecap="round"
                />
                <path
                  d="M14 34 C 90 24, 170 40, 250 28"
                  fill="none"
                  stroke={currentPersona.accent}
                  strokeWidth="4"
                  strokeLinecap="round"
                  opacity="0.8"
                />
              </svg>
            </div>
          </div>

          <div className="jl-photo-col">
            <button
              type="button"
              className="jl-flip jl-human-card"
              aria-label="Flip the sketch to see the real photo"
              onClick={() => dispatch({ type: "TOGGLE_FLIP_HUMAN" })}
            >
              <div className={`jl-human-inner jl-flip-inner ${humanFlipClass}`}>
                <div className="jl-face jl-human-front">
                  <div className="jl-human-tape" />
                  <div
                    className="jl-human-sketch-wrap"
                    style={{ opacity: fadeOpacity }}
                  >
                    {renderPortrait(
                      currentPersona.key,
                      currentPersona.portraitAriaLabel
                    )}
                  </div>
                  <div className="jl-human-hint">hover to meet the real one →</div>
                </div>

                <div
                  className="jl-face jl-human-back"
                  style={{ background: currentPersona.paper }}
                >
                  <div className="jl-human-placeholder">
                    <svg width="44" height="36" viewBox="0 0 44 36" aria-hidden="true">
                      <rect x="2" y="8" width="40" height="26" rx="4" fill="none" stroke="#111" strokeWidth="2" />
                      <circle cx="22" cy="21" r="8" fill="none" stroke="#111" strokeWidth="2" />
                      <rect x="14" y="2" width="16" height="6" rx="2" fill="none" stroke="#111" strokeWidth="2" />
                    </svg>
                    <div>
                      [Real flash photo: {currentPersona.name},{" "}
                      {currentPersona.photoWhere}]
                    </div>
                  </div>
                </div>
              </div>
            </button>

            <div className="jl-caption" style={{ opacity: fadeOpacity }}>
              {currentPersona.caption}
            </div>

            <div className="jl-dots-row">
              {PERSONAS.map((p, idx) => (
                <button
                  key={p.key}
                  type="button"
                  className={`jl-persona-dot ${idx === state.index ? "is-active" : ""}`}
                  aria-label={`Show ${p.name}`}
                  onClick={() => handleDotClick(idx)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="jl-bottom-row">
          <div className="jl-bottom-left">
            <div className="jl-cta-row">
              <a
                className="jl-cta-button"
                href={START_PATH}
                onClick={() =>
                  captureProductEvent("joystick_start_clicked", {
                    source: "landing_hero",
                  })
                }
              >
                Preview my first game →
              </a>
              <div className="jl-cta-microcopy">
                3 questions. A game built for your business. No account required.
              </div>
            </div>
          </div>

          <div className="jl-bottom-sentence">
            <div>then makes</div>
            <div>your next move</div>
            <div className="jl-headline-underlined">
              a game.
              <svg
                className="jl-bottom-underline"
                viewBox="0 0 220 30"
                preserveAspectRatio="none"
                aria-hidden="true"
                style={{ opacity: fadeOpacity }}
              >
                <path
                  d="M6 18 C 50 6, 110 26, 214 10"
                  fill="none"
                  stroke={currentPersona.accent}
                  strokeWidth="7"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </section>

      {/* 3. CLAIRE READS YOUR BOOKS */}
      <section
        id="how"
        className="jl-band"
        aria-labelledby="how-heading"
        data-testid="section-how-it-works"
      >
        <div className="jl-wrap">
          <div className="jl-lede">
            <div>
              <div className="jl-section-label">How Joystick works</div>
              <h2 id="how-heading" className="jl-h2">
                {stepTitle(claireStep.title)}
              </h2>
            </div>
            <p className="jl-lede-text">{claireStep.text}</p>
          </div>

          <div className="jl-object jl-call-stage">
            <div
              className="jl-call-mascot"
              style={{ opacity: fadeOpacity }}
              aria-hidden="true"
            >
              {renderCompanion(
                currentPersona.key,
                currentPersona.companionAriaLabel,
                currentPersona.accent
              )}
            </div>
            <div className="jl-call-card" style={{ opacity: fadeOpacity }}>
              <div
                className="jl-call-quote"
                aria-hidden="true"
                style={{ color: currentPersona.accent }}
              >
                &ldquo;
              </div>
              <div className="jl-call-text">
                <div className="jl-call-header">
                  Claire <span className="jl-call-role">· runs your day ·</span>{" "}
                  <span
                    className="jl-call-time"
                    style={{ color: currentPersona.accent }}
                  >
                    {currentPersona.callTime}
                  </span>
                </div>
                <div className="jl-call-line">{currentPersona.callLine}</div>
              </div>
              <div className="jl-call-tagline">She calls. You don't type.</div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. YOU GET THE ONE YOU'RE MISSING */}
      <section className="jl-band" aria-labelledby="party-heading">
        <div className="jl-wrap">
          <div className="jl-lede">
            <h2 id="party-heading" className="jl-h2">
              {stepTitle(partyStep.title)}
            </h2>
            <p className="jl-lede-text">{PARTY_LEDE}</p>
          </div>

          <div className="jl-object jl-party">
            {PERSONAS.map((p, idx) => {
              const flipped = flippedCompanions[p.key] ? "is-flipped" : "";
              const current = idx === state.index ? "is-current" : "";
              return (
                <article key={p.key} className={`jl-party-card ${current}`}>
                  <button
                    type="button"
                    className="jl-flip jl-companion-card"
                    aria-label={`Flip to see ${p.companion} at work in the game`}
                    onClick={() => toggleCompanion(p.key)}
                  >
                    <div className={`jl-companion-inner jl-flip-inner ${flipped}`}>
                      <div
                        className="jl-face jl-companion-front"
                        style={{ background: p.paper }}
                      >
                        <div className="jl-companion-tape" />
                        <div className="jl-companion-sketch-wrap">
                          {renderCompanion(p.key, p.companionAriaLabel, p.accent)}
                        </div>
                        <div className="jl-companion-hint">flip →</div>
                      </div>

                      <div className="jl-face jl-companion-back">
                        <div
                          className="jl-companion-header"
                          style={{ background: p.accent }}
                        >
                          {p.panelTitle}
                        </div>
                        <div className="jl-companion-content">
                          <div style={{ fontWeight: 600 }}>{p.panelLine1}</div>
                          <div style={{ color: "#444" }}>{p.panelLine2}</div>
                          <div style={{ color: "#444" }}>{p.panelLine3}</div>
                          {renderPanelFooter(p.key, p.accent)}
                        </div>
                      </div>
                    </div>
                  </button>

                  <div className="jl-companion-meta">
                    <div className="jl-companion-name" style={{ color: p.accent }}>
                      {p.companion}
                    </div>
                    <div className="jl-companion-truth">{p.companionTruth}</div>
                    <div className="jl-companion-why">{p.companionWhy}</div>
                    <div className="jl-companion-for">{forTheOneWho(p.caption)}</div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* 5. YOUR NEXT MOVE BECOMES A GAME */}
      <section id="games" className="jl-band" aria-labelledby="games-heading">
        <div className="jl-wrap">
          <div className="jl-lede">
            <div>
              <div className="jl-section-label">The games</div>
              <h2 id="games-heading" className="jl-h2">
                {stepTitle(gamesStep.title)}
              </h2>
            </div>
            <p className="jl-lede-text">{gamesStep.text}</p>
          </div>

          <div className="jl-object">
            {renderCapture(featuredGame, true)}
            <div className="jl-capture-row">
              {otherGames.map((game) => renderCapture(game, false))}
            </div>
          </div>
        </div>
      </section>

      {/* 6. PRICING & COMMERCIAL TERMS */}
      <section
        id="pricing"
        className="jl-band jl-pricing-section"
        aria-labelledby="pricing-heading"
        data-testid="section-pricing"
      >
        <div className="jl-wrap">
          <div className="jl-lede jl-pricing-card" data-testid="landing-pricing-card">
            <div>
              <div className="jl-section-label">Pricing</div>
              <h2 id="pricing-heading" className="jl-h2 jl-pricing-title">
                7-Day Free Trial, Then $49/Month
              </h2>
            </div>
            <div className="jl-pricing-side">
              <ul
                className="jl-terms joystick-desktop__terms"
                data-testid="landing-commercial-terms"
              >
                <li className="joystick-terms-pill">7-day trial</li>
                <li className="joystick-terms-pill">$49/month</li>
                <li className="joystick-terms-pill">Card required at signup</li>
                <li className="joystick-terms-pill">Cancel anytime</li>
              </ul>
              <div className="jl-cta-row">
                <a
                  className="jl-cta-button"
                  href={START_PATH}
                  onClick={() =>
                    captureProductEvent("joystick_start_clicked", {
                      source: "landing_pricing",
                    })
                  }
                >
                  Preview my first game →
                </a>
              </div>
              <p
                className="joystick-checkout-closed jl-cta-microcopy"
                data-testid="landing-checkout-unavailable"
              >
                Checkout is not open. This does not charge a card.
              </p>
            </div>
          </div>
          <p
            className="jl-pricing-illustration"
            data-testid="landing-examples-illustration"
          >
            All customer references on this page are illustrations.
          </p>
        </div>
      </section>

      <footer className="jl-footer">
        <div className="jl-wrap jl-footer-row">
          <span>Joystick · Real work. Playable.</span>
          <a href="/dayforge-login">Sign in</a>
        </div>
      </footer>
    </main>
  );
}
