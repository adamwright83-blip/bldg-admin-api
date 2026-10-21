/* LEGACY DAYFORGE COMPATIBILITY: route literal retained for the existing tenant-provisioning endpoint; customer-facing product is JOYSTICK. */
import { useEffect, useReducer, useRef, useState } from "react";
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

function renderScene(key: string, label: string, accent: string) {
  switch (key) {
    case "adam":
      return (
        <svg
          viewBox="0 0 420 420"
          width="420"
          height="420"
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
              d="M250 400 L 250 200 L 330 180 L 330 400"
              fill={accent}
              opacity="0.9"
            />
            <path d="M262 220 h16 M292 214 h16 M262 250 h16 M292 244 h16 M262 280 h16 M292 274 h16 M262 310 h16 M292 304 h16 M262 340 h16 M292 334 h16" />
            <path d="M330 400 L 330 250 L 380 262 L 380 400" />
            <path d="M340 272 h12 M360 276 h12 M340 300 h12 M360 304 h12 M340 328 h12 M360 332 h12" />
            <circle cx="150" cy="120" r="78" fill="#fbfaf6" />
            <circle cx="150" cy="120" r="78" strokeWidth="4" />
            <path d="M150 120 L 150 62 M150 120 L 196 140" strokeWidth="5" />
            <circle cx="150" cy="120" r="5" fill="#111" />
            <path d="M150 50 v8 M212 120 h-8 M150 190 v-8 M88 120 h8" />
            <path d="M118 196 C 96 250, 104 300, 112 360 M182 196 C 206 250, 198 300, 190 360" />
            <path d="M96 170 C 60 190, 44 230, 56 262 M204 170 C 240 190, 256 230, 244 262" />
            <path d="M100 360 h24 M178 360 h24" />
            <path
              d="M30 300 C 60 290, 90 310, 120 296"
              stroke={accent}
              strokeWidth="6"
            />
            <path
              d="M300 60 L 300 150 M300 60 L 352 64 L 344 80 L 300 76"
              fill={accent}
              stroke={accent}
            />
          </g>
        </svg>
      );
    case "daisy":
      return (
        <svg
          viewBox="0 0 420 420"
          width="420"
          height="420"
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
            <path d="M40 60 C 120 110, 220 110, 300 60 C 340 40, 380 50, 400 70" />
            <path
              d="M100 86 l-10 20 h20 z M180 100 l-10 20 h20 z M260 88 l-10 20 h20 z M340 68 l-10 20 h20 z"
              fill={accent}
            />
            <ellipse cx="220" cy="330" rx="130" ry="30" fill={accent} opacity="0.9" />
            <path d="M160 316 L160 250 Q220 226 280 250 L280 316" />
            <path d="M220 250 L220 170" />
            <path d="M220 170 C 190 172, 184 206, 204 220 M220 170 C 250 172, 256 206, 236 220" />
            <path d="M220 150 c-8 14 8 14 0 28 M196 164 c-6 12 8 12 2 24 M244 164 c6 12 -8 12 -2 24" />
            <circle cx="80" cy="270" r="16" />
            <path d="M66 286 C 60 320, 70 350, 78 360 M94 286 C 100 320, 90 350, 82 360" />
            <circle cx="350" cy="260" r="16" />
            <path d="M336 276 C 330 310, 340 340, 348 350 M364 276 C 370 310, 360 340, 352 350" />
            <path d="M300 380 C 310 360, 330 356, 340 366 C 352 380, 340 396, 322 392 C 308 390, 298 384, 300 380 Z" />
            <path d="M340 366 C 356 340, 384 346, 380 372 C 378 388, 362 394, 352 386" />
            <circle cx="312" cy="372" r="2" fill="#111" />
            <path
              d="M30 400 C 80 388, 140 404, 200 392"
              stroke={accent}
              strokeWidth="6"
            />
          </g>
        </svg>
      );
    case "shawn":
      return (
        <svg
          viewBox="0 0 420 420"
          width="420"
          height="420"
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
            <rect
              x="120"
              y="150"
              width="170"
              height="120"
              rx="14"
              fill={accent}
              opacity="0.9"
            />
            <path d="M290 190 L 370 150 L 370 270 L 290 230 Z" />
            <circle cx="166" cy="112" r="30" />
            <circle cx="236" cy="112" r="30" />
            <path d="M204 270 L 170 400 M204 270 L 240 400 M150 398 h40 M222 398 h40" />
            <rect x="40" y="40" width="150" height="56" rx="8" fill="#fbfaf6" />
            <path
              d="M62 68 h20 M92 68 h12 M114 68 h22 M146 68 h22"
              stroke={accent}
              strokeWidth="6"
            />
            <path d="M40 40 L 190 40" stroke={accent} strokeWidth="5" />
            <path d="M300 310 L 400 290 L 400 360 L 300 380 Z" fill="#fbfaf6" />
            <path
              d="M300 310 L 310 288 L 410 268 L 400 290"
              fill={accent}
            />
            <path d="M320 338 h60 M320 356 h40" />
          </g>
        </svg>
      );
    case "tj":
      return (
        <svg
          viewBox="0 0 420 420"
          width="420"
          height="420"
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
            <path d="M60 400 L 60 220 C 40 200, 30 180, 46 170 C 60 164, 72 176, 66 192 C 84 176, 102 180, 98 200 C 110 186, 128 194, 118 210 C 98 214, 80 220, 60 220" />
            <path d="M360 400 L 360 240 C 340 222, 332 202, 348 194 C 362 188, 374 200, 366 214 C 384 200, 402 204, 398 224 C 376 232, 366 236, 360 240" />
            <path
              d="M150 400 L 150 280 L 310 280 L 310 400"
              fill={accent}
              opacity="0.9"
            />
            <path d="M170 300 h24 M210 300 h24 M250 300 h24 M170 340 h24 M210 340 h24 M250 340 h24 M170 380 h24 M250 380 h24" />
            <path
              d="M190 120 C 170 90, 190 50, 230 50 C 272 50, 290 92, 270 122 C 262 136, 250 146, 230 146 C 210 146, 198 136, 190 120 Z"
              fill="#fbfaf6"
            />
            <circle cx="212" cy="104" r="14" />
            <circle cx="248" cy="104" r="14" />
            <path d="M230 128 C 222 150, 236 160, 248 150" strokeWidth="4" />
            <path d="M190 146 C 172 160, 164 180, 166 200 M270 146 C 288 160, 296 180, 294 200" />
            <path d="M300 40 L 380 40 M340 40 L 340 60 M312 60 L 372 60 C 386 60, 392 76, 380 84 L 306 84 C 296 80, 298 64, 312 60 Z M306 84 L 300 100 M372 84 L 378 100" />
            <path
              d="M40 60 C 30 90, 40 110, 60 120"
              stroke={accent}
              strokeWidth="6"
            />
            <path d="M310 300 L 404 288 L 404 346 L 310 358 Z" fill="#fbfaf6" />
            <path
              d="M330 320 h50 M330 336 h34"
              stroke={accent}
              strokeWidth="5"
            />
            <circle cx="392" cy="306" r="7" stroke={accent} />
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

export default function JoystickLanding() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [state, dispatch] = useReducer(personaReducer, initialPersonaState);
  const [isHoveringHero, setIsHoveringHero] = useState(false);
  const [timerResetKey, setTimerResetKey] = useState(0);
  const swapTimeoutRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

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

  useEffect(() => {
    if (reducedMotion || isHoveringHero) return;

    const timer = window.setInterval(() => {
      dispatch({ type: "TICK_FADE" });
      swapTimeoutRef.current = window.setTimeout(() => {
        dispatch({ type: "COMPLETE_SWAP" });
      }, FADE_DURATION_MS);
    }, ROTATION_PERIOD_MS);

    return () => {
      window.clearInterval(timer);
      if (swapTimeoutRef.current) {
        window.clearTimeout(swapTimeoutRef.current);
      }
    };
  }, [reducedMotion, isHoveringHero, state.index, timerResetKey]);

  const handleDotClick = (index: number) => {
    if (index === state.index) return;
    if (swapTimeoutRef.current) {
      window.clearTimeout(swapTimeoutRef.current);
    }
    dispatch({ type: "START_FADE", nextIndex: index });
    swapTimeoutRef.current = window.setTimeout(() => {
      dispatch({ type: "COMPLETE_SWAP" });
    }, FADE_DURATION_MS);
    setTimerResetKey((prev) => prev + 1);
  };

  const handlePlayCall = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlayingAudio) {
      audio.pause();
      setIsPlayingAudio(false);
    } else {
      audio.src = `/joystick/claire/${currentPersona.key}.mp3`;
      audio
        .play()
        .then(() => {
          setIsPlayingAudio(true);
        })
        .catch(() => {
          setIsPlayingAudio(false);
        });
    }
  };

  const currentPersona = PERSONAS[state.index];
  const fadeOpacity = state.fading ? 0 : 1;
  const sceneOpacity = state.fading ? 0 : 0.85;
  const humanFlipClass = state.isFlippedHuman ? "is-flipped" : "";
  const companionFlipClass = state.isFlippedCompanion ? "is-flipped" : "";

  return (
    <main
      className="joystick-landing"
      data-testid="joystick-marketing"
      aria-label="Joystick — Knows your business, then makes your next move a game."
    >
      <audio
        ref={audioRef}
        onEnded={() => setIsPlayingAudio(false)}
        onError={() => setIsPlayingAudio(false)}
        style={{ display: "none" }}
      />
      <div className="jl-container">
        {/* 1. NAV (88px tall, flex, space-between) */}
        <nav className="jl-nav" aria-label="Main navigation">
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

        {/* 2 & 3. HERO SECTION */}
        <section
          className="jl-hero-section"
          aria-label="Joystick hero"
          onPointerEnter={() => setIsHoveringHero(true)}
          onPointerLeave={() => setIsHoveringHero(false)}
        >
          {/* HERO ROW */}
          <div className="jl-hero-row">
            {/* a) Headline block */}
            <div className="jl-headline-block">
              <div>Knows your</div>
              <div>business,</div>
              <svg
                className="jl-headline-underline"
                viewBox="0 0 420 40"
                width="420"
                height="40"
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

            {/* b) Photo column */}
            <div className="jl-photo-col">
              <div className="jl-human-card-wrap">
                {/* THE HUMAN POST-IT (flip card) */}
                <button
                  type="button"
                  className="jl-flip jl-human-card"
                  aria-label="Flip the sketch to see the real photo"
                  onClick={() => dispatch({ type: "TOGGLE_FLIP_HUMAN" })}
                >
                  <div className={`jl-human-inner jl-flip-inner ${humanFlipClass}`}>
                    {/* FRONT */}
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
                      <div className="jl-human-hint">
                        hover to meet the real one →
                      </div>
                    </div>

                    {/* BACK */}
                    <div
                      className="jl-face jl-human-back"
                      style={{ background: currentPersona.paper }}
                    >
                      <div className="jl-human-placeholder">
                        <svg
                          width="44"
                          height="36"
                          viewBox="0 0 44 36"
                          aria-hidden="true"
                        >
                          <rect
                            x="2"
                            y="8"
                            width="40"
                            height="26"
                            rx="4"
                            fill="none"
                            stroke="#111"
                            strokeWidth="2"
                          />
                          <circle
                            cx="22"
                            cy="21"
                            r="8"
                            fill="none"
                            stroke="#111"
                            strokeWidth="2"
                          />
                          <rect
                            x="14"
                            y="2"
                            width="16"
                            height="6"
                            rx="2"
                            fill="none"
                            stroke="#111"
                            strokeWidth="2"
                          />
                        </svg>
                        <div>
                          [Real flash photo: {currentPersona.name},{" "}
                          {currentPersona.photoWhere}]
                        </div>
                      </div>
                    </div>
                  </div>
                </button>

                {/* THE GAME SCENE */}
                <div
                  className="jl-game-scene"
                  style={{ opacity: sceneOpacity }}
                >
                  {renderScene(
                    currentPersona.key,
                    currentPersona.sceneAriaLabel,
                    currentPersona.accent
                  )}
                </div>

                {/* THE COMPANION POST-IT (flip card) */}
                <div
                  className="jl-companion-col"
                  style={{ opacity: fadeOpacity }}
                >
                  <button
                    type="button"
                    className="jl-flip jl-companion-card"
                    aria-label="Flip to see this companion at work in the game"
                    onClick={() => dispatch({ type: "TOGGLE_FLIP_COMPANION" })}
                  >
                    <div
                      className={`jl-companion-inner jl-flip-inner ${companionFlipClass}`}
                    >
                      {/* FRONT */}
                      <div className="jl-face jl-companion-front">
                        <div className="jl-companion-tape" />
                        <div className="jl-companion-sketch-wrap">
                          {renderCompanion(
                            currentPersona.key,
                            currentPersona.companionAriaLabel,
                            currentPersona.accent
                          )}
                        </div>
                        <div className="jl-companion-hint">flip →</div>
                      </div>

                      {/* BACK */}
                      <div className="jl-face jl-companion-back">
                        <div
                          className="jl-companion-header"
                          style={{ background: currentPersona.accent }}
                        >
                          {currentPersona.panelTitle}
                        </div>
                        <div className="jl-companion-content">
                          <div style={{ fontWeight: 600 }}>
                            {currentPersona.panelLine1}
                          </div>
                          <div style={{ color: "#444" }}>
                            {currentPersona.panelLine2}
                          </div>
                          <div style={{ color: "#444" }}>
                            {currentPersona.panelLine3}
                          </div>
                          {renderPanelFooter(
                            currentPersona.key,
                            currentPersona.accent
                          )}
                        </div>
                      </div>
                    </div>
                  </button>

                  <div className="jl-companion-meta jl-desktop-companion-meta">
                    <div
                      className="jl-companion-name"
                      style={{ color: currentPersona.accent }}
                    >
                      {currentPersona.companion}
                    </div>
                    <div className="jl-companion-truth">
                      {currentPersona.companionTruth}
                    </div>
                    <div className="jl-companion-why">
                      {currentPersona.companionWhy}
                    </div>
                  </div>
                </div>
              </div>

              {/* THE CAPTION */}
              <div
                className="jl-caption"
                style={{ opacity: fadeOpacity }}
              >
                {currentPersona.caption}
              </div>

              {/* MOBILE ONLY: companion name/strength/flaw after caption */}
              <div className="jl-mobile-companion-meta">
                <div
                  className="jl-companion-name"
                  style={{ color: currentPersona.accent }}
                >
                  {currentPersona.companion}
                </div>
                <div className="jl-companion-truth">
                  {currentPersona.companionTruth}
                </div>
                <div className="jl-companion-why">
                  {currentPersona.companionWhy}
                </div>
              </div>
            </div>
          </div>

          {/* 3. BOTTOM ROW */}
          <div className="jl-bottom-row">
            {/* Left column */}
            <div className="jl-bottom-left">
              {/* CLAIRE'S CALL CARD */}
              <div
                className="jl-call-card"
                style={{ opacity: fadeOpacity }}
              >
                <button
                  type="button"
                  className="jl-call-play-btn"
                  aria-label="Play Claire's call"
                  style={{ background: currentPersona.accent }}
                  onClick={handlePlayCall}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                  >
                    <path d="M4 2.5v11l9-5.5z" fill="#111" />
                  </svg>
                </button>
                <div className="jl-call-text">
                  <div className="jl-call-header">
                    Claire{" "}
                    <span className="jl-call-role">· runs your day</span>{" "}
                    <span
                      className="jl-call-time"
                      style={{ color: currentPersona.accent }}
                    >
                      · {currentPersona.callTime}
                    </span>
                  </div>
                  <div className="jl-call-line">{currentPersona.callLine}</div>
                </div>
              </div>

              <div className="jl-call-tagline">She calls. You don't type.</div>

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

              <div className="jl-dots-row">
                {PERSONAS.map((p, idx) => (
                  <button
                    key={p.key}
                    type="button"
                    className={`jl-persona-dot ${
                      idx === state.index ? "is-active" : ""
                    }`}
                    aria-label={`Show ${p.name}`}
                    onClick={() => handleDotClick(idx)}
                  />
                ))}
              </div>
            </div>

            {/* Right column: back half of the sentence */}
            <div className="jl-bottom-sentence">
              <div>then makes</div>
              <div>your next move</div>
              <div>a game.</div>
              <svg
                className="jl-bottom-underline"
                viewBox="0 0 220 30"
                width="220"
                height="30"
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
        </section>

        {/* 4. BELOW THE FOLD */}
        {/* THE GAMES ROW */}
        <section id="games" className="jl-games-section" aria-labelledby="games-heading">
          <div id="games-heading" className="jl-section-label">The games</div>
          <div className="jl-games-grid">
            <div
              className="jl-game-card"
              style={{ background: "#f3e2b4" }}
            >
              [Real gameplay video: The Colosseum]
            </div>
            <div
              className="jl-game-card"
              style={{ background: "#f6cfdc" }}
            >
              [Real gameplay video: Silver Lake]
            </div>
            <div
              className="jl-game-card"
              style={{ background: "#bfe6e1" }}
            >
              [Real gameplay video: CHANNEL 382]
            </div>
            <div
              className="jl-game-card"
              style={{ background: "#f8cfc3" }}
            >
              [Real gameplay video: Beverly Hills]
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section
          id="how"
          className="jl-how-section"
          aria-labelledby="how-heading"
          data-testid="section-how-it-works"
        >
          <div id="how-heading" className="jl-section-label">HOW JOYSTICK WORKS</div>
          <div className="jl-how-grid">
            {HOW_IT_WORKS_STEPS.map((s) => (
              <div key={s.step} className="jl-how-step">
                <div className="jl-how-step-title">{s.title}</div>
                <div className="jl-how-step-text">{s.text}</div>
              </div>
            ))}
          </div>
        </section>

        {/* PRICING & COMMERCIAL TERMS */}
        <section
          id="pricing"
          className="jl-pricing-section"
          aria-labelledby="pricing-heading"
          data-testid="section-pricing"
        >
          <div id="pricing-heading" className="jl-section-label">Pricing</div>
          <div
            className="jl-pricing-card"
            data-testid="landing-pricing-card"
          >
            <div className="jl-pricing-title">
              7-Day Free Trial, Then $49/Month
            </div>
            <div
              className="joystick-desktop__terms"
              data-testid="landing-commercial-terms"
            >
              <span className="joystick-terms-pill">7-day trial</span>
              <span className="joystick-terms-pill">$49/month</span>
              <span className="joystick-terms-pill">Card required at signup</span>
              <span className="joystick-terms-pill">Cancel anytime</span>
            </div>
            <p
              className="joystick-checkout-closed"
              data-testid="landing-checkout-unavailable"
            >
              Checkout is not open. This does not charge a card.
            </p>
            <p
              className="jl-pricing-illustration"
              data-testid="landing-examples-illustration"
            >
              All customer references on this page are illustrations.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
