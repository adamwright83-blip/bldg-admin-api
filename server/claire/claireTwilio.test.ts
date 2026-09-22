import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../_core/env", () => ({
  ENV: {
    adminBaseUrl: "https://api.example.test",
    cookieSecret: "test-secret",
    xaiApiKey: "",
    claireXaiTtsEnabled: false,
    claireXaiTtsVoiceId: "eve",
  },
}));

import { CLAIRE_AMD_PATH } from "./amdVoicemail";
import {
  claireVoiceCallCreateOptions,
  CLAIRE_CALL_STATUS_PATH,
  CLAIRE_RECORDING_STATUS_PATH,
  preDriveConversationTwiML,
  registerClaireRoutes,
  spokenClaireText,
} from "./claireTwilio";
import { isClaireVoiceRecordingEnabled } from "./conversation/consent";

describe("H — existing Claire conversational loop remains intact", () => {
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
    expect(spokenClaireText("Your next stop is The Wilshire. Ask how laundry works today.", true)).toBe(
      "Adam. Claire here. Your next stop is The Wilshire. Ask how laundry works today."
    );
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

describe("Claire voice recording gate", () => {
  it("stays off unless the explicit env flag is set", () => {
    expect(isClaireVoiceRecordingEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isClaireVoiceRecordingEnabled({ CLAIRE_VOICE_RECORDING_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
    const previous = process.env.CLAIRE_VOICE_RECORDING_ENABLED;
    delete process.env.CLAIRE_VOICE_RECORDING_ENABLED;
    const disabled = claireVoiceCallCreateOptions();
    expect(disabled.record).toBe(false);
    expect(disabled.recordingStatusCallback).toBeUndefined();
    expect(disabled.statusCallback).toContain(CLAIRE_CALL_STATUS_PATH);
    process.env.CLAIRE_VOICE_RECORDING_ENABLED = "true";
    const enabled = claireVoiceCallCreateOptions();
    expect(enabled.record).toBe(true);
    expect(enabled.recordingChannels).toBe("dual");
    expect(enabled.recordingStatusCallback).toContain(CLAIRE_RECORDING_STATUS_PATH);
    expect(enabled.recordingStatusCallbackEvent).toEqual(["completed", "absent"]);
    if (previous === undefined) delete process.env.CLAIRE_VOICE_RECORDING_ENABLED;
    else process.env.CLAIRE_VOICE_RECORDING_ENABLED = previous;
  });
});

describe("Claire production Twilio callback registration", () => {
  it("mounts xAI speech media plus the existing Twilio callbacks", () => {
    const postPaths: string[] = [];
    const getPaths: string[] = [];
    registerClaireRoutes({
      post: (path: string) => postPaths.push(path),
      get: (path: string) => getPaths.push(path),
    } as never);
    expect(getPaths).toEqual(["/api/claire/voice/xai"]);
    expect(postPaths).toEqual([
      "/api/claire/twilio/inbound",
      "/api/claire/twilio/pre-drive",
      "/api/claire/twilio/pre-drive/continue",
      "/api/claire/twilio/debrief",
      "/api/claire/twilio/confirm",
      CLAIRE_RECORDING_STATUS_PATH,
      CLAIRE_CALL_STATUS_PATH,
      CLAIRE_AMD_PATH,
    ]);
  });

  it("the production Express entrypoint registers those Claire routes", () => {
    const src = readFileSync("server/_core/index.ts", "utf8");
    expect(src).toContain('import { registerClaireRoutes } from "../claire/claireTwilio"');
    expect(src).toContain("registerClaireRoutes(app)");
  });
});
