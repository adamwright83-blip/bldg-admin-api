import { describe, expect, it, vi } from "vitest";
import { createRallyState, type RallyEvent } from "./rallyEngine";
import { RallyMetrics } from "./rallyMetrics";

describe("local Rally metrics", () => {
  it("captures the playtest gate signals and persists only locally", () => {
    const setItem = vi.fn();
    const storage = { setItem } as unknown as Storage;
    const metrics = new RallyMetrics("buttHybrid", "url", "duel", storage, Date.now());
    metrics.matchStart();
    const state = createRallyState(false, "buttHybrid");
    const event = (type: RallyEvent["type"], extras: Partial<RallyEvent> = {}) =>
      metrics.handleEvent({ type, at: 0, ...extras }, state);
    event("serve");
    event("return", { tier: 2 });
    event("power_cast", { power: "hardNo" });
    event("strike_crack", { mixup: "lob" });
    event("wrong_guess_conceded");
    event("contact_header");
    event("crossover");
    event("gate_score_for", { banked: true, ownGoal: true });
    event("surge_on");
    event("frozen");
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
      "control_mode",
      "match_start",
      "time_to_first_score",
      "first_score_serve_index",
      "power_used",
      "mixup_used",
      "wrong_guess_conceded",
      "headers",
      "crossovers",
      "own_goals",
      "surges",
      "frozen",
      "bash_count",
      "regulation_expired",
      "sudden_death",
      "share_offered",
      "share_accepted",
      "match_end",
      "avg_rally_tier",
      "rematch",
    ]));
    expect(exported.session).toMatchObject({ mode: "buttHybrid", controlMode: "duel", source: "url", matches: 1 });
    expect(setItem).toHaveBeenCalled();
  });
});
