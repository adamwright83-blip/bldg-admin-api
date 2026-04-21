import { describe, expect, it } from "vitest";
import {
  createInitialDriverPrepState,
  driverPrepReducer,
  getPayloadCountForMission,
  isConsecutiveDay,
  type DriverPrepAction,
  type DriverPrepState,
} from "../driverPrepMachine";

/**
 * These tests lock down the MUST-PRESERVE gameplay rules that carried over
 * from the legacy Minesweeper version into the Tactical Noir port:
 *
 *   1. Payload count == mission number; N payloads per mission.
 *   2. Signal Override failure hard-resets the payload loop to 1 while
 *      preserving prep, mission number, and lifetime history.
 *   3. Day rollover advances the mission number.
 *   4. Lifetime stats (payloadsDiffusedLifetime / missionsCompletedLifetime /
 *      totalXp / streakDays / lastCompletedDayKey) accumulate correctly.
 *   5. missionCompletedForDay blocks further mission work until day rollover.
 */

function run(state: DriverPrepState, ...actions: DriverPrepAction[]): DriverPrepState {
  return actions.reduce(driverPrepReducer, state);
}

/** Replay the entire happy-path of a single payload, bottoming out in verify_success. */
function completeOnePayload(
  state: DriverPrepState,
  opts: { orderId: number; now: string; xp?: number } = {
    orderId: 1,
    now: "2026-04-20T10:00:00.000Z",
  }
): DriverPrepState {
  const previewUrl = "data:image/png;base64,AAA";
  let next = run(
    state,
    { type: "SELECT_ORDER", orderId: opts.orderId },
    { type: "START_RUN_FROM_ORDER" }
  );
  // If prep isn't secured yet, walk through the three prep tiers.
  if (next.phase === "prep_t1") {
    next = run(
      next,
      { type: "SET_PREP_PREVIEW", tier: 1, previewDataUrl: previewUrl },
      { type: "SECURE_PREP_TASK", tier: 1, now: opts.now },
      { type: "SET_PREP_PREVIEW", tier: 2, previewDataUrl: previewUrl },
      { type: "SECURE_PREP_TASK", tier: 2, now: opts.now },
      { type: "SET_PREP_PREVIEW", tier: 3, previewDataUrl: previewUrl },
      { type: "SECURE_PREP_TASK", tier: 3, now: opts.now },
      { type: "ADVANCE_PREP_COMPLETE" }
    );
  }
  return run(
    next,
    { type: "COMPLETE_LAUNDRY_RUN", score: 7 },
    { type: "ADVANCE_TO_FLYER_PROOF" },
    {
      type: "COMPLETE_FLYER_PROOF",
      previewDataUrl: previewUrl,
    },
    {
      type: "START_SIGNAL_OVERRIDE",
      startedAt: opts.now,
      deadlineAt: opts.now,
    },
    {
      type: "RESOLVE_VERIFY_SUCCESS",
      now: opts.now,
      resolvedOrder: { orderId: opts.orderId, nextStatus: "collected" },
      xpAwarded: opts.xp ?? 100,
    },
    { type: "ADVANCE_AFTER_VERIFY_SUCCESS" }
  );
}

describe("driverPrepMachine — payload count", () => {
  it("mission N requires exactly N completed payloads", () => {
    for (const mission of [1, 3, 7, 30]) {
      expect(getPayloadCountForMission(mission)).toBe(mission);
    }
    expect(getPayloadCountForMission(0)).toBe(1);
    expect(getPayloadCountForMission(99)).toBe(30);
  });
});

