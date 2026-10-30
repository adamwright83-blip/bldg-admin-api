/**
 * Activation at the moment of value (docs/goldline/FIRST_TEN_MINUTES_BUILD.md, slice 6). The person keeps their crew
 * when the prepared message has value; the offer is stated plainly, exactly as it is; checkout returns to the
 * prepared message. Sending is the person's own: their mail opens with the message ready, and nothing is ever shown as
 * sent unless they said so or their own Sent folder shows it.
 */
import type { DraftStatus } from "./firstTenMinutesChapter";

export type ActivationOffer = {
  planKey: string;
  /** "7 days free, then $49 a month." */
  line: string;
  /** "Card required. One plan. Cancel anytime." */
  detail: string;
};

export type ActivationView = {
  /** Nina's example: nothing activates and nothing is sent */
  example: boolean;
  /** billing is open, so activation comes before the message leaves the table */
  required: boolean;
  offer: ActivationOffer | null;
  status: "none" | "checkout_pending" | "active";
  /** what JOYSTICK already knows, for the person to confirm */
  identity: { businessName: string | null; contactName: string | null; ownerEmail: string | null };
  /** the person's own mail is connected, so the message can open there and be looked for in Sent */
  canOpenInGmail: boolean;
  /** the connected Gmail account, so the message opens in the right one */
  gmailAccount: string | null;
  /**
   * Where checkout comes back to (today's billing returns to one origin). A journey begun elsewhere is carried there
   * first, or the person would come back to a page that doesn't know them.
   */
  returnOrigin: string;
};

export const ACTIVATION_COPY = {
  heading: "Keep your crew. Continue your story.",
  waiting: "Your business portrait, this conversation, and everything you've prepared will be waiting here.",
  button: "Continue with JOYSTICK",
  closed: "JOYSTICK isn't taking payment yet. Everything here is saved.",
} as const;

/** The advertised JOYSTICK offer (server/saas/joystickStripeOffer.ts), in plain words. */
export function offerWords(input: { trialDays: number; unitAmountCents: number | null; interval: "month" | "year" | null; displayName: string }): {
  line: string;
  detail: string;
} {
  const price = input.unitAmountCents !== null ? `$${(input.unitAmountCents / 100).toFixed(input.unitAmountCents % 100 ? 2 : 0)}` : null;
  const per = input.interval === "year" ? "a year" : "a month";
  if (price && input.trialDays > 0) return { line: `${input.trialDays} days free, then ${price} ${per}.`, detail: "Card required. One plan. Cancel anytime." };
  if (price) return { line: `${price} ${per}.`, detail: "Card required. Cancel anytime." };
  return { line: input.trialDays > 0 ? `${input.displayName}, ${input.trialDays} days free.` : `${input.displayName}.`, detail: "Card required." };
}

/** Gmail's own compose window, with the message ready. Opening it sends nothing. */
export function gmailComposeUrl(input: { to: string; subject: string; body: string; account: string | null }): string {
  const params = new URLSearchParams({ view: "cm", fs: "1", to: input.to, su: input.subject, body: input.body });
  if (input.account) params.set("authuser", input.account);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/** What the person is told about the message, from what actually happened. */
export function draftStatusLine(
  status: DraftStatus,
  at: { handedOffAt: string | null; reportedSentAt: string | null; verifiedSentAt: string | null; handedOffVia?: "gmail" | "copy" | null }
): string | null {
  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
  switch (status) {
    case "prepared":
      return "Prepared. Not sent.";
    case "declined":
      return "Not now. It stays here, unsent.";
    case "handed_off":
      return `${at.handedOffVia === "copy" ? "Copied" : "Opened in your mail"}${at.handedOffAt ? ` at ${time(at.handedOffAt)}` : ""}. JOYSTICK didn't send it.`;
    case "reported_sent":
      return "You said you sent it.";
    case "verified_sent":
      return `In your Sent folder${at.verifiedSentAt ? `, ${time(at.verifiedSentAt)}` : ""}.`;
  }
}
