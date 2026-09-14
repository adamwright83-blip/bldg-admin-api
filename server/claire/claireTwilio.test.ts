import { describe, expect, it, vi } from "vitest";

vi.mock("../_core/env", () => ({
  ENV: { adminBaseUrl: "https://api.example.test" },
}));

import { preDriveConversationTwiML } from "./claireTwilio";

describe("Claire Twilio pre-drive TwiML", () => {
  it("uses a conversational voice and gathers barge-in speech around the opening", () => {
    const xml = preDriveConversationTwiML({
      text: "Your next stop is The Wilshire. Ask how laundry works today.",
      token: "signed-token",
      opening: true,
    });

    expect(xml).toContain('voice="Polly.Ruth-Generative"');
    expect(xml).toContain('rate="90%"');
    expect(xml).toContain('volume="+6dB"');
    expect(xml).toContain('input="speech"');
    expect(xml).toContain('bargeIn="true"');
    expect(xml).toContain('speechModel="experimental_conversations"');
    expect(xml.indexOf("<Gather")).toBeLessThan(
      xml.indexOf("Adam. Claire here.")
    );
    expect(xml.indexOf("Adam. Claire here.")).toBeLessThan(
      xml.indexOf("</Gather>")
    );
    expect(xml).toContain("/api/claire/twilio/pre-drive?token=signed-token");
  });

  it("keeps each follow-up answer inside another speech gather", () => {
    const xml = preDriveConversationTwiML({
      text: "The context names the building, but not a person.",
      token: "signed-token",
    });

    expect(xml).not.toContain("Adam. Claire here.");
    expect(xml.indexOf("<Gather")).toBeLessThan(
      xml.indexOf("The context names the building")
    );
    expect(xml.indexOf("The context names the building")).toBeLessThan(
      xml.indexOf("</Gather>")
    );
  });
});
