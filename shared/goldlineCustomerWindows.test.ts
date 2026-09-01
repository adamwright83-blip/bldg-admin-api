import { describe, expect, it } from "vitest";
import { projectCustomerWindows } from "./goldlineCustomerWindows";

const resident = (identityKey: string, state: "active" | "dimming" | "dark") => ({ identityKey, cadence: { state } });

describe("customer-window presentation", () => {
  it("shows one physical window per readable relationship", () => {
    const projection = projectCustomerWindows([resident("a", "active"), resident("b", "dimming"), resident("c", "dark")]);
    expect(projection).toMatchObject({ mode: "individual", active: 2, dormant: 1 });
    expect(projection.mode === "individual" && projection.windows).toEqual([
      { identityKey: "a", state: "warm" }, { identityKey: "b", state: "warm" }, { identityKey: "c", state: "cool" },
    ]);
  });

  it("aggregates only the facade beyond legibility and preserves the roster", () => {
    const roster = Array.from({ length: 18 }, (_, index) => resident(`resident-${index}`, index < 7 ? "active" : "dark"));
    const snapshot = structuredClone(roster);
    const projection = projectCustomerWindows(roster);
    expect(projection).toMatchObject({ mode: "aggregate", total: 18, active: 7, dormant: 11 });
    expect(roster).toEqual(snapshot);
    expect(roster).toHaveLength(18);
  });
});