describe("driverPrepMachine — payload progression", () => {
  it("gates Signal Override behind flyer proof capture", () => {
    const previewUrl = "data:image/png;base64,AAA";
    let state = createInitialDriverPrepState(1, "2026-04-20");
    state = run(
      state,
      { type: "SELECT_ORDER", orderId: 77 },
      { type: "START_RUN_FROM_ORDER" },
      { type: "SET_PREP_PREVIEW", tier: 1, previewDataUrl: previewUrl },
      { type: "SECURE_PREP_TASK", tier: 1, now: "2026-04-20T10:00Z" },
      { type: "SET_PREP_PREVIEW", tier: 2, previewDataUrl: previewUrl },
      { type: "SECURE_PREP_TASK", tier: 2, now: "2026-04-20T10:00Z" },
      { type: "SET_PREP_PREVIEW", tier: 3, previewDataUrl: previewUrl },
      { type: "SECURE_PREP_TASK", tier: 3, now: "2026-04-20T10:00Z" },
      { type: "ADVANCE_PREP_COMPLETE" },
      { type: "COMPLETE_LAUNDRY_RUN", score: 4 }
    );
    expect(state.phase).toBe("mission_briefing");

    state = run(state, {
      type: "START_SIGNAL_OVERRIDE",
      startedAt: "2026-04-20T10:01Z",
      deadlineAt: "2026-04-20T10:01:08Z",
    });
    expect(state.phase).toBe("mission_briefing");

    state = run(state, { type: "ADVANCE_TO_FLYER_PROOF" });
    expect(state.phase).toBe("flyer_proof");

    state = run(state, {
      type: "COMPLETE_FLYER_PROOF",
      previewDataUrl: previewUrl,
    });
    expect(state.phase).toBe("signal_override");
    expect(state.deployment.status).toBe("uploaded");
    expect(state.deployment.previewDataUrl).toBe(previewUrl);

    state = run(state, {
      type: "START_SIGNAL_OVERRIDE",
      startedAt: "2026-04-20T10:01Z",
      deadlineAt: "2026-04-20T10:01:08Z",
    });
    expect(state.verification.startedAt).toBe("2026-04-20T10:01Z");
    expect(state.verification.deadlineAt).toBe("2026-04-20T10:01:08Z");
  });

  it("mission 3 requires three complete loops before missionCompletedForDay flips", () => {
    let state = createInitialDriverPrepState(3, "2026-04-20");
    expect(state.payloadCount).toBe(3);
    expect(state.currentPayloadIndex).toBe(1);
    expect(state.missionCompletedForDay).toBe(false);

    state = completeOnePayload(state, { orderId: 101, now: "2026-04-20T10:00Z" });
    expect(state.completedPayloadsCurrentMission).toBe(1);
    expect(state.currentPayloadIndex).toBe(2);
    expect(state.missionCompletedForDay).toBe(false);
    expect(state.phase).toBe("next_target");

    state = run(state, { type: "RESUME_AFTER_MAP_RETURN" });
    expect(state.phase).toBe("laundry_run");

    state = completeOnePayload(state, { orderId: 102, now: "2026-04-20T11:00Z" });
    expect(state.completedPayloadsCurrentMission).toBe(2);
    expect(state.currentPayloadIndex).toBe(3);
    expect(state.missionCompletedForDay).toBe(false);

    state = run(state, { type: "RESUME_AFTER_MAP_RETURN" });
    state = completeOnePayload(state, { orderId: 103, now: "2026-04-20T12:00Z" });
    expect(state.completedPayloadsCurrentMission).toBe(3);
    expect(state.missionCompletedForDay).toBe(true);
    expect(state.phase).toBe("mission_complete");
    expect(state.history.missionsCompletedLifetime).toBe(1);
  });
});

