import { describe, expect, it } from "vitest";
import {
  parseBusinessTurn,
  type ClaireAnalyticsSession,
} from "./businessConversation";
import { defaultBusinessQuery } from "../analytics/businessQuery";

const now = new Date("2026-09-15T16:30:00.000Z");
const timeZone = "America/Los_Angeles";

function topCustomerSession(): ClaireAnalyticsSession {
  return {
    query: defaultBusinessQuery("top_customers"),
    periods: [],
    pendingClarification: null,
    disclosed: [],
    touchedAt: now.getTime(),
    focus: {
      population: [
        { displayName: "John", identityKeys: ["cleancloud:1"] },
        { displayName: "Rebecca", identityKeys: ["cleancloud:2"] },
      ],
      populationPeriod: { start: "2026-08-17", end: "2026-09-15" },
    },
  };
}

function expectDormant(result: ReturnType<typeof parseBusinessTurn>) {
  expect(result.kind).toBe("query");
  if (result.kind !== "query") return;
  expect(result.query.metric).toBe("dormant_customers");
  expect(result.query.metric).not.toBe("top_customers");
}

describe("Claire dormant-customer intent repair", () => {
  it("treats the live follow-up question as dormancy, not top spenders", () => {
    expectDormant(
      parseBusinessTurn(
        "Which customers haven't ordered in a long time that I need to follow up with?",
        null,
        now,
        timeZone
      )
    );
  });

  it("lets an explicit correction supersede an existing top-customer thread", () => {
    expectDormant(
      parseBusinessTurn(
        "No, no, no. Which customers haven't ordered in a long time?",
        topCustomerSession(),
        now,
        timeZone
      )
    );
  });

  it.each([
    "No. I mean inactive customers.",
    "Forget top customers. Who has gone dormant?",
    "That's not what I asked. Who used to order and stopped?",
  ])("repairs stale ranking context: %s", utterance => {
    expectDormant(parseBusinessTurn(utterance, topCustomerSession(), now, timeZone));
  });
});
