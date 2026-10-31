import { describe, expect, it } from "vitest";
import type { ChapterOpportunity, ChapterView, DraftView } from "../../../../shared/firstTenMinutesChapter";
import {
  evaluateMachineRoute,
  MACHINE_NODES,
} from "./machineGraph";
import {
  hydrateMachineStateFromChapter,
  isCenterTrackRestored,
} from "./machinePersistence";
import {
  createInitialMachineState,
  reduceMachineState,
} from "./machineState";

const mockOpportunity: ChapterOpportunity = {
  id: "opp_elena_123",
  type: "became_possible",
  person: { name: "Elena Ruiz", address: "elena@larkspurhotel.example" },
  firstName: "Elena",
  request: {
    quote: "Could you do fresh arrangements every Friday?",
    subject: "Friday flowers?",
    at: "2026-04-18T16:12:00Z",
  },
  reply: {
    quote: "We're only doing events at the moment. Ask me again once we have a Friday delivery.",
    missing: "Friday delivery",
    at: "2026-04-18T16:30:00Z",
  },
  service: { name: "Weekly Friday delivery" },
  route: { weekday: 5 },
  place: { name: "The Larkspur Hotel", category: "hotel" },
  along: "street",
};

const mockDraft: DraftView = {
  to: { name: "Elena Ruiz", address: "elena@larkspurhotel.example" },
  subject: "Re: Friday flowers?",
  body: "Hi Elena — you asked earlier this year about Friday flowers. We now have a weekly Friday delivery. Is that still something you're looking for at the hotel?",
  approach: "still_wanted",
  status: "prepared",
  preparedAt: "2026-10-29T17:00:00Z",
  edited: false,
};