describe("driverPrepMachine — hard reset on Signal Override failure", () => {
  it("RESOLVE_VERIFY_FAILURE resets payload loop to 1 but preserves prep, missionNumber, and lifetime history", () => {
    const previewUrl = "data:image/png;base64,AAA";
    let state = createInitialDriverPrepState(5, "2026-04-20");
    // Complete two payloads of mission 5.
    state = completeOnePayload(state, { orderId: 201, now: "2026-04-20T10:00Z", xp: 75 });
    state = run(state, { type: "RESUME_AFTER_MAP_RETURN" });
    state = completeOnePayload(state, { orderId: 202, now: "2026-04-20T11:00Z", xp: 75 });
    state = run(state, { type: "RESUME_AFTER_MAP_RETURN" });

    expect(state.currentPayloadIndex).toBe(3);
    expect(state.completedPayloadsCurrentMission).toBe(2);
    const prepBefore = state.prepUploads;
    const historyBefore = state.history;
    const missionBefore = state.missionNumber;

    // Walk into Signal Override on payload 3 and fail the climax.
    state = run(
      state,
      { type: "COMPLETE_LAUNDRY_RUN", score: 5 },
      { type: "ADVANCE_TO_FLYER_PROOF" },
      {
        type: "COMPLETE_FLYER_PROOF",
        previewDataUrl: previewUrl,
      },
      {
        type: "START_SIGNAL_OVERRIDE",
        startedAt: "2026-04-20T12:00Z",
        deadlineAt: "2026-04-20T12:00:08Z",
      },
      {
        type: "RESOLVE_VERIFY_FAILURE",
        reason: "manual_test_failure",
        now: "2026-04-20T12:00:09Z",
      }
    );

    expect(state.phase).toBe("verify_failed");
    expect(state.currentPayloadIndex).toBe(1);
    expect(state.completedPayloadsCurrentMission).toBe(0);
    expect(state.laundryRunScore).toBe(0);
    expect(state.resolvedOrderIdsCurrentMission).toEqual([]);
    expect(state.pendingOrderResolution).toBeNull();
    expect(state.deployment).toEqual({
      status: "empty",
      previewDataUrl: null,
      uploadedAt: null,
    });
    // Prep, mission number, history all untouched.
    expect(state.prepUploads).toEqual(prepBefore);
    expect(state.missionNumber).toBe(missionBefore);
    expect(state.history).toEqual(historyBefore);

    // Acking bounces the driver back to laundry_run to redo the loop.
    state = run(state, { type: "ACK_VERIFY_FAILURE" });
    expect(state.phase).toBe("laundry_run");
    expect(state.verification.result).toBe("pending");
  });
});

describe("driverPrepMachine — day rollover", () => {
  it("ROLL_TO_NEXT_DAY advances mission number and carries history when the prior mission completed on another day", () => {
    let state = createInitialDriverPrepState(1, "2026-04-20");
    state = completeOnePayload(state, { orderId: 301, now: "2026-04-20T10:00Z" });
    expect(state.missionCompletedForDay).toBe(true);
    expect(state.history.lastCompletedDayKey).toBe("2026-04-20");
    const histBefore = state.history;

    const next = driverPrepReducer(state, {
      type: "ROLL_TO_NEXT_DAY",
      todayKey: "2026-04-21",
    });
    expect(next.missionNumber).toBe(2);
    expect(next.payloadCount).toBe(2);
    expect(next.missionDayKey).toBe("2026-04-21");
    expect(next.missionCompletedForDay).toBe(false);
    expect(next.phase).toBe("command_center");
    expect(next.currentPayloadIndex).toBe(1);
    expect(next.completedPayloadsCurrentMission).toBe(0);
    // History carried over.
    expect(next.history).toEqual(histBefore);
  });

  it("ROLL_TO_NEXT_DAY is a no-op if the current day is not yet complete", () => {
    const state = createInitialDriverPrepState(2, "2026-04-20");
    const result = driverPrepReducer(state, {
      type: "ROLL_TO_NEXT_DAY",
      todayKey: "2026-04-21",
    });
    expect(result).toBe(state);
  });

  it("mission number wraps from 30 back to 1", () => {
    let state = createInitialDriverPrepState(30, "2026-04-20");
    for (let i = 0; i < 30; i += 1) {
      state = completeOnePayload(state, {
        orderId: 500 + i,
        now: "2026-04-20T10:00Z",
      });
      if (i < 29) {
        state = driverPrepReducer(state, { type: "RESUME_AFTER_MAP_RETURN" });
      }
    }
    expect(state.missionCompletedForDay).toBe(true);
    const next = driverPrepReducer(state, {
      type: "ROLL_TO_NEXT_DAY",
      todayKey: "2026-04-21",
    });
    expect(next.missionNumber).toBe(1);
    expect(next.payloadCount).toBe(1);
  });
});

