/* LEGACY DAYFORGE COMPATIBILITY: route literal retained for the existing tenant-provisioning endpoint; customer-facing product is JOYSTICK. */
import { useEffect, useReducer, useState, type FormEvent } from "react";
import { captureProductEvent } from "@/lib/posthog";
import {
  CLAIRE_DECISION_CHOICES,
  CLAIRE_ROTATING_WORDS,
  DAY_LINE_ROUTINES,
  DOSSIER_TABS,
  FADE_DURATION_MS,
  HOW_IT_WORKS_STEPS,
  LIVE_RUN_METRICS,
  PERSONAS,
  RECEIPTS_GRID,
  ROSTER_COMPANIONS,
  ROTATION_PERIOD_MS,
  initialPersonaState,
  personaReducer,
  type PersonaAction,
  type PersonaState,
} from "./joystickPersonaData";
import "./joystick-landing.css";

const START_PATH = "/joystick-start";

function renderPortrait(key: string, label: string) {
  switch (key) {
    case "adam":
      return (
        <svg
          viewBox="0 0 160 160"
          width="120"
          height="120"
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
            {/* Cap */}
            <path d="M50 56 C 54 36, 76 28, 98 34 C 108 38, 112 46, 112 56" />
            <path d="M46 56 C 68 52, 94 52, 114 56 C 128 54, 138 60, 134 68 C 124 70, 112 62, 108 58" />
            {/* Face oval */}
            <path d="M52 56 C 50 86, 60 110, 80 112 C 100 110, 110 86, 108 56" />
            {/* Eyes */}
            <path d="M64 74 q 6 -4 12 0" />
            <path d="M86 74 q 6 -4 12 0" />
            {/* Nose and half smile */}
            <path d="M78 82 c 1 4, -1 7, -3 8" />
            <path d="M68 96 q 12 7 24 0" />
            {/* Neck */}
            <path d="M68 112 v 24 M92 112 v 24" />
          </g>
        </svg>
      );
    case "daisy":
      return (
        <svg
          viewBox="0 0 160 160"
          width="120"
          height="120"
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
            {/* Long hair */}
            <path d="M52 136 C 44 94, 50 50, 80 46 C 110 50, 116 94, 108 136" />
            {/* Face */}
            <path d="M58 64 C 56 88, 64 106, 80 108 C 96 106, 104 88, 102 64" />
            {/* Gentle eyes */}
            <circle cx="70" cy="74" r="2.5" fill="#111" />
            <circle cx="90" cy="74" r="2.5" fill="#111" />
            {/* Nose and soft smile */}
            <path d="M80 78 v 6" />
            <path d="M72 92 q 8 5 16 0" />
          </g>
        </svg>
      );
    case "shawn":
      return (
        <svg
          viewBox="0 0 160 160"
          width="120"
          height="120"
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
            {/* Beanie / knit cap */}
            <path d="M52 58 C 52 38, 70 30, 80 30 C 90 30, 108 38, 108 58 Z" />
            <path d="M48 58 h 64" strokeWidth="3" />
            {/* Face */}
            <path d="M54 58 C 52 86, 62 106, 80 108 C 98 106, 108 86, 106 58" />
            {/* Eyes */}
            <circle cx="68" cy="72" r="2.5" fill="#111" />
            <circle cx="92" cy="72" r="2.5" fill="#111" />
            {/* Smile */}
            <path d="M72 90 q 8 6 16 0" />
            {/* Counter line */}
            <path d="M38 126 h 84" />
          </g>
        </svg>
      );
    case "tj":
      return (
        <svg
          viewBox="0 0 160 160"
          width="120"
          height="120"
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
            {/* Hood / collar */}
            <path d="M48 136 C 44 98, 56 60, 80 56 C 104 60, 116 98, 112 136" />
            {/* Face */}
            <path d="M58 64 C 56 86, 64 104, 80 106 C 96 104, 104 86, 102 64" />
            {/* Eyes */}
            <circle cx="70" cy="74" r="2.5" fill="#111" />
            <circle cx="90" cy="74" r="2.5" fill="#111" />
            <path d="M72 92 q 8 5 16 0" />
            {/* Doorframe line */}
            <path d="M120 44 v 92" />
          </g>
        </svg>
      );
    default:
      return null;
  }
}

// Single-line Picasso style animal drawings for the 4 companions
function renderCompanion(key: string, label: string, accent: string) {
  switch (key) {
    case "adam":
      // Rook — Upright fearless messenger bird with bucket hat, goggles, wind-up key, satchel
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
      // Sable — Sleek black cat with alert ears, whiskers, collar tag, satchel with scrolls
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
            {/* Ears */}
            <path d="M64 46 L 54 20 L 76 34" fill={accent} />
            <path d="M104 34 L 126 20 L 116 46" fill={accent} />
            {/* Crown and face */}
            <path d="M76 34 C 88 30, 96 30, 104 34" />
            <path d="M54 48 C 46 72, 70 82, 90 82 C 110 82, 134 72, 126 48" />
            {/* Alert eyes */}
            <path d="M72 52 q 6 -4 12 0 M96 52 q 6 -4 12 0" />
            <circle cx="78" cy="53" r="2.5" fill="#111" />
            <circle cx="102" cy="53" r="2.5" fill="#111" />
            {/* Nose, mouth, whiskers */}
            <path d="M87 64 l 3 3 l 3 -3 Z" fill="#111" />
            <path d="M90 67 v 4 q -6 4 -10 2 M90 71 q 6 4 10 2" />
            <path d="M52 64 L 30 60 M52 70 L 28 72 M128 64 L 150 60 M128 70 L 152 72" />
            {/* Collar with accent pendant */}
            <path d="M72 84 C 82 88, 98 88, 108 84" />
            <circle cx="90" cy="94" r="6" fill={accent} />
            {/* Body, legs, paws */}
            <path d="M74 86 C 54 110, 48 152, 52 196" />
            <path d="M106 86 C 116 110, 118 152, 114 196" />
            <path d="M44 196 h 16 M106 196 h 16" />
            {/* Scroll satchel */}
            <path d="M42 120 L 76 116 L 78 152 L 44 156 Z" fill="#fbfaf6" />
            <path d="M48 118 v -8 c 0 -3, 6 -3, 6 0 v 8 M58 118 v -10 c 0 -3, 6 -3, 6 0 v 10" />
            {/* High curved tail */}
            <path d="M52 180 C 30 170, 16 142, 22 112 C 26 92, 40 86, 44 98 C 46 108, 36 118, 32 132" />
          </g>
        </svg>
      );
    case "shawn":
      // Luma — Chameleon director with visor cap, spiraled tail, camera frame
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
            {/* Director's visor */}
            <path
              d="M62 36 C 62 18, 88 14, 112 22 C 126 26, 138 36, 136 48 L 56 52 Z"
              fill={accent}
            />
            {/* Big circular expressive eye */}
            <circle cx="92" cy="62" r="12" fill="#fbfaf6" />
            <circle cx="95" cy="62" r="5" fill="#111" />
            {/* Snout and smile */}
            <path d="M62 52 C 42 58, 38 74, 50 84 C 66 94, 90 90, 108 84" />
            <path d="M46 74 q 10 6 20 0" />
            {/* Body and spiraled curled tail */}
            <path d="M108 84 C 130 94, 142 118, 138 148 C 132 174, 110 188, 84 184 C 60 180, 50 158, 62 142 C 72 128, 96 132, 100 148 C 102 160, 92 168, 82 166" />
            {/* Director's clapperboard / frame */}
            <path d="M32 106 L 82 96 L 86 140 L 36 150 Z" fill="#fbfaf6" />
            <path d="M32 106 L 82 96 L 84 110 L 34 120 Z" fill={accent} />
            <path d="M46 104 L 42 118 M60 101 L 56 115 M74 98 L 70 112" />
            {/* Hand holding frame */}
            <path d="M88 118 C 76 120, 68 124, 64 132" />
            <path d="M114 148 C 108 174, 104 192, 118 196 M68 184 L 64 196" />
          </g>
        </svg>
      );
    case "tj":
      // Orren — Desert tortoise with compass pack on shell and map scroll
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
            {/* Compass mounted atop shell */}
            <circle cx="106" cy="34" r="14" fill={accent} />
            <path d="M106 20 V 10 M102 10 H 110" />
            <path d="M106 34 L 112 26" stroke="#111" strokeWidth="2.4" />
            <circle cx="106" cy="34" r="2.5" fill="#111" />
            {/* Domed sturdy shell */}
            <path
              d="M38 140 C 34 76, 70 46, 116 48 C 146 50, 168 76, 164 140 Z"
              fill="#fbfaf6"
            />
            {/* Shell plates */}
            <path d="M56 100 C 76 76, 110 76, 146 98" />
            <path d="M46 140 C 70 120, 110 120, 154 138" />
            <path d="M96 48 V 140 M64 90 L 42 110 M128 88 L 150 110" />
            {/* Head and neck reaching forward */}
            <path d="M38 124 C 24 122, 12 132, 14 146 C 16 158, 28 162, 40 156" />
            <circle cx="24" cy="140" r="3" fill="#111" />
            <path d="M18 148 q 6 4 10 0" />
            {/* Front foot */}
            <path d="M32 152 C 28 174, 30 192, 44 196 C 54 196, 56 184, 54 160" />
            {/* Back foot */}
            <path d="M140 148 C 144 172, 146 192, 160 196 C 168 196, 170 184, 166 160" />
            {/* Underside & rolled map */}
            <path d="M54 170 H 140" />
            <rect x="76" y="142" width="28" height="12" rx="3" fill={accent} />
          </g>
        </svg>
      );
    default:
      return null;
  }
}

