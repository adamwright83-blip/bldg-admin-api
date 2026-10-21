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
    caption: "Adam loves Tomb Raider. The front desk is the level he skips.",
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
    caption: "Daisy loves cozy games. Follow-ups are not cozy.",
    companion: "Sable",
    companionTruth: "Remembers every customer.",
    companionWhy: "Remembers every excuse, too.",
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
  },
  {
    key: "shawn",
    name: "Sean",
    accent: "#13a39a",
    paper: "#d9ebe8",
    photoWhere: "at the laundromat counter",
    caption: "Sean doomscrolls IG and TikTok. Has never pressed record.",
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
      "Sean, stand-in for a real photo at the laundromat counter",
    sceneAriaLabel:
      "CHANNEL 382: the clay studio camera, an ON AIR sign and a clapperboard, sketched in ink",
    companionAriaLabel: "Luma, sketched: an alert chameleon framing a shot",
  },
  {
    key: "tj",
    name: "TJ",
    accent: "#e8472a",
    paper: "#eadfd3",
    photoWhere: "at a front door in the flats",
    caption: "TJ plays Call of Duty nightly. Won't hang a door hanger.",
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
      "Beverly Hills: palm trees, a masked figure, a helicopter and a warning sign, sketched in ink",
    companionAriaLabel: "Orren, sketched: a steady desert tortoise with a compass pack",
  },
] as const;

export const ROTATION_PERIOD_MS = 7000;
export const FADE_DURATION_MS = 400;

export const CLAIRE_ROTATING_WORDS = [
  "books",
  "orders",
  "customers",
  "routes",
  "goals",
] as const;

export interface DecisionChoice {
  title: string;
  desc?: string;
  cost?: string;
}

export const CLAIRE_DECISION_CHOICES: readonly DecisionChoice[] = [
  {
    title: "Just check in.",
  },
  {
    title:
      "Offer a free Thursday pickup. A trip across Silver Lake for you. For a $215 customer, Sable would make it.",
  },
  {
    title: "Not today.",
  },
] as const;

export interface DossierTab {
  id: string;
  label: string;
  operator: string;
  ticket: string;
  quiet: string;
  owed: string;
  goal: string;
  skipped: string;
}

export const DOSSIER_TABS: readonly DossierTab[] = [
  {
    id: "wash-and-fold",
    label: "Wash & fold",
    operator: "Laundry Farm · Silver Lake",
    ticket: "$42 avg order",
    quiet: "8 regular accounts quiet for 45+ days",
    owed: "$340 across 3 pending pickup invoices",
    goal: "50 active customers",
    skipped: "Calling Maya R. after her third skip",
  },
  {
    id: "home-services",
    label: "Home services",
    operator: "Valley Detail & Care · Sherman Oaks",
    ticket: "$180 recurring detail",
    quiet: "14 bi-weekly homeowners due for spring schedule",
    owed: "$620 past 30 days on commercial accounts",
    goal: "50 active customers",
    skipped: "Texting past clients when rain clears the calendar",
  },
  {
    id: "residential-routes",
    label: "Residential routes",
    operator: "Flats Express Drop · Beverly Flats",
    ticket: "$28 drop charge",
    quiet: "6 buildings where unit turnover dropped routes",
    owed: "$190 in missed end-of-month chargebacks",
    goal: "50 active customers",
    skipped: "Hanging door tags on the east side of the block",
  },
  {
    id: "solo-operator",
    label: "Solo operator",
    operator: "K-Town Studio Press · Wilshire Blvd",
    ticket: "$95 print run",
    quiet: "11 design agency buyers quiet this quarter",
    owed: "$1,120 uncollected balance on delivery",
    goal: "50 active customers",
    skipped: "Walking into corporate agency lobbies cold",
  },
] as const;

export interface ReceiptCard {
  category: string;
  sources: string;
  claireLine: string;
  gameTerritory: string;
  accent: string;
}

export const RECEIPTS_GRID: readonly ReceiptCard[] = [
  {
    category: "Orders & POS",
    sources: "CleanCloud, Square, Stripe, Shopify",
    claireLine: "Two weekly orders cancelled last month. Placed on tonight's Day Line as Silver Lake.",
    gameTerritory: "Silver Lake",
    accent: "#e0457b",
  },
  {
    category: "Customers",
    sources: "Gmail, SMS, phone, Google Contacts",
    claireLine: "Three people asked about commercial pickup and never booked. Waiting in Century Park East.",
    gameTerritory: "Century Park East",
    accent: "#13a39a",
  },
  {
    category: "Money",
    sources: "Stripe, QuickBooks",
    claireLine: "Four overdue balances. Claire drafts polite reminders for you to approve with one tap.",
    gameTerritory: "Day Line",
    accent: "#e39b00",
  },
  {
    category: "The Map",
    sources: "Google Maps, property records",
    claireLine: "Twelve multi-family buildings on your delivery corridor. Formatted as Beverly Hills prospect doors.",
    gameTerritory: "Beverly Hills",
    accent: "#e8472a",
  },
  {
    category: "The Ad",
    sources: "Instagram, TikTok",
    claireLine: "Zero videos posted in twenty days. Three hook concepts waiting on the CHANNEL 382 call sheet.",
    gameTerritory: "CHANNEL 382",
    accent: "#13a39a",
  },
  {
    category: "Reviews",
    sources: "Google Business Profile",
    claireLine: "Five-star delivery completed yesterday. Claire queues a review request for your approval.",
    gameTerritory: "Day Line",
    accent: "#e39b00",
  },
  {
    category: "Calendar",
    sources: "Google Calendar, iCloud",
    claireLine: "Friday afternoon block is open. Route scheduled before weekend traffic hits.",
    gameTerritory: "Route Loop",
    accent: "#e8472a",
  },
] as const;

