import { describe, expect, it } from "vitest";
import { matchWork, plausibleSameWork, workStems } from "./workMatch";

describe("plausibleSameWork", () => {
  it("recognizes the same job said two ways (run 20 duplicate)", () => {
    expect(plausibleSameWork("Dubois regulation", "Regulate the action on Mr. Dubois's upright")).toBe(true);
    // One shared name alone is a search candidate, not a confirmed duplicate.
    expect(matchWork("the Dubois job", "Regulate the action on Mr. Dubois's upright")).toMatchObject({ plausible: false, candidate: true });
    expect(plausibleSameWork("Medeco cylinder order", "Order the Medeco cylinders")).toBe(true);
    expect(plausibleSameWork("Lindqvist master key quote", "Master key system quote for the Lindqvist building")).toBe(true);
    expect(plausibleSameWork("pick up Gentiles at Opus", "Pick up the Gentiles' laundry at Opus")).toBe(true);
  });

  it("does not confuse different jobs that share only generic words", () => {
    expect(plausibleSameWork("Pitch The Chadwick in person", "Pitch Wilshire Vermont in person")).toBe(false);
    expect(plausibleSameWork("Deliver to Century Park East", "Deliver the Achterberg headshots")).toBe(false);
    expect(plausibleSameWork("Call the plumber", "Call the flour rep about the short pallet")).toBe(false);
    expect(plausibleSameWork("Order a new harness for the Delacroix corgi", "Order the diaper and wipes restock")).toBe(false);
    // Different jobs at the same place (run of the first integration test): not a duplicate.
    expect(plausibleSameWork("Pick up the Gentiles' laundry at Opus", "Huntington Park towel run, then drop the towels at Opus")).toBe(false);
    expect(plausibleSameWork("Pick up the Gentiles at Opus", "Pickup at OPUS")).toBe(false);
    expect(matchWork("Pickup at OPUS", "Drop the towels at Opus").candidate).toBe(true);
  });

  it("a recurring job has the same title on two days: the match is plausible, the caller must resolve, not merge", () => {
    const match = matchWork("Mow and edge at the Kessler residence", "Mow and edge at the Kessler residence");
    expect(match.plausible).toBe(true);
    expect(match.sharedProper).toContain("kessl");
  });

  it("stems strip possessives and compare short prefixes", () => {
    expect(workStems("Mr. Dubois's upright")).toEqual(["duboi", "uprig"]);
  });
});