describe("driverPrepMachine — lifetime stats", () => {
  it("payloadsDiffusedLifetime and totalXp accumulate per successful payload", () => {
    let state = createInitialDriverPrepState(2, "2026-04-20");
    expect(state.history.payloadsDiffusedLifetime).toBe(0);
    expect(state.history.totalXp).toBe(0);

    state = completeOnePayload(state, {
      orderId: 401,
      now: "2026-04-20T10:00Z",
      xp: 120,
    });
    expect(state.history.payloadsDiffusedLifetime).toBe(1);
    expect(state.history.totalXp).toBe(120);
    expect(state.history.missionsCompletedLifetime).toBe(0);

    state = driverPrepReducer(state, { type: "RESUME_AFTER_MAP_RETURN" });
    state = completeOnePayload(state, {
      orderId: 402,
      now: "2026-04-20T11:00Z",
      xp: 80,
    });
    expect(state.history.payloadsDiffusedLifetime).toBe(2);
    expect(state.history.totalXp).toBe(200);
    expect(state.history.missionsCompletedLifetime).toBe(1);
    expect(state.history.lastCompletedDayKey).toBe("2026-04-20");
    expect(state.history.lastCompletedMissionNumber).toBe(2);
  });

  it("streakDays increments on consecutive day mission completion and resets on a gap", () => {
    let state = createInitialDriverPrepState(1, "2026-04-20");
    state = completeOnePayload(state, { orderId: 1, now: "2026-04-20T10:00Z" });
    expect(state.history.streakDays).toBe(1);
    expect(state.history.lastCompletedDayKey).toBe("2026-04-20");

    // Next calendar day → streak climbs.
    state = driverPrepReducer(state, {
      type: "ROLL_TO_NEXT_DAY",
      todayKey: "2026-04-21",
    });
    state = completeOnePayload(state, { orderId: 2, now: "2026-04-21T10:00Z" });
    state = driverPrepReducer(state, { type: "RESUME_AFTER_MAP_RETURN" });
    state = completeOnePayload(state, { orderId: 3, now: "2026-04-21T11:00Z" });
    expect(state.history.streakDays).toBe(2);

    // Skip a day → streak resets to 1 on next completion.
    state = driverPrepReducer(state, {
      type: "ROLL_TO_NEXT_DAY",
      todayKey: "2026-04-23",
    });
    state = completeOnePayload(state, { orderId: 4, now: "2026-04-23T10:00Z" });
    state = driverPrepReducer(state, { type: "RESUME_AFTER_MAP_RETURN" });
    state = completeOnePayload(state, { orderId: 5, now: "2026-04-23T11:00Z" });
    state = driverPrepReducer(state, { type: "RESUME_AFTER_MAP_RETURN" });
    state = completeOnePayload(state, { orderId: 6, now: "2026-04-23T12:00Z" });
    expect(state.history.streakDays).toBe(1);
  });

  it("isConsecutiveDay handles nulls, equal days, and non-adjacent days", () => {
    expect(isConsecutiveDay(null, "2026-04-21")).toBe(false);
    expect(isConsecutiveDay("2026-04-20", "2026-04-20")).toBe(false);
    expect(isConsecutiveDay("2026-04-20", "2026-04-21")).toBe(true);
    expect(isConsecutiveDay("2026-04-20", "2026-04-22")).toBe(false);
    // Month boundary.
    expect(isConsecutiveDay("2026-04-30", "2026-05-01")).toBe(true);
  });
});

describe("driverPrepMachine — missionCompletedForDay blocks progression", () => {
  it("SELECT_ORDER and START_RUN_FROM_ORDER are no-ops once the daily mission is done", () => {
    let state = createInitialDriverPrepState(1, "2026-04-20");
    state = completeOnePayload(state, { orderId: 1, now: "2026-04-20T10:00Z" });
    expect(state.missionCompletedForDay).toBe(true);
    expect(state.phase).toBe("mission_complete");

    const afterSelect = driverPrepReducer(state, {
      type: "SELECT_ORDER",
      orderId: 999,
    });
    expect(afterSelect).toBe(state);

    const afterStart = driverPrepReducer(state, { type: "START_RUN_FROM_ORDER" });
    expect(afterStart).toBe(state);
  });
});
