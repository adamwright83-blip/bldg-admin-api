import { describe, expect, it } from "vitest";
import {
  describeMicrophoneError,
  describeSaveError,
  startOptionalBrowserTranscript,
} from "./SalesMomentum";

/**
 * A real Android user recorded a journal entry successfully, but Save
 * failed with the raw browser "Failed to fetch" message and no indication
 * their recording was still safe. This only maps error shapes the code can
 * actually distinguish — it never invents a root cause it hasn't verified.
 */
describe("describeSaveError", () => {
  it("maps a raw network failure to a truthful, recoverable message", () => {
    const message = describeSaveError(new TypeError("Failed to fetch"));
    expect(message).toMatch(/could not reach the server/i);
    expect(message).toMatch(/still here/i);
  });

  it("maps a server-reported size limit to a truthful, actionable message", () => {
    const message = describeSaveError(
      new Error("Audio recording must be between 1 byte and 12 MB")
    );
    expect(message).toMatch(/too large/i);
  });

  it("maps a transcription failure to a truthful message without fabricating a transcript", () => {
    const message = describeSaveError(
      new Error("Could not transcribe this recording: service unavailable")
    );
    expect(message).toMatch(/transcription is unavailable/i);
    expect(message).not.toMatch(/service unavailable/i);
  });

  it("falls back to the real server error message for anything else it can't specifically classify", () => {
    expect(describeSaveError(new Error("journal date is required"))).toBe(
      "journal date is required"
    );
  });

  it("never throws and always returns a truthful string, even for a non-Error value", () => {
    expect(describeSaveError("not an Error instance")).toMatch(
      /could not save your journal/i
    );
    expect(describeSaveError(undefined)).toMatch(/could not save your journal/i);
  });
});


describe("mission debrief audio capture", () => {
  it("treats browser SpeechRecognition failure as optional instead of a microphone failure", () => {
    const session = startOptionalBrowserTranscript(
      { initialText: "", onTranscript: () => undefined },
      (() => {
        throw new Error("SpeechRecognition unsupported");
      }) as never
    );
    expect(session).toBeNull();
  });

  it("reports an actual microphone permission denial separately from live transcription support", () => {
    const message = describeMicrophoneError(
      new DOMException("Permission denied", "NotAllowedError")
    );
    expect(message).toMatch(/blocked microphone access/i);
    expect(message).toMatch(/type what happened/i);
  });

  it("does not mislabel an unknown recorder failure as permission denied", () => {
    const message = describeMicrophoneError(new Error("recorder failed"));
    expect(message).not.toMatch(/permission denied/i);
    expect(message).toMatch(/type what happened/i);
  });
});
