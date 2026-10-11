import { describe, expect, it } from "vitest";
import {
  groupConsecutiveActionSlots,
  visualStateForStop,
} from "./daylineWorldComposition";
import { liveObjectivesFromFieldToday } from "../driver/goldlineDayPlanModel";

describe("illustrated Day Line classification and identity", () => {
  it("uses the explicit marketing category without guessing from business names", () => {
    const groups = groupConsecutiveActionSlots([
      { id: "1", kind: "marketing" },
      { id: "2", kind: "prep" },
      { id: "3", kind: "growth" },
    ] as const);
    expect(groups.map(group => group.kind)).toEqual([
      "marketing",
      "generic",
      "growth",
    ]);
    const source = {
      id: "source-42",
      kind: "marketing_challenge",
      title: "Canonical challenge",
      subtitle: "",
      status: "published",
      urgency: "normal",
      scheduledAt: null,
      destination: null,
      source: { sourceReference: "source:42" },
    };
    expect(liveObjectivesFromFieldToday([source])[0]).toMatchObject({
      id: "source-42",
      kind: "marketing",
      status: "completed",
      address: null,
    });
    expect(
      liveObjectivesFromFieldToday([
        { ...source, kind: "unknown", title: "Post Zeely Ad" },
      ])
    ).toEqual([]);
  });
  it("preserves blocked, missing-details and verified states", () => {
    expect(visualStateForStop({ id: "1", status: "blocked" }, "1", false)).toBe(
      "blocked"
    );
    expect(
      visualStateForStop(
        { id: "1", status: "ready", attentionState: "needs_details" },
        "1",
        false
      )
    ).toBe("unknown");
    expect(
      visualStateForStop({ id: "1", status: "completed" }, "1", false)
    ).toBe("ready_to_open");
  });
});
