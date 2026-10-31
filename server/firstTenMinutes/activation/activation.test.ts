import { describe, expect, it } from "vitest";
import { draftStatusLine, offerWords } from "../../../shared/firstTenMinutesActivation";
import { advertisedOfferForPlan, JOYSTICK_ANNUAL_PLAN_KEY, JOYSTICK_MONTHLY_PLAN_KEY } from "../../saas/joystickStripeOffer";
import { isThePreparedMessage, latestOnSubject } from "./activation";

const PREPARED = {
  subject: "Re: Friday flowers?",
  body: "Hi Elena — you asked earlier this year about Friday flowers. We now have a weekly Friday delivery. Is that still something you're looking for at the hotel?",
};

describe("the offer, stated plainly", () => {
  it("states the advertised monthly offer as $79 a month with no trial, and annual with its seven days", () => {
    const monthly = advertisedOfferForPlan(JOYSTICK_MONTHLY_PLAN_KEY)!;
    expect(offerWords({ ...monthly, displayName: "JOYSTICK" })).toEqual({
      line: "JOYSTICK, $79 a month.",
      detail: "Card required. One plan. Cancel anytime.",
    });
    const annual = advertisedOfferForPlan(JOYSTICK_ANNUAL_PLAN_KEY)!;
    expect(offerWords({ ...annual, displayName: "JOYSTICK" }).line).toBe("7 days free, then $468 a year.");
  });

  it("says only what it knows for a plan whose price it can't see", () => {
    expect(offerWords({ trialDays: 0, unitAmountCents: null, interval: null, displayName: "JOYSTICK" })).toEqual({
      line: "JOYSTICK.",
      detail: "Card required.",
    });
  });
});

describe("the message leaving the table", () => {
  it("counts only the prepared message as found in the Sent folder: its subject, or its opening words", () => {
    expect(isThePreparedMessage({ subject: "Re: Friday flowers?", text: "Hi Elena — something else entirely" }, PREPARED)).toBe(true);
    expect(isThePreparedMessage({ subject: "RE: re: friday  flowers?", text: "" }, PREPARED)).toBe(true);
    // the subject changed in their own mail, the words didn't
    expect(isThePreparedMessage({ subject: "Fridays", text: `${PREPARED.body}\n\nNina` }, PREPARED)).toBe(true);
    // other mail to the same person, after the hand-off, is not the message
    expect(isThePreparedMessage({ subject: "Invoice for the gala", text: "Hi Elena, the invoice for Saturday is attached." }, PREPARED)).toBe(false);
    expect(isThePreparedMessage({ subject: "", text: "Thanks!" }, { subject: "", body: "Thanks!" })).toBe(false);
  });

  it("takes the newest reply on the message's subject: where things stand is the last word", () => {
    const mail = [
      { subject: "Re: Friday flowers?", text: "Yes please, let's start this Friday.", at: new Date("2026-10-29T16:00:00Z") },
      { subject: "RE: Friday flowers?", text: "Actually, we'll have to hold off for now.", at: new Date("2026-10-29T18:00:00Z") },
      { subject: "Lunch?", text: "Free for lunch on Monday?", at: new Date("2026-10-29T19:00:00Z") },
    ];
    expect(latestOnSubject(mail, PREPARED.subject)?.text).toBe("Actually, we'll have to hold off for now.");
    // newest by when it was written, whatever order the mail comes in
    expect(latestOnSubject([...mail].reverse(), PREPARED.subject)?.text).toBe("Actually, we'll have to hold off for now.");
    // other mail from them is not a reply
    expect(latestOnSubject(mail.slice(2), PREPARED.subject)).toBeNull();
  });

  it("says how it left: opened in their mail, or copied", () => {
    const at = { handedOffAt: "2026-10-29T17:02:00Z", reportedSentAt: null, verifiedSentAt: null };
    expect(draftStatusLine("handed_off", { ...at, handedOffVia: "gmail" })).toMatch(/^Opened in your mail at .+\. JOYSTICK didn't send it\.$/);
    expect(draftStatusLine("handed_off", { ...at, handedOffVia: "copy" })).toMatch(/^Copied at .+\. JOYSTICK didn't send it\.$/);
  });

  it("says sent from JOYSTICK only with Google's id, and an unconfirmed send is never called sent", () => {
    const at = { handedOffAt: "2026-10-31T17:02:00Z", reportedSentAt: null, verifiedSentAt: "2026-10-31T17:02:05Z" };
    expect(draftStatusLine("verified_sent", { ...at, sentByJoystick: true })).toMatch(/^Sent from your Gmail at .+\.$/);
    expect(draftStatusLine("verified_sent", { ...at, sentByJoystick: false })).toMatch(/^In your Sent folder/);
    expect(draftStatusLine("sending", { ...at, verifiedSentAt: null })).toBe("Sending from your Gmail. JOYSTICK will say it went only once Google shows it.");
  });
});
