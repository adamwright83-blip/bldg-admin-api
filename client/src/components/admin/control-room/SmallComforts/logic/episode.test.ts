import { describe, expect, it } from "vitest";
import { emptyLayout } from "./grid";
import {
  arrivalGate,
  completeProject,
  completeStay,
  emptyEpisode,
  nextArrival,
  projectStatus,
  roomCapacity,
} from "./episode";

describe("Small Comforts suitcase episode", () => {
  it("keeps travelers instead of consuming them as disposable runs", () => {
    let state = emptyEpisode();
    expect(nextArrival(state)).toBe("conductor");
    state = completeStay(state, "conductor", "window|bed|flick");
    expect(state.residents.map(r => r.guest)).toEqual(["conductor"]);
    expect(state.keepsakes[0]).toMatchObject({ guest: "conductor", kind: "ticket" });
    expect(nextArrival(state)).toBe("baker");
  });

  it("makes suitcase anatomy increase hotel capacity", () => {
    let state = completeStay(emptyEpisode(), "conductor", "keyhole|bed|walk");
    expect(roomCapacity(state)).toBe(1);
    expect(arrivalGate(state)).toMatchObject({ canRing: false });

    state = completeProject(state, "strap_hammock");
    expect(roomCapacity(state)).toBe(2);
    expect(arrivalGate(state)).toMatchObject({ canRing: true });

    state = completeStay(state, "baker", "scarf|bed|walk");
    expect(arrivalGate(state)).toMatchObject({ canRing: false });

    state = completeProject(state, "lining_stairs");
    state = completeProject(state, "pocket_loft");
    expect(roomCapacity(state)).toBe(3);
    expect(arrivalGate(state)).toMatchObject({ canRing: true });
  });

  it("unlocks architecture through physical dependencies", () => {
    const layout = emptyLayout();
    let state = completeStay(emptyEpisode(), "conductor", "keyhole|bed|walk");

    expect(projectStatus("lining_stairs", state, layout).available).toBe(false);
    layout.windowCut = true;
    expect(projectStatus("lining_stairs", state, layout).available).toBe(true);
    expect(projectStatus("strap_hammock", state, layout).available).toBe(true);
    expect(projectStatus("pocket_loft", state, layout).available).toBe(false);

    state = completeProject(state, "lining_stairs");
    expect(projectStatus("pocket_loft", state, layout).available).toBe(true);
  });
});
