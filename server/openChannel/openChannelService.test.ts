import { describe, expect, it } from "vitest";
import {
  decodeOpenChannelAudio,
  deterministicOpenChannelPlan,
} from "./openChannelService";
import { effectiveOpenChannelTaskExecution } from "./openChannelTypes";

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

  it("every deterministic fallback task proposes an explicit base execution", () => {
    const plan = deterministicOpenChannelPlan(
      "Call two leads back and check on the supply order."
    );
    expect(plan.tasks.every(task => task.execution === "base")).toBe(true);
  });
});

describe("effectiveOpenChannelTaskExecution (§R1 legacy-default rule)", () => {
  it("honors an explicit stored execution over the navigationQuery signal", () => {
    expect(
      effectiveOpenChannelTaskExecution({
        execution: "base",
        navigationQuery: "Opus LA, 1601 Vine St",
      })
    ).toBe("base");
    expect(
      effectiveOpenChannelTaskExecution({
        execution: "physical_stop",
        navigationQuery: null,
      })
    ).toBe("physical_stop");
  });

  it("defaults a legacy null-execution row with a destination to physical_stop", () => {
    expect(
      effectiveOpenChannelTaskExecution({
        execution: null,
        navigationQuery: "Opus LA, 1601 Vine St",
      })
    ).toBe("physical_stop");
  });

  it("defaults a legacy null-execution row with no destination to base", () => {
    expect(
      effectiveOpenChannelTaskExecution({
        execution: null,
        navigationQuery: null,
      })
    ).toBe("base");
  });
});

describe("LOCAL_TARGET_RUN recognition (§PR77 Part 8, deterministic fallback path)", () => {
  it("recognizes Adam's own example as ONE target run, not ten prose steps", () => {
    const plan = deterministicOpenChannelPlan(
      "I need to stop into 10 dry cleaners to see if they'll give us their fluff and fold orders in exchange for our dry cleaning."
    );
    expect(plan.tasks).toHaveLength(0);
    expect(plan.localTargetRun).not.toBeNull();
    expect(plan.localTargetRun?.action).toBe("visit");
    expect(plan.localTargetRun?.targetQuery).toBe("dry cleaner");
    expect(plan.localTargetRun?.requestedCount).toBe(10);
  });

  it("never invents business names — the intent carries only a query and a count", () => {
    const plan = deterministicOpenChannelPlan(
      "I need to visit 6 hair salons to pitch our referral program."
    );
    expect(plan.localTargetRun?.targetQuery).toBe("hair salon");
    expect(plan.localTargetRun?.requestedCount).toBe(6);
    // No business name anywhere in the recognized intent — sourcing is a
    // separate, later step (materializeLocalTargetRun), never the model.
    expect(JSON.stringify(plan.localTargetRun)).not.toMatch(
      /cleaners|salon\s+(?:one|two|#)/i
    );
  });

  it("does not misfire on an ordinary count that isn't a visit-style request", () => {
    const plan = deterministicOpenChannelPlan(
      "Today I have 2 pickups and 3 deliveries, then I need to call Russell."
    );
    expect(plan.localTargetRun).toBeNull();
    expect(plan.tasks.length).toBeGreaterThan(0);
  });

  it("does not recognize a count outside the sane 2-25 range", () => {
    const plan = deterministicOpenChannelPlan(
      "I need to visit 1 dry cleaner about a referral."
    );
    expect(plan.localTargetRun).toBeNull();
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
