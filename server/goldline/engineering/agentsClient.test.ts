import { describe, expect, it } from "vitest";
import {
  extractTerminalFromAgentEvents,
  isProgressEngineeringEvent,
  parseEngineeringTerminalResult,
} from "./agentsClient";

describe("engineering progress vs terminal results", () => {
  it("does not treat environment startup BLOCKED as terminal", () => {
    expect(
      isProgressEngineeringEvent({
        status: "BLOCKED",
        summary: "BLOCKED — workspace starting",
      })
    ).toBe(true);
    expect(
      parseEngineeringTerminalResult({
        status: "BLOCKED",
        summary: "waiting for repository",
      })
    ).toBeNull();
  });

  it("accepts a real NEEDS_HUMAN terminal result", () => {
    const events = [
      { type: "agent.session.created", id: "sess_1" },
      { status: "BLOCKED", summary: "inspecting code" },
      {
        type: "agent.session.turn.completed",
        output: {
          status: "NEEDS_HUMAN",
          capability: "dayline.cancel",
          summary: "Soft cancellation needs an additive migration.",
          blocker: "schema migration",
          requires_human_approval: true,
        },
      },
    ];
    expect(extractTerminalFromAgentEvents(events)).toMatchObject({
      status: "NEEDS_HUMAN",
      capability: "dayline.cancel",
      requires_human_approval: true,
    });
  });

  it("accepts PR_READY with a PR link", () => {
    expect(
      parseEngineeringTerminalResult({
        status: "PR_READY",
        summary: "Implemented",
        tests: "47 tests passed",
        pr_url: "https://github.com/adamwright83-blip/bldg-admin-api/pull/1",
        branch: "capability/dayline-cancel",
      })
    ).toMatchObject({
      status: "PR_READY",
      pr_url: "https://github.com/adamwright83-blip/bldg-admin-api/pull/1",
    });
  });
});
