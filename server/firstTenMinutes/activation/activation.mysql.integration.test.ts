/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
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

function fakeStripe(state: { event: unknown; subscription: unknown; created?: { params: Record<string, unknown> }; sessionId?: string }) {
  return {
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          state.created = { params };
          const id = `cs_test_first_ten_${randomUUID().slice(0, 8)}`;
          if ("sessionId" in state) state.sessionId = id;
          return { id, url: "https://checkout.stripe.example/first-ten" };
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
       VALUES (?,?,?,0,?,?,true)`,
      [planKey, "JOYSTICK", `price_${planKey}`, JSON.stringify({}), JSON.stringify([LEGACY_DAYFORGE_CORE])]
    );
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await db.execute(`DELETE FROM ${LEGACY_DAYFORGE_TABLE("billing_plans")} WHERE planKey = ?`, [planKey]);
    if (tenantId) {
      for (const table of ["entitlements", "subscriptions", "memberships", "user_credentials"].map(LEGACY_DAYFORGE_TABLE)) {
        await db.execute(`DELETE FROM \`${table}\` WHERE tenantId = ?`, [tenantId]).catch(() => undefined);
      }
      await db.execute("DELETE FROM users WHERE tenantId = ?", [tenantId]).catch(() => undefined);
      await db.execute(`DELETE FROM ${LEGACY_DAYFORGE_TABLE("tenants")} WHERE id = ?`, [tenantId]).catch(() => undefined);
    }
    await db.end();
  });

  it("checks out a first-ten draft, comes back to the prepared message, and only then sends it, once, from her own Gmail", async () => {
    const { startJourney } = await import("../journeys");
    const { journeyById } = await import("../store");
    const { activationView, beginActivation, sendDraft } = await import("./activation");
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
    // a test plan, not the advertised one: no trial, and its price is not known here, so only the name is stated
    expect(before).toMatchObject({ example: false, required: true, status: "none", offer: { planKey, line: "JOYSTICK.", detail: "Card required." } });
    const approved = { to: "elena@larkspurhotel.example", subject: "Re: Friday flowers?", body: "Hi Elena — ..." };
    // billing is open and the journey isn't active: the message stays at the table
    await expect(sendDraft(journey, credentials, approved)).rejects.toThrow(/Continue with JOYSTICK first/);

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
    expect(state.created?.params.subscription_data).not.toHaveProperty("trial_period_days");
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
      status: "active",
      cancel_at_period_end: false,
      trial_end: null,
      // 2025-03-31.basil onward: the period end is on the subscription item
      items: { data: [{ current_period_end: created + 86400 * 30 }] },
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

    // the workspace exists, but no one can sign in to it yet: the owner makes a password, as in today's funnel
    const ownerEmail = `nina-${suffix}@wildrootflowers.example`;
    expect(after).toMatchObject({ owner: "needs_password", identity: { contactName: "Nina Vale", ownerEmail } });
    const [noOwner] = await db.query<mysql.RowDataPacket[]>(`SELECT 1 FROM ${LEGACY_DAYFORGE_TABLE("user_credentials")} WHERE tenantId = ?`, [tenantId]);
    expect(noOwner).toHaveLength(0);
    const { activateOnboardingOwner } = await import("../../saas/saasStore");
    const owned = await activateOnboardingOwner({ ...credentials, name: "Nina Vale", passwordHash: await bcrypt.hash("a long first-ten password", 4) });
    expect(owned.tenantId).toBe(tenantId);
    expect(await activationView(journey, credentials)).toMatchObject({ status: "active", owner: "ready" });
    // what the password sign-in route reads: her credentials, an active owner membership, the tenant active
    const [signIn] = await db.query<mysql.RowDataPacket[]>(
      `SELECT c.emailNormalized, m.role, m.active, t.status FROM ${LEGACY_DAYFORGE_TABLE("user_credentials")} c
       JOIN ${LEGACY_DAYFORGE_TABLE("memberships")} m ON m.tenantId = c.tenantId AND m.userOpenId = c.userOpenId
       JOIN ${LEGACY_DAYFORGE_TABLE("tenants")} t ON t.id = c.tenantId WHERE c.tenantId = ?`,
      [tenantId]
    );
    expect(signIn).toEqual([expect.objectContaining({ emailNormalized: ownerEmail, role: "owner", active: 1, status: "active" })]);
    expect(await bcrypt.compare("a long first-ten password", (await db.query<mysql.RowDataPacket[]>(`SELECT passwordHash FROM ${LEGACY_DAYFORGE_TABLE("user_credentials")} WHERE tenantId = ?`, [tenantId]))[0][0].passwordHash)).toBe(true);

    // now it can leave, from inside JOYSTICK, from her own Gmail (played by a local stand-in), once
    const sends: string[] = [];
    const gmail = http.createServer((req, res) => {
      let body = "";
      req.on("data", chunk => (body += chunk));
      req.on("end", () => {
        if (req.method === "POST" && req.url === "/gmail.googleapis.com/gmail/v1/users/me/messages/send") {
          sends.push(Buffer.from(JSON.parse(body).raw, "base64url").toString("utf8"));
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: `gmail-${sends.length}`, threadId: "thread-1", labelIds: ["SENT"] }));
        } else res.writeHead(404).end("{}");
      });
    });
    await new Promise<void>(resolve => gmail.listen(0, "127.0.0.1", resolve));
    const previousOrigin = process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN;
    process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN = `http://127.0.0.1:${(gmail.address() as AddressInfo).port}`;
    try {
      // Gmail isn't connected: nothing is tried
      expect(await sendDraft(journey, credentials, approved)).toBe("needs_permission");
      const { saveConnection } = await import("../store");
      const google = { journeyId: journey.id, provider: "google" as const, accountLabel: "nina@wildrootflowers.example", accountSubject: "sub-nina", accessToken: "token", refreshToken: null, accessExpiresAt: new Date(Date.now() + 3_600_000) };
      // connected for reading only: still nothing is tried, until Google allows sending
      await saveConnection({ ...google, grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly"] });
      expect(await sendDraft(journey, credentials, approved)).toBe("needs_permission");
      expect((await activationView(journey, credentials)).canSend).toBe(false);
      await saveConnection({ ...google, grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"] });
      expect(await activationView(journey, credentials)).toMatchObject({ sendFrom: "nina@wildrootflowers.example", canSend: true });

      // only the message she approved goes
      await expect(sendDraft(journey, credentials, { ...approved, body: "something else" })).rejects.toThrow(/changed since you looked/);
      expect(sends).toHaveLength(0);
      expect(await sendDraft(journey, credentials, approved)).toBe("sent");
      // asked again (a retry, a reload, a replay): it doesn't send twice
      expect(await sendDraft(journey, credentials, approved)).toBe("sent");
      expect(sends).toHaveLength(1);
      expect(sends[0]).toMatch(/^To: "Elena Ruiz" <elena@larkspurhotel\.example>\r$/m);
      expect(sends[0]).toMatch(/^From: nina@wildrootflowers\.example\r$/m);

      const [rows] = await db.query<mysql.RowDataPacket[]>("SELECT status, handed_off_at, reported_sent_at, verified_sent_at, verified_message_id FROM first_ten_drafts WHERE journey_id = ?", [journey.id]);
      expect(rows[0]).toMatchObject({ status: "verified_sent", verified_message_id: "gmail-1", reported_sent_at: null });
      expect(rows[0].handed_off_at).not.toBeNull();
      expect(rows[0].verified_sent_at).not.toBeNull();
      const [ledger] = await db.query<mysql.RowDataPacket[]>("SELECT actor, status, gmail_message_id, gmail_thread_id, attempts, recipient FROM gmail_sends WHERE send_key = ?", [`first_ten:${journey.id}`]);
      expect(ledger[0]).toMatchObject({ actor: "first_ten_onboarding", status: "sent", gmail_message_id: "gmail-1", gmail_thread_id: "thread-1", attempts: 1, recipient: "elena@larkspurhotel.example" });
      const [events] = await db.query<mysql.RowDataPacket[]>("SELECT kind FROM first_ten_events WHERE journey_id = ? AND kind = 'draft_sent'", [journey.id]);
      expect(events).toHaveLength(1);
    } finally {
      if (previousOrigin === undefined) delete process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN;
      else process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN = previousOrigin;
      await new Promise(resolve => gmail.close(resolve));
    }
  });

  it("checks out an own journey with no opportunity and no draft, and does not invent either", async () => {
    const { startJourney } = await import("../journeys");
    const { journeyById } = await import("../store");
    const { chapterView } = await import("../chapter/chapter");
    const { activationView, beginActivation, sendDraft } = await import("./activation");
    const { processLegacyDayforgeBillingWebhook } = await import("../../saas/saasBilling");
    const { activateOnboardingOwner } = await import("../../saas/saasStore");
    const started = await startJourney({ requestId: randomUUID(), kind: "own" });
    const { journey, credentials } = started;
    const email = `ada-${suffix}@northsideplumbing.example`;
    const identity = { businessName: "Northside Plumbing", contactName: "Ada Moss", ownerEmail: email, timeZone: "America/Los_Angeles" };
    let paidTenant = "";

    const chapter = await chapterView(journey);
    expect(chapter.opportunity).toBeNull();
    expect(chapter.draft).toBeNull();
    expect(journey.kind).toBe("own");
    const [draftsBefore] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM first_ten_drafts WHERE journey_id = ?", [journey.id]);
    const [opportunitiesBefore] = await db.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM first_ten_findings WHERE journey_id = ? AND kind = 'opportunity'",
      [journey.id]
    );
    expect(Number(draftsBefore[0].n)).toBe(0);
    expect(Number(opportunitiesBefore[0].n)).toBe(0);
    // billing is open, and there is still nothing to send
    await expect(sendDraft(journey, credentials, { to: "nobody@example.com", subject: "Hello", body: "Hello" })).rejects.toThrow(/Continue with JOYSTICK first/);

    const state = { event: null as unknown, subscription: null as unknown, created: undefined as { params: Record<string, unknown> } | undefined, sessionId: "" };
    const stripe = fakeStripe(state);
    const { url: checkoutUrl } = await beginActivation(journey, credentials, identity, stripe);
    expect(checkoutUrl).toBe("https://checkout.stripe.example/first-ten");
    expect(state.created?.params.success_url).toContain(`/joystick-start?session=${credentials.sessionId}&checkout=success`);
    expect(state.created?.params.cancel_url).toContain("checkout=cancelled");
    expect((await activationView(journey, credentials)).status).toBe("checkout_pending");
    expect((await journeyById(journey.id))!.tenantId).toBeNull();
    expect((await journeyById(journey.id))!.kind).toBe("own");

    // leaving checkout, or asking again, does not provision and does not open a second checkout
    state.created = undefined;
    const resumed = await beginActivation(journey, credentials, identity, fakeStripe(state));
    expect(resumed.url).toBe("https://checkout.stripe.example/first-ten");
    expect(state.created).toBeUndefined();
    expect((await activationView(journey, credentials))).toMatchObject({ status: "checkout_pending", owner: null });

    process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET ||= "whsec_first_ten_test"; // the legacy-named webhook secret
    const created = Math.floor(Date.now() / 1000);
    const subscription = {
      id: `sub_nodraft_${suffix}`,
      customer: `cus_nodraft_${suffix}`,
      status: "active",
      cancel_at_period_end: false,
      trial_end: null,
      items: { data: [{ current_period_end: created + 86400 * 30 }] },
      latest_invoice: `in_nodraft_${suffix}`,
      metadata: { legacyDayforgeOnboardingSessionId: credentials.sessionId, legacyDayforgePlanKey: planKey },
    };
    state.event = {
      id: `evt_nodraft_${suffix}`,
      type: "checkout.session.completed",
      livemode: false,
      created,
      data: { object: { id: state.sessionId || "cs_test_nodraft", subscription: subscription.id, metadata: subscription.metadata } },
    };
    state.subscription = subscription;
    const processed = await processLegacyDayforgeBillingWebhook({ rawBody: Buffer.from("nodraft"), signature: "test-signature", stripe: fakeStripe(state) });
    expect(processed.status).toBe("processed");
    const again = await processLegacyDayforgeBillingWebhook({ rawBody: Buffer.from("nodraft"), signature: "test-signature", stripe: fakeStripe(state) });
    expect(again).toMatchObject({ status: "ignored", reason: "duplicate_event" });

    const after = await activationView(journey, credentials);
    expect(after).toMatchObject({ status: "active", owner: "needs_password", example: false, identity: { contactName: "Ada Moss", ownerEmail: email } });
    paidTenant = (await journeyById(journey.id))!.tenantId ?? "";
    expect(paidTenant).toMatch(/^df_[0-9a-f]{24}$/);
    const [tenants] = await db.query<mysql.RowDataPacket[]>(`SELECT id FROM ${LEGACY_DAYFORGE_TABLE("tenants")} WHERE id = ?`, [paidTenant]);
    expect(tenants).toHaveLength(1);

    // asking for checkout again reuses the paid signup; it does not open another tenant
    state.created = undefined;
    await beginActivation(journey, credentials, identity, fakeStripe(state));
    expect(state.created).toBeUndefined();
    const [tenantsAfterRepeat] = await db.query<mysql.RowDataPacket[]>(`SELECT id FROM ${LEGACY_DAYFORGE_TABLE("tenants")} WHERE contactEmail = ?`, [email]);
    expect(tenantsAfterRepeat.map(row => row.id)).toEqual([paidTenant]);

    const owned = await activateOnboardingOwner({ ...credentials, name: "Ada Moss", passwordHash: await bcrypt.hash("a long first-ten password", 4) });
    expect(owned.tenantId).toBe(paidTenant);
    expect(await activationView(journey, credentials)).toMatchObject({ status: "active", owner: "ready" });
    const [signIn] = await db.query<mysql.RowDataPacket[]>(
      `SELECT c.emailNormalized, m.role FROM ${LEGACY_DAYFORGE_TABLE("user_credentials")} c
       JOIN ${LEGACY_DAYFORGE_TABLE("memberships")} m ON m.tenantId = c.tenantId AND m.userOpenId = c.userOpenId
       WHERE c.tenantId = ?`,
      [paidTenant]
    );
    expect(signIn).toEqual([expect.objectContaining({ emailNormalized: email, role: "owner" })]);

    // still nothing to send, and nothing was written into the business records
    await expect(sendDraft(journey, credentials, { to: "nobody@example.com", subject: "Hello", body: "Hello" })).rejects.toThrow(/isn't waiting at the table/);
    const [draftsAfter] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM first_ten_drafts WHERE journey_id = ?", [journey.id]);
    const [opportunitiesAfter] = await db.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM first_ten_findings WHERE journey_id = ? AND kind = 'opportunity'",
      [journey.id]
    );
    const [sends] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM gmail_sends WHERE send_key = ?", [`first_ten:${journey.id}`]);
    expect(Number(draftsAfter[0].n)).toBe(0);
    expect(Number(opportunitiesAfter[0].n)).toBe(0);
    expect(Number(sends[0].n)).toBe(0);
    expect((await journeyById(journey.id))!.kind).toBe("own");

    for (const table of ["entitlements", "subscriptions", "memberships", "user_credentials"].map(LEGACY_DAYFORGE_TABLE)) {
      await db.execute(`DELETE FROM \`${table}\` WHERE tenantId = ?`, [paidTenant]).catch(() => undefined);
    }
    await db.execute("DELETE FROM users WHERE tenantId = ?", [paidTenant]).catch(() => undefined);
    await db.execute(`DELETE FROM ${LEGACY_DAYFORGE_TABLE("tenants")} WHERE id = ?`, [paidTenant]).catch(() => undefined);
  });

  it("does not grant a workspace when checkout is abandoned, expired, or unpaid", async () => {
    const { startJourney } = await import("../journeys");
    const { journeyById } = await import("../store");
    const { activationView, beginActivation } = await import("./activation");
    const { processLegacyDayforgeBillingWebhook } = await import("../../saas/saasBilling");
    const { activateOnboardingOwner } = await import("../../saas/saasStore");
    process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET ||= "whsec_first_ten_test"; // the legacy-named webhook secret

    const abandoned = await startJourney({ requestId: randomUUID(), kind: "own" });
    const abandonedEmail = `abandoned-${suffix}@northsideplumbing.example`;
    const abandonedIdentity = { businessName: "Northside Plumbing", contactName: "Ada Moss", ownerEmail: abandonedEmail, timeZone: "America/Los_Angeles" };
    const abandonedState = { event: null as unknown, subscription: null as unknown, created: undefined as { params: Record<string, unknown> } | undefined, sessionId: "" };
    await beginActivation(abandoned.journey, abandoned.credentials, abandonedIdentity, fakeStripe(abandonedState));
    expect(await activationView(abandoned.journey, abandoned.credentials)).toMatchObject({ status: "checkout_pending", owner: null });
    expect((await journeyById(abandoned.journey.id))!.tenantId).toBeNull();

    const created = Math.floor(Date.now() / 1000);
    abandonedState.event = {
      id: `evt_expire_${suffix}`,
      type: "checkout.session.expired",
      livemode: false,
      created,
      data: { object: { id: abandonedState.sessionId } },
    };
    const expired = await processLegacyDayforgeBillingWebhook({ rawBody: Buffer.from("expire"), signature: "test-signature", stripe: fakeStripe(abandonedState) });
    expect(expired.status).toBe("processed");
    expect(await activationView(abandoned.journey, abandoned.credentials)).toMatchObject({ status: "none", owner: null });
    expect((await journeyById(abandoned.journey.id))!.tenantId).toBeNull();

    const failed = await startJourney({ requestId: randomUUID(), kind: "own" });
    const failedEmail = `failed-${suffix}@northsideplumbing.example`;
    const failedIdentity = { businessName: "Northside Plumbing", contactName: "Ada Moss", ownerEmail: failedEmail, timeZone: "America/Los_Angeles" };
    const failedState = { event: null as unknown, subscription: null as unknown, created: undefined as { params: Record<string, unknown> } | undefined, sessionId: "" };
    await beginActivation(failed.journey, failed.credentials, failedIdentity, fakeStripe(failedState));
    const subscription = {
      id: `sub_unpaid_${suffix}`,
      customer: `cus_unpaid_${suffix}`,
      status: "incomplete",
      cancel_at_period_end: false,
      trial_end: null,
      items: { data: [{ current_period_end: created + 86400 * 30 }] },
      latest_invoice: `in_unpaid_${suffix}`,
      metadata: { legacyDayforgeOnboardingSessionId: failed.credentials.sessionId, legacyDayforgePlanKey: planKey },
    };
    failedState.subscription = subscription;
    failedState.event = {
      id: `evt_unpaid_${suffix}`,
      type: "invoice.payment_failed",
      livemode: false,
      created,
      data: {
        object: {
          id: `in_unpaid_${suffix}`,
          parent: { type: "subscription_details", subscription_details: { subscription: subscription.id } },
        },
      },
    };
    const unpaid = await processLegacyDayforgeBillingWebhook({ rawBody: Buffer.from("unpaid"), signature: "test-signature", stripe: fakeStripe(failedState) });
    expect(unpaid.status).toBe("processed");
    const unpaidView = await activationView(failed.journey, failed.credentials);
    expect(unpaidView.owner).not.toBe("ready");
    await expect(
      activateOnboardingOwner({ ...failed.credentials, name: "Ada Moss", passwordHash: await bcrypt.hash("a long first-ten password", 4) })
    ).rejects.toThrow(/not active/);
    const failedTenant = (await journeyById(failed.journey.id))!.tenantId;
    if (failedTenant) {
      const [creds] = await db.query<mysql.RowDataPacket[]>(`SELECT 1 FROM ${LEGACY_DAYFORGE_TABLE("user_credentials")} WHERE tenantId = ?`, [failedTenant]);
      expect(creds).toHaveLength(0);
      for (const table of ["entitlements", "subscriptions", "memberships", "user_credentials"].map(LEGACY_DAYFORGE_TABLE)) {
        await db.execute(`DELETE FROM \`${table}\` WHERE tenantId = ?`, [failedTenant]).catch(() => undefined);
      }
      await db.execute(`DELETE FROM ${LEGACY_DAYFORGE_TABLE("tenants")} WHERE id = ?`, [failedTenant]).catch(() => undefined);
    }
  });

  it("refuses to activate one person's journey from another person's signup", async () => {
    const { startJourney } = await import("../journeys");
    const { beginActivation } = await import("./activation");
    const ada = await startJourney({ requestId: randomUUID(), kind: "own" });
    const ben = await startJourney({ requestId: randomUUID(), kind: "own" });
    const state = { event: null as unknown, subscription: null as unknown, created: undefined as { params: Record<string, unknown> } | undefined, sessionId: "" };
    await expect(
      beginActivation(
        ben.journey,
        ada.credentials,
        { businessName: "Northside Plumbing", contactName: "Ada Moss", ownerEmail: `ada-cross-${suffix}@northsideplumbing.example`, timeZone: "America/Los_Angeles" },
        fakeStripe(state)
      )
    ).rejects.toThrow(/different signup/);
    expect(state.created).toBeUndefined();
  });

  it("never activates Nina's example, and says plainly when billing isn't open", async () => {
    const { startJourney } = await import("../journeys");
    const { activationView, beginActivation } = await import("./activation");
    const example = await startJourney({ requestId: randomUUID(), kind: "example" });
    expect(await activationView(example.journey, example.credentials)).toMatchObject({ example: true, required: false, offer: null, owner: null });
    await expect(
      beginActivation(example.journey, example.credentials, { businessName: "x", contactName: "y", ownerEmail: "z@example.com", timeZone: "UTC" })
    ).rejects.toThrow(/can't be activated/);
  });
});
