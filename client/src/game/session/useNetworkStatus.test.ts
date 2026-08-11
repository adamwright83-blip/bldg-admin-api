import { describe, expect, it } from "vitest";
import { networkStatusLabel } from "./useNetworkStatus";

describe("networkStatusLabel", () => {
  it("shows a game-native status when offline", () => {
    expect(networkStatusLabel("offline")).toBe("SIGNAL LOST · RECONNECTING");
  });

  it("shows nothing when online, never a false completion claim", () => {
    expect(networkStatusLabel("online")).toBe("");
  });
});
