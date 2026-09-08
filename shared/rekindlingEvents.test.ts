import { describe, expect, it } from "vitest";
import {
  arsenalOutreachEventFields,
  deriveRekindling,
  impactClassForRekindlingEvent,
  verificationClassForToolUse,
} from "./rekindlingEvents";

const outreach = (
  occurredAt: string,
  metadata: Record<string, unknown> = { arsenalTool: "signal_flare" }
) => ({
  eventType: "recovery_outreach_completed",
  classification: "action",
  occurredAt,
  metadata,
});

describe("tool truth class becomes the event's verification class", () => {
  it("never claims provider delivery the operator only reported", () => {
    expect(
      verificationClassForToolUse({ tool: "signal_flare", providerDeliveryVerified: false })
    ).toBe("ATTESTED");
    expect(
      verificationClassForToolUse({ tool: "signal_flare", providerDeliveryVerified: true })
    ).toBe("VERIFIED");
    expect(
      verificationClassForToolUse({ tool: "recall_bell", providerDeliveryVerified: true })
    ).toBe("ATTESTED");
    expect(
      verificationClassForToolUse({ tool: "golden_seal", providerDeliveryVerified: true })
    ).toBe("CLAIMED");
  });

  it("stamps the tool, its truth class, and field_activity on the outreach event", () => {
    expect(
      arsenalOutreachEventFields({ tool: "courier_sprite", providerDeliveryVerified: false })
    ).toEqual({
      verificationClass: "ATTESTED",
      metadata: {
        arsenalTool: "courier_sprite",
        truthClass: "attested",
        impactClass: "field_activity",
        providerDeliveryVerified: false,
      },
    });
  });
});

describe("impact class of a world event", () => {
  it("maps only real action and outcome events, never metadata claims", () => {
    expect(impactClassForRekindlingEvent(outreach("2026-09-03T00:00:00.000Z"))).toBe(
      "field_activity"
    );
    expect(
      impactClassForRekindlingEvent({
        eventType: "customer_recovered",
        classification: "outcome",
        occurredAt: "2026-09-04T00:00:00.000Z",
        metadata: {},
      })
    ).toBe("customer_outcome");
    // A send whose metadata asserts a response is still only a send.
    expect(
      impactClassForRekindlingEvent(
        outreach("2026-09-03T00:00:00.000Z", { impactClass: "response" })
      )
    ).toBe("field_activity");
    // Game projection and derived signals carry no funnel meaning.
    expect(
      impactClassForRekindlingEvent({
        eventType: "customer_recovered",
        classification: "game_projection",
        occurredAt: "2026-09-04T00:00:00.000Z",
        metadata: {},
      })
    ).toBeNull();
    expect(
      impactClassForRekindlingEvent({
        eventType: "territory_cleared",
        classification: "game_projection",
        occurredAt: "2026-09-04T00:00:00.000Z",
        metadata: {},
      })
    ).toBeNull();
  });
});

describe("rekindling state since the operation began", () => {
  const since = "2026-09-01T00:00:00.000Z";

  it("a send is a spark and nothing more, however many sends", () => {
    const result = deriveRekindling({
      since,
      events: [
        outreach("2026-09-02T18:00:00.000Z"),
        outreach("2026-09-05T18:00:00.000Z", { arsenalTool: "recall_bell" }),
      ],
    });
    expect(result).toEqual({
      state: "spark",
      reached: "field_activity",
      lastToolUse: { tool: "recall_bell", occurredAt: "2026-09-05T18:00:00.000Z" },
    });
  });

  it("only a real order makes a flame", () => {
    expect(
      deriveRekindling({
        since,
        events: [
          outreach("2026-09-02T18:00:00.000Z"),
          {
            eventType: "customer_recovered",
            classification: "outcome",
            occurredAt: "2026-09-06T18:00:00.000Z",
            metadata: {},
          },
        ],
      })
    ).toMatchObject({ state: "flame", reached: "customer_outcome" });
  });

  it("ignores everything before the operation began and unknown tools", () => {
    expect(
      deriveRekindling({
        since,
        events: [
          outreach("2026-08-20T18:00:00.000Z"),
          outreach("2026-09-02T18:00:00.000Z", { arsenalTool: "laser" }),
        ],
      })
    ).toEqual({ state: "spark", reached: "field_activity", lastToolUse: null });
    expect(deriveRekindling({ since, events: [] })).toEqual({
      state: "dark",
      reached: null,
      lastToolUse: null,
    });
  });
});
