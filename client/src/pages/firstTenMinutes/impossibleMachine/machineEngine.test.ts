import { describe, expect, it } from "vitest";
import { evaluateMachineRoute, MACHINE_NODES } from "./machineGraph";
import { hydrateMachineStateFromChapter } from "./machinePersistence";
import { createInitialMachineState, reduceMachineState } from "./machineState";

describe("THE IMPOSSIBLE MACHINE — Pure Puzzle Logic (16 required acceptance rules)", () => {
  it("1. starts with Rook trapped and the key across the railway in THEN", () => {
    const state = createInitialMachineState();
    expect(state.phase).toBe("discovery");
    expect(state.domeUnlocked).toBe(false);
    expect(state.rookRescued).toBe(false);
    expect(state.keyRetrieved).toBe(false);
    expect(state.dial).toBe("THEN");
    expect(MACHINE_NODES.rook_dome.x).toBeLessThan(MACHINE_NODES.west_junction.x);
    expect(MACHINE_NODES.key_station.x).toBeGreaterThan(MACHINE_NODES.east_junction.x);
  });

  it("2. rotating a junction changes its actual graph connection", () => {
    let state = createInitialMachineState();
    expect(state.westJunction).toBe("center");
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION" });
    expect(state.westJunction).toBe("lower");
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION" });
    expect(state.westJunction).toBe("upper");
    const route = evaluateMachineRoute(state);
    expect(route.reachedNodes).toContain("upper_rotor");
  });

  it("3. a visually disconnected track is never treated as connected", () => {
    const initial = createInitialMachineState();
    const evalInitial = evaluateMachineRoute(initial);
    expect(evalInitial.connected).toBe(false);
    expect(evalInitial.activeRoute).toBeNull();
    expect(evalInitial.haltPoint).not.toBeNull();
  });

  it("4. the THEN upper route has a valid outbound solution", () => {
    let state = createInitialMachineState();
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "TOGGLE_UPPER_ROTOR", to: "aligned" });
    state = reduceMachineState(state, { type: "ROTATE_EAST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "SET_DIAL", to: "THEN" });

    const route = evaluateMachineRoute(state);
    expect(route.connected).toBe(true);
    expect(route.direction).toBe("outbound");
    expect(route.activeRoute).toBe("upper");
    expect(route.reachedNodes).toEqual([
      "rook_dome",
      "west_junction",
      "upper_rotor",
      "east_junction",
      "key_station",
    ]);
  });

  it("5. misaligning any required upper component prevents the outbound solution", () => {
    const solvedConfig = {
      dial: "THEN" as const,
      westJunction: "upper" as const,
      eastJunction: "upper" as const,
      upperRotor: "aligned" as const,
      lowerRotor: "misaligned" as const,
      keyRetrieved: false,
      centerBridgeRestored: false,
    };
    expect(evaluateMachineRoute(solvedConfig).connected).toBe(true);

    // Misalign west junction
    expect(evaluateMachineRoute({ ...solvedConfig, westJunction: "center" }).connected).toBe(false);
    // Misalign upper rotor
    expect(evaluateMachineRoute({ ...solvedConfig, upperRotor: "misaligned" }).connected).toBe(false);
    // Misalign east junction
    expect(evaluateMachineRoute({ ...solvedConfig, eastJunction: "center" }).connected).toBe(false);
    // Wrong dial (NOW instead of THEN)
    expect(evaluateMachineRoute({ ...solvedConfig, dial: "NOW" }).connected).toBe(false);
  });

  it("6. a failed route gives recoverable feedback without destroying player state", () => {
    let state = createInitialMachineState();
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION", to: "upper" });
    // Upper rotor still misaligned, east junction still lower
    state = reduceMachineState(state, { type: "WIND_CRANK" });
    expect(state.lastAttempt?.connected).toBe(false);
    expect(state.lastAttempt?.stopReason).toBe("upper_rotor_misaligned");
    // Player's junction setting is preserved!
    expect(state.westJunction).toBe("upper");
    expect(state.keyRetrieved).toBe(false);
  });

  it("7. retrieving the key transitions into the return phase and shifts dial to NOW", () => {
    let state = createInitialMachineState();
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "TOGGLE_UPPER_ROTOR", to: "aligned" });
    state = reduceMachineState(state, { type: "ROTATE_EAST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "WIND_CRANK" });
    expect(state.phase).toBe("outbound_solved");

    state = reduceMachineState(state, { type: "COMPLETE_OUTBOUND_TRAVEL" });
    expect(state.phase).toBe("return_puzzle");
    expect(state.keyRetrieved).toBe(true);
    expect(state.dial).toBe("NOW");
  });

  it("8. the outward solution cannot complete the return phase", () => {
    let state = createInitialMachineState();
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "TOGGLE_UPPER_ROTOR", to: "aligned" });
    state = reduceMachineState(state, { type: "ROTATE_EAST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "WIND_CRANK" });
    state = reduceMachineState(state, { type: "COMPLETE_OUTBOUND_TRAVEL" });

    // Even if the player switches the dial back to THEN and keeps upper junctions aligned,
    // the upper route return gate is closed.
    state = reduceMachineState(state, { type: "SET_DIAL", to: "THEN" });
    const returnAttempt = evaluateMachineRoute(state);
    expect(returnAttempt.connected).toBe(false);
    expect(returnAttempt.stopReason).toBe("upper_return_gate_closed");
  });

  it("9. the NOW lower route has a valid return solution", () => {
    let state = createInitialMachineState();
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "TOGGLE_UPPER_ROTOR", to: "aligned" });
    state = reduceMachineState(state, { type: "ROTATE_EAST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "WIND_CRANK" });
    state = reduceMachineState(state, { type: "COMPLETE_OUTBOUND_TRAVEL" });

    // Configure lower return route in NOW
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION", to: "lower" });
    state = reduceMachineState(state, { type: "TOGGLE_LOWER_ROTOR", to: "aligned" });
    state = reduceMachineState(state, { type: "ROTATE_EAST_JUNCTION", to: "lower" });
    expect(state.dial).toBe("NOW");

    const route = evaluateMachineRoute(state);
    expect(route.connected).toBe(true);
    expect(route.direction).toBe("return");
    expect(route.activeRoute).toBe("lower");
    expect(route.reachedNodes).toEqual([
      "key_station",
      "east_junction",
      "lower_rotor",
      "west_junction",
      "rook_dome",
    ]);
  });

  it("10. misaligning any required lower component prevents its completion", () => {
    const lowerSolved = {
      dial: "NOW" as const,
      westJunction: "lower" as const,
      eastJunction: "lower" as const,
      upperRotor: "aligned" as const,
      lowerRotor: "aligned" as const,
      keyRetrieved: true,
      centerBridgeRestored: false,
    };
    expect(evaluateMachineRoute(lowerSolved).connected).toBe(true);

    expect(evaluateMachineRoute({ ...lowerSolved, westJunction: "center" }).connected).toBe(false);
    expect(evaluateMachineRoute({ ...lowerSolved, lowerRotor: "misaligned" }).connected).toBe(false);
    expect(evaluateMachineRoute({ ...lowerSolved, eastJunction: "center" }).connected).toBe(false);
    expect(evaluateMachineRoute({ ...lowerSolved, dial: "THEN" }).connected).toBe(false);
  });

  it("11. the center route remains disconnected after merely preparing a draft", () => {
    let state = createInitialMachineState();
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "TOGGLE_UPPER_ROTOR", to: "aligned" });
    state = reduceMachineState(state, { type: "ROTATE_EAST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "WIND_CRANK" });
    state = reduceMachineState(state, { type: "COMPLETE_OUTBOUND_TRAVEL" });

    state = reduceMachineState(state, { type: "EXAMINE_CENTER" });
    state = reduceMachineState(state, { type: "CHOOSE_CORRESPONDENCE", choice: "prepare_reply" });
    state = reduceMachineState(state, { type: "SYNC_DRAFT_STATUS", draftStatus: "prepared" });

    expect(state.centerBridgeRestored).toBe(false);
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION", to: "center" });
    state = reduceMachineState(state, { type: "ROTATE_EAST_JUNCTION", to: "center" });
    const evalCenter = evaluateMachineRoute(state);
    expect(evalCenter.connected).toBe(false);
    expect(evalCenter.stopReason).toBe("center_crossing_broken");
  });

  it("12. the center route remains disconnected after an unverified or unsuccessful send", () => {
    let state = createInitialMachineState();
    for (const status of ["prepared", "sending", "declined", "handed_off", "reported_sent", null] as const) {
      state = reduceMachineState(state, { type: "SYNC_DRAFT_STATUS", draftStatus: status });
      expect(state.centerBridgeRestored).toBe(false);
    }
  });

  it("13. a verified qualifying send restores the center crossing", () => {
    let state = createInitialMachineState();
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "TOGGLE_UPPER_ROTOR", to: "aligned" });
    state = reduceMachineState(state, { type: "ROTATE_EAST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "WIND_CRANK" });
    state = reduceMachineState(state, { type: "COMPLETE_OUTBOUND_TRAVEL" });

    state = reduceMachineState(state, { type: "SYNC_DRAFT_STATUS", draftStatus: "verified_sent" });
    expect(state.centerBridgeRestored).toBe(true);
    expect(state.phase).toBe("center_restored");
  });

  it("14. the restored crossing provides a valid alternate return route", () => {
    let state = createInitialMachineState();
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "TOGGLE_UPPER_ROTOR", to: "aligned" });
    state = reduceMachineState(state, { type: "ROTATE_EAST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "WIND_CRANK" });
    state = reduceMachineState(state, { type: "COMPLETE_OUTBOUND_TRAVEL" });
    state = reduceMachineState(state, { type: "SYNC_DRAFT_STATUS", draftStatus: "verified_sent" });

    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION", to: "center" });
    state = reduceMachineState(state, { type: "ROTATE_EAST_JUNCTION", to: "center" });

    const route = evaluateMachineRoute(state);
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

  it("15. returning the key unlocks the dome and triggers Rook's theft ending", () => {
    let state = createInitialMachineState();
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "TOGGLE_UPPER_ROTOR", to: "aligned" });
    state = reduceMachineState(state, { type: "ROTATE_EAST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "WIND_CRANK" });
    state = reduceMachineState(state, { type: "COMPLETE_OUTBOUND_TRAVEL" });

    // Return via lower route without sending any email
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION", to: "lower" });
    state = reduceMachineState(state, { type: "TOGGLE_LOWER_ROTOR", to: "aligned" });
    state = reduceMachineState(state, { type: "ROTATE_EAST_JUNCTION", to: "lower" });
    state = reduceMachineState(state, { type: "WIND_CRANK" });
    expect(state.phase).toBe("return_solved");
    expect(state.returnRouteUsed).toBe("lower");

    state = reduceMachineState(state, { type: "COMPLETE_RETURN_TRAVEL" });
    expect(state.domeUnlocked).toBe(true);
    expect(state.rookRescued).toBe(true);
    expect(state.phase).toBe("dome_unlocked");

    state = reduceMachineState(state, { type: "COMPLETE_DOME_UNLOCK" });
    expect(state.rookStealing).toBe(true);
    expect(state.adventureCompleted).toBe(true);
    expect(state.phase).toBe("completed");
  });

  it("16. Rook cannot be declared rescued before the actual key return is complete", () => {
    let state = createInitialMachineState();
    // Try completing return travel before key is even retrieved
    state = reduceMachineState(state, { type: "COMPLETE_RETURN_TRAVEL" });
    expect(state.rookRescued).toBe(false);
    expect(state.domeUnlocked).toBe(false);

    // Retrieve key, but leave return route disconnected
    state = reduceMachineState(state, { type: "ROTATE_WEST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "TOGGLE_UPPER_ROTOR", to: "aligned" });
    state = reduceMachineState(state, { type: "ROTATE_EAST_JUNCTION", to: "upper" });
    state = reduceMachineState(state, { type: "WIND_CRANK" });
    state = reduceMachineState(state, { type: "COMPLETE_OUTBOUND_TRAVEL" });

    state = reduceMachineState(state, { type: "COMPLETE_RETURN_TRAVEL" });
    expect(state.rookRescued).toBe(false);
    expect(state.domeUnlocked).toBe(false);

    state = reduceMachineState(state, { type: "COMPLETE_DOME_UNLOCK" });
    expect(state.adventureCompleted).toBe(false);
  });

  it("hydrates prior progress and legacy chapter completion cleanly", () => {
    const hydrated = hydrateMachineStateFromChapter(
      {
        opportunity: null,
        progress: { revealed: true, steps: [], letterWritten: false },
        draft: null,
      },
      {
        keyRetrieved: true,
        centerExamined: true,
        correspondenceChoice: "keep_for_later",
        returnCompleted: false,
        returnRouteUsed: null,
        rookRescued: false,
        adventureCompleted: false,
      }
    );
    expect(hydrated.keyRetrieved).toBe(true);
    expect(hydrated.correspondenceChoice).toBe("keep_for_later");
    expect(hydrated.centerBridgeRestored).toBe(false);
    expect(hydrated.phase).toBe("choice_made");
  });
});
