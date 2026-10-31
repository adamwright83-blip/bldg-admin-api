/**
 * JOYSTICK's first ten minutes: Astra's onboarding (connect, understand, the crew gets acquainted, Claire's
 * portrait, the first playable chapter, activation, the first chapter remembered).
 * Build notes and the operator's configuration: docs/goldline/FIRST_TEN_MINUTES_BUILD.md.
 *
 * These are the contracts the server (server/firstTenMinutes/) and the page (client/src/pages/firstTenMinutes/)
 * share. Everything here is pure.
 */

/** One flag. Unset or anything unrecognised is off: the existing /joystick-start funnel is unchanged. */
export const FIRST_TEN_FLAG = "JOYSTICK_FIRST_TEN_MINUTES";

/**
 * - `off`: nobody sees it; every first-ten procedure refuses.
 * - `preview`: only a browser that opened /joystick-start?crew=1 sees it (remembered for that tab). For trying it in
 *   production while Google still lists the app in Testing mode.
 * - `on`: everyone who opens /joystick-start sees it.
 */
export type FirstTenMode = "off" | "preview" | "on";

export function parseFirstTenMode(value: string | null | undefined): FirstTenMode {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "on") return "on";
  if (normalized === "preview") return "preview";
  return "off";
}

/** /joystick-start?crew=1 opts a browser in while the flag is `preview`. */
export const FIRST_TEN_PREVIEW_PARAM = "crew";

/** The signup-draft mode a first-ten draft carries (onboardingMode on the legacy dayforge_saas_onboarding_sessions table). */
export const FIRST_TEN_ONBOARDING_MODE = "joystick_first_ten";
/** Today's JOYSTICK funnel (three questions, preview, identity, card). */
export const JOYSTICK_GENERIC_ONBOARDING_MODE = "joystick_generic";

/** Both JOYSTICK signup modes return to /joystick-start and provision a generic JOYSTICK workspace. */
export function isJoystickSignupMode(mode: string | null | undefined): boolean {
  return mode === JOYSTICK_GENERIC_ONBOARDING_MODE || mode === FIRST_TEN_ONBOARDING_MODE;
}

// ------------------------------------------------------------------ connections

export type ConnectionProvider = "google" | "slack";
export const CONNECTION_PROVIDERS: readonly ConnectionProvider[] = ["google", "slack"];

/** Read-only access, nothing more. Gmail and Drive read access are Google "restricted" scopes. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
] as const;

/** The three Google products the crew reads; each must be granted on the consent screen's checkboxes. */
export const GOOGLE_PRODUCT_SCOPES = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  calendar: "https://www.googleapis.com/auth/calendar.readonly",
  drive: "https://www.googleapis.com/auth/drive.readonly",
} as const;
export type GoogleProduct = keyof typeof GOOGLE_PRODUCT_SCOPES;

/** Slack user-token scopes: read the conversations the person is in, and who is in them. Never post. */
export const SLACK_USER_SCOPES = [
  "channels:read",
  "channels:history",
  "groups:read",
  "groups:history",
  "im:read",
  "im:history",
  "mpim:read",
  "mpim:history",
  "users:read",
  "search:read",
] as const;

/** Which Google products a granted scope string covers. Google lets a person untick any of them. */
export function grantedGoogleProducts(grantedScopes: readonly string[]): GoogleProduct[] {
  const granted = new Set(grantedScopes);
  return (Object.keys(GOOGLE_PRODUCT_SCOPES) as GoogleProduct[]).filter(product =>
    granted.has(GOOGLE_PRODUCT_SCOPES[product])
  );
}

export type ConnectionView = {
  provider: ConnectionProvider;
  /** the Google account's email, or "Slack workspace name" */
  account: string | null;
  connectedAt: string;
  /** Google only: which of Gmail, Calendar and Drive the person actually granted */
  products: GoogleProduct[];
};

/**
 * "What this connection includes", in plain words. Every line must stay true of the code: the readers in
 * server/firstTenMinutes/ read only what `reads` says, store only what `kept` says, and never do what `never` says.
 */
export type ConnectionIncludes = {
  title: string;
  reads: readonly string[];
  never: readonly string[];
  kept: readonly string[];
  stop: readonly string[];
};