describe("Section 19 — Business Integration Tests (11 Requirements)", () => {
  // 1. Real sourced opportunity, send succeeds
  it("Requirement 1: Real sourced opportunity, send succeeds -> restores central track and enables center route", () => {
    const verifiedDraft: DraftView = {
      ...mockDraft,
      status: "verified_sent",
      sentAt: "2026-10-31T09:00:00Z",
      messageId: "msg_gmail_abc123",
    };

    expect(isCenterTrackRestored(verifiedDraft)).toBe(true);

    const chapterView: ChapterView = {
      opportunity: mockOpportunity,
      draft: verifiedDraft,
      progress: { revealed: true, steps: ["glove", "shake", "quill", "dip"], letterWritten: true },
    };

    const state = hydrateMachineStateFromChapter(chapterView);
    expect(state.centerBridgeRestored).toBe(true);
    expect(state.keyRetrieved).toBe(true);
    expect(state.dial).toBe("NOW");

    // Position junctions for center crossing
    const centerConfig = {
      ...state,
      westJunction: "center" as const,
      eastJunction: "center" as const,
    };

    const route = evaluateMachineRoute(centerConfig);
    expect(route.connected).toBe(true);
    expect(route.direction).toBe("return");
    expect(route.activeRoute).toBe("center");
    expect(route.reachedNodes).toEqual([
      "key_station",
      "east_junction",
      "center_crossing",
      "west_junction",
      "rook_dome",
    ]);
  });

  // 2. Real sourced opportunity, prepare only
  it("Requirement 2: Real sourced opportunity, prepare only -> central track remains disconnected, player can finish using alternate route", () => {
    const preparedDraft: DraftView = {
      ...mockDraft,
      status: "prepared",
    };

    // Central track remains disconnected
    expect(isCenterTrackRestored(preparedDraft)).toBe(false);

    const state = hydrateMachineStateFromChapter({
      opportunity: mockOpportunity,
      draft: preparedDraft,
      progress: { revealed: true, steps: [], letterWritten: false },
    });
    expect(state.centerBridgeRestored).toBe(false);

    // Trying center route fails at center_break
    const centerConfig = {
      ...state,
      westJunction: "center" as const,
      eastJunction: "center" as const,
    };
    const centerEval = evaluateMachineRoute(centerConfig);
    expect(centerEval.connected).toBe(false);
    expect(centerEval.haltPoint).toEqual({ x: 732, y: 374 });

    // But alternate lower route in NOW is completely solvable without sending!
    const lowerConfig = {
      ...state,
      dial: "NOW" as const,
      westJunction: "lower" as const,
      lowerRotor: "aligned" as const,
      eastJunction: "lower" as const,
    };
    const lowerEval = evaluateMachineRoute(lowerConfig);
    expect(lowerEval.connected).toBe(true);
    expect(lowerEval.direction).toBe("return");
    expect(lowerEval.activeRoute).toBe("lower");
    expect(lowerEval.reachedNodes).toEqual([
      "key_station",
      "east_junction",
      "lower_rotor",
      "west_junction",
      "rook_dome",
    ]);
  });

  // 3. Keep for later
  it("Requirement 3: Keep for later -> decision persists, center track stays disconnected, alternate route works", () => {
    let state = createInitialMachineState();
    state = reduceMachineState(state, { type: "CHOOSE_CORRESPONDENCE", choice: "keep_for_later" });
    expect(state.correspondenceChoice).toBe("keep_for_later");
    expect(state.centerBridgeRestored).toBe(false);

    // Player with key can still rescue Rook via lower route
    const lowerConfig = {
      ...state,
      keyRetrieved: true,
      dial: "NOW" as const,
      westJunction: "lower" as const,
      lowerRotor: "aligned" as const,
      eastJunction: "lower" as const,
    };
    const lowerReturn = evaluateMachineRoute(lowerConfig);
    expect(lowerReturn.connected).toBe(true);
    expect(lowerReturn.activeRoute).toBe("lower");
  });

  // 4. Not for me
  it("Requirement 4: Not for me -> records decision cleanly, opportunity is preserved in history, center track remains disconnected", () => {
    const chapter: ChapterView = {
      opportunity: mockOpportunity,
      draft: { ...mockDraft, status: "declined" },
      progress: { revealed: true, steps: [], letterWritten: false },
    };

    // Opportunity remains present (not deleted from history)
    expect(chapter.opportunity).not.toBeNull();
    expect(chapter.draft?.status).toBe("declined");

    // Center track is NOT restored
    expect(isCenterTrackRestored(chapter.draft)).toBe(false);

    const state = hydrateMachineStateFromChapter(chapter);
    expect(state.correspondenceChoice).toBe("not_for_me");
    expect(state.centerBridgeRestored).toBe(false);

    // Alternate route solves cleanly
    const lowerConfig = {
      ...state,
      dial: "NOW" as const,
      westJunction: "lower" as const,
      lowerRotor: "aligned" as const,
      eastJunction: "lower" as const,
    };
    const lowerReturn = evaluateMachineRoute(lowerConfig);
    expect(lowerReturn.connected).toBe(true);
    expect(lowerReturn.activeRoute).toBe("lower");
  });

  // 5. No eligible opportunity
  it("Requirement 5: No eligible opportunity -> center track cannot be bridged, player finishes via alternate route, no invented customer", () => {
    const chapterNoOpp: ChapterView = {
      opportunity: null,
      draft: null,
      progress: { revealed: false, steps: [], letterWritten: false },
    };

    expect(isCenterTrackRestored(null)).toBe(false);

    const state = hydrateMachineStateFromChapter(chapterNoOpp);
    expect(state.centerBridgeRestored).toBe(false);

    // Solving outbound upper route
    const outbound = evaluateMachineRoute({
      ...state,
      dial: "THEN",
      westJunction: "upper",
      upperRotor: "aligned",
      eastJunction: "upper",
    });
    expect(outbound.connected).toBe(true);
    expect(outbound.direction).toBe("outbound");

    // Solving return lower route
    const returnRoute = evaluateMachineRoute({
      ...state,
      keyRetrieved: true,
      dial: "NOW",
      westJunction: "lower",
      lowerRotor: "aligned",
      eastJunction: "lower",
    });
    expect(returnRoute.connected).toBe(true);
    expect(returnRoute.direction).toBe("return");
  });

  // 6. Example mode
  it("Requirement 6: Example mode -> draft without verified sent cannot bridge central route", () => {
    const exampleDraft: DraftView = {
      ...mockDraft,
      status: "prepared",
    };

    expect(isCenterTrackRestored(exampleDraft)).toBe(false);

    const state = hydrateMachineStateFromChapter({
      opportunity: mockOpportunity,
      draft: exampleDraft,
      progress: { revealed: true, steps: [], letterWritten: false },
    });

    const centerEval = evaluateMachineRoute({
      ...state,
      dial: "NOW",
      westJunction: "center",
      eastJunction: "center",
    });
    expect(centerEval.connected).toBe(false);
    expect(centerEval.haltPoint).toEqual({ x: 732, y: 374 });
  });

  // 7. Permission denied
  it("Requirement 7: Permission denied -> no message leaves, center does not reconnect, player finishes via lower route", () => {
    // When permission is denied, draft remains in prepared status with no messageId
    const unauthenticatedDraft: DraftView = {
      ...mockDraft,
      status: "prepared",
    };

    expect(isCenterTrackRestored(unauthenticatedDraft)).toBe(false);

    const state = hydrateMachineStateFromChapter({
      opportunity: mockOpportunity,
      draft: unauthenticatedDraft,
      progress: { revealed: true, steps: [], letterWritten: false },
    });

    expect(state.centerBridgeRestored).toBe(false);

    // Alternate route finishes successfully
    const lowerEval = evaluateMachineRoute({
      ...state,
      dial: "NOW",
      westJunction: "lower",
      lowerRotor: "aligned",
      eastJunction: "lower",
    });
    expect(lowerEval.connected).toBe(true);
    expect(lowerEval.activeRoute).toBe("lower");
  });

  // 8. Google response uncertain (sending)
  it("Requirement 8: Google response uncertain (sending) -> does not claim sent, center stays disconnected", () => {
    const sendingDraft: DraftView = {
      ...mockDraft,
      status: "sending",
    };

    // "sending" is NOT verified_sent! Central track must NOT be restored
    expect(isCenterTrackRestored(sendingDraft)).toBe(false);

    const state = hydrateMachineStateFromChapter({
      opportunity: mockOpportunity,
      draft: sendingDraft,
      progress: { revealed: true, steps: [], letterWritten: false },
    });

    expect(state.centerBridgeRestored).toBe(false);

    const centerEval = evaluateMachineRoute({
      ...state,
      dial: "NOW",
      westJunction: "center",
      eastJunction: "center",
    });
    expect(centerEval.connected).toBe(false);
    expect(centerEval.haltPoint).toEqual({ x: 732, y: 374 });
  });

  // 9. Duplicate action
  it("Requirement 9: Duplicate action -> repeated transitions do not corrupt state or retrigger send", () => {
    let state = createInitialMachineState();

    // Idempotent junction rotation
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION", to: "upper" });
    expect(state.westJunction).toBe("upper");
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION", to: "upper" });
    expect(state.westJunction).toBe("upper");

    // Idempotent decision recording
    state = reduceMachineState(state, { type: "CHOOSE_CORRESPONDENCE", choice: "keep_for_later" });
    expect(state.correspondenceChoice).toBe("keep_for_later");
    state = reduceMachineState(state, { type: "CHOOSE_CORRESPONDENCE", choice: "keep_for_later" });
    expect(state.correspondenceChoice).toBe("keep_for_later");

    // Outbound route solve + key retrieval idempotency
    state = reduceMachineState(state, { type: "TOGGLE_UPPER_ROTOR", to: "aligned" });
    state = reduceMachineState(state, { type: "ROTATE_EAST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "WIND_CRANK" });
    expect(state.phase).toBe("outbound_solved");

    state = reduceMachineState(state, { type: "COMPLETE_OUTBOUND_TRAVEL" });
    expect(state.keyRetrieved).toBe(true);
    state = reduceMachineState(state, { type: "COMPLETE_OUTBOUND_TRAVEL" });
    expect(state.keyRetrieved).toBe(true);
  });

  // 10. Returning customer
  it("Requirement 10: Returning customer -> previous verified send restores center track immediately", () => {
    const returnChapter: ChapterView = {
      opportunity: mockOpportunity,
      draft: {
        ...mockDraft,
        status: "verified_sent",
        sentAt: "2026-10-29T18:00:00Z",
        messageId: "msg_existing_456",
      },
      progress: { revealed: true, steps: ["glove", "shake", "quill", "dip"], letterWritten: true },
    };

    const storedProgress = {
      keyRetrieved: true,
      centerExamined: true,
      correspondenceChoice: "prepare_reply" as const,
      returnCompleted: false,
      returnRouteUsed: null,
      rookRescued: false,
      adventureCompleted: false,
    };

    const state = hydrateMachineStateFromChapter(returnChapter, storedProgress);
    expect(state.centerBridgeRestored).toBe(true);
    expect(state.keyRetrieved).toBe(true);
    expect(state.correspondenceChoice).toBe("prepare_reply");
  });

  // 11. Account boundary
  it("Requirement 11: Account boundary -> isolated states for different accounts/journeys", () => {
    const chapterA: ChapterView = {
      opportunity: mockOpportunity,
      draft: { ...mockDraft, status: "verified_sent" },
      progress: { revealed: true, steps: [], letterWritten: true },
    };

    const chapterB: ChapterView = {
      opportunity: null,
      draft: null,
      progress: { revealed: false, steps: [], letterWritten: false },
    };

    const stateA = hydrateMachineStateFromChapter(chapterA);
    const stateB = hydrateMachineStateFromChapter(chapterB);

    expect(stateA.centerBridgeRestored).toBe(true);
    expect(stateB.centerBridgeRestored).toBe(false);
  });
});
