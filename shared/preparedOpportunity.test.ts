import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { presentPreparedOpportunity, type PreparedOpportunitySource } from "./preparedOpportunity";

function source(overrides: Partial<PreparedOpportunitySource> = {}): PreparedOpportunitySource {
  return {
    pendingApproval: {
      proposalId: "proposal-1",
      revision: "a".repeat(64),
      itemIds: ["item-1"],
    },
    items: [
      {
        id: "item-1",
        date: "2026-10-18",
        title: "Recover the Silver Lake regulars",
        objective: "Start with customers who already ordered.",
        status: "awaiting_approval",
      },
    ],
    rationale: {
      diagnosis: "Several regulars in Silver Lake have gone quiet.",
      approach: "Use the relationships already on the book.",
    },
    ...overrides,
  };
}

describe("presentPreparedOpportunity", () => {
  it("shows the first item still awaiting approval, with the stored reason", () => {
    expect(presentPreparedOpportunity(source())).toMatchObject({
      proposalId: "proposal-1",
      itemId: "item-1",
      title: "Recover the Silver Lake regulars",
      reason: "Several regulars in Silver Lake have gone quiet.",
      approach: "Use the relationships already on the book.",
    });
  });

  it("stays empty when nothing is awaiting approval", () => {
    expect(presentPreparedOpportunity(null)).toBeNull();
    expect(presentPreparedOpportunity(source({ pendingApproval: null }))).toBeNull();
    expect(
      presentPreparedOpportunity(
        source({
          items: [{ id: "item-1", date: "2026-10-18", title: "Already committed", objective: null, status: "committed" }],
        })
      )
    ).toBeNull();
  });

  it("does not offer work whose time has passed", () => {
    expect(
      presentPreparedOpportunity(
        source({
          items: [
            {
              id: "item-1",
              date: "2026-10-16",
              title: "Missed visit",
              objective: null,
              status: "needs_reschedule",
            },
          ],
        })
      )
    ).toBeNull();
  });

  it("uses an honest fallback when the diagnosis text is blank", () => {
    expect(
      presentPreparedOpportunity(source({ rationale: { diagnosis: "  ", approach: "" } }))?.reason
    ).toBe("Claire prepared this from the stored strategic proposal.");
  });
});

describe("prepared opportunity surfaces", () => {
  it("is mounted on Home and the Day Line, and approves through the existing proposal mutation", () => {
    const card = readFileSync(new URL("../client/src/pages/home/PreparedOpportunityCard.tsx", import.meta.url), "utf8");
    const home = readFileSync(new URL("../client/src/pages/JoystickHome.tsx", import.meta.url), "utf8");
    const dayLine = readFileSync(new URL("../client/src/pages/goldline/GoldlineDayPlan.tsx", import.meta.url), "utf8");
    expect(card).toContain("respondToPreparedProposal");
    expect(card).toContain('action: "approve"');
    expect(card).toContain("itemIds: [opportunity.itemId]");
    expect(home).toContain("PreparedOpportunityCard");
    expect(dayLine).toContain("PreparedOpportunityCard");
  });
});