export const CONNECTION_INCLUDES: Record<ConnectionProvider | "example", ConnectionIncludes> = {
  google: {
    title: "Connecting Google",
    reads: [
      "Gmail: the messages you've sent and received in the last twelve months. Who you write to, what people ask you for, what you promise.",
      "Google Calendar: your events from the last three months and the next month, so your routes and regular work show up.",
      "Google Drive: the names of your recent files, and the text of your recent documents.",
    ],
    never: [
      "Change or delete anything, or send without you. Connecting is read-only; if you choose to send a message from JOYSTICK, Google asks you first whether JOYSTICK may send from your account.",
      "Contact anyone. If you decide to write to someone, you'll see the recipient and every word first, and the message leaves from your own account when you send it.",
    ],
    kept: [
      "What your crew found, each with a short quote and where it came from. Not copies of your inbox, calendar or files.",
      "The access Google gives JOYSTICK, encrypted.",
      "To find what matters, the text of your messages is read by Anthropic's AI on JOYSTICK's behalf. JOYSTICK never sells your messages or uses them for advertising.",
    ],
    stop: [
      "Disconnect here at any time, or remove JOYSTICK at myaccount.google.com/permissions. Disconnecting deletes the stored access.",
      "While Google reviews JOYSTICK, Google may show a screen saying it hasn't verified the app yet.",
    ],
  },
  slack: {
    title: "Adding Slack",
    reads: [
      "Your own messages, and messages sent to you, from the last ninety days, with the names of the people in them.",
    ],
    never: ["Post, react, or change anything in Slack. Access is read-only."],
    kept: [
      "What your crew found, each with a short quote and where it came from. Not copies of your conversations.",
      "The access Slack gives JOYSTICK, encrypted.",
      "To find what matters, the text of your messages is read by Anthropic's AI on JOYSTICK's behalf. JOYSTICK never sells your messages or uses them for advertising.",
    ],
    stop: ["Disconnect here at any time, or remove JOYSTICK in your Slack workspace's app settings."],
  },
  example: {
    title: "Exploring an example",
    reads: [
      "Nina's flower studio: her email, calendar and files, all invented for this example.",
    ],
    never: ["Use anything from your accounts. Nothing here is yours, and nothing is sent to anyone."],
    kept: ["Nothing about you. You can bring your own world at any point."],
    stop: [],
  },
};

// ------------------------------------------------------------------ the journey

export type JourneyKind = "own" | "example";

/**
 * Where the visitor is. The page decides what to show inside a stage; the server keeps the stage so a reload, a
 * Google consent screen, or a Stripe checkout lands back in the same place.
 */
export const JOURNEY_STAGES = [
  "invitation",
  "connect",
  "understanding",
  "crew",
  "portrait",
  "chapter",
  "table",
  "activation",
  "first_chapter",
] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

export function isJourneyStage(value: unknown): value is JourneyStage {
  return typeof value === "string" && (JOURNEY_STAGES as readonly string[]).includes(value);
}

export type FirstTenJourneyView = {
  id: string;
  kind: JourneyKind;
  stage: JourneyStage;
  connections: ConnectionView[];
  /** The draft (and everything prepared in it) is kept until this moment, then expires with the signup draft. */
  expiresAt: string;
};

export type FirstTenAvailability = {
  mode: FirstTenMode;
  /** the server's answer for this browser: `on`, or `preview` with its preview pass */
  open: boolean;
  google: boolean;
  slack: boolean;
};

/** Is the experience shown to this browser? Only when the server says it is open to it (the pass is server-checked). */
export function firstTenShownTo(availability: Pick<FirstTenAvailability, "mode" | "open">): boolean {
  return availability.mode !== "off" && availability.open;
}

/** What /joystick-start?connect_error=… may say. Nothing from the provider is ever echoed. */
/** Sending from the person's own Gmail: asked for only when they first send from JOYSTICK. */
export const GOOGLE_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export const CONNECT_ERRORS = {
  cancelled: "You didn't finish connecting. Nothing was shared.",
  scopes: "Google connected, but without Gmail. Your crew needs to read your email to get acquainted; try again and keep the Gmail box ticked.",
  expired: "That connection took too long and expired. Please try again.",
  failed: "That didn't connect. Nothing was shared. Please try again.",
  send_permission: "Google didn't give JOYSTICK permission to send. Nothing was sent; your message is still here.",
  other_account: "That was a different Google account from the one your crew read. Choose the same account to send from it.",
} as const;
export type ConnectErrorCode = keyof typeof CONNECT_ERRORS;

export function connectErrorCode(value: string | null | undefined): ConnectErrorCode | null {
  return value && Object.prototype.hasOwnProperty.call(CONNECT_ERRORS, value) ? (value as ConnectErrorCode) : null;
}
