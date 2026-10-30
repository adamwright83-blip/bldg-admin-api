import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Keeping the crew on real MySQL: a first-ten signup draft takes the owner's identity, checks out through today's
 * billing (a stand-in Stripe), returns to /joystick-start, and is provisioned by the webhook like any JOYSTICK signup.
 * While billing is open, the message leaves the table only once the journey is active. Local disposable database only.
 */
const url = process.env.DATABASE_URL ?? "";
const allowed = (() => {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.pathname === "/first_ten_test";
  } catch {
    return false;
  }
})();
process.env.JWT_SECRET ||= "first-ten-integration-secret-000000000000";

function fakeStripe(state: { event: unknown; subscription: unknown; created?: { params: Record<string, unknown> } }) {
  return {
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          state.created = { params };
          return { id: `cs_test_first_ten_${randomUUID().slice(0, 8)}`, url: "https://checkout.stripe.example/first-ten" };
        },
        retrieve: async (id: string) => ({ id, url: "https://checkout.stripe.example/first-ten" }),
      },
    },
    webhooks: { constructEvent: () => state.event },
    subscriptions: { retrieve: async () => state.subscription },
  } as never;
}

// today's billing tables and its core entitlement keep their historical names (docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md)
const LEGACY_DAYFORGE_TABLE = (name: string) => `dayforge_saas_${name}`; // legacy table prefix
const LEGACY_DAYFORGE_CORE = "dayforge_core";

