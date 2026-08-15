import { describe, expect, it } from "vitest";
import {
  decodeOpenChannelAudio,
  deterministicOpenChannelPlan,
} from "./openChannelService";

describe("Open Channel deterministic mission planner", () => {
  it("keeps every operator briefing item instead of collapsing to one keyword task", () => {
    const plan = deterministicOpenChannelPlan(
      "Today I need to pick up order 101 and drop off order 202 and visit two apartment buildings and call Russell and tomorrow follow up with the Airbnb manager."
    );
    const joined = plan.tasks.map(task => `${task.title} ${task.detail}`).join(" ").toLowerCase();
    expect(plan.tasks.length).toBeGreaterThanOrEqual(5);
    expect(joined).toContain("pick up order 101");
    expect(joined).toContain("drop off order 202");
    expect(joined).toContain("visit two apartment buildings");
    expect(joined).toContain("call russell");
    expect(joined).toContain("tomorrow follow up with the airbnb manager");
  });

  it("never converts a stray food/eat token into an invented canned meal task", () => {
    const plan = deterministicOpenChannelPlan(
      "Pick up the laundry bags. The rough transcript also contains the word eat. Drop off the finished order."
    );
    expect(plan.tasks.map(task => task.title)).not.toContain("Secure a low-cost meal");
    expect(plan.tasks.every(task => task.navigationQuery === null)).toBe(true);
    expect(JSON.stringify(plan)).not.toContain("inexpensive grocery store food near me");
  });

  it("does not fabricate an end time or address in fallback mode", () => {
    const plan = deterministicOpenChannelPlan(
      "I need to organize the supplies in my car and write down what is missing before tomorrow."
    );
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].navigationQuery).toBeNull();
    expect(JSON.stringify(plan)).not.toMatch(/\b(?:am|pm)\b/i);
  });
});

describe("decodeOpenChannelAudio", () => {
  it("accepts Android codec-qualified WebM audio data URLs", () => {
    const recording = decodeOpenChannelAudio(
      "data:audio/webm;codecs=opus;base64,SGVsbG8="
    );
    expect(recording.mimeType).toBe("audio/webm");
    expect(recording.data.toString("utf8")).toBe("Hello");
  });

  it("accepts Android WebM containers reported as video", () => {
    const recording = decodeOpenChannelAudio(
      "data:video/webm;codecs=opus;base64,SGVsbG8="
    );
    expect(recording.mimeType).toBe("video/webm");
  });

  it("rejects non-recording data URLs", () => {
    expect(() =>
      decodeOpenChannelAudio("data:image/png;base64,SGVsbG8=")
    ).toThrow("Audio recording format is invalid");
  });
});
