import { describe, expect, it } from "vitest";
import {
  decodeOpenChannelAudio,
  deterministicOpenChannelPlan,
} from "./openChannelService";

describe("Open Channel deterministic mission planner", () => {
  it("turns the operator's Sunday gap briefing into individual board spaces", () => {
    const plan = deterministicOpenChannelPlan(
      "I am hungry but should not spend money. I have printed collateral and should approach three local barbershops in Huntington Park. I brought personal dirty clothes to wash and dry. I need to collect quarters and count cash for Russell."
    );
    expect(plan.tasks.map(task => task.title)).toEqual([
      "Secure a low-cost meal",
      "Local shop outreach 1 of 3",
      "Local shop outreach 2 of 3",
      "Local shop outreach 3 of 3",
      "Start personal laundry",
      "Collect the quarters",
      "Count and reconcile cash",
    ]);
    expect(plan.tasks.filter(task => task.category === "sales")).toHaveLength(
      3
    );
    expect(plan.tasks[1].navigationQuery).toBe(
      "barbershops in Huntington Park CA"
    );
  });

  it("never fabricates an end time or address in its fallback mission", () => {
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