// Single-line black ink drawings for Hero companion cards (per mock & spec)
function renderHeroCompanion(key: string, accent: string) {
  switch (key) {
    case "adam":
      // Rook — round bird, beak, round glasses, orange hard hat (#e39b00), clipboard with a card
      return (
        <svg viewBox="0 0 160 160" width="130" height="130" aria-hidden="true">
          <g fill="none" stroke="#111" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M48 42 C 48 22, 68 18, 88 18 C 108 18, 128 22, 128 42 Z" fill={accent} />
            <path d="M40 42 h 96" strokeWidth="2.8" />
            <circle cx="76" cy="62" r="12" />
            <circle cx="100" cy="62" r="12" />
            <circle cx="78" cy="62" r="3" fill="#111" />
            <circle cx="102" cy="62" r="3" fill="#111" />
            <path d="M88 62 h 2" />
            <path d="M110 58 L 138 64 L 110 70 Z" fill="#fff" />
            <circle cx="86" cy="96" r="28" fill="#fff" />
            <path d="M76 124 v 16 M70 140 h 12 M96 124 v 16 M90 140 h 12" />
            <rect x="94" y="86" width="22" height="28" rx="2" fill="#fff" />
            <path d="M100 83 h 10 v 4 h -10 Z" fill="#111" />
            <path d="M98 94 h 14 M98 99 h 14 M98 104 h 10" />
          </g>
        </svg>
      );
    case "daisy":
      // Sable — sleek cat with alert ears, whiskers, collar tag (#e0457b), satchel with scrolls
      return (
        <svg viewBox="0 0 160 160" width="130" height="130" aria-hidden="true">
          <g fill="none" stroke="#111" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            {/* Alert ears with accent fill */}
            <path d="M60 48 L 50 24 L 72 38 Z" fill={accent} />
            <path d="M96 38 L 118 24 L 108 48 Z" fill={accent} />
            {/* Crown and head */}
            <path d="M72 38 C 82 34, 88 34, 96 38" />
            <ellipse cx="84" cy="58" rx="28" ry="22" fill="#fff" />
            {/* Eyes */}
            <circle cx="74" cy="54" r="3" fill="#111" />
            <circle cx="94" cy="54" r="3" fill="#111" />
            {/* Nose & whiskers */}
            <path d="M82 62 l 2 2 l 2 -2 Z" fill="#111" />
            <path d="M84 64 v 3 q -4 3 -8 2 M84 67 q 4 3 8 2" />
            <path d="M54 58 L 38 54 M54 64 L 36 66 M114 58 L 130 54 M114 64 L 132 66" />
            {/* Collar and tag */}
            <path d="M66 78 C 76 82, 92 82, 102 78" />
            <circle cx="84" cy="88" r="5" fill={accent} />
            {/* Body */}
            <path d="M68 80 C 58 100, 56 122, 60 142 M100 80 C 108 100, 110 122, 106 142" />
            {/* Scroll satchel */}
            <rect x="52" y="104" width="28" height="24" rx="2" fill="#fff" />
            <path d="M56 102 v -6 c 0 -2, 4 -2, 4 0 v 6 M64 102 v -8 c 0 -2, 4 -2, 4 0 v 8" />
            {/* Tail */}
            <path d="M60 134 C 44 126, 36 108, 40 88 C 42 76, 50 72, 54 82" />
          </g>
        </svg>
      );
    case "shawn":
      // Luma — chameleon director with visor cap (#13a39a), spiraled tail, camera frame
      return (
        <svg viewBox="0 0 160 160" width="130" height="130" aria-hidden="true">
          <g fill="none" stroke="#111" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            {/* Visor cap in teal */}
            <path d="M52 40 C 52 24, 76 20, 98 26 C 110 30, 120 38, 118 48 L 48 50 Z" fill={accent} />
            {/* Chameleon head */}
            <path d="M52 50 C 38 56, 34 68, 44 76 C 58 84, 78 82, 94 76" />
            {/* Expressive turret eye */}
            <circle cx="80" cy="56" r="10" fill="#fff" />
            <circle cx="83" cy="56" r="4" fill="#111" />
            <path d="M42 68 q 8 5 16 0" />
            {/* Body and spiraled tail */}
            <path d="M94 76 C 112 84, 122 104, 118 128 C 112 148, 94 156, 74 152 C 54 148, 46 130, 56 118 C 64 106, 84 110, 88 122 C 90 130, 82 136, 74 134" />
            {/* Clapperboard / frame */}
            <rect x="36" y="94" width="44" height="30" rx="2" fill="#fff" />
            <path d="M36 94 L 80 94 L 80 102 L 36 102 Z" fill={accent} />
            <path d="M46 94 L 42 102 M58 94 L 54 102 M70 94 L 66 102" />
          </g>
        </svg>
      );
    case "tj":
      // Orren — desert tortoise with compass pack on shell (#e8472a) and map scroll
      return (
        <svg viewBox="0 0 160 160" width="130" height="130" aria-hidden="true">
          <g fill="none" stroke="#111" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            {/* Mounted compass in red */}
            <circle cx="94" cy="30" r="12" fill={accent} />
            <path d="M94 18 V 10 M90 10 H 98" />
            <circle cx="94" cy="30" r="2.5" fill="#111" />
            <path d="M94 30 L 100 24" stroke="#111" strokeWidth="2" />
            {/* Domed shell */}
            <path d="M38 120 C 34 68, 64 42, 104 44 C 130 46, 148 68, 144 120 Z" fill="#fff" />
            <path d="M54 86 C 70 66, 100 66, 130 84" />
            <path d="M44 118 C 66 102, 100 102, 138 116" />
            <path d="M86 44 V 120 M58 78 L 40 96 M114 76 L 132 94" />
            {/* Tortoise head reaching out */}
            <path d="M38 106 C 26 104, 16 112, 18 124 C 20 134, 30 138, 40 132" />
            <circle cx="26" cy="118" r="2.5" fill="#111" />
            {/* Feet */}
            <path d="M34 130 v 14 M98 130 v 14 M126 128 v 16" />
            {/* Rolled map */}
            <rect x="68" y="122" width="24" height="10" rx="2" fill={accent} />
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

interface GameCapture {
  key: string;
  pillTitle: string;
  pillChore: string;
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
    pillTitle: "Silver Lake",
    pillChore: "the customers who went quiet",
    title: "Silver Lake",
    line: "Your quiet customers live here. Walk over and say hi.",
    note: "Real gameplay. Nothing here is sent without you.",
    poster: "/joystick/gameplay/silver-lake.jpg",
    video: "/joystick/gameplay/silver-lake.mp4",
    alt: "Silver Lake: a cozy courtyard of neighbours, a bear in a scarf, and a porcupine beside a cottage",
  },
  {
    key: "beverly-hills",
    pillTitle: "Beverly Hills",
    pillChore: "the prospects you drive past",
    title: "Beverly Hills",
    line: "Real prospects behind the velvet rope.",
    note: "Real gameplay. Cold outreach is drafted, never sent for you.",
    poster: "/joystick/gameplay/beverly-hills.jpg",
    video: "/joystick/gameplay/beverly-hills.mp4",
    alt: "Beverly Hills: a sunlit plaza with string lights, a pink awning and three passers-by",
  },
  {
    key: "channel-382",
    pillTitle: "CHANNEL 382",
    pillChore: "the ad you never film",
    title: "CHANNEL 382",
    line: "The commercial you film is a real ad.",
    note: "Real gameplay capture. Every word is approved before it airs.",
    poster: "/joystick/gameplay/channel-382.jpg",
    video: null,
    alt: "CHANNEL 382: a clay television studio with a tiny Laundry Farm van on set and a call sheet of three hooks",
  },
  {
    key: "century-park-east",
    pillTitle: "Century Park East",
    pillChore: "the building you’ve never walked",
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
  // React's reducer takes (state, action) only; the persona count stays at its default.
  const [state, dispatch] = useReducer(
    (current: PersonaState, action: PersonaAction) => personaReducer(current, action),
    initialPersonaState
  );
  const currentPersona = PERSONAS[state.index];
  const [isHoveringHero, setIsHoveringHero] = useState(false);
  const [timerResetKey, setTimerResetKey] = useState(0);
  const [flippedCompanions, setFlippedCompanions] = useState<Record<string, boolean>>({});

  // Hero empty card input
  const [heroInputGame, setHeroInputGame] = useState("");
  const [, setHeroInputFocused] = useState(false);

  // Hero card flip states
  const [isHeroFlippedPerson, setIsHeroFlippedPerson] = useState(false);
  const [isHeroFlippedCompanion, setIsHeroFlippedCompanion] = useState(false);

  // Hero card entrance settle animation
  const [heroCardSettled, setHeroCardSettled] = useState(false);

  // Hero 6-second idle nudge arrow
  const [idleNudgeVisible, setIdleNudgeVisible] = useState(false);

  // Hero pause timer for interaction (pauses rotation and resumes 10s after)
  const [rotationPausedUntil, setRotationPausedUntil] = useState<number>(0);

  // Claire rotating word state (books, orders, customers, routes, goals)
  const [wordIndex, setWordIndex] = useState(0);

  // Claire call card flip state (Decision flip)
  const [claireCardFlipped, setClaireCardFlipped] = useState(false);

  // Games chore switcher
  const [activeGameKey, setActiveGameKey] = useState<string>("silver-lake");

  // Dossier tab state
  const [activeDossierTab, setActiveDossierTab] = useState<string>("wash-and-fold");

  // Day Line chore input
  const [choreInputValue, setChoreInputValue] = useState("");

  // Day Line category filter
  const [activeRoutineCategory, setActiveRoutineCategory] = useState<string>("All");

  // Lantern city map node hover state
  const [hoveredLantern, setHoveredLantern] = useState<number | null>(null);

  useEffect(() => {
    captureProductEvent("landing_page_visited", {
      path: typeof window !== "undefined" ? window.location.pathname : "/joystick",
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

  // Settle animation (500ms after load)
  useEffect(() => {
    if (reducedMotion) {
      setHeroCardSettled(true);
      return;
    }
    const settleTimer = window.setTimeout(() => {
      setHeroCardSettled(true);
    }, 500);
    return () => window.clearTimeout(settleTimer);
  }, [reducedMotion]);

  // Idle nudge: 6 seconds of no interaction
  useEffect(() => {
    if (reducedMotion) return;
    const nudgeTimer = window.setTimeout(() => {
      setIdleNudgeVisible(true);
      captureProductEvent("hero_nudge_drawn", { persona: currentPersona.key });
    }, 6000);
    return () => window.clearTimeout(nudgeTimer);
  }, [reducedMotion, currentPersona.key]);

  // Escape key flips back
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsHeroFlippedPerson(false);
        setIsHeroFlippedCompanion(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Persona rotation timer (7s clock, pauses on flip/tap, resumes 10s after)
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
      if (Date.now() < rotationPausedUntil) return;
      if (isHeroFlippedPerson || isHeroFlippedCompanion) return;
      dispatch({ type: "TICK_FADE" });
    }, ROTATION_PERIOD_MS);
    return () => window.clearInterval(timer);
  }, [reducedMotion, isHoveringHero, rotationPausedUntil, isHeroFlippedPerson, isHeroFlippedCompanion, state.index, timerResetKey]);

  // Claire rotating word timer (every 2.5s)
  useEffect(() => {
    if (reducedMotion) return;
    const wordTimer = window.setInterval(() => {
      setWordIndex((prev) => (prev + 1) % CLAIRE_ROTATING_WORDS.length);
    }, 2500);
    return () => window.clearInterval(wordTimer);
  }, [reducedMotion]);

  const handleDotClick = (index: number) => {
    if (index === state.index && !state.fading) return;
    dispatch({ type: "START_FADE", nextIndex: index });
    setTimerResetKey((prev) => prev + 1);
  };

  const toggleCompanion = (key: string) => {
    setFlippedCompanions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleTogglePersonFlip = () => {
    const next = !isHeroFlippedPerson;
    setIsHeroFlippedPerson(next);
    setRotationPausedUntil(Date.now() + 10000);
    captureProductEvent("hero_card_flipped", {
      persona: currentPersona.key,
      side: next ? "back" : "front",
      target: "person",
    });
  };

  const handleToggleCompanionFlip = () => {
    const next = !isHeroFlippedCompanion;
    setIsHeroFlippedCompanion(next);
    setRotationPausedUntil(Date.now() + 10000);
    captureProductEvent("hero_card_flipped", {
      persona: currentPersona.key,
      side: next ? "back" : "front",
      target: "companion",
    });
  };

  const handleHeroCardSubmit = (e: FormEvent) => {
    e.preventDefault();
    captureProductEvent("hero_preview_opened", { source: "card" });
    if (typeof window !== "undefined") {
      const val = heroInputGame.trim();
      const target = val ? `${START_PATH}?game=${encodeURIComponent(val)}` : START_PATH;
      window.location.href = target;
    }
  };

  const handlePreviewLinkClick = () => {
    captureProductEvent("hero_preview_opened", { source: "link" });
  };

  const handleClipClick = () => {
    setRotationPausedUntil(Date.now() + 10000);
    captureProductEvent("hero_clip_tapped", { persona: currentPersona.key });
    captureProductEvent("hero_preview_opened", { source: "clip" });
    if (typeof window !== "undefined") {
      window.location.href = START_PATH;
    }
  };

  const handleChoreSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (typeof window !== "undefined") {
      const target = choreInputValue.trim()
        ? `${START_PATH}?chore=${encodeURIComponent(choreInputValue.trim())}`
        : START_PATH;
      window.location.href = target;
    }
  };

  const fadeOpacity = state.fading ? 0 : 1;
  const humanFlipClass = state.isFlippedHuman ? "is-flipped" : "";
  const [claireStep, partyStep, gamesStep] = HOW_IT_WORKS_STEPS;
  const activeGame = GAMES.find((g) => g.key === activeGameKey) ?? GAMES[0];
  const activeDossier =
    DOSSIER_TABS.find((d) => d.id === activeDossierTab) ?? DOSSIER_TABS[0];

  const filteredRoutines =
    activeRoutineCategory === "All"
      ? DAY_LINE_ROUTINES
      : DAY_LINE_ROUTINES.filter((r) => r.category === activeRoutineCategory);

  return (
    <main
      className="joystick-landing"
      data-testid="joystick-marketing"
      aria-label="Joystick — Knows your business, then makes your next move a game."
    >
      {/* 1. NAV (No CTA in nav per spec) */}
      <nav className="jl-nav jl-wrap" aria-label="Main navigation">
        <div className="jl-nav-brand">
          <span className="jl-nav-title">Joystick</span>
          <span className="jl-nav-tagline">A BUSINESS YOU CAN PLAY.</span>
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

      {/* 2. HERO: Single concept — your companions. Empty card is the only CTA. */}
      <section
        className="jl-hero-section jl-wrap"
        aria-label="Joystick hero"
        onPointerEnter={() => setIsHoveringHero(true)}
        onPointerLeave={() => setIsHoveringHero(false)}
      >
        <div className="jl-hero-main-row">
          {/* Left Column (~42%): Headline and underlines only. Air beneath is intentional. */}
          <div className="jl-hero-left">
            <h1 className="jl-hero-headline">
              <span className="jl-hero-headline-line">Knows your</span>
              <span className="jl-hero-headline-line">business, then</span>
              <span className="jl-hero-headline-line">makes your next</span>
              <span className="jl-hero-headline-line">
                move{" "}
                <span className="jl-hero-headline-underlined">
                  a game.
                  <svg
                    className="jl-hero-double-underline"
                    viewBox="0 0 280 34"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M4 12 C 70 6, 150 16, 276 8"
                      fill="none"
                      stroke="#e39b00"
                      strokeWidth="5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M14 24 C 80 18, 170 28, 268 20"
                      fill="none"
                      stroke="#e39b00"
                      strokeWidth="6"
                      strokeLinecap="round"
                    />
                  </svg>
                  {/* 6-second idle nudge arrow */}
                  {idleNudgeVisible && (
                    <div className="jl-hero-idle-nudge" aria-hidden="true">
                      <svg className="jl-nudge-arrow-svg" viewBox="0 0 160 60">
                        <path
                          className="jl-nudge-path"
                          d="M 12 36 Q 70 -4, 140 22"
                          fill="none"
                          stroke="#e39b00"
                          strokeWidth="3.2"
                          strokeLinecap="round"
                        />
                        <path
                          className="jl-nudge-head"
                          d="M 122 14 L 142 22 L 132 36"
                          fill="none"
                          stroke="#e39b00"
                          strokeWidth="3.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className="jl-nudge-text">yours →</span>
                    </div>
                  )}
                </span>
              </span>
            </h1>
          </div>

          {/* Right Column: The Gallery Stack */}
          <div className="jl-hero-gallery">
            <div className="jl-gallery-stack">
              <div className="jl-gallery-cards-pair">
                {/* Person card: tilted ~ -4deg, upper-left */}
                <div
                  className={`jl-gallery-card jl-gallery-person-card ${isHeroFlippedPerson ? "is-flipped" : ""}`}
                  onClick={handleTogglePersonFlip}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") handleTogglePersonFlip();
                  }}
                  aria-label={`Flip to see ${currentPersona.name}'s photo`}
                >
                <div className="jl-gallery-card-inner">
                  <div
                    className="jl-gallery-card-face jl-gallery-card-front"
                    style={{ background: "#fff3b0" }}
                  >
                    <div className="jl-card-tap-label">tap →</div>
                    <div className="jl-card-spark-left" aria-hidden="true">
                      <span></span>
                      <span></span>
                    </div>
                    <div className="jl-card-sketch-wrap" style={{ opacity: fadeOpacity }}>
                      {renderPortrait(currentPersona.key, currentPersona.portraitAriaLabel)}
                    </div>
                    <div className="jl-card-caption-handwriting" style={{ opacity: fadeOpacity }}>
                      {currentPersona.caption}
                    </div>
                  </div>
                  <div
                    className="jl-gallery-card-face jl-gallery-card-back"
                    style={{ background: "#fff3b0" }}
                  >
                    <div className="jl-real-photo-placeholder">
                      <svg width="44" height="36" viewBox="0 0 44 36" aria-hidden="true">
                        <rect x="2" y="8" width="40" height="26" rx="4" fill="none" stroke="#111" strokeWidth="2" />
                        <circle cx="22" cy="21" r="8" fill="none" stroke="#111" strokeWidth="2" />
                        <rect x="14" y="2" width="16" height="6" rx="2" fill="none" stroke="#111" strokeWidth="2" />
                      </svg>
                      <div className="jl-photo-caption">
                        [Real flash photo: {currentPersona.name}, {currentPersona.photoWhere}]
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Companion card: tilted ~ +3deg, lower-left */}
              <div
                className={`jl-gallery-card jl-gallery-companion-card ${isHeroFlippedCompanion ? "is-flipped" : ""}`}
                onClick={handleToggleCompanionFlip}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") handleToggleCompanionFlip();
                }}
                aria-label={`Flip to see ${currentPersona.companion}'s scene`}
              >
                <div className="jl-gallery-card-inner">
                  <div
                    className="jl-gallery-card-face jl-gallery-card-front"
                    style={{ background: "#fff3b0" }}
                  >
                    <div className="jl-card-tap-label">tap →</div>
                    <div className="jl-companion-drawing-wrap" style={{ opacity: fadeOpacity }}>
                      {renderHeroCompanion(currentPersona.key, currentPersona.accent)}
                    </div>
                    <div className="jl-companion-text-block" style={{ opacity: fadeOpacity }}>
                      <div className="jl-companion-handwriting-name" style={{ color: currentPersona.accent }}>
                        {currentPersona.companion}
                      </div>
                      <div className="jl-companion-handwriting-gift">
                        <strong>{currentPersona.companionGift}</strong> {currentPersona.companionFlaw}
                      </div>
                      <div className="jl-companion-handwriting-for">
                        {currentPersona.forTheOneWhoText}
                      </div>
                    </div>
                  </div>
                  <div
                    className="jl-gallery-card-face jl-gallery-card-back"
                    style={{ background: "#ffffff" }}
                  >
                    <div className="jl-companion-scene-header" style={{ background: currentPersona.accent }}>
                      {currentPersona.panelTitle}
                    </div>
                    <div className="jl-companion-scene-content">
                      <div style={{ fontWeight: 600 }}>{currentPersona.panelLine1}</div>
                      <div style={{ color: "#444" }}>{currentPersona.panelLine2}</div>
                      <div style={{ color: "#444" }}>{currentPersona.panelLine3}</div>
                      <div className="jl-scene-tagline">“{currentPersona.companionInGameLine}”</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Empty card: largest, straight, front of stack */}
              <div className={`jl-gallery-empty-card ${heroCardSettled ? "is-settled" : ""}`}>
                <div className="jl-empty-card-tape" />
                <div className="jl-empty-card-sparks" aria-hidden="true">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <div className="jl-empty-card-inner-dashed">
                  <div className="jl-empty-card-header">
                    <span className="jl-empty-card-title">Your card.</span>
                    <svg className="jl-empty-card-underline" viewBox="0 0 120 12" aria-hidden="true">
                      <path d="M4 7 C 30 3, 70 9, 116 6" fill="none" stroke="#e39b00" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  </div>

                  <div className="jl-empty-card-prompt">
                    What game did you love growing up?
                  </div>

                  <form onSubmit={handleHeroCardSubmit} className="jl-empty-card-form">
                    <div className="jl-empty-card-ruled-line">
                      <input
                        type="text"
                        className="jl-empty-card-input"
                        value={heroInputGame}
                        placeholder={currentPersona.gamePlaceholder}
                        onChange={(e) => {
                          setHeroInputGame(e.target.value);
                          captureProductEvent("hero_card_typed", { text: e.target.value });
                        }}
                        onFocus={() => setHeroInputFocused(true)}
                        onBlur={() => setHeroInputFocused(false)}
                        aria-label="What game did you love growing up?"
                      />
                      <span className="jl-empty-card-caret" />
                    </div>
                  </form>

                  <div className="jl-empty-card-subtext">
                    3 questions. No account required.
                  </div>
                </div>
              </div>
            </div>

            {/* Gallery meta row: one-liner + dots on left, skip link on right */}
            <div className="jl-gallery-bottom-row">
              <div className="jl-gallery-bottom-meta">
                <div className="jl-rotating-one-liner" style={{ opacity: fadeOpacity }}>
                  {currentPersona.oneLiner}
                </div>
                <div className="jl-gallery-dots">
                  {PERSONAS.map((p, idx) => (
                    <button
                      key={p.key}
                      type="button"
                      className={`jl-gallery-dot ${idx === state.index ? "is-active" : ""}`}
                      aria-label={`Show ${p.name}`}
                      onClick={() => handleDotClick(idx)}
                    />
                  ))}
                </div>
              </div>

              <div className="jl-gallery-skip-wrap">
                <a
                  href={START_PATH}
                  className="jl-empty-card-skip-link"
                  onClick={handlePreviewLinkClick}
                >
                  or just preview my first game →
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom-Middle Section: Kicker, Clip, Static line */}
        <div className="jl-hero-clip-section">
          <div className="jl-clip-kicker">
            YOU DON'T ASK. YOUR COMPANIONS ALREADY FOUND IT.
          </div>

          <div
            className="jl-clip-frame-wrap"
            onClick={handleClipClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleClipClick();
            }}
            aria-label={`Play ${currentPersona.clipLabel} clip`}
          >
            <div className="jl-clip-frame">
              {/* Dynamic badge for non-Adam slots */}
              {currentPersona.key !== "adam" && (
                <div className="jl-clip-label-badge">
                  {currentPersona.clipLabel}
                </div>
              )}

              <img
                src={
                  currentPersona.key === "adam"
                    ? "/joystick/gameplay/hero-clip-silver-lake.png"
                    : currentPersona.key === "daisy"
                    ? "/joystick/gameplay/century-park-east.jpg"
                    : currentPersona.key === "shawn"
                    ? "/joystick/gameplay/channel-382.jpg"
                    : "/joystick/gameplay/beverly-hills.jpg"
                }
                alt={`${currentPersona.clipLabel} gameplay scene`}
                className="jl-clip-scene-bg"
              />

              {/* Thought bubble (for non-Adam slots) */}
              {currentPersona.key !== "adam" && (
                <div className="jl-clip-thought-bubble" style={{ opacity: fadeOpacity }}>
                  <div className="jl-thought-bubble-tail" />
                  {currentPersona.clipThoughtBubble.map((line, i) => (
                    <div key={i} className="jl-thought-bubble-line">{line}</div>
                  ))}
                </div>
              )}

              {/* Play circle button bottom-right (for non-Adam slots) */}
              {currentPersona.key !== "adam" && (
                <div className="jl-clip-play-circle" aria-hidden="true">
                  <svg viewBox="0 0 36 36" width="36" height="36" fill="none">
                    <circle cx="18" cy="18" r="16" stroke="#111" strokeWidth="2.4" fill="#ffffff" />
                    <polygon points="14,11 25,18 14,25" fill="#111" />
                  </svg>
                </div>
              )}
            </div>
          </div>

          <div className="jl-clip-static-caption">
            Real gameplay. Nothing is sent without you.
          </div>
        </div>
      </section>

      {/* 3. CLAIRE READS YOUR BOOKS (ROTATING WORD & DECISION FLIP) */}
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
                Claire reads your{" "}
                <span
                  className="jl-rotating-word"
                  style={{ color: currentPersona.accent }}
                >
                  {CLAIRE_ROTATING_WORDS[wordIndex]}.
                </span>
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

            <div
              className={`jl-call-card-wrap ${claireCardFlipped ? "is-flipped" : ""}`}
              onClick={() => setClaireCardFlipped(!claireCardFlipped)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setClaireCardFlipped(!claireCardFlipped);
                }
              }}
              aria-label="Click to flip between what Claire noticed and the player decision"
            >
              <div className="jl-call-card-inner">
                {/* FRONT: What Claire noticed */}
                <div className="jl-call-card-face jl-call-card-front">
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
                  <div className="jl-call-bottom-hint">
                    flip to see your move →
                  </div>
                </div>

                {/* BACK: The Three Player Decisions with a Cost */}
                <div className="jl-call-card-face jl-call-card-back">
                  <div className="jl-decision-header" style={{ color: currentPersona.accent }}>
                    The Game Move · Player Decision
                  </div>
                  <div className="jl-decision-list">
                    {CLAIRE_DECISION_CHOICES.map((choice, i) => (
                      <div key={i} className="jl-decision-item">
                        <span className="jl-decision-num">0{i + 1}</span>
                        <span className="jl-decision-title">{choice.title}</span>
                      </div>
                    ))}
                  </div>
                  <div className="jl-decision-subtext">
                    She calls. You don't type.
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="jl-claire-personal-note">
            She knows a lot about your business. Less about herself, on purpose.
          </div>
        </div>
      </section>

      {/* 4. GOOD AT THE PART YOU AVOID (COMPANIONS) */}
      <section className="jl-band" aria-labelledby="party-heading">
        <div className="jl-wrap">
          <div className="jl-lede">
            <div>
              <div className="jl-section-label">Your crew</div>
              <h2 id="party-heading" className="jl-h2">
                Good at the part you avoid.
              </h2>
            </div>
            <p className="jl-lede-text">
              Rook, Sable, Luma, Orren. Each has what you don't, and a flaw you'll enjoy. You earn them by doing the work.
            </p>
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

      {/* 5. THE GAMES (CHORE PILLS SWITCHER) */}
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

          {/* Chore Pills */}
          <div className="jl-game-pills-row" role="tablist" aria-label="Game chores">
            {GAMES.map((game) => (
              <button
                key={game.key}
                type="button"
                role="tab"
                aria-selected={activeGameKey === game.key}
                className={`jl-game-pill ${activeGameKey === game.key ? "is-active" : ""}`}
                onClick={() => setActiveGameKey(game.key)}
              >
                <span className="jl-game-pill-title">{game.pillTitle}</span>
                <span className="jl-game-pill-chore">{game.pillChore}</span>
              </button>
            ))}
          </div>

          <div className="jl-object">
            <figure className="jl-capture jl-capture-featured">
              {activeGame.video !== null && !reducedMotion ? (
                <video
                  key={activeGame.key}
                  className="jl-shot"
                  muted
                  loop
                  playsInline
                  autoPlay
                  poster={activeGame.poster}
                  aria-label={activeGame.alt}
                >
                  <source src={activeGame.video} type="video/mp4" />
                </video>
              ) : (
                <img
                  className="jl-shot"
                  src={activeGame.poster}
                  alt={activeGame.alt}
                  loading="lazy"
                />
              )}
              <figcaption className="jl-capture-caption">
                <span className="jl-capture-line">
                  {activeGame.title}. {activeGame.line}
                </span>
                <span className="jl-capture-note">{activeGame.note}</span>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* 6. THE CITY (LANTERN CITY — LIGHTWEIGHT 2D CANVAS) */}
      <section id="city" className="jl-band jl-city-section" aria-labelledby="city-heading">
        <div className="jl-wrap">
          <div className="jl-lede">
            <div>
              <div className="jl-section-label">Lantern City</div>
              <h2 id="city-heading" className="jl-h2">
                Your customers are spread across a city.
              </h2>
            </div>
            <p className="jl-lede-text">
              Most of them have gone quiet. Claire knows which doors, and which one to knock first.
            </p>
          </div>

          {/* Lightweight 2D Lantern Map Canvas */}
          <div className="jl-city-canvas-wrap">
            <svg
              className="jl-city-svg"
              viewBox="0 0 960 440"
              preserveAspectRatio="xMidYMid slice"
              role="img"
              aria-label="Lantern City map: glowing lanterns show active customers; dim lanterns show quiet doors"
            >
              <defs>
                <radialGradient id="cityMist" cx="50%" cy="50%" r="60%">
                  <stop offset="0%" stopColor="#1a1a24" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#0c0d12" stopOpacity="1" />
                </radialGradient>
                <filter id="lanternGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="6" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              <rect width="960" height="440" fill="url(#cityMist)" rx="8" />

              {/* Stylized street grid lines */}
              <g stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="3 4">
                <path d="M 60 80 Q 240 120, 480 90 T 900 110" fill="none" />
                <path d="M 80 180 Q 320 210, 560 170 T 920 230" fill="none" />
                <path d="M 40 320 Q 300 310, 600 340 T 940 330" fill="none" />
                <path d="M 220 40 L 260 400 M 460 30 L 480 410 M 720 40 L 700 420" fill="none" />
              </g>

              {/* Territory boundaries */}
              <text x="90" y="60" fill="rgba(255,255,255,0.3)" fontSize="11" letterSpacing="2">
                SILVER LAKE SECTOR
              </text>
              <text x="490" y="60" fill="rgba(255,255,255,0.3)" fontSize="11" letterSpacing="2">
                BEVERLY FLATS
              </text>
              <text x="760" y="60" fill="rgba(255,255,255,0.3)" fontSize="11" letterSpacing="2">
                K-TOWN BOULEVARD
              </text>

              {/* Lanterns: Glowing amber = Active, Dim = Quiet */}
              {[
                { id: 1, x: 180, y: 140, active: true, name: "Maya R.", note: "78 days quiet · $48 last wash" },
                { id: 2, x: 260, y: 220, active: false, name: "Hazel House", note: "3 deliveries logged" },
                { id: 3, x: 380, y: 160, active: true, name: "Rise Wilshire", note: "24 units · prospect door" },
                { id: 4, x: 520, y: 280, active: false, name: "The Flats 14B", note: "Door tags hung Tuesday" },
                { id: 5, x: 620, y: 130, active: true, name: "Sunset Loft", note: "Weekly regular · pickup 10am" },
                { id: 6, x: 740, y: 240, active: true, name: "CPE Tower East", note: "8 residents quiet" },
                { id: 7, x: 840, y: 170, active: false, name: "Vermont Studios", note: "Ad air #02 pending" },
              ].map((lantern) => (
                <g
                  key={lantern.id}
                  className="jl-lantern-node"
                  onMouseEnter={() => setHoveredLantern(lantern.id)}
                  onMouseLeave={() => setHoveredLantern(null)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Outer glow */}
                  <circle
                    cx={lantern.x}
                    cy={lantern.y}
                    r={lantern.active ? 20 : 10}
                    fill={lantern.active ? "rgba(227, 155, 0, 0.25)" : "rgba(255, 255, 255, 0.05)"}
                    filter={lantern.active ? "url(#lanternGlow)" : undefined}
                  />
                  {/* Lantern core */}
                  <circle
                    cx={lantern.x}
                    cy={lantern.y}
                    r={lantern.active ? 6 : 3.5}
                    fill={lantern.active ? "#e39b00" : "#666"}
                  />
                  {/* Label */}
                  <text
                    x={lantern.x}
                    y={lantern.y - 12}
                    textAnchor="middle"
                    fill={lantern.active ? "#fbfaf6" : "#888"}
                    fontSize="11"
                    fontFamily="Inter, sans-serif"
                    fontWeight="500"
                  >
                    {lantern.name}
                  </text>
                </g>
              ))}
            </svg>

            <div className="jl-city-hud">
              <span className="jl-city-hud-indicator" />
              <span>Lantern City active: 142 doors walked this week · 8 quiet doors ready for Claire's call</span>
            </div>
          </div>
        </div>
      </section>

      {/* 7. THE DOSSIER (LIVING WIKI FORMAT) */}
      <section className="jl-band" aria-labelledby="dossier-heading">
        <div className="jl-wrap">
          <div className="jl-lede">
            <div>
              <div className="jl-section-label">The Dossier</div>
              <h2 id="dossier-heading" className="jl-h2">
                She reads your books before the first call.
              </h2>
            </div>
            <p className="jl-lede-text">
              Orders, customers, payments, routes. Every number has a receipt.
            </p>
          </div>

          <div className="jl-dossier-wrap">
            {/* Dossier Tabs */}
            <div className="jl-dossier-tabs" role="tablist">
              {DOSSIER_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeDossierTab === tab.id}
                  className={`jl-dossier-tab ${activeDossierTab === tab.id ? "is-active" : ""}`}
                  onClick={() => setActiveDossierTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Dossier Card */}
            <div className="jl-dossier-card">
              <div className="jl-dossier-header">
                <div className="jl-dossier-title">{activeDossier.operator}</div>
                <div className="jl-dossier-badge">{activeDossier.ticket}</div>
              </div>
              <div className="jl-dossier-grid">
                <div className="jl-dossier-item">
                  <span className="jl-dossier-field">Who went quiet</span>
                  <span className="jl-dossier-val">{activeDossier.quiet}</span>
                </div>
                <div className="jl-dossier-item">
                  <span className="jl-dossier-field">What's owed</span>
                  <span className="jl-dossier-val">{activeDossier.owed}</span>
                </div>
                <div className="jl-dossier-item">
                  <span className="jl-dossier-field">The goal</span>
                  <span className="jl-dossier-val" style={{ fontWeight: 600, color: "#111" }}>
                    {activeDossier.goal}
                  </span>
                </div>
                <div className="jl-dossier-item">
                  <span className="jl-dossier-field">What you keep skipping</span>
                  <span className="jl-dossier-val">{activeDossier.skipped}</span>
                </div>
              </div>
              <div className="jl-dossier-footer">
                There is a page about Claire. She hasn’t written it yet.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 8. THE RECEIPTS GRID (INTEGRATIONS) */}
      <section id="receipts" className="jl-band" aria-labelledby="receipts-heading">
        <div className="jl-wrap">
          <div className="jl-lede">
            <div>
              <div className="jl-section-label">Connectors</div>
              <h2 id="receipts-heading" className="jl-h2">
                The books, not the inbox.
              </h2>
            </div>
            <p className="jl-lede-text">
              Claire reads where the money actually moves. Each receipt becomes a move.
            </p>
          </div>

          <div className="jl-receipts-grid">
            {RECEIPTS_GRID.map((card, i) => (
              <div key={i} className="jl-receipt-card">
                <div className="jl-receipt-top">
                  <span className="jl-receipt-cat">{card.category}</span>
                  <span
                    className="jl-receipt-territory"
                    style={{ background: card.accent }}
                  >
                    {card.gameTerritory}
                  </span>
                </div>
                <div className="jl-receipt-sources">{card.sources}</div>
                <div className="jl-receipt-line">&ldquo;{card.claireLine}&rdquo;</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 9. THE DAY LINE (ROUTINES) */}
      <section id="day-line" className="jl-band" aria-labelledby="dayline-heading">
        <div className="jl-wrap">
          <div className="jl-lede">
            <div>
              <div className="jl-section-label">The Day Line</div>
              <h2 id="dayline-heading" className="jl-h2">
                The chores you avoid, on a schedule.
              </h2>
            </div>
            <p className="jl-lede-text">
              Claire calls at 7:30 with three moves. She calls again at night to hear what happened.
            </p>
          </div>

          {/* Routine category filters */}
          <div className="jl-routine-filters">
            {(["All", "Win-backs", "Prospects", "Ads", "Money", "Reviews", "Routes"] as const).map(
              (cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`jl-routine-filter-btn ${activeRoutineCategory === cat ? "is-active" : ""}`}
                  onClick={() => setActiveRoutineCategory(cat)}
                >
                  {cat}
                </button>
              )
            )}
          </div>

          {/* Timeline cards */}
          <div className="jl-routines-grid">
            {filteredRoutines.map((routine) => (
              <div key={routine.id} className="jl-routine-card">
                <div className="jl-routine-time-row">
                  <span className="jl-routine-time">{routine.time}</span>
                  <span className="jl-routine-cat">{routine.category}</span>
                </div>
                <div className="jl-routine-title">{routine.title}</div>
                <div className="jl-routine-desc">{routine.desc}</div>
                <div className="jl-routine-receipt">Receipt: {routine.receipt}</div>
              </div>
            ))}
          </div>

          {/* Chore input: carry into /joystick-start */}
          <div className="jl-chore-prompt-box">
            <div className="jl-chore-prompt-label">
              Tell Claire the chore you avoid:
            </div>
            <form onSubmit={handleChoreSubmit} className="jl-chore-prompt-form">
              <input
                type="text"
                className="jl-chore-prompt-input"
                placeholder="e.g. Calling inactive clients, walking commercial high-rises..."
                value={choreInputValue}
                onChange={(e) => setChoreInputValue(e.target.value)}
              />
              <button type="submit" className="jl-chore-prompt-btn">
                She builds the game →
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* 10. SEATS (SOLO BUSINESS CREW) */}
      <section className="jl-band" aria-labelledby="seats-heading">
        <div className="jl-wrap">
          <div className="jl-lede">
            <div>
              <div className="jl-section-label">Seats</div>
              <h2 id="seats-heading" className="jl-h2">
                You’re solo. Your crew isn’t.
              </h2>
            </div>
            <p className="jl-lede-text">
              Your driver gets the route. Your customer gets their order. Only you get the books.
            </p>
          </div>

          <div className="jl-seats-devices">
            {/* Device 1: Driver App */}
            <div className="jl-seat-device">
              <div className="jl-seat-badge">Driver App</div>
              <div className="jl-seat-screen">
                <div className="jl-seat-screen-header">Stop 04 · Rise Wilshire</div>
                <div className="jl-seat-screen-detail">Gate code #1940 · 2 bags picked up</div>
                <div className="jl-seat-screen-meta">Zero access to books or customer billing</div>
              </div>
            </div>

            {/* Device 2: Resident App */}
            <div className="jl-seat-device">
              <div className="jl-seat-badge">Customer App</div>
              <div className="jl-seat-screen">
                <div className="jl-seat-screen-header">Order #8412 · On Route</div>
                <div className="jl-seat-screen-detail">Estimated delivery: 2:15 PM</div>
                <div className="jl-seat-screen-meta">Clean direct chat · Zero admin access</div>
              </div>
            </div>

            {/* Device 3: Your Day Line */}
            <div className="jl-seat-device jl-seat-primary">
              <div className="jl-seat-badge">Your Day Line</div>
              <div className="jl-seat-screen">
                <div className="jl-seat-screen-header">Today: 3 High-Leverage Moves</div>
                <div className="jl-seat-screen-detail">$480 projected · 2 win-backs pending approval</div>
                <div className="jl-seat-screen-meta">The books, the receipts, full control</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 11. TRUST (FOUR AIRTIGHT TILES) */}
      <section className="jl-band jl-trust-section" aria-labelledby="trust-heading">
        <div className="jl-wrap">
          <div className="jl-lede">
            <div>
              <div className="jl-section-label">Trust</div>
              <h2 id="trust-heading" className="jl-h2">
                Nothing goes out without you.
              </h2>
            </div>
            <p className="jl-lede-text">
              Your companions draft, calculate, and route. You approve every message and dollar.
            </p>
          </div>

          <div className="jl-trust-grid">
            <div className="jl-trust-tile">
              <div className="jl-trust-title">Asks first</div>
              <div className="jl-trust-desc">
                Companions draft. You approve every message, invoice, and dollar before it moves.
              </div>
            </div>
            <div className="jl-trust-tile">
              <div className="jl-trust-title">Every number has a receipt</div>
              <div className="jl-trust-desc">
                Claire cannot say a figure she cannot show on your real books.
              </div>
            </div>
            <div className="jl-trust-tile">
              <div className="jl-trust-title">Pending means pending</div>
              <div className="jl-trust-desc">
                Nothing is marked confirmed until a human confirms it.
              </div>
            </div>
            <div className="jl-trust-tile">
              <div className="jl-trust-title">Your voice, your number</div>
              <div className="jl-trust-desc">
                Customers never meet a bot. Messages send from your device.
              </div>
            </div>
          </div>
          <div className="jl-trust-subline">Your books train nothing.</div>
        </div>
      </section>

      {/* 12. THE RUN (LIVE OPERATOR LEDGER) */}
      <section className="jl-band" aria-labelledby="run-heading">
        <div className="jl-wrap">
          <div className="jl-lede">
            <div>
              <div className="jl-section-label">Live proof</div>
              <h2 id="run-heading" className="jl-h2">
                Real evidence moves the world.
              </h2>
            </div>
            <p className="jl-lede-text">
              The founder playing in public is the proof. Live verified operations this week:
            </p>
          </div>

          <div className="jl-run-metrics-grid">
            {LIVE_RUN_METRICS.map((metric, i) => (
              <div key={i} className="jl-run-metric-card">
                <div className="jl-run-metric-count">{metric.count}</div>
                <div className="jl-run-metric-label">{metric.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 13. PRICING & COMMERCIAL TERMS */}
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
                  Turn my work into a game →
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

          {/* Transparent Tier Architecture */}
          <div className="jl-pricing-tiers-row">
            <div className="jl-pricing-tier">
              <div className="jl-tier-name">Explore</div>
              <div className="jl-tier-price">Free</div>
              <div className="jl-tier-desc">Sample worlds, no card required.</div>
            </div>
            <div className="jl-pricing-tier jl-tier-highlight">
              <div className="jl-tier-name">JOYSTICK</div>
              <div className="jl-tier-price">$79<span>/mo</span></div>
              <div className="jl-tier-desc">Unmetered gameplay, $40 AI allowance, overage off by default.</div>
            </div>
            <div className="jl-pricing-tier">
              <div className="jl-tier-name">Commerce</div>
              <div className="jl-tier-price">$119<span>/mo</span></div>
              <div className="jl-tier-desc">Native orders, payments, and the customer app.</div>
            </div>
            <div className="jl-pricing-tier">
              <div className="jl-tier-name">Workshop</div>
              <div className="jl-tier-price">Custom</div>
              <div className="jl-tier-desc">Custom game builds you approve one at a time.</div>
            </div>
          </div>
          <div className="jl-pricing-punchline">
            Companions aren’t a tier. You earn them.
          </div>
          <p
            className="jl-pricing-illustration"
            data-testid="landing-examples-illustration"
          >
            All customer references on this page are illustrations.
          </p>
        </div>
      </section>

      {/* 14. SEVEN COMPANIONS ROSTER & FINAL CALL */}
      <section className="jl-band jl-roster-section" aria-labelledby="roster-heading">
        <div className="jl-wrap">
          <div className="jl-lede">
            <div>
              <div className="jl-section-label">The roster</div>
              <h2 id="roster-heading" className="jl-h2">
                Meet your companions.
              </h2>
            </div>
            <p className="jl-lede-text">
              Four in the field today. Three you unlock by doing the work.
            </p>
          </div>

          <div className="jl-roster-grid">
            {ROSTER_COMPANIONS.map((companion) => (
              <div
                key={companion.name}
                className={`jl-roster-card ${companion.status === "earned" ? "is-earned" : ""}`}
              >
                <div className="jl-roster-card-top">
                  <span className="jl-roster-name" style={{ color: companion.accent }}>
                    {companion.name}
                  </span>
                  <span className="jl-roster-reason">{companion.oneWordReason}</span>
                </div>
                <div className="jl-roster-animal">{companion.animal}</div>
                <div className="jl-roster-role">{companion.role}</div>
                <div className="jl-roster-flaw">{companion.flaw}</div>
              </div>
            ))}
          </div>

          {/* Grand Finale Alone on Screen */}
          <div className="jl-final-call-box">
            <h3 className="jl-final-h3">
              Start with the door you keep driving past.
            </h3>
            <a
              className="jl-cta-button jl-final-cta"
              href={START_PATH}
              onClick={() =>
                captureProductEvent("joystick_start_clicked", {
                  source: "landing_footer_cta",
                })
              }
            >
              Turn my work into a game →
            </a>
          </div>
        </div>
      </section>

      {/* 15. FOOTER */}
      <footer className="jl-footer">
        <div className="jl-wrap jl-footer-row">
          <div className="jl-footer-brand">
            <span className="jl-footer-title">Joystick</span>
            <span className="jl-footer-copy">Real work. Playable.</span>
          </div>
          <div className="jl-footer-links">
            <a href="#games">The games</a>
            <a href="#day-line">The Day Line</a>
            <a href="#receipts">Receipts</a>
            <a href="#pricing">Pricing</a>
            <a href="#trust">Trust</a>
            <a href="/patch-notes">Patch notes</a>
            <a href="/field-guide">Field guide</a>
            <a href="/press">Press</a>
            <a href="https://x.com" target="_blank" rel="noopener noreferrer">
              X
            </a>
            <a href="/dayforge-login">Sign in</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