export interface RoutineItem {
  id: string;
  category: "Win-backs" | "Prospects" | "Ads" | "Money" | "Reviews" | "Routes";
  time: string;
  title: string;
  desc: string;
  receipt: string;
}

export const DAY_LINE_ROUTINES: readonly RoutineItem[] = [
  {
    id: "morning-call",
    category: "Routes",
    time: "7:30 AM",
    title: "Morning call",
    desc: "Claire calls with today's three high-leverage plays before you leave the house.",
    receipt: "Route sheet #04",
  },
  {
    id: "quiet-sweep",
    category: "Win-backs",
    time: "9:15 AM",
    title: "Quiet-customer sweep",
    desc: "Sable surfaces three clients whose regular orders paused over thirty days ago.",
    receipt: "Maya R. ($48)",
  },
  {
    id: "cold-route",
    category: "Prospects",
    time: "11:00 AM",
    title: "Cold-prospect route",
    desc: "Orren routes twenty-four contiguous doors in walking order. Parking before ten.",
    receipt: "Wilshire 1.3 mi",
  },
  {
    id: "ad-shoot",
    category: "Ads",
    time: "1:30 PM",
    title: "Ad shoot week",
    desc: "Luma queues three van-commercial hooks derived from last month's real drop data.",
    receipt: "Hook #02",
  },
  {
    id: "review-ask",
    category: "Reviews",
    time: "4:00 PM",
    title: "Review ask after delivery",
    desc: "Automatic draft sent for approval sixty minutes after bag delivery is verified.",
    receipt: "Order #8412",
  },
  {
    id: "invoice-chase",
    category: "Money",
    time: "5:15 PM",
    title: "Invoice chase",
    desc: "Gentle follow-up to two accounts with aging balances before the weekend cut.",
    receipt: "$340 balance",
  },
  {
    id: "evening-debrief",
    category: "Win-backs",
    time: "7:00 PM",
    title: "Evening debrief",
    desc: "Claire calls to hear what happened, logs every outcome, and closes the day.",
    receipt: "3 plays resolved",
  },
] as const;

export interface RosterMember {
  name: string;
  status: "active" | "earned";
  oneWordReason: string;
  role: string;
  flaw: string;
  accent: string;
  animal: string;
}

export const ROSTER_COMPANIONS: readonly RosterMember[] = [
  {
    name: "Rook",
    status: "active",
    oneWordReason: "Contact",
    role: "Socially fearless at any front desk.",
    flaw: "Exaggerates hilariously.",
    accent: "#e39b00",
    animal: "Messenger bird",
  },
  {
    name: "Sable",
    status: "active",
    oneWordReason: "Recall",
    role: "Remembers every customer.",
    flaw: "Remembers every excuse, too.",
    accent: "#e0457b",
    animal: "Black cat",
  },
  {
    name: "Luma",
    status: "active",
    oneWordReason: "Production",
    role: "Makes the ad in an hour.",
    flaw: "Changes it eleven times.",
    accent: "#13a39a",
    animal: "Chameleon director",
  },
  {
    name: "Orren",
    status: "active",
    oneWordReason: "Routing",
    role: "Never wastes a step.",
    flaw: "Never admits a wrong turn.",
    accent: "#e8472a",
    animal: "Desert tortoise",
  },
  {
    name: "Mara",
    status: "earned",
    oneWordReason: "Discovery",
    role: "Maps candidate doors and network accounts.",
    flaw: "Earned in the field after 25 customer wins.",
    accent: "#888888",
    animal: "Scout hawk",
  },
  {
    name: "Bront",
    status: "earned",
    oneWordReason: "Pricing",
    role: "Shapes offer language and defends margins.",
    flaw: "Earned in the field after 50 customer wins.",
    accent: "#888888",
    animal: "Negotiator badger",
  },
  {
    name: "Ilex",
    status: "earned",
    oneWordReason: "Signals",
    role: "Catches hidden objections and conversation patterns.",
    flaw: "Earned in the field after 100 customer wins.",
    accent: "#888888",
    animal: "Listening lynx",
  },
] as const;

export const LIVE_RUN_METRICS = [
  { count: "142", label: "Doors walked" },
  { count: "19", label: "Win-backs approved" },
  { count: "3", label: "Ads aired" },
  { count: "48", label: "Residents written" },
] as const;

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
