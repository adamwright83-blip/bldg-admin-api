import { describe, expect, it } from "vitest";
import { draftStatusLine } from "../../../shared/firstTenMinutesActivation";
import { isThePreparedMessage } from "./activation";

const PREPARED = {
  subject: "Re: Friday flowers?",
  body: "Hi Elena — you asked earlier this year about Friday flowers. We now have a weekly Friday delivery. Is that still something you're looking for at the hotel?",
};

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

  it("says how it left: opened in their mail, or copied", () => {
    const at = { handedOffAt: "2026-10-29T17:02:00Z", reportedSentAt: null, verifiedSentAt: null };
    expect(draftStatusLine("handed_off", { ...at, handedOffVia: "gmail" })).toMatch(/^Opened in your mail at .+\. JOYSTICK didn't send it\.$/);
    expect(draftStatusLine("handed_off", { ...at, handedOffVia: "copy" })).toMatch(/^Copied at .+\. JOYSTICK didn't send it\.$/);
  });
});
