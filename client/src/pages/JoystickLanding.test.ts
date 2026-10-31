/* LEGACY DAYFORGE COMPATIBILITY: route literal retained for the existing tenant-provisioning endpoint; customer-facing product is JOYSTICK. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOW_IT_WORKS_STEPS,
  PERSONAS,
  ROTATION_PERIOD_MS,
  FADE_DURATION_MS,
  initialPersonaState,
  personaReducer,
} from "./joystickPersonaData";

const landingSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "JoystickLanding.tsx"),
  "utf8"
);
const personaDataSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "joystickPersonaData.ts"),
  "utf8"
);
const cssSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "joystick-landing.css"),
  "utf8"
);

describe("JOYSTICK public start", () => {
  it("routes a fresh customer through tenant provisioning, not tenant-bound Goldline onboarding", () => {
    expect(landingSource).toContain('const START_PATH = "/joystick-start";');
    expect(landingSource).not.toContain('const START_PATH = "/onboarding";');
  });

  it("does not use the unapproved monsters line", () => {
    expect(landingSource).not.toContain("THE MONSTERS ARE FAKE");
    expect(landingSource).not.toContain("THE MONEY ISN");
  });

  it("labels example missions as illustrations", () => {
    expect(landingSource).toContain('data-testid="landing-examples-illustration"');
    expect(landingSource).toContain("illustrations");
    expect(landingSource).not.toContain("REAL MISSIONS. REAL REVENUE.");
    expect(landingSource).not.toContain("<strong>Result:</strong>");
  });

  it("keeps the approved editorial hero sentence and headline copy", () => {
    expect(landingSource).toContain("Knows your");
    expect(landingSource).toContain("business,");
    expect(landingSource).toContain("then makes");
    expect(landingSource).toContain("your next move");
    expect(landingSource).toContain("a game.");
    expect(landingSource).toContain(
      'aria-label="Joystick — Knows your business, then makes your next move a game."'
    );
  });

  it("advertises $79/month with no trial, charged and card required at signup", () => {
    expect(landingSource).toContain("$79/month");
    expect(landingSource).toContain("$79/Month. Cancel Anytime.");
    expect(landingSource).toContain("Charged at signup");
    expect(landingSource).toContain("Card required at signup");
    // the retired $49 + seven-day-trial offer is not advertised anywhere on the page
    expect(landingSource).not.toMatch(/\$49\b/);
    expect(landingSource).not.toMatch(/7-day trial|free trial/i);
    // the annual savings claims were computed from $49; they are not restated
    expect(landingSource).not.toContain("save 20%");
    expect(landingSource).not.toContain("saves $120");
  });

  it("does not advertise a live charge while checkout is unverified", () => {
    expect(landingSource).toContain(
      "Checkout is not open. This does not charge a card."
    );
    expect(landingSource).toContain('data-testid="landing-checkout-unavailable"');
    expect(landingSource).not.toContain("START 7-DAY TRIAL");
    expect(landingSource).not.toContain("joystick-pricing-cta");
    expect(landingSource).toContain(
      'captureProductEvent("landing_checkout_unavailable"'
    );
    expect(landingSource).toContain("checkout_live: false");
  });

  it("does not show an annual price other than $468/year", () => {
    const annual = [
      ...landingSource.matchAll(
        /\$\s*([0-9][0-9,]*)\s*(?:\/\s*year|per year)/gi
      ),
    ];
    expect(
      annual.every((match) => match[1].replace(/,/g, "") === "468")
    ).toBe(true);
  });

  it("does not advertise XP, coins, gold, or streaks", () => {
    expect(landingSource).not.toMatch(/\bXP\b|\bcoins?\b|\bgold\b|\bstreaks?\b/i);
    expect(personaDataSource).not.toMatch(
      /\bXP\b|\bcoins?\b|\bgold\b|\bstreaks?\b/i
    );
  });

  it("records pricing and closed-checkout events without message bodies", () => {
    expect(landingSource).toContain('captureProductEvent("landing_pricing_viewed"');
    expect(landingSource).toContain("monthly_usd: 79");
    expect(landingSource).toContain("trial_days: 0");
    expect(landingSource).toContain("card_required_at_signup: true");
    expect(landingSource).not.toMatch(
      /captureProductEvent\([^)]*\b(message|body|answer)\b/
    );
  });
});

describe("JOYSTICK hero copy integrity & forbidden words", () => {
  it("does not use the forbidden words anywhere on the page, data, or styles", () => {
    const forbidden = ["chief of staff", "assistant", "gamify", "adventure"];
    const combined = `${landingSource}\n${personaDataSource}\n${cssSource}`.toLowerCase();

    for (const word of forbidden) {
      expect(combined).not.toContain(word);
    }
  });

  it("defines exact persona locked copy character for character", () => {
    expect(PERSONAS).toHaveLength(4);
    expect(ROTATION_PERIOD_MS).toBe(7000);
    expect(FADE_DURATION_MS).toBe(400);

    // 1. Adam
    expect(PERSONAS[0]).toEqual({
      key: "adam",
      name: "Adam",
      accent: "#e39b00",
      paper: "#f1e6cf",
      photoWhere: "at a lobby desk in Koreatown",
      caption: "Adam loves playing Tomb Raider. Shies away from lobbies.",
      gamePlaceholder: "Tomb Raider...",
      oneLiner: "Three doors before noon. Rook wrote the opener.",
      clipLabel: "Rook · Silver Lake",
      clipThoughtBubble: [
        "8 regulars dark since August.",
        "Silver Lake’s down 12%.",
        "Let’s get them back.",
      ],
      clipHandoff: "a short letter unfolds",
      clipButton: "Send to Maya →",
      clipEndCard: "8 found. 1 letter waiting for your OK.",
      companion: "Rook",
      companionGift: "Socially fearless at any front desk.",
      companionFlaw: "Exaggerates hilariously.",
      companionTruth: "Socially fearless at any front desk.",
      companionWhy: "Exaggerates hilariously.",
      companionInGameLine: "“I wrote something.”",
      forTheOneWhoText: "for the one who shies away from lobbies",
      callTime: "7:31 AM",
      callLine:
        "Three doors before noon. Rise Koreatown first. Rook wrote the opener; I cut the part about the yacht.",
      panelTitle: "Rook · Contact",
      panelLine1: "Rise Koreatown · front desk",
      panelLine2: "Opener drafted and handed to Claire for the 7:31 call.",
      panelLine3: "Calling… 00:14. Yacht reference removed.",
      portraitAriaLabel: "Adam, stand-in for a real flash photo at a lobby desk",
      sceneAriaLabel:
        "The Colosseum: Clockhead looming over a Koreatown tower, sketched in ink",
      companionAriaLabel:
        "Rook, sketched: an upright messenger bird in a bucket hat and goggles",
    });

    // 2. Daisy
    expect(PERSONAS[1]).toEqual({
      key: "daisy",
      name: "Daisy",
      accent: "#e0457b",
      paper: "#f3dde3",
      photoWhere: "on her couch at night",
      caption: "Daisy loves playing cozy games. Forgets to follow up.",
      gamePlaceholder: "Stardew Valley...",
      oneLiner: "Maya first; she’s the easiest yes.",
      clipLabel: "Sable · Los Feliz",
      clipThoughtBubble: [
        "Maya ordered every Tuesday for two years.",
        "Stopped the week the pickup window moved.",
        "She’ll say yes if we fix that first.",
      ],
      clipHandoff: "the old pickup time, crossed out, new one written",
      clipButton: "Offer the new window →",
      clipEndCard: "1 fix. 1 regular back on Tuesdays, if she says yes.",
      companion: "Sable",
      companionGift: "Remembers every customer.",
      companionFlaw: "Remembers every excuse, too.",
      companionTruth: "Remembers every customer.",
      companionWhy: "Remembers every excuse, too.",
      companionInGameLine: "“You’ve been here before.”",
      forTheOneWhoText: "for the one who forgets to follow up",
      callTime: "9:42 PM",
      callLine:
        "Eight regulars went quiet. Sable has the dates. Maya first; she's the easiest yes.",
      panelTitle: "Sable · Recall",
      panelLine1: "Maya R. · last order Aug 3",
      panelLine2: '"Try me next month." She said that twice.',
      panelLine3: "The WeHo one. The dog, the rug. You said she was cute.",
      portraitAriaLabel: "Daisy, stand-in for a real photo on her couch at night",
      sceneAriaLabel:
        "Silver Lake: the fountain, two neighbours, Hazel the squirrel and strung lanterns, sketched in ink",
      companionAriaLabel:
        "Sable, sketched: a sleek black cat with a scroll satchel",
    });

    // 3. Shawn
    expect(PERSONAS[2]).toEqual({
      key: "shawn",
      name: "Shawn",
      accent: "#13a39a",
      paper: "#d9ebe8",
      photoWhere: "at the laundromat counter",
      caption: "Shawn loves making videos. Never starts the ad.",
      gamePlaceholder: "Halo...",
      oneLiner: "The ad goes up Thursday. Luma cut three openers.",
      clipLabel: "Luma · CHANNEL 382",
      clipThoughtBubble: [
        "Three customers said the same thing last month:",
        "“you got the stain nobody else could.”",
        "That’s the ad. I made three cuts.",
      ],
      clipHandoff: "three cards fan out under ON AIR",
      clipButton: "This one →",
      clipEndCard: "Ad drafted. Airs when you say.",
      companion: "Luma",
      companionGift: "Makes the ad in an hour.",
      companionFlaw: "Changes it eleven times.",
      companionTruth: "Makes the ad in an hour.",
      companionWhy: "Changes it eleven times.",
      companionInGameLine: "“I changed it.”",
      forTheOneWhoText: "for the one who never starts the ad",
      callTime: "8:05 AM",
      callLine:
        "The ad goes up Thursday. Luma cut three openers from last month's orders. Pick one before she cuts a fourth.",
      panelTitle: "Luma · Make",
      panelLine1: "Instagram ad · Thursday",
      panelLine2: "Three openers cut from last month's orders.",
      panelLine3: "Version 11. She is not done.",
      portraitAriaLabel:
        "Shawn, stand-in for a real photo at the laundromat counter",
      sceneAriaLabel:
        "CHANNEL 382: the clay studio camera, an ON AIR sign and a clapperboard, sketched in ink",
      companionAriaLabel: "Luma, sketched: an alert chameleon framing a shot",
    });

    // 4. TJ
    expect(PERSONAS[3]).toEqual({
      key: "tj",
      name: "TJ",
      accent: "#e8472a",
      paper: "#eadfd3",
      photoWhere: "at a front door in the flats",
      caption: "TJ loves playing shooters. Starts at the wrong end of the block.",
      gamePlaceholder: "Animal Crossing...",
      oneLiner: "Twenty-four doors in the flats. North end first.",
      clipLabel: "Orren · the flats",
      clipThoughtBubble: [
        "24 doors, none knocked.",
        "North end’s home before 6; south end isn’t.",
        "Start north. Twelve doors by dark.",
      ],
      clipHandoff: "the route draws itself",
      clipButton: "Start at the north end →",
      clipEndCard: "24 doors. Route set.",
      companion: "Orren",
      companionGift: "Never wastes a step.",
      companionFlaw: "Never admits a wrong turn.",
      companionTruth: "Never wastes a step.",
      companionWhy: "Never admits a wrong turn.",
      companionInGameLine: "“Wrong way.”",
      forTheOneWhoText: "for the one who starts at the wrong end of the block",
      callTime: "7:31 AM",
      callLine:
        "Twenty-four doors in the flats. Orren says north end first. He was right last time, so.",
      panelTitle: "Orren · Route",
      panelLine1: "24 doors · the flats · 1.3 mi",
      panelLine2: "North end first. Parking is easier before ten.",
      panelLine3: "Wrong way, apparently.",
      portraitAriaLabel:
        "TJ, stand-in for a real flash photo at a front door with hangers",
      sceneAriaLabel:
        "Beverly Hills: palm trees, a masked figure, a helicopter and a warning sign, sketched in ink",
      companionAriaLabel: "Orren, sketched: a steady desert tortoise with a compass pack",
    });
  });

  it("defines exact how it works copy character for character", () => {
    expect(HOW_IT_WORKS_STEPS).toEqual([
      {
        step: "1",
        title: "1. Claire reads your books.",
        text: "Orders, customers, payments, routes. Every number she says has a receipt.",
      },
      {
        step: "2",
        title: "2. You get the one you're missing.",
        text: "Rook is fearless and exaggerates. Sable never forgets, including your excuses. Luma can't stop making, or changing. Orren never wastes a step and never admits a wrong turn. Each one has the thing you don't, and a flaw of their own. You earn them by doing the work.",
      },
      {
        step: "3",
        title: "3. Your next move becomes a game.",
        text: "The work you avoid becomes the game you'd pick anyway. Real evidence moves the world; nothing fake does.",
      },
    ]);
  });
});

describe("persona rotation reducer & flip state", () => {
  it("initializes with index 0 (Adam), fading false, and flips unflipped", () => {
    expect(initialPersonaState).toEqual({
      index: 0,
      pendingIndex: null,
      fading: false,
      isFlippedHuman: false,
      isFlippedCompanion: false,
    });
  });

  it("rotates through Adam -> Daisy -> Shawn -> TJ -> Adam on successive ticks", () => {
    let state = initialPersonaState;

    // Adam -> Daisy
    state = personaReducer(state, { type: "TICK_FADE" });
    expect(state.fading).toBe(true);
    expect(state.pendingIndex).toBe(1);
    expect(state.index).toBe(0);

    state = personaReducer(state, { type: "COMPLETE_SWAP" });
    expect(state.fading).toBe(false);
    expect(state.pendingIndex).toBe(null);
    expect(state.index).toBe(1); // Daisy

    // Daisy -> Shawn
    state = personaReducer(state, { type: "TICK_FADE" });
    expect(state.pendingIndex).toBe(2);
    state = personaReducer(state, { type: "COMPLETE_SWAP" });
    expect(state.index).toBe(2); // Shawn

    // Shawn -> TJ
    state = personaReducer(state, { type: "TICK_FADE" });
    expect(state.pendingIndex).toBe(3);
    state = personaReducer(state, { type: "COMPLETE_SWAP" });
    expect(state.index).toBe(3); // TJ

    // TJ -> Adam (loops)
    state = personaReducer(state, { type: "TICK_FADE" });
    expect(state.pendingIndex).toBe(0);
    state = personaReducer(state, { type: "COMPLETE_SWAP" });
    expect(state.index).toBe(0); // Adam
  });

  it("supports jumping directly to any persona index", () => {
    let state = initialPersonaState;

    state = personaReducer(state, { type: "START_FADE", nextIndex: 3 });
    expect(state.fading).toBe(true);
    expect(state.pendingIndex).toBe(3);

    state = personaReducer(state, { type: "COMPLETE_SWAP" });
    expect(state.index).toBe(3);
    expect(state.fading).toBe(false);
  });

  it("toggles human flip state independently", () => {
    let state = initialPersonaState;
    expect(state.isFlippedHuman).toBe(false);

    state = personaReducer(state, { type: "TOGGLE_FLIP_HUMAN" });
    expect(state.isFlippedHuman).toBe(true);
    expect(state.isFlippedCompanion).toBe(false);

    state = personaReducer(state, { type: "TOGGLE_FLIP_HUMAN" });
    expect(state.isFlippedHuman).toBe(false);
  });

  it("toggles companion flip state independently", () => {
    let state = initialPersonaState;
    expect(state.isFlippedCompanion).toBe(false);

    state = personaReducer(state, { type: "TOGGLE_FLIP_COMPANION" });
    expect(state.isFlippedCompanion).toBe(true);
    expect(state.isFlippedHuman).toBe(false);

    state = personaReducer(state, { type: "TOGGLE_FLIP_COMPANION" });
    expect(state.isFlippedCompanion).toBe(false);
  });

  it("resets both flip states to front on swap", () => {
    let state = initialPersonaState;
    state = personaReducer(state, { type: "TOGGLE_FLIP_HUMAN" });
    state = personaReducer(state, { type: "TOGGLE_FLIP_COMPANION" });
    expect(state.isFlippedHuman).toBe(true);
    expect(state.isFlippedCompanion).toBe(true);

    state = personaReducer(state, { type: "TICK_FADE" });
    state = personaReducer(state, { type: "COMPLETE_SWAP" });
    expect(state.isFlippedHuman).toBe(false);
    expect(state.isFlippedCompanion).toBe(false);
    expect(state.index).toBe(1);
  });
});

// Regression checks for production-only failures identified in PR #688 review.
describe("landing release safety", () => {
  it("does not advertise playable call audio until the recordings exist", () => {
    expect(landingSource).not.toContain("/joystick/claire/");
    expect(landingSource).not.toContain('aria-label="Play Claire\'s call"');
  });
  it("completes persona swaps independently of rotation interval cleanup", () => {
    expect(landingSource).toContain("}, [state.fading, state.pendingIndex]);");
    expect(landingSource).not.toContain("swapTimeoutRef");
  });
  it("stacks the hero and the companion row to one column on narrow screens", () => {
    expect(cssSource).toContain(".jl-hero-row {\n    flex-direction: column;");
    expect(cssSource).toContain(".jl-party {\n    grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(cssSource).toContain(".jl-party {\n    grid-template-columns: minmax(0, 1fr);");
  });
  it("shows real gameplay captures instead of bracketed placeholders", () => {
    expect(landingSource).not.toContain("[Real gameplay video:");
    expect(landingSource).toContain("/joystick/gameplay/silver-lake.mp4");
    expect(landingSource).toContain("/joystick/gameplay/channel-382.jpg");
  });
});