describe.skipIf(!allowed)("keeping the crew on MySQL", () => {
  let db: mysql.Connection;
  const suffix = Date.now().toString(36);
  const planKey = `first-ten-test-${suffix}`;
  let tenantId = "";

  beforeAll(async () => {
    db = await mysql.createConnection(url);
    await import("../journeys");
    await db.execute(
      `INSERT INTO ${LEGACY_DAYFORGE_TABLE("billing_plans")} (planKey,displayName,stripePriceId,trialDays,rulesJson,entitlementsJson,active)
       VALUES (?,?,?,7,?,?,true)`,
      [planKey, "JOYSTICK", `price_${planKey}`, JSON.stringify({}), JSON.stringify([LEGACY_DAYFORGE_CORE])]
    );
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await db.execute(`DELETE FROM ${LEGACY_DAYFORGE_TABLE("billing_plans")} WHERE planKey = ?`, [planKey]);
    if (tenantId) {
      for (const table of ["entitlements", "subscriptions", "memberships"].map(LEGACY_DAYFORGE_TABLE)) {
        await db.execute(`DELETE FROM \`${table}\` WHERE tenantId = ?`, [tenantId]).catch(() => undefined);
      }
      await db.execute(`DELETE FROM ${LEGACY_DAYFORGE_TABLE("tenants")} WHERE id = ?`, [tenantId]).catch(() => undefined);
    }
    await db.end();
  });

  it("checks out a first-ten draft, comes back to the prepared message, and only then lets it leave the table", async () => {
    const { startJourney } = await import("../journeys");
    const { journeyById } = await import("../store");
    const { activationView, beginActivation, handOffDraft, reportDraft } = await import("./activation");
    const { processLegacyDayforgeBillingWebhook } = await import("../../saas/saasBilling");
    const started = await startJourney({ requestId: randomUUID(), kind: "own" });
    const credentials = started.credentials;
    const journey = started.journey;
    await db.execute(
      `INSERT INTO first_ten_drafts (journey_id, opportunity_id, recipient_name, recipient_address, subject, body, approach, edited, status)
       VALUES (?, 'opportunity', 'Elena Ruiz', 'elena@larkspurhotel.example', 'Re: Friday flowers?', 'Hi Elena — ...', 'still_wanted', 0, 'prepared')`,
      [journey.id]
    );

    const before = await activationView(journey, credentials);
    expect(before).toMatchObject({ example: false, required: true, status: "none", offer: { planKey, line: "JOYSTICK, 7 days free." } });
    // billing is open and the journey isn't active: the message stays at the table
    await expect(handOffDraft(journey, credentials, "copy")).rejects.toThrow(/Continue with JOYSTICK first/);

    const state = { event: null as unknown, subscription: null as unknown, created: undefined as { params: Record<string, unknown> } | undefined };
    const { url: checkoutUrl } = await beginActivation(
      journey,
      credentials,
      { businessName: "Wildroot Flowers", contactName: "Nina Vale", ownerEmail: `nina-${suffix}@wildrootflowers.example`, timeZone: "America/Los_Angeles" },
      fakeStripe(state)
    );
    expect(checkoutUrl).toBe("https://checkout.stripe.example/first-ten");
    expect(state.created?.params.success_url).toContain(`/joystick-start?session=${credentials.sessionId}&checkout=success`);
    expect(state.created?.params.cancel_url).toContain("/joystick-start?");
    expect((await activationView(journey, credentials)).status).toBe("checkout_pending");
    expect((await journeyById(journey.id))!.stage).toBe("activation");

    // back from a cancelled checkout, continuing picks the same checkout up again; nothing new is created
    state.created = undefined;
    const resumed = await beginActivation(
      journey,
      credentials,
      { businessName: "Wildroot Flowers", contactName: "Nina Vale", ownerEmail: `nina-${suffix}@wildrootflowers.example`, timeZone: "America/Los_Angeles" },
      fakeStripe(state)
    );
    expect(resumed.url).toBe("https://checkout.stripe.example/first-ten");
    expect(state.created).toBeUndefined();
    expect((await activationView(journey, credentials)).status).toBe("checkout_pending");

    process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET ||= "whsec_first_ten_test"; // the legacy-named webhook secret
    const created = Math.floor(Date.now() / 1000);
    const subscription = {
      id: `sub_first_ten_${suffix}`,
      customer: `cus_first_ten_${suffix}`,
      status: "trialing",
      cancel_at_period_end: false,
      current_period_end: created + 86400 * 30,
      trial_end: created + 86400 * 7,
      latest_invoice: `in_first_ten_${suffix}`,
      metadata: { legacyDayforgeOnboardingSessionId: credentials.sessionId, legacyDayforgePlanKey: planKey },
    };
    state.event = {
      id: `evt_first_ten_${suffix}`,
      type: "checkout.session.completed",
      livemode: false,
      created,
      data: { object: { id: "cs_test_first_ten", subscription: subscription.id, metadata: subscription.metadata } },
    };
    state.subscription = subscription;
    const processed = await processLegacyDayforgeBillingWebhook({ rawBody: Buffer.from("first-ten"), signature: "test-signature", stripe: fakeStripe(state) });
    expect(processed.status).toBe("processed");

    const after = await activationView(journey, credentials);
    expect(after.status).toBe("active");
    tenantId = (await journeyById(journey.id))!.tenantId ?? "";
    expect(tenantId).toMatch(/^df_[0-9a-f]{24}$/);

    // now it can leave, the person's way, and only what happened is recorded
    await handOffDraft(journey, credentials, "copy");
    await reportDraft(journey, "sent");
    const [rows] = await db.query<mysql.RowDataPacket[]>("SELECT status, handed_off_at, reported_sent_at, verified_sent_at FROM first_ten_drafts WHERE journey_id = ?", [journey.id]);
    expect(rows[0].status).toBe("reported_sent");
    expect(rows[0].handed_off_at).not.toBeNull();
    expect(rows[0].verified_sent_at).toBeNull();
  });

  it("never activates Nina's example, and says plainly when billing isn't open", async () => {
    const { startJourney } = await import("../journeys");
    const { activationView, beginActivation } = await import("./activation");
    const example = await startJourney({ requestId: randomUUID(), kind: "example" });
    expect(await activationView(example.journey, example.credentials)).toMatchObject({ example: true, required: false, offer: null });
    await expect(
      beginActivation(example.journey, example.credentials, { businessName: "x", contactName: "y", ownerEmail: "z@example.com", timeZone: "UTC" })
    ).rejects.toThrow(/can't be activated/);
  });
});
