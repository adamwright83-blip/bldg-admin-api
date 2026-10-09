import { describe, expect, it } from "vitest";
import { applyRealOutcome, branchFictionFromRealOutcome } from "./chapterOutcomeBranchService";

describe("branchFictionFromRealOutcome", () => {
  it("a real win opens the obvious route", () => {
    expect(branchFictionFromRealOutcome("won")).toEqual({ outcome: "won", branch: "route_open" });
  });

  it("a real rejection closes the obvious route but opens an alternate one — never a fake win", () => {
    const result = branchFictionFromRealOutcome("lost");
    expect(result).toEqual({ outcome: "lost", branch: "alternate_route_open" });
    expect(result.branch).not.toBe("route_open");
  });

  it("a pending follow-up stays ambiguous — no manufactured optimism", () => {
    expect(branchFictionFromRealOutcome("follow_up")).toEqual({ outcome: "follow_up", branch: "ambiguous_hold" });
  });

  it("no recorded outcome at all also stays ambiguous", () => {
    expect(branchFictionFromRealOutcome(null)).toEqual({ outcome: null, branch: "ambiguous_hold" });
  });
});

describe("applyRealOutcome", () => {
  it("adopts the first outcome when nothing was recorded before", () => {
    expect(applyRealOutcome(null, "follow_up")).toBe("follow_up");
  });

  it("a closed prospect stays closed even if a later signal looks more hopeful", () => {
    expect(applyRealOutcome("lost", "follow_up")).toBe("lost");
    expect(applyRealOutcome("lost", "won")).toBe("lost");
  });

  it("a won prospect stays won even if a stale follow-up event arrives late", () => {
    expect(applyRealOutcome("won", "follow_up")).toBe("won");
  });

  it("a pending follow-up can still resolve to a terminal outcome", () => {
    expect(applyRealOutcome("follow_up", "won")).toBe("won");
    expect(applyRealOutcome("follow_up", "lost")).toBe("lost");
  });
});
