import { describe, expect, it } from "vitest";
import {
  initialPressureState,
  PRESSURE_HOLD_BUDGET_MS,
  PRESSURE_IMPACT_THRESHOLD_MS,
  punishmentWouldAdvance,
  reducePressure,
  restorePressureAcrossRefresh,
} from "./spiritHumanPressure";

describe("Spirit Human pressure machine", () => {
  it("freezes immediately when the player prepares outreach, before draft exists", () => {
    const armed = reducePressure(initialPressureState(0), { type: "tick", nowMs: 4_000 });
    expect(armed.phase).toBe("descent");
    const held = reducePressure(armed, { type: "player_prepare", nowMs: 4_100 });
    expect(held.phase).toBe("holding");
    expect(held.frozenReason).toBe("drafting");
    const stillHeld = reducePressure(held, { type: "tick", nowMs: 30_000 });
    expect(stillHeld.phase).toBe("holding");
    expect(punishmentWouldAdvance(stillHeld)).toBe(false);
  });

  it("does not start HOLD budget until the draft is visible", () => {
    const preparing = reducePressure(initialPressureState(0), { type: "player_prepare", nowMs: 1_000 });
    const late = reducePressure(preparing, { type: "tick", nowMs: 1_000 + PRESSURE_HOLD_BUDGET_MS + 5_000 });
    expect(late.phase).toBe("holding");
    const ready = reducePressure(preparing, { type: "draft_ready", nowMs: 2_000 });
    expect(ready.draftVisible).toBe(true);
    expect(ready.frozenReason).toBeNull();
    const unstable = reducePressure(ready, {
      type: "tick",
      nowMs: 2_000 + PRESSURE_HOLD_BUDGET_MS,
    });
    expect(unstable.phase).toBe("unstable");
  });

  it("freezes punishment while send is in flight and on driving/background", () => {
    const ready = reducePressure(initialPressureState(0), { type: "draft_ready", nowMs: 1_000 });
    const sending = reducePressure(ready, { type: "send_started", nowMs: 1_100 });
    expect(punishmentWouldAdvance(sending)).toBe(false);
    expect(reducePressure(sending, { type: "tick", nowMs: 40_000 }).phase).not.toBe("impact");
    const driving = reducePressure(ready, { type: "driving_changed", nowMs: 1_200, driving: true });
    expect(driving.frozenReason).toBe("driving");
    const bg = reducePressure(ready, { type: "background", nowMs: 1_300 });
    const fg = reducePressure(bg, { type: "foreground", nowMs: 21_300, elapsedBackgroundMs: 20_000 });
    expect(fg.roundAnchorMs).toBe(ready.roundAnchorMs + 20_000);
  });

  it("rescues only on send success; send failure does not impact-kill", () => {
    const sending = reducePressure(initialPressureState(0), { type: "send_started", nowMs: 1_000 });
    expect(reducePressure(sending, { type: "send_succeeded", nowMs: 1_200 }).phase).toBe("rescue");
    expect(reducePressure(sending, { type: "send_failed", nowMs: 1_200 }).phase).toBe("resetting");
    expect(reducePressure(sending, { type: "send_failed", nowMs: 1_200 }).phase).not.toBe("impact");
  });

  it("does not let a cheap refresh erase an in-window round, and completed missions stay rescued", () => {
    const restored = restorePressureAcrossRefresh({
      storedAnchorMs: 1_000,
      nowMs: 8_000,
      missionCompleted: false,
    });
    expect(restored.phase).toBe("descent");
    expect(
      restorePressureAcrossRefresh({
        storedAnchorMs: 1_000,
        nowMs: 8_000,
        missionCompleted: true,
      }).phase
    ).toBe("rescue");
  });

  it("can still reach impact when the player idles with a visible draft and no freeze", () => {
    const ready = reducePressure(initialPressureState(0), { type: "draft_ready", nowMs: 0 });
    const afterHold = reducePressure(ready, { type: "tick", nowMs: PRESSURE_HOLD_BUDGET_MS });
    expect(afterHold.phase).toBe("unstable");
    const idle = reducePressure(initialPressureState(0), {
      type: "tick",
      nowMs: PRESSURE_IMPACT_THRESHOLD_MS,
    });
    expect(idle.phase).toBe("impact");
  });
});
