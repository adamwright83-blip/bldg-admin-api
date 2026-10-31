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

const S_HERO = {
  stroke: "#161616",
  strokeWidth: "3.4",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function renderHeroPersonArt(key: string) {
  switch (key) {
    case "adam":
      return (
        <svg viewBox="0 0 124 144" fill="none" style={{ height: "210px", width: "auto", maxWidth: "92%" }} aria-hidden="true">
          <path d="M62 22 C 40 22, 28 42, 30 64 C 32 88, 46 102, 64 102 C 82 102, 96 88, 98 64 C 100 42, 86 22, 62 22 Z" {...S_HERO} />
          <path d="M32 50 C 36 30, 56 24, 72 26 C 88 28, 96 40, 96 50" {...S_HERO} />
          <path d="M34 48 C 50 42, 78 42, 96 48" {...S_HERO} />
          <path d="M92 44 L 118 40 L 110 50" fill="#cfc6b4" {...S_HERO} />
          <path d="M22 144 C 26 114, 42 106, 64 106 C 86 106, 100 114, 104 144" {...S_HERO} />
          <path d="M46 62 q6 -6 12 0 M70 62 q6 -6 12 0" {...S_HERO} />
          <path d="M54 80 q10 8 20 0" {...S_HERO} />
        </svg>
      );
    case "daisy":
      return (
        <svg viewBox="0 0 124 144" fill="none" style={{ height: "210px", width: "auto", maxWidth: "92%" }} aria-hidden="true">
          <path d="M62 22 C 40 22, 28 42, 30 64 C 32 88, 46 102, 64 102 C 82 102, 96 88, 98 64 C 100 42, 86 22, 62 22 Z" {...S_HERO} />
          <path d="M30 60 C 22 92, 26 116, 34 126 M98 60 C 106 92, 102 116, 94 126" {...S_HERO} />
          <path d="M34 44 C 44 30, 80 28, 94 44" {...S_HERO} />
          <path d="M22 144 C 26 114, 42 106, 64 106 C 86 106, 100 114, 104 144" {...S_HERO} />
          <path d="M46 62 q6 -6 12 0 M70 62 q6 -6 12 0" {...S_HERO} />
          <path d="M54 80 q10 8 20 0" {...S_HERO} />
        </svg>
      );
    case "shawn":
      return (
        <svg viewBox="0 0 124 144" fill="none" style={{ height: "210px", width: "auto", maxWidth: "92%" }} aria-hidden="true">
          <path d="M62 22 C 40 22, 28 42, 30 64 C 32 88, 46 102, 64 102 C 82 102, 96 88, 98 64 C 100 42, 86 22, 62 22 Z" {...S_HERO} />
          <path d="M40 36 C 50 22, 76 22, 86 36" {...S_HERO} />
          <path d="M30 60 L24 70 M98 60 L104 70" {...S_HERO} />
          <path d="M22 144 C 26 114, 42 106, 64 106 C 86 106, 100 114, 104 144" {...S_HERO} />
          <path d="M46 62 q6 -6 12 0 M70 62 q6 -6 12 0" {...S_HERO} />
          <path d="M54 80 q10 8 20 0" {...S_HERO} />
        </svg>
      );
    case "tj":
      return (
        <svg viewBox="0 0 124 144" fill="none" style={{ height: "210px", width: "auto", maxWidth: "92%" }} aria-hidden="true">
          <path d="M62 22 C 40 22, 28 42, 30 64 C 32 88, 46 102, 64 102 C 82 102, 96 88, 98 64 C 100 42, 86 22, 62 22 Z" {...S_HERO} />
          <path d="M36 40 L92 40 M44 40 C 48 30, 76 30, 84 40" {...S_HERO} />
          <path d="M22 144 C 26 114, 42 106, 64 106 C 86 106, 100 114, 104 144" {...S_HERO} />
          <path d="M46 62 q6 -6 12 0 M70 62 q6 -6 12 0" {...S_HERO} />
          <path d="M54 80 q10 8 20 0" {...S_HERO} />
        </svg>
      );
    default:
      return null;
  }
}

function renderHeroCompArt(key: string, accent: string) {
  switch (key) {
    case "adam":
      return (
        <svg viewBox="0 0 124 144" fill="none" style={{ height: "210px", width: "auto", maxWidth: "92%" }} aria-hidden="true">
          <path d="M34 46 C 36 24, 88 24, 90 46 Z" fill={accent} {...S_HERO} />
          <path d="M24 48 L100 48 L96 54 L28 54 Z" fill={accent} {...S_HERO} />
          <path d="M38 56 C 30 80, 34 112, 62 118 C 90 112, 94 80, 86 56 Z" fill="#fff" {...S_HERO} />
          <circle cx="52" cy="68" r="9" fill="#fff" {...S_HERO} />
          <circle cx="74" cy="68" r="9" fill="#fff" {...S_HERO} />
          <path d="M61 68 h4" {...S_HERO} />
          <path d="M83 70 L104 66 L86 78 Z" fill="#fff" {...S_HERO} />
          <path d="M40 86 C 26 92, 24 106, 36 108" {...S_HERO} />
          <rect x="56" y="88" width="28" height="20" rx="2" fill="#fff" {...S_HERO} />
          <path d="M56 118 L54 136 M70 118 L72 136 M46 136 h14 M66 136 h14" {...S_HERO} />
        </svg>
      );
    case "daisy":
      return (
        <svg viewBox="0 0 124 144" fill="none" style={{ height: "210px", width: "auto", maxWidth: "92%" }} aria-hidden="true">
          <path d="M40 44 L34 14 L56 30 Z M84 44 L90 14 L68 30 Z" fill={accent} {...S_HERO} />
          <circle cx="62" cy="48" r="24" fill={accent} {...S_HERO} />
          <path d="M53 46 q3 -3 6 0 M65 46 q3 -3 6 0 M58 56 q4 3 8 0" {...S_HERO} />
          <path d="M44 52 L30 50 M44 56 L30 58 M80 52 L94 50 M80 56 L94 58" {...S_HERO} />
          <path d="M42 80 C 36 100, 40 120, 62 122 C 84 120, 88 100, 82 80" {...S_HERO} />
          <rect x="48" y="92" width="30" height="20" fill="#fff" {...S_HERO} />
          <path d="M53 99 h20 M53 105 h14" {...S_HERO} />
          <path d="M84 110 C 100 112, 104 96, 96 90" {...S_HERO} />
          <path d="M54 122 L54 138 M70 122 L70 138" {...S_HERO} />
        </svg>
      );
    case "shawn":
      return (
        <svg viewBox="0 0 124 144" fill="none" style={{ height: "210px", width: "auto", maxWidth: "92%" }} aria-hidden="true">
          <path d="M48 44 C 40 20, 44 4, 54 6 C 62 8, 60 30, 58 44 Z M76 44 C 84 20, 80 4, 70 6 C 62 8, 64 30, 66 44 Z" fill={accent} {...S_HERO} />
          <circle cx="62" cy="60" r="22" fill={accent} {...S_HERO} />
          <path d="M54 58 q3 -3 6 0 M66 58 q3 -3 6 0 M58 68 q4 3 8 0" {...S_HERO} />
          <path d="M44 86 C 38 104, 42 120, 62 122 C 82 120, 86 104, 80 86" {...S_HERO} />
          <rect x="80" y="84" width="28" height="28" fill="#fff" {...S_HERO} />
          <path d="M80 98 L74 96" {...S_HERO} />
          <path d="M54 122 L54 138 M70 122 L70 138" {...S_HERO} />
        </svg>
      );
    case "tj":
      return (
        <svg viewBox="0 0 124 144" fill="none" style={{ height: "210px", width: "auto", maxWidth: "92%" }} aria-hidden="true">
          <path d="M36 40 C 24 44, 22 66, 34 70 Z M80 40 C 92 44, 94 66, 82 70 Z" fill={accent} {...S_HERO} />
          <circle cx="58" cy="46" r="22" fill={accent} {...S_HERO} />
          <path d="M50 44 q3 -3 6 0 M62 44 q3 -3 6 0" {...S_HERO} />
          <path d="M52 56 C 56 62, 64 62, 66 56 Z" fill="#161616" {...S_HERO} />
          <path d="M42 74 C 36 96, 40 118, 58 120 C 78 118, 82 96, 76 74" {...S_HERO} />
          <path d="M96 56 L96 126" {...S_HERO} />
          <path d="M96 62 L120 58 L116 70 L96 72 Z M96 82 L74 86 L78 96 L96 94 Z" fill="#fff" {...S_HERO} />
          <path d="M50 120 L50 138 M66 120 L66 138" {...S_HERO} />
          <path d="M40 108 C 28 104, 26 94, 34 90" {...S_HERO} />
        </svg>
      );
    default:
      return null;
  }
}

function renderHeroScene(key: string, accent: string) {
  switch (key) {
    case "adam":
      return (
        <svg viewBox="0 0 420 112" aria-hidden="true">
          <circle cx="70" cy="46" r="34" />
          <path d="M70 46 L70 24 M70 46 L86 56" />
          <path d="M58 46 h-6 M82 46 h6 M70 34 v-6 M70 58 v6" />
          <path d="M110 108 h300 M140 108 V70 h120 V108 M150 70 V56 h100 V70" />
          <path d="M300 20 V108" />
          <path className="ac" d="M300 20 L350 28 L300 36 Z" fill={accent} />
          <path d="M190 80 h20 M190 90 h30" />
          <path d="M380 108 C 376 90, 384 80, 396 86" />
        </svg>
      );
    case "daisy":
      return (
        <svg viewBox="0 0 420 112" aria-hidden="true">
          <path d="M10 30 C 90 8, 170 48, 250 20 C 320 0, 380 30, 414 18" />
          <path className="ac" d="M60 24 l8 14 h-16 Z M150 36 l8 14 h-16 Z M240 22 l8 14 h-16 Z M330 20 l8 14 h-16 Z" fill={accent} />
          <ellipse cx="210" cy="78" rx="110" ry="14" />
          <path d="M120 80 V108 M300 80 V108 M210 92 V108" />
          <path d="M170 72 C 172 60, 190 60, 192 72 M230 72 C 232 60, 250 60, 252 72" />
          <path d="M60 108 C 58 96, 70 92, 78 100" />
        </svg>
      );
    case "shawn":
      return (
        <svg viewBox="0 0 420 112" aria-hidden="true">
          <rect x="40" y="10" width="90" height="26" rx="6" />
          <path className="ac" d="M52 23 h66" style={{ stroke: accent, strokeWidth: 5, fill: "none" }} />
          <rect x="200" y="30" width="80" height="48" rx="8" />
          <path d="M280 44 L310 30 V78 L280 64 Z" />
          <circle cx="222" cy="22" r="12" />
          <circle cx="252" cy="22" r="12" />
          <path d="M240 78 L224 108 M240 78 L256 108 M240 78 V108" />
          <path d="M340 60 h60 v30 h-60 Z M340 60 L348 46 h52 L400 60" />
          <path d="M348 52 l6 8 M362 52 l6 8 M376 52 l6 8" />
        </svg>
      );
    case "tj":
      return (
        <svg viewBox="0 0 420 112" aria-hidden="true">
          <ellipse cx="300" cy="46" rx="40" ry="18" />
          <path d="M300 28 V14 M250 14 h100 M300 46 L240 40 M236 34 v14" />
          <path d="M276 64 L270 76 h60 L324 64" />
          <path d="M40 108 h360" />
          <path d="M60 108 V60 L90 48 L120 60 V108" />
          <path className="ac" d="M72 108 V90 h20 v18 Z" fill={accent} />
          <path d="M160 108 V50" />
          <path d="M160 50 L140 84 h40 Z" />
          <path d="M160 62 v12 M160 78 v2" />
          <path d="M200 100 C 230 92, 250 100, 280 92 C 310 84, 340 96, 370 90" />
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

  // Hero work mode selection ("cozy" or "road") and status
  const [selectedWorkMode, setSelectedWorkMode] = useState<"cozy" | "road" | null>(null);
  const [tileStatus, setTileStatus] = useState<string>("");

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

  // Section 6: Lantern City landmark state (1 = Maya R, 2 = Rise Wilshire, 3 = CPE)
  const [activeLanternLandmark, setActiveLanternLandmark] = useState<number>(1);

  // Section 7: Dossier page state ("clue" | "mission")
  const [dossierPage, setDossierPage] = useState<"clue" | "mission">("clue");

  // Section 8: Connectors transmutation pipeline trigger (0 = CleanCloud, 1 = Stripe, 2 = Square)
  const [activePipelineTrigger, setActivePipelineTrigger] = useState<number>(0);

  // Section 10: Seats living handoff dispatch trigger
  const [isSeatsDispatched, setIsSeatsDispatched] = useState<boolean>(false);

  // Section 11: Trust mechanical approval slate states
  const [trustTime, setTrustTime] = useState<"8:00 AM" | "9:00 AM">("8:00 AM");
  const [isTrustApproved, setIsTrustApproved] = useState<boolean>(false);

  // Section 12: Live proof founder clipboard dispatch log tab (0 = Silver Lake, 1 = CPE, 2 = Wilshire)
  const [activeDispatchTab, setActiveDispatchTab] = useState<number>(0);


  useEffect(() => {
    captureProductEvent("landing_page_visited", {
      path: typeof window !== "undefined" ? window.location.pathname : "/joystick",
      source: "joystick_landing",
    });
    captureProductEvent("landing_pricing_viewed", {
      monthly_usd: 79,
      trial_days: 0,
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

  const handleSelectWorkMode = (mode: "cozy" | "road") => {
    setSelectedWorkMode(mode);
    setRotationPausedUntil(Date.now() + 10000);
    const statusMsg = (mode === "cozy" ? "Indoors, cozy" : "Out on the road") + " selected. Opening your game…";
    setTileStatus(statusMsg);
    captureProductEvent("hero_game_tile_clicked", { mode });
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        window.location.href = `${START_PATH}?mode=${encodeURIComponent(mode)}`;
      }, 400);
    }
  };

  const handleStartJoystick = (mode?: string) => {
    captureProductEvent("hero_start_clicked", { source: "hero_tile", mode: mode || "cozy" });
    if (typeof window !== "undefined") {
      const target = mode ? `${START_PATH}?mode=${encodeURIComponent(mode)}` : START_PATH;
      window.location.href = target;
    }
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

      {/* 2. HERO: Three columns: Headline | Rotating Persona + Companion Pair | Game Pick CTA */}
      <section
        className="jl-hero jl-wrap"
        aria-label="Joystick — Knows your business, then makes your next move a game."
        onPointerEnter={() => setIsHoveringHero(true)}
        onPointerLeave={() => setIsHoveringHero(false)}
      >
        <h1 className="jl-hero-h1">
          <svg className="spark h1" viewBox="0 0 34 34" aria-hidden="true">
            <g stroke="#e9a100" strokeWidth="3" strokeLinecap="round">
              <path d="M6 27 L14 19" />
              <path d="M4 14 L13 15" />
              <path d="M15 5 L16 14" />
            </g>
          </svg>
          <span className="jl-hero-line-chunk">Knows your</span>
          <span className="jl-hero-line-chunk">business,</span>
          <span className="jl-hero-line-chunk">then makes</span>
          <span className="jl-hero-line-chunk">your next move</span>
          <span className="u jl-hero-line-chunk">
            a game.
            <svg viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true">
              <path
                d="M4 9 C 60 4, 140 14, 296 7"
                stroke={currentPersona.accent}
                strokeWidth="7"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M14 16 C 70 12, 110 19, 180 14"
                stroke={currentPersona.accent}
                strokeWidth="5"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </h1>

        <div className="jl-pairwrap">
          <svg className="spark c1" viewBox="0 0 34 34" aria-hidden="true">
            <g stroke="#161616" strokeWidth="3" strokeLinecap="round">
              <path d="M6 27 L14 19" />
              <path d="M4 14 L13 15" />
              <path d="M15 5 L16 14" />
            </g>
          </svg>
          <svg className="spark c2" viewBox="0 0 34 34" aria-hidden="true">
            <g stroke="#161616" strokeWidth="3" strokeLinecap="round">
              <path d="M6 27 L14 19" />
              <path d="M4 14 L13 15" />
              <path d="M15 5 L16 14" />
            </g>
          </svg>
          <div className="jl-pair" aria-live="polite">
            <div
              className="jl-card jl-person"
              style={{ background: currentPersona.paper }}
            >
              <div className="tape" />
              <div className="art jl-fade" style={{ opacity: fadeOpacity }}>
                {renderHeroPersonArt(currentPersona.key)}
              </div>
              <div className="cap jl-fade" style={{ opacity: fadeOpacity }}>
                {currentPersona.caption.split(". ")[0]}.
                <span className="flaw">{currentPersona.caption.split(". ")[1]}</span>
                <span className="ul" style={{ background: currentPersona.accent }} />
              </div>
            </div>

            <div
              className="jl-card jl-comp"
              style={{ background: currentPersona.paper }}
            >
              <div className="tape" />
              <div className="art jl-fade" style={{ opacity: fadeOpacity }}>
                {renderHeroCompArt(currentPersona.key, currentPersona.accent)}
              </div>
              <div className="cap jl-fade" style={{ opacity: fadeOpacity }}>
                <span className="name" style={{ color: currentPersona.accent }}>
                  {currentPersona.companion}
                </span>
                {currentPersona.companionGift}
                <span className="flaw">{currentPersona.companionFlaw}</span>
                <span className="ul" style={{ background: currentPersona.accent }} />
              </div>
            </div>
          </div>

          <div className="jl-dots" role="tablist" aria-label="People">
            {PERSONAS.map((p, idx) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-label={p.name}
                aria-current={idx === state.index ? "true" : "false"}
                onClick={() => handleDotClick(idx)}
              />
            ))}
          </div>

          <p className="jl-line jl-fade" style={{ opacity: fadeOpacity }}>
            {currentPersona.oneLiner}
          </p>

          <div className="jl-scene jl-fade" style={{ opacity: fadeOpacity }} aria-hidden="true">
            {renderHeroScene(currentPersona.key, currentPersona.accent)}
          </div>
        </div>

        <div className="jl-pick" role="group" aria-labelledby="pk">
          <h2 id="pk">How do you work?</h2>

          <button
            type="button"
            className="jl-tile"
            aria-pressed={selectedWorkMode === "cozy" ? "true" : "false"}
            onClick={() => handleSelectWorkMode("cozy")}
          >
            <img
              src="/joystick/gameplay/tile-cozy-silver-lake.jpg"
              alt="Silver Lake: cozy village with lanterns and villagers"
            />
            <span className="shade" />
            <span className="ring" />
            <span className="tag">gameplay still · Silver Lake</span>
            <span className="txt">
              <b>Indoors, cozy?</b>
              <small>Villagers, lanterns, letters to write.</small>
            </span>
          </button>

          <p className="jl-or">or</p>

          <button
            type="button"
            className="jl-tile"
            aria-pressed={selectedWorkMode === "road" ? "true" : "false"}
            onClick={() => handleSelectWorkMode("road")}
          >
            <img
              src="/joystick/gameplay/tile-road-colosseum.jpg"
              alt="The Colosseum: Clockhead and front desks on the road"
            />
            <span className="shade" />
            <span className="ring" />
            <span className="tag">gameplay still · the Colosseum</span>
            <span className="txt">
              <b>Out on the road?</b>
              <small>Front desks, building managers, the clock.</small>
            </span>
          </button>

          <div className="jl-turn-on-cta">
            <button
              type="button"
              className="jl-btn-turn-on"
              onClick={() => handleStartJoystick(selectedWorkMode || "cozy")}
            >
              {selectedWorkMode === "cozy"
                ? "Play in Silver Lake →"
                : selectedWorkMode === "road"
                ? "Play on the Road →"
                : "Turn my work into a game →"}
            </button>
            <p className="jl-fine">3 questions. No account required.</p>
            {tileStatus && <p className="jl-status" aria-live="polite">{tileStatus}</p>}
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

      {/* 6. THE CITY (LANTERN CITY — INTERACTIVE STORYBOOK DIORAMA) */}
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

          <div className="jl-city-diorama-container">
            {/* The Storybook Visual Diorama */}
            <div className="jl-city-diorama-viewport">
              <img
                src="/joystick/lantern-city-diorama.jpg"
                alt="Lantern City: A cozy storybook neighborhood diorama with craftsman cottages and warm glowing amber lanterns on front porches"
                className="jl-city-diorama-img"
                loading="lazy"
              />

              {/* Ambient Mist & Twilight Overlay */}
              <div className="jl-city-diorama-vignette" />

              {/* Landmark Pin 1: Maya R.'s Cottage */}
              <button
                type="button"
                className={`jl-landmark-pin jl-pin-maya ${activeLanternLandmark === 1 ? "is-active" : ""}`}
                onClick={() => setActiveLanternLandmark(1)}
                aria-label="Maya R. cottage landmark in Silver Lake"
              >
                <span className="jl-pin-pulse" />
                <span className="jl-pin-lantern-icon">🏮</span>
                <span className="jl-pin-label">Maya R. · Quiet</span>
              </button>

              {/* Landmark Pin 2: Rise Wilshire */}
              <button
                type="button"
                className={`jl-landmark-pin jl-pin-rise ${activeLanternLandmark === 2 ? "is-active" : ""}`}
                onClick={() => setActiveLanternLandmark(2)}
                aria-label="Rise Wilshire multi-unit prospect corridor"
              >
                <span className="jl-pin-pulse" />
                <span className="jl-pin-lantern-icon">🏮</span>
                <span className="jl-pin-label">Rise Wilshire · 24 Units</span>
              </button>

              {/* Landmark Pin 3: Century Park East */}
              <button
                type="button"
                className={`jl-landmark-pin jl-pin-cpe ${activeLanternLandmark === 3 ? "is-active" : ""}`}
                onClick={() => setActiveLanternLandmark(3)}
                aria-label="Century Park East executive win-back tower"
              >
                <span className="jl-pin-pulse" />
                <span className="jl-pin-lantern-icon">🏮</span>
                <span className="jl-pin-label">Tower B · 8 Quiet</span>
              </button>

              {/* Unfurling Paper Mission Docket Overlay */}
              <div className="jl-diorama-mission-docket">
                <div className="jl-docket-header">
                  <div className="jl-docket-tag">
                    {activeLanternLandmark === 1 && "SILVER LAKE SECTOR · REUNION MISSION"}
                    {activeLanternLandmark === 2 && "WILSHIRE CORRIDOR · PROSPECT MISSION"}
                    {activeLanternLandmark === 3 && "CENTURY PARK EAST · WIN-BACK"}
                  </div>
                  <div className="jl-docket-companion">
                    {activeLanternLandmark === 1 && "Sable (Recall) in field"}
                    {activeLanternLandmark === 2 && "Rook (Contact) in field"}
                    {activeLanternLandmark === 3 && "Orren (Route) in field"}
                  </div>
                </div>

                <div className="jl-docket-body">
                  {activeLanternLandmark === 1 && (
                    <>
                      <h4 className="jl-docket-title">Maya R. · 78 Days Quiet</h4>
                      <p className="jl-docket-desc">
                        Ordered weekly for 2 years ($48 avg). Paused when the delivery window moved from Tuesday afternoons to mornings. Her porch lantern is lit.
                      </p>
                      <div className="jl-docket-metric-row">
                        <div className="jl-docket-metric">
                          <span className="jl-metric-label">Recoverable Revenue</span>
                          <span className="jl-metric-val">+$2,490 / yr</span>
                        </div>
                        <div className="jl-docket-metric">
                          <span className="jl-metric-label">Route Detour</span>
                          <span className="jl-metric-val">0.1 mi (Tuesday loop)</span>
                        </div>
                      </div>
                      <a
                        href={START_PATH}
                        className="jl-docket-action"
                        onClick={() => captureProductEvent("city_mission_previewed", { landmark: "maya" })}
                      >
                        Preview Claire&apos;s Opener →
                      </a>
                    </>
                  )}

                  {activeLanternLandmark === 2 && (
                    <>
                      <h4 className="jl-docket-title">Rise Wilshire · 24 Residential Doors</h4>
                      <p className="jl-docket-desc">
                        Directly on your Tuesday van path. Building manager changed last month; resident flyer rack is open. Rook drafted a neighborhood intro note.
                      </p>
                      <div className="jl-docket-metric-row">
                        <div className="jl-docket-metric">
                          <span className="jl-metric-label">Target Density</span>
                          <span className="jl-metric-val">24 doors / 1 stop</span>
                        </div>
                        <div className="jl-docket-metric">
                          <span className="jl-metric-label">Projected Value</span>
                          <span className="jl-metric-val">+$1,150 / mo</span>
                        </div>
                      </div>
                      <a
                        href={START_PATH}
                        className="jl-docket-action"
                        onClick={() => captureProductEvent("city_mission_previewed", { landmark: "rise" })}
                      >
                        Preview Route Tag →
                      </a>
                    </>
                  )}

                  {activeLanternLandmark === 3 && (
                    <>
                      <h4 className="jl-docket-title">Century Park East · The Velvet Gate</h4>
                      <p className="jl-docket-desc">
                        8 executive residents stopped pickups when the security desk changed concierge protocols. Orren mapped an approved ground-level delivery protocol.
                      </p>
                      <div className="jl-docket-metric-row">
                        <div className="jl-docket-metric">
                          <span className="jl-metric-label">Dormant Accounts</span>
                          <span className="jl-metric-val">8 verified VIPs</span>
                        </div>
                        <div className="jl-docket-metric">
                          <span className="jl-metric-label">Recoverable Revenue</span>
                          <span className="jl-metric-val">+$420 / mo</span>
                        </div>
                      </div>
                      <a
                        href={START_PATH}
                        className="jl-docket-action"
                        onClick={() => captureProductEvent("city_mission_previewed", { landmark: "cpe" })}
                      >
                        Review Protocol Move →
                      </a>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Landmark Selector Pills */}
            <div className="jl-landmark-tabs" role="tablist">
              <button
                type="button"
                className={`jl-landmark-tab ${activeLanternLandmark === 1 ? "is-active" : ""}`}
                onClick={() => setActiveLanternLandmark(1)}
              >
                <span className="jl-tab-dot" />
                Maya R. (Silver Lake Cottage)
              </button>
              <button
                type="button"
                className={`jl-landmark-tab ${activeLanternLandmark === 2 ? "is-active" : ""}`}
                onClick={() => setActiveLanternLandmark(2)}
              >
                <span className="jl-tab-dot" />
                Rise Wilshire (24-Door Corridor)
              </button>
              <button
                type="button"
                className={`jl-landmark-tab ${activeLanternLandmark === 3 ? "is-active" : ""}`}
                onClick={() => setActiveLanternLandmark(3)}
              >
                <span className="jl-tab-dot" />
                Century Park East (The Velvet Gate)
              </button>
            </div>

            <div className="jl-city-hud">
              <span className="jl-city-hud-indicator" />
              <span>Lantern City active · 142 doors walked this week · 8 quiet doors ready for Claire&apos;s call</span>
            </div>
          </div>
        </div>
      </section>

      {/* 7. THE DOSSIER (MANILA CASE FILE WITH RECEIPT & GREASE PENCIL) */}
      <section id="dossier" className="jl-band" aria-labelledby="dossier-heading">
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

          <div className="jl-dossier-casefile-wrap">
            {/* The Manila Folder Header */}
            <div className="jl-casefile-folder">
              <div className="jl-casefile-tab-top">
                <span className="jl-brass-clip" aria-hidden="true" />
                <span className="jl-casefile-serial">FILE #042 · CONFIDENTIAL OPERATOR DOSSIER</span>
                <span className="jl-casefile-stamp">RECEIPT BACKED</span>
              </div>

              {/* Dossier Business Sector Selector */}
              <div className="jl-dossier-sector-bar">
                {DOSSIER_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`jl-dossier-sector-btn ${activeDossierTab === tab.id ? "is-active" : ""}`}
                    onClick={() => setActiveDossierTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Interactive Page Switcher */}
              <div className="jl-casefile-spread">
                <div className="jl-casefile-nav">
                  <button
                    type="button"
                    className={`jl-casefile-nav-btn ${dossierPage === "clue" ? "is-active" : ""}`}
                    onClick={() => setDossierPage("clue")}
                  >
                    1. The Neglected Receipt
                  </button>
                  <button
                    type="button"
                    className={`jl-casefile-nav-btn ${dossierPage === "mission" ? "is-active" : ""}`}
                    onClick={() => setDossierPage("mission")}
                  >
                    2. Claire&apos;s Playable Move →
                  </button>
                </div>

                {dossierPage === "clue" ? (
                  <div className="jl-casefile-page jl-page-clue">
                    <div className="jl-clue-layout">
                      {/* Crinkled Thermal POS Register Receipt */}
                      <div className="jl-thermal-receipt">
                        <div className="jl-receipt-jagged-top" />
                        <div className="jl-thermal-header">
                          <div className="jl-thermal-shop">CLEANCLOUD POS · REGISTER #02</div>
                          <div className="jl-thermal-id">{activeDossier.operator}</div>
                        </div>
                        <div className="jl-thermal-divider">- - - - - - - - - - - - - - - - - - -</div>
                        <div className="jl-thermal-row">
                          <span>WHO WENT QUIET:</span>
                          <strong>{activeDossier.quiet}</strong>
                        </div>
                        <div className="jl-thermal-row">
                          <span>WHAT&apos;S OWED:</span>
                          <span>{activeDossier.owed}</span>
                        </div>
                        <div className="jl-thermal-row">
                          <span>AVERAGE TICKET:</span>
                          <span>{activeDossier.ticket}</span>
                        </div>
                        <div className="jl-thermal-row">
                          <span>THE GOAL:</span>
                          <strong>{activeDossier.goal}</strong>
                        </div>
                        <div className="jl-thermal-divider">- - - - - - - - - - - - - - - - - - -</div>
                        <div className="jl-thermal-highlight">
                          <span className="jl-grease-pencil">SKIPPED MOVE: {activeDossier.skipped}</span>
                        </div>
                        <div className="jl-thermal-divider">- - - - - - - - - - - - - - - - - - -</div>
                        <div className="jl-thermal-footer">
                          VERIFIED BOOK ENTRY · TAX LEDGER MATCHED
                        </div>
                        <div className="jl-receipt-jagged-bottom" />
                      </div>

                      {/* Paperclipped Note from Claire */}
                      <div className="jl-claire-pinned-note">
                        <div className="jl-paperclip" aria-hidden="true" />
                        <div className="jl-claire-note-tag">Claire&apos;s Field Note</div>
                        <p className="jl-claire-note-handwriting">
                          &ldquo;She tipped $12 every single Tuesday for two straight years. She didn&apos;t leave you because of price. You stopped showing up on her street when the delivery route shifted east. She&apos;s not lost. She&apos;s waiting.&rdquo;
                        </p>
                        <div className="jl-claire-note-meta">
                          — Claire · Verified from POS ticket #8412
                        </div>
                        <button
                          type="button"
                          className="jl-casefile-flip-btn"
                          onClick={() => setDossierPage("mission")}
                        >
                          Turn page to the move she built →
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="jl-casefile-page jl-page-mission">
                    <div className="jl-mission-reveal">
                      <div className="jl-mission-card-badge">PLAYABLE MOVE #01</div>
                      <h3 className="jl-mission-reveal-title">
                        Tuesday Afternoon Reunion Knock
                      </h3>
                      <p className="jl-mission-reveal-desc">
                        Claire reconstructed the route. On Tuesday at 1:45 PM, your van passes Maya&apos;s porch with zero extra transit time. Sable drafted the personal note:
                      </p>
                      <blockquote className="jl-mission-draft-quote">
                        &ldquo;Hey Maya — noticed we missed your Tuesday pickups since the route shifted. We&apos;re back on your block every Tuesday afternoon starting tomorrow. First pickup is on us.&rdquo;
                      </blockquote>
                      <div className="jl-mission-economics">
                        <div className="jl-econ-item">
                          <span className="jl-econ-num">+$2,490</span>
                          <span className="jl-econ-label">Annual LTV saved</span>
                        </div>
                        <div className="jl-econ-item">
                          <span className="jl-econ-num">$0.00</span>
                          <span className="jl-econ-label">Ad spend required</span>
                        </div>
                        <div className="jl-econ-item">
                          <span className="jl-econ-num">1 tap</span>
                          <span className="jl-econ-label">Approval on Day Line</span>
                        </div>
                      </div>
                      <div className="jl-mission-reveal-footer">
                        <button
                          type="button"
                          className="jl-casefile-back-btn"
                          onClick={() => setDossierPage("clue")}
                        >
                          ← Back to the receipt clue
                        </button>
                        <a href={START_PATH} className="jl-cta-button">
                          Play moves like this on my books →
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 8. CONNECTORS (3-BEAT TRANSMUTATION PIPELINE) */}
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

          <div className="jl-transmutation-container">
            {/* Trigger Selector */}
            <div className="jl-pipeline-triggers" role="tablist">
              <button
                type="button"
                className={`jl-pipeline-trigger-btn ${activePipelineTrigger === 0 ? "is-active" : ""}`}
                onClick={() => setActivePipelineTrigger(0)}
              >
                1. CleanCloud POS (Dry Cleaning &amp; Laundry)
              </button>
              <button
                type="button"
                className={`jl-pipeline-trigger-btn ${activePipelineTrigger === 1 ? "is-active" : ""}`}
                onClick={() => setActivePipelineTrigger(1)}
              >
                2. Stripe Billing (Customer Churn Webhook)
              </button>
              <button
                type="button"
                className={`jl-pipeline-trigger-btn ${activePipelineTrigger === 2 ? "is-active" : ""}`}
                onClick={() => setActivePipelineTrigger(2)}
              >
                3. Square Register (Overdue Invoices)
              </button>
            </div>

            {/* 3-Beat Horizontal Pipeline */}
            <div className="jl-pipeline-stage">
              {/* Beat 1: Raw Business Signal */}
              <div className="jl-pipeline-beat jl-beat-raw">
                <div className="jl-beat-header">
                  <span className="jl-beat-num">BEAT 1</span>
                  <span className="jl-beat-title">Raw Business Signal</span>
                </div>
                <div className="jl-beat-content">
                  {activePipelineTrigger === 0 && (
                    <div className="jl-raw-slip">
                      <div className="jl-slip-badge">CleanCloud POS Event</div>
                      <div className="jl-slip-code">
                        <code>
                          ORDER_ID: 8412<br />
                          CUSTOMER: Maya R.<br />
                          DELTA: 78_DAYS_INACTIVE<br />
                          HIST_SPEND: $5,450
                        </code>
                      </div>
                      <p className="jl-slip-caption">Raw transactions stream directly from your store register.</p>
                    </div>
                  )}
                  {activePipelineTrigger === 1 && (
                    <div className="jl-raw-slip">
                      <div className="jl-slip-badge">Stripe Webhook Event</div>
                      <div className="jl-slip-code">
                        <code>
                          EVENT: sub.canceled<br />
                          CUSTOMER: Dr. Aris Thorne<br />
                          PLAN: $420_MONTHLY_TIER<br />
                          REASON: schedule_conflict
                        </code>
                      </div>
                      <p className="jl-slip-caption">Real webhook payloads caught at the second of churn.</p>
                    </div>
                  )}
                  {activePipelineTrigger === 2 && (
                    <div className="jl-raw-slip">
                      <div className="jl-slip-badge">Square Register Event</div>
                      <div className="jl-slip-code">
                        <code>
                          INVOICE: #0194<br />
                          CUSTOMER: Rise Commercial<br />
                          AGING: 42_DAYS_OVERDUE<br />
                          BALANCE: $680.00
                        </code>
                      </div>
                      <p className="jl-slip-caption">Aged accounts receivable extracted from counter POS.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Arrow Connector */}
              <div className="jl-pipeline-arrow" aria-hidden="true">
                <span>→</span>
              </div>

              {/* Beat 2: Claire's Ink Lens */}
              <div className="jl-pipeline-beat jl-beat-lens">
                <div className="jl-beat-header">
                  <span className="jl-beat-num">BEAT 2</span>
                  <span className="jl-beat-title">Claire&apos;s Ink Lens</span>
                </div>
                <div className="jl-beat-content">
                  <div className="jl-lens-circle">
                    <span className="jl-lens-tag">Operational Signal Found</span>
                    {activePipelineTrigger === 0 && (
                      <p className="jl-lens-quote">
                        &ldquo;Maya didn&apos;t leave over quality. Your van is 0.1 miles away on Tuesdays. Route overlap found.&rdquo;
                      </p>
                    )}
                    {activePipelineTrigger === 1 && (
                      <p className="jl-lens-quote">
                        &ldquo;Dr. Thorne canceled because his clinic opens at 8 AM. We have an open van slot at 7:45 AM.&rdquo;
                      </p>
                    )}
                    {activePipelineTrigger === 2 && (
                      <p className="jl-lens-quote">
                        &ldquo;Rise property manager is on site every Thursday. Rook drafted a courteous payment docket.&rdquo;
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Arrow Connector */}
              <div className="jl-pipeline-arrow" aria-hidden="true">
                <span>→</span>
              </div>

              {/* Beat 3: Playable Quest Card */}
              <div className="jl-pipeline-beat jl-beat-card">
                <div className="jl-beat-header">
                  <span className="jl-beat-num">BEAT 3</span>
                  <span className="jl-beat-title">Playable Move Built</span>
                </div>
                <div className="jl-beat-content">
                  <div className="jl-quest-card">
                    <div className="jl-quest-top">
                      <span className="jl-quest-badge">READY ON DAY LINE</span>
                      <span className="jl-quest-icon">⚡</span>
                    </div>
                    {activePipelineTrigger === 0 && (
                      <>
                        <h4 className="jl-quest-name">Reunion Knock · Silver Lake</h4>
                        <div className="jl-quest-impact">+$310 / mo recovered</div>
                        <p className="jl-quest-micro">Sable drafted the message. Awaiting your 1-tap sign-off.</p>
                      </>
                    )}
                    {activePipelineTrigger === 1 && (
                      <>
                        <h4 className="jl-quest-name">Early Clinic Window Save</h4>
                        <div className="jl-quest-impact">+$420 / mo account retained</div>
                        <p className="jl-quest-micro">Claire adjusted route timing. 1 tap queues the offer.</p>
                      </>
                    )}
                    {activePipelineTrigger === 2 && (
                      <>
                        <h4 className="jl-quest-name">Thursday Front-Desk Drop</h4>
                        <div className="jl-quest-impact">+$680 overdue collected</div>
                        <p className="jl-quest-micro">Courteous invoice reminder printed for driver stop.</p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Live Connectors Strip */}
            <div className="jl-connectors-support-strip">
              <span className="jl-connectors-label">Connects to your real stack:</span>
              <div className="jl-connectors-badges">
                <span className="jl-connector-pill">CleanCloud</span>
                <span className="jl-connector-pill">Stripe</span>
                <span className="jl-connector-pill">Square</span>
                <span className="jl-connector-pill">QuickBooks</span>
                <span className="jl-connector-pill">Shopify</span>
                <span className="jl-connector-pill">Toast</span>
                <span className="jl-connector-pill">Clover</span>
              </div>
            </div>
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

      {/* 10. SEATS (LIVING HANDOFF ACROSS 3 DEVICES) */}
      <section id="seats" className="jl-band" aria-labelledby="seats-heading">
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

          <div className="jl-seats-handoff-container">
            {/* The 3 Phone Screens Cascade */}
            <div className="jl-handoff-cascade">
              {/* Phone 1: Owner Cockpit */}
              <div className="jl-phone-frame jl-phone-owner">
                <div className="jl-phone-notch" />
                <div className="jl-phone-header">
                  <span className="jl-phone-time">7:32 AM</span>
                  <span className="jl-phone-role-badge">OPERATOR COCKPIT</span>
                </div>
                <div className="jl-phone-screen">
                  <div className="jl-screen-title">Today: 3 High-Leverage Stops</div>
                  <div className="jl-owner-kpi">
                    <span className="jl-kpi-val">$380</span>
                    <span className="jl-kpi-lbl">Projected route revenue</span>
                  </div>
                  <div className="jl-owner-stops-preview">
                    <div className="jl-stop-chip">Stop 01: Maya R. (Reunion)</div>
                    <div className="jl-stop-chip">Stop 02: Rise Wilshire (Gate 1940)</div>
                    <div className="jl-stop-chip">Stop 03: Century Park East</div>
                  </div>
                  <button
                    type="button"
                    className={`jl-dispatch-action-btn ${isSeatsDispatched ? "is-dispatched" : ""}`}
                    onClick={() => {
                      setIsSeatsDispatched(true);
                      captureProductEvent("seats_route_dispatched", { source: "landing_demo" });
                    }}
                  >
                    {isSeatsDispatched ? "✓ Dispatched to Leo's Phone" : "Dispatch Route to Leo →"}
                  </button>
                  <div className="jl-privacy-guard">
                    Strict Privacy: You see the books, gross margins, and customer dossiers.
                  </div>
                </div>
              </div>

              {/* Ink Route Line Between Phones */}
              <div className={`jl-handoff-thread ${isSeatsDispatched ? "is-pulsing" : ""}`}>
                <span className="jl-thread-pulse-dot" />
              </div>

              {/* Phone 2: Driver Leo's Rugged App */}
              <div className="jl-phone-frame jl-phone-driver">
                <div className="jl-phone-notch" />
                <div className="jl-phone-header">
                  <span className="jl-phone-time">10:14 AM</span>
                  <span className="jl-phone-role-badge">DRIVER LEO</span>
                </div>
                <div className="jl-phone-screen">
                  <div className="jl-screen-tag">NEXT STOP (04 OF 12)</div>
                  <div className="jl-driver-stop-title">Rise Wilshire · Unit 4B</div>
                  <div className="jl-driver-instructions">
                    <div className="jl-driver-field">
                      <span className="jl-df-lbl">Gate Code:</span>
                      <strong className="jl-df-val">#1940</strong>
                    </div>
                    <div className="jl-driver-field">
                      <span className="jl-df-lbl">Instructions:</span>
                      <span className="jl-df-val">2 laundry bags at front door. Knock twice.</span>
                    </div>
                  </div>
                  <div className="jl-driver-status-tag">
                    {isSeatsDispatched ? "Stop Loaded & Route Active" : "Waiting for dispatch"}
                  </div>
                  <div className="jl-privacy-guard">
                    Strict Privacy: Leo sees only gates and packages. Zero access to billing or revenue.
                  </div>
                </div>
              </div>

              {/* Ink Route Line Between Phones */}
              <div className={`jl-handoff-thread ${isSeatsDispatched ? "is-pulsing" : ""}`}>
                <span className="jl-thread-pulse-dot" />
              </div>

              {/* Phone 3: Customer Resident Card */}
              <div className="jl-phone-frame jl-phone-customer">
                <div className="jl-phone-notch" />
                <div className="jl-phone-header">
                  <span className="jl-phone-time">10:16 AM</span>
                  <span className="jl-phone-role-badge">CUSTOMER APP / SMS</span>
                </div>
                <div className="jl-phone-screen">
                  <div className="jl-sms-bubble jl-sms-incoming">
                    <p className="jl-sms-text">
                      &ldquo;Hi Maya! Your driver Leo is 2 stops away in the green Laundry Farm van. ETA: 10:28 AM.&rdquo;
                    </p>
                    <span className="jl-sms-time">10:16 AM · Sent from your number</span>
                  </div>
                  <div className="jl-resident-card">
                    <span className="jl-res-lbl">Order #8412</span>
                    <strong className="jl-res-status">Van Approaching Porch</strong>
                  </div>
                  <div className="jl-privacy-guard">
                    Direct human contact. Zero bots, zero confusing automated menus.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 11. TRUST (THE MECHANICAL APPROVAL GATE) */}
      <section id="trust" className="jl-band jl-trust-section" aria-labelledby="trust-heading">
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

          <div className="jl-approval-gate-container">
            {/* The Mechanical Desk Approval Slate */}
            <div className="jl-approval-slate">
              <div className="jl-slate-top">
                <div className="jl-slate-badge">
                  {isTrustApproved ? "STATUS: APPROVED & TRANSMITTED" : "STATUS: PENDING OPERATOR SIGN-OFF"}
                </div>
                <div className="jl-slate-companion">Rook drafted · Claire verified</div>
              </div>

              <div className="jl-slate-draft-card">
                <div className="jl-draft-target-row">
                  <span className="jl-draft-to">TO:</span>
                  <strong>Dr. Aris Thorne ($420/mo VIP Account)</strong>
                </div>

                <div className="jl-draft-time-selector">
                  <span className="jl-selector-label">Proposed Departure Window:</span>
                  <div className="jl-time-chips">
                    <button
                      type="button"
                      className={`jl-time-chip ${trustTime === "8:00 AM" ? "is-selected" : ""}`}
                      onClick={() => setTrustTime("8:00 AM")}
                      disabled={isTrustApproved}
                    >
                      8:00 AM Window
                    </button>
                    <button
                      type="button"
                      className={`jl-time-chip ${trustTime === "9:00 AM" ? "is-selected" : ""}`}
                      onClick={() => setTrustTime("9:00 AM")}
                      disabled={isTrustApproved}
                    >
                      9:00 AM Window
                    </button>
                  </div>
                </div>

                <div className="jl-draft-message-box">
                  <div className="jl-message-origin">PREVIEW OUTGOING SMS (SENT FROM YOUR IPHONE):</div>
                  <p className="jl-message-body">
                    &ldquo;Hi Dr. Thorne — noticed you haven&apos;t had a pickup since our Tuesday schedule shifted. We&apos;ve added an {trustTime} window on your block. Would you like us to grab your linens tomorrow morning?&rdquo;
                  </p>
                </div>

                {/* Mechanical Stamping Area */}
                <div className="jl-stamp-action-area">
                  {!isTrustApproved ? (
                    <button
                      type="button"
                      className="jl-mechanical-stamp-btn"
                      onClick={() => {
                        setIsTrustApproved(true);
                        captureProductEvent("trust_stamp_approved", { time: trustTime });
                      }}
                    >
                      <span className="jl-stamp-handle" aria-hidden="true" />
                      <span className="jl-stamp-press-text">Press Brass Stamp to Approve Message</span>
                    </button>
                  ) : (
                    <div className="jl-stamp-seal-imprint">
                      <div className="jl-seal-circle">
                        <span className="jl-seal-inner-border" />
                        <span className="jl-seal-text">APPROVED &amp; QUEUED FOR {trustTime} FROM YOUR IPHONE</span>
                        <span className="jl-seal-date">VERIFIED OPERATOR OK</span>
                      </div>
                      <button
                        type="button"
                        className="jl-seal-reset-btn"
                        onClick={() => setIsTrustApproved(false)}
                      >
                        Reset approval slate
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 4 Concrete Pillars */}
            <div className="jl-trust-pillars-row">
              <div className="jl-trust-pillar">
                <div className="jl-pillar-title">Asks first</div>
                <div className="jl-pillar-desc">
                  Companions draft messages, recalculate routes, and prepare invoices. Zero messages are transmitted and zero funds are billed without human sign-off.
                </div>
              </div>
              <div className="jl-trust-pillar">
                <div className="jl-pillar-title">Receipt-backed truth</div>
                <div className="jl-pillar-desc">
                  Claire cannot speak a number or name she cannot show on your real books. Every proposal cites the exact POS ticket or Stripe ledger entry.
                </div>
              </div>
              <div className="jl-trust-pillar">
                <div className="jl-pillar-title">Isolated private data</div>
                <div className="jl-pillar-desc">
                  Your proprietary customer lists and receipts reside in a dedicated tenant database. Your books are never pooled or used to train general models.
                </div>
              </div>
              <div className="jl-trust-pillar">
                <div className="jl-pillar-title">Sent from your device</div>
                <div className="jl-pillar-desc">
                  Customers communicate with your verified phone number and brand. They never interact with an unmonitored chatbot.
                </div>
              </div>
            </div>
            <div className="jl-trust-subline">Your books train nothing.</div>
          </div>
        </div>
      </section>

      {/* 12. LIVE PROOF (DOCUMENTARY FOUNDER FIELD DISPATCH) */}
      <section id="run" className="jl-band" aria-labelledby="run-heading">
        <div className="jl-wrap">
          <div className="jl-lede">
            <div>
              <div className="jl-section-label">Live proof</div>
              <h2 id="run-heading" className="jl-h2">
                Real evidence moves the world.
              </h2>
            </div>
            <p className="jl-lede-text">
              The founder playing in public is the proof. Real field dispatches from our active Los Angeles laundry route:
            </p>
          </div>

          <div className="jl-founder-clipboard-wrap">
            {/* Wooden Clipboard with Metal Clip */}
            <div className="jl-vintage-clipboard">
              <div className="jl-clipboard-clip" aria-hidden="true" />

              {/* Photo Strip Clipped to Board */}
              <div className="jl-clipboard-photos">
                <figure className="jl-clip-photo">
                  <img
                    src="/landingfinal/founder.jpg"
                    alt="Founder running public route operations in Los Angeles"
                    className="jl-photo-img"
                    loading="lazy"
                  />
                  <figcaption className="jl-photo-caption">Founder in field · Route #04</figcaption>
                </figure>
                <figure className="jl-clip-photo">
                  <img
                    src="/landingfinal/owner-walkup.jpg"
                    alt="Founder walking up residential steps delivering door tags"
                    className="jl-photo-img"
                    loading="lazy"
                  />
                  <figcaption className="jl-photo-caption">Reconnecting quiet porch lanterns</figcaption>
                </figure>
                <figure className="jl-clip-photo">
                  <img
                    src="/landingfinal/collateral.jpg"
                    alt="Physical door dockets and verification collateral"
                    className="jl-photo-img"
                    loading="lazy"
                  />
                  <figcaption className="jl-photo-caption">Printed mission collateral</figcaption>
                </figure>
              </div>

              {/* Typewritten Field Dispatch Log */}
              <div className="jl-clipboard-dossier">
                <div className="jl-dispatch-tab-bar" role="tablist">
                  <button
                    type="button"
                    className={`jl-dispatch-tab ${activeDispatchTab === 0 ? "is-active" : ""}`}
                    onClick={() => setActiveDispatchTab(0)}
                  >
                    Dispatch #042: Silver Lake
                  </button>
                  <button
                    type="button"
                    className={`jl-dispatch-tab ${activeDispatchTab === 1 ? "is-active" : ""}`}
                    onClick={() => setActiveDispatchTab(1)}
                  >
                    Dispatch #019: Century Park
                  </button>
                  <button
                    type="button"
                    className={`jl-dispatch-tab ${activeDispatchTab === 2 ? "is-active" : ""}`}
                    onClick={() => setActiveDispatchTab(2)}
                  >
                    Dispatch #003: Wilshire High-Rise
                  </button>
                </div>

                <div className="jl-dispatch-typewritten-card">
                  {activeDispatchTab === 0 && (
                    <>
                      <div className="jl-dispatch-meta-line">
                        <span>SECTOR: Silver Lake &amp; Echo Park Loop</span>
                        <span>DATE: Verified Tuesday Sweep</span>
                      </div>
                      <div className="jl-dispatch-section">
                        <strong className="jl-dispatch-label">The Attempted Mission:</strong>
                        <p className="jl-dispatch-text">
                          Sable identified 14 homes with quiet porch lanterns along the existing morning van run. Founder walked the block with personalized handwritten dockets.
                        </p>
                      </div>
                      <div className="jl-dispatch-section">
                        <strong className="jl-dispatch-label">The Actual Outcome:</strong>
                        <p className="jl-dispatch-text">
                          3 inactive regular accounts reconnected on the spot. 2 new recurring pickups scheduled for Thursday. <strong>+$310 revenue recovered in 90 minutes.</strong>
                        </p>
                      </div>
                      <div className="jl-dispatch-section">
                        <strong className="jl-dispatch-label">The World Reaction:</strong>
                        <blockquote className="jl-dispatch-quote">
                          &ldquo;Maya R.: &lsquo;I wondered where you guys went! Put me down for Tuesdays again.&rsquo;&rdquo;
                        </blockquote>
                      </div>
                    </>
                  )}

                  {activeDispatchTab === 1 && (
                    <>
                      <div className="jl-dispatch-meta-line">
                        <span>SECTOR: Century Park East (Tower B)</span>
                        <span>DATE: Verified Thursday Sweep</span>
                      </div>
                      <div className="jl-dispatch-section">
                        <strong className="jl-dispatch-label">The Attempted Mission:</strong>
                        <p className="jl-dispatch-text">
                          Orren routed 8 executive accounts that lapsed following a building concierge desk transition. Re-established ground-level delivery protocol with building superintendent.
                        </p>
                      </div>
                      <div className="jl-dispatch-section">
                        <strong className="jl-dispatch-label">The Actual Outcome:</strong>
                        <p className="jl-dispatch-text">
                          Dedicated laundry drop bin re-approved by building security. 4 accounts resumed weekly service. <strong>+$420/month recurring volume secured.</strong>
                        </p>
                      </div>
                      <div className="jl-dispatch-section">
                        <strong className="jl-dispatch-label">The World Reaction:</strong>
                        <blockquote className="jl-dispatch-quote">
                          &ldquo;Concierge desk: &lsquo;We can hold the bins at the south gate. Saves us 3 interruptions every morning.&rsquo;&rdquo;
                        </blockquote>
                      </div>
                    </>
                  )}

                  {activeDispatchTab === 2 && (
                    <>
                      <div className="jl-dispatch-meta-line">
                        <span>SECTOR: Wilshire Commercial Corridor</span>
                        <span>DATE: Verified Friday Sweep</span>
                      </div>
                      <div className="jl-dispatch-section">
                        <strong className="jl-dispatch-label">The Attempted Mission:</strong>
                        <p className="jl-dispatch-text">
                          Rook drafted commercial introduction dockets for 2 boutique fitness studios located directly across the avenue from existing customer stops.
                        </p>
                      </div>
                      <div className="jl-dispatch-section">
                        <strong className="jl-dispatch-label">The Actual Outcome:</strong>
                        <p className="jl-dispatch-text">
                          Both studios signed bi-weekly towel turnover agreements on first visit. <strong>+$560/month recurring margin added with zero extra driver fuel.</strong>
                        </p>
                      </div>
                      <div className="jl-dispatch-section">
                        <strong className="jl-dispatch-label">The World Reaction:</strong>
                        <blockquote className="jl-dispatch-quote">
                          &ldquo;Studio Manager: &lsquo;Our current service is late every Monday. If you are already on this block, we are switching.&rsquo;&rdquo;
                        </blockquote>
                      </div>
                    </>
                  )}

                  <div className="jl-dispatch-verified-footer">
                    <span className="jl-ledger-stamp">LOGGED TO LIVE PUBLIC OPERATOR RUN</span>
                    <span>Cohort 01: 50 active businesses in public launch</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Metrics Count Row */}
            <div className="jl-run-metrics-grid">
              {LIVE_RUN_METRICS.map((metric, i) => (
                <div key={i} className="jl-run-metric-card">
                  <div className="jl-run-metric-count">{metric.count}</div>
                  <div className="jl-run-metric-label">{metric.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 13. PRICING & INFRASTRUCTURE ARCHITECTURE */}
      <section
        id="pricing"
        className="jl-band jl-pricing-section"
        aria-labelledby="pricing-heading"
        data-testid="section-pricing"
      >
        <div className="jl-wrap">
          <div className="jl-lede">
            <div>
              <div className="jl-section-label">Pricing</div>
              <h2 id="pricing-heading" className="jl-h2 jl-pricing-title">
                $79/Month. Cancel Anytime.
              </h2>
            </div>
            <p className="jl-lede-text">
              One authoritative membership. No hidden tiers, no conflicting plans. Unmetered gameplay with transparent infrastructure unit economics.
            </p>
          </div>

          <div className="jl-pricing-presentation-card" data-testid="landing-pricing-card">
            {/* Membership Header */}
            <div className="jl-pricing-main-block">
              <div className="jl-pricing-tier-badge">JOYSTICK OPERATOR MEMBERSHIP</div>

              <div className="jl-pricing-cost-display">
                <div className="jl-cost-large">
                  $79
                  <span className="jl-cost-period">/month</span>
                </div>
                {/* One plan at launch: monthly. An annual price isn't offered until it is approved. */}
                <div className="jl-cost-annual-note">Billed monthly.</div>
              </div>

              {/* Commercial Terms Pills */}
              <ul
                className="jl-terms joystick-desktop__terms"
                data-testid="landing-commercial-terms"
              >
                <li className="joystick-terms-pill">$79/month</li>
                <li className="joystick-terms-pill">Charged at signup</li>
                <li className="joystick-terms-pill">Card required at signup</li>
                <li className="joystick-terms-pill">Cancel anytime</li>
              </ul>

              <div className="jl-pricing-action-wrap">
                <a
                  className="jl-cta-button jl-pricing-btn"
                  href={START_PATH}
                  onClick={() =>
                    captureProductEvent("joystick_start_clicked", {
                      source: "landing_pricing",
                    })
                  }
                >
                  Turn my work into a game →
                </a>
                <p
                  className="joystick-checkout-closed jl-cta-microcopy"
                  data-testid="landing-checkout-unavailable"
                >
                  Checkout is not open. This does not charge a card.
                </p>
              </div>
            </div>

            {/* Intelligent Infrastructure & Token Rates Grid */}
            <div className="jl-infrastructure-grid">
              <div className="jl-infra-card">
                <div className="jl-infra-header">
                  <span className="jl-infra-tag">REASONING ENGINE</span>
                  <strong className="jl-infra-spec">5M Tokens / mo</strong>
                </div>
                <p className="jl-infra-desc">
                  Full context window evaluation of your customer histories, receipts, and route maps.
                </p>
                <div className="jl-infra-rate">
                  <span>Overage rate:</span>
                  <strong>$0.002 / 1k tokens (spend capped)</strong>
                </div>
              </div>

              <div className="jl-infra-card">
                <div className="jl-infra-header">
                  <span className="jl-infra-tag">VOICE SYNTHESIS</span>
                  <strong className="jl-infra-spec">1,500 Voice Mins / mo</strong>
                </div>
                <p className="jl-infra-desc">
                  Ultra-low latency conversational audio for Claire&apos;s 7:30 AM morning dispatch and evening debrief calls.
                </p>
                <div className="jl-infra-rate">
                  <span>Overage rate:</span>
                  <strong>$0.038 / min (off by default)</strong>
                </div>
              </div>

              <div className="jl-infra-card">
                <div className="jl-infra-header">
                  <span className="jl-infra-tag">DATA ISOLATION</span>
                  <strong className="jl-infra-spec">Dedicated Tenant</strong>
                </div>
                <p className="jl-infra-desc">
                  Private database instance per business. Strict tenant boundary isolation; zero cross-account model training.
                </p>
                <div className="jl-infra-rate">
                  <span>Policy:</span>
                  <strong>Your books train nothing</strong>
                </div>
              </div>

              <div className="jl-infra-card">
                <div className="jl-infra-header">
                  <span className="jl-infra-tag">PUBLIC COHORT</span>
                  <strong className="jl-infra-spec">Capped Run of 50</strong>
                </div>
                <p className="jl-infra-desc">
                  Limited to 50 active businesses in the public launch. Direct founder engineering on your game mechanics.
                </p>
                <div className="jl-infra-rate">
                  <span>Status:</span>
                  <strong>41 of 50 cohort seats allocated</strong>
                </div>
              </div>
            </div>

            <div className="jl-pricing-punchline">
              Companions aren’t a tier. You earn them by doing the work.
            </div>
            <p
              className="jl-pricing-illustration"
              data-testid="landing-examples-illustration"
            >
              All customer references on this page are illustrations.
            </p>
          </div>
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
