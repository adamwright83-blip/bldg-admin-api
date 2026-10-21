/* LEGACY DAYFORGE COMPATIBILITY: route literal retained for the existing tenant-provisioning endpoint; customer-facing product is JOYSTICK. */

export interface Persona {
  key: "adam" | "daisy" | "shawn" | "tj";
  name: string;
  accent: string;
  paper: string;
  photoWhere: string;
  caption: string;
  companion: string;
  companionTruth: string;
  companionWhy: string;
  callTime: string;
  callLine: string;
  panelTitle: string;
  panelLine1: string;
  panelLine2: string;
  panelLine3: string;
  portraitAriaLabel: string;
  sceneAriaLabel: string;
  companionAriaLabel: string;
}

export const PERSONAS: readonly Persona[] = [
  {
    key: "adam",
    name: "Adam",
    accent: "#e39b00",
    paper: "#f1e6cf",
    photoWhere: "at a lobby desk in Koreatown",
    caption: "Adam loved Tomb Raider. Shies away from lobbies.",
    companion: "Rook",
    companionTruth: "Socially fearless at any front desk.",
    companionWhy: "Exaggerates hilariously.",
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
  },
  {
    key: "daisy",
    name: "Daisy",
    accent: "#e0457b",
    paper: "#f3dde3",
    photoWhere: "on her couch at night",
    caption: "Daisy loved cozy games. Forgets to follow up.",
    companion: "Sable",
    companionTruth: "Remembers every customer.",
    companionWhy: "Remembers every excuse, too.",
    callTime: "9:42 PM",
    callLine:
      "Eight regulars went quiet. Sable has the dates. Maya first; she's the easiest yes.",
    panelTitle: "Sable · Recall",
    panelLine1: "Maya R. · last order Aug 3",
    panelLine2: '"Try me next month." She said that twice.',
    panelLine3: "Check-in drafted for Daisy to approve.",
    portraitAriaLabel: "Daisy, stand-in for a real photo on her couch at night",
    sceneAriaLabel:
      "Silver Lake: the fountain, two neighbours, Hazel the squirrel and strung lanterns, sketched in ink",
    companionAriaLabel:
      "Sable, sketched, holding the ledger she never forgets",
  },
  {
    key: "shawn",
    name: "Shawn",
    accent: "#13a39a",
    paper: "#d9ebe8",
    photoWhere: "at the laundromat counter",
    caption: "Shawn loved making videos. Never starts the ad.",
    companion: "Luma",
    companionTruth: "Makes the ad in an hour.",
    companionWhy: "Changes it eleven times.",
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
    companionAriaLabel: "Luma, sketched, holding a frame",
  },
  {
    key: "tj",
    name: "TJ",
    accent: "#e8472a",
    paper: "#eadfd3",
    photoWhere: "at a front door in the flats",
    caption: "TJ loved shooters. Starts at the wrong end of the block.",
    companion: "Orren",
    companionTruth: "Never wastes a step.",
    companionWhy: "Never admits a wrong turn.",
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
      "Beverly Hills containment: palm trees, a masked figure, a helicopter and a warning sign, sketched in ink",
    companionAriaLabel: "Orren, sketched, beside a signpost",
  },
] as const;

export const ROTATION_PERIOD_MS = 7000;
export const FADE_DURATION_MS = 400;

export const HOW_IT_WORKS_STEPS = [
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
] as const;

export interface PersonaState {
  index: number;
  pendingIndex: number | null;
  fading: boolean;
  isFlippedHuman: boolean;
  isFlippedCompanion: boolean;
}

export type PersonaAction =
  | { type: "TICK_FADE" }
  | { type: "START_FADE"; nextIndex: number }
  | { type: "COMPLETE_SWAP" }
  | { type: "TOGGLE_FLIP_HUMAN" }
  | { type: "TOGGLE_FLIP_COMPANION" }
  | { type: "RESET_FLIPS" };

export const initialPersonaState: PersonaState = {
  index: 0,
  pendingIndex: null,
  fading: false,
  isFlippedHuman: false,
  isFlippedCompanion: false,
};

export function personaReducer(
  state: PersonaState,
  action: PersonaAction,
  totalPersonas: number = PERSONAS.length
): PersonaState {
  switch (action.type) {
    case "TICK_FADE": {
      const nextIndex = (state.index + 1) % totalPersonas;
      return {
        ...state,
        fading: true,
        pendingIndex: nextIndex,
      };
    }
    case "START_FADE": {
      if (action.nextIndex === state.index && !state.fading) {
        return state;
      }
      return {
        ...state,
        fading: true,
        pendingIndex: action.nextIndex,
      };
    }
    case "COMPLETE_SWAP": {
      const nextIndex =
        state.pendingIndex !== null ? state.pendingIndex : state.index;
      return {
        ...state,
        index: nextIndex,
        pendingIndex: null,
        fading: false,
        isFlippedHuman: false,
        isFlippedCompanion: false,
      };
    }
    case "TOGGLE_FLIP_HUMAN": {
      return {
        ...state,
        isFlippedHuman: !state.isFlippedHuman,
      };
    }
    case "TOGGLE_FLIP_COMPANION": {
      return {
        ...state,
        isFlippedCompanion: !state.isFlippedCompanion,
      };
    }
    case "RESET_FLIPS": {
      return {
        ...state,
        isFlippedHuman: false,
        isFlippedCompanion: false,
      };
    }
    default:
      return state;
  }
}
