import { describe, expect, it, vi } from "vitest";
import { createRallyState, type RallyEvent } from "./rallyEngine";
import { RallyMetrics } from "./rallyMetrics";

describe("local Rally metrics", () => {
  it("captures the playtest gate signals and persists only locally", () => {
    const setItem = vi.fn();
    const storage = { setItem } as unknown as Storage;
    const metrics = new RallyMetrics("buttHybrid", "url", storage, Date.now());
    metrics.matchStart();
    const state = createRallyState(false, "buttHybrid");
    const event = (type: RallyEvent["type"], extras: Partial<RallyEvent> = {}) =>
      metrics.handleEvent({ type, at: 0, ...extras }, state);
    event("serve");
    event("return", { tier: 2 });
    event("power_cast", { power: "hardNo" });
    event("gate_score_for", { banked: true });
    event("regulation_expired");
    event("sudden_death");
    metrics.shareOffered();
    metrics.shareAccepted();
    event("victory");
    metrics.rematch();

    const exported = metrics.exportData();
    const names = exported.events.map(metric => metric.name);
    expect(names).toEqual(expect.arrayContaining([
      "variant",
      "match_start",
      "time_to_first_score",
      "first_score_serve_index",
      "power_used",
      "bash_count",
      "regulation_expired",
      "sudden_death",
      "share_offered",
      "share_accepted",
      "match_end",
      "avg_rally_tier",
      "rematch",
    ]));
    expect(exported.session).toMatchObject({ mode: "buttHybrid", source: "url", matches: 1 });
    expect(setItem).toHaveBeenCalled();
  });
});
