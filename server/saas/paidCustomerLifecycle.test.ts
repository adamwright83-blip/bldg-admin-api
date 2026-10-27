/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { subscriptionAllowsLegacyDayforgeAccess } from "../../shared/saasTenant";
import {
  checkAdvertisedStripePrice,
  JOYSTICK_MONTHLY_PLAN_KEY,
} from "./joystickStripeOffer";
import {
  ADAM_JOYSTICK_STRIPE_TEST_KEY_STEP,
  ADVERTISED_PAID_OFFER,
  assertAdvertisedOfferUnchanged,
  assertNewBusinessIdentity,
  assertTestModeCheckoutKey,
  billingSecretGate,
  classifyWebhookDelivery,
  decidePaidLogin,
  deliveryShouldMutateSubscription,
  JOYSTICK_PUBLIC_CHECKOUT_LIVE,
  LIVE_KEY_CHECKOUT_CLOSED_MESSAGE,
  screenPaidLifecycleWebhook,
  TEST_MODE_CHECKOUT_CLOSED_MESSAGE,
  type WebhookDeliveryClass,
} from "./paidCustomerLifecycle";

const WEBHOOK_SECRET = "whsec_paid_lifecycle_unit_only";
const TEST_KEY = `sk_test_${"x".repeat(24)}`;
const LIVE_KEY = `sk_live_${"y".repeat(24)}`;

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

function signedEvent(event: Record<string, unknown>): { payload: string; signature: string } {
  const stripe = new Stripe("sk_test_paid_lifecycle_sign_only", {
    apiVersion: "2025-03-31.basil" as any,
  });
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { payload, signature };
}

describe("JOYSTICK paid-customer lifecycle gates", () => {
  it("keeps the advertised offer and leaves public checkout closed", () => {
    assertAdvertisedOfferUnchanged();
    expect(ADVERTISED_PAID_OFFER).toEqual({
      monthlyUnitAmountCents: 4900,
      annualUnitAmountCents: 46800,
      trialDays: 7,
      checkoutLive: false,
    });
    expect(JOYSTICK_PUBLIC_CHECKOUT_LIVE).toBe(false);
    const landing = source("../../client/src/pages/JoystickLanding.tsx");
    expect(landing).toContain("checkout_live: false");
    expect(landing).not.toContain("checkout_live: true");
  });

  it("normalizes a new business identity and refuses an incomplete one", () => {
    expect(
      assertNewBusinessIdentity({
        businessName: "  North Harbor Laundry  ",
        contactName: " Ada Owner ",
        ownerEmail: "Ada.Owner@Example.Invalid",
        timeZone: " America/Los_Angeles ",
      })
    ).toEqual({
      businessName: "North Harbor Laundry",
      contactName: "Ada Owner",
      ownerEmail: "ada.owner@example.invalid",
      timeZone: "America/Los_Angeles",
    });
    expect(() =>
      assertNewBusinessIdentity({
        businessName: " ",
        contactName: "Ada",
        ownerEmail: "ada@example.invalid",
        timeZone: "UTC",
      })
    ).toThrow(/Business and owner identity/);
    const router = source("./saasRouter.ts");
    const identity = router.indexOf("saveJoystickIdentity");
    expect(router.indexOf("assertNewBusinessIdentity", identity)).toBeGreaterThan(identity);
  });

  it("fails closed when a retrieved price disagrees, and allows the advertised monthly price", () => {
    const verified = {
      id: "price_test_monthly",
      active: true,
      unit_amount: 4900,
      currency: "usd",
      recurring: { interval: "month" },
    };
    expect(
      checkAdvertisedStripePrice({
        planKey: JOYSTICK_MONTHLY_PLAN_KEY,
        trialDays: 7,
        configuredPriceId: "price_test_monthly",
        price: verified,
      })
    ).toEqual({ ok: true });
    const mismatched = checkAdvertisedStripePrice({
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      trialDays: 7,
      configuredPriceId: "price_test_monthly",
      price: { ...verified, unit_amount: 4901 },
    });
    expect(mismatched.ok).toBe(false);
    const wrongTrial = checkAdvertisedStripePrice({
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      trialDays: 0,
      configuredPriceId: "price_test_monthly",
      price: verified,
    });
    expect(wrongTrial.ok).toBe(false);
    expect(
      checkAdvertisedStripePrice({
        planKey: JOYSTICK_MONTHLY_PLAN_KEY,
        trialDays: 7,
        configuredPriceId: "price_test_monthly",
        price: null,
      }).ok
    ).toBe(false);
  });

  it("refuses a live billing key and records the missing-key step without charging", () => {
    const absent = billingSecretGate(undefined);
    expect(absent.action).toBe("absent");
    if (absent.action === "absent") {
      expect(absent.blocker).toContain("DAYFORGE_BILLING_STRIPE_SECRET_KEY is unset");
      expect(absent.adamStep).toBe(ADAM_JOYSTICK_STRIPE_TEST_KEY_STEP);
      expect(absent.adamStep).toContain("sk_test_");
      expect(absent.adamStep).toContain("Laundry Farm");
      expect(absent.adamStep).toContain("checkout_live stays false");
    }
    expect(billingSecretGate(LIVE_KEY)).toMatchObject({
      action: "refuse",
      reason: "live_key",
      message: LIVE_KEY_CHECKOUT_CLOSED_MESSAGE,
    });
    expect(billingSecretGate("rk_live_restricted_key_value")).toMatchObject({
      action: "refuse",
      reason: "live_key",
    });
    expect(billingSecretGate("not-a-stripe-key")).toMatchObject({
      action: "refuse",
      reason: "unrecognized_key",
    });
    expect(billingSecretGate(TEST_KEY)).toEqual({ action: "allow_test" });
    expect(() => assertTestModeCheckoutKey(undefined)).toThrow(TEST_MODE_CHECKOUT_CLOSED_MESSAGE);
    expect(() => assertTestModeCheckoutKey(LIVE_KEY)).toThrow(LIVE_KEY_CHECKOUT_CLOSED_MESSAGE);
    expect(() => assertTestModeCheckoutKey(TEST_KEY)).not.toThrow();
    const router = source("./saasRouter.ts");
    const checkout = router.indexOf("checkout: publicProcedure");
    const portal = router.indexOf("billingPortal:");
    expect(router.indexOf("assertTestModeCheckoutKey", checkout)).toBeGreaterThan(checkout);
    expect(router.indexOf("assertTestModeCheckoutKey", checkout)).toBeLessThan(
      router.indexOf("createLegacyDayforgeSubscriptionCheckout", checkout)
    );
    expect(router.indexOf("assertTestModeCheckoutKey", portal)).toBeGreaterThan(portal);
    expect(router.indexOf("createLegacyDayforgeBillingPortal", portal)).toBeGreaterThan(
      router.indexOf("assertTestModeCheckoutKey", portal)
    );
  });

  it("verifies webhook signatures and refuses live-mode delivery before provisioning", () => {
    const created = Math.floor(Date.now() / 1000);
    const good = signedEvent({
      id: "evt_paid_lifecycle_test",
      object: "event",
      type: "checkout.session.completed",
      livemode: false,
      created,
      data: { object: { id: "cs_test_paid_lifecycle", object: "checkout.session" } },
    });
    expect(
      screenPaidLifecycleWebhook({
        rawBody: good.payload,
        signature: good.signature,
        webhookSecret: WEBHOOK_SECRET,
      })
    ).toEqual({ proceed: true });
    expect(
      screenPaidLifecycleWebhook({
        rawBody: Buffer.from(good.payload),
        signature: good.signature,
        webhookSecret: WEBHOOK_SECRET,
      })
    ).toEqual({ proceed: true });
    expect(
      screenPaidLifecycleWebhook({
        rawBody: good.payload,
        signature: "t=1,v1=deadbeef",
        webhookSecret: WEBHOOK_SECRET,
      })
    ).toMatchObject({
      proceed: false,
      httpStatus: 400,
      body: { status: "failed", reason: "invalid_signature" },
    });
    expect(
      screenPaidLifecycleWebhook({
        rawBody: good.payload,
        signature: undefined,
        webhookSecret: WEBHOOK_SECRET,
      }).proceed
    ).toBe(false);
    const live = signedEvent({
      id: "evt_paid_lifecycle_live",
      object: "event",
      type: "checkout.session.completed",
      livemode: true,
      created,
      data: { object: { id: "cs_live_refused", object: "checkout.session" } },
    });
    expect(
      screenPaidLifecycleWebhook({
        rawBody: live.payload,
        signature: live.signature,
        webhookSecret: WEBHOOK_SECRET,
      })
    ).toEqual({
      proceed: false,
      httpStatus: 200,
      body: { status: "ignored", reason: "live_mode_refused" },
    });
    expect(
      screenPaidLifecycleWebhook({
        rawBody: good.payload,
        signature: good.signature,
        webhookSecret: "",
      })
    ).toEqual({ proceed: true });
    const route = source("./saasBillingWebhookRoute.ts");
    const screenAt = route.indexOf("screenPaidLifecycleWebhook");
    const processAt = route.indexOf("processLegacyDayforgeBillingWebhook");
    expect(screenAt).toBeGreaterThan(-1);
    expect(screenAt).toBeLessThan(processAt);
    expect(route).toContain("rawBody: req.body");
    expect(route).toContain('req.headers["stripe-signature"]');
    const billing = source("./saasBilling.ts");
    expect(billing).toContain("stripe.webhooks.constructEvent");
    expect(billing).toContain('reason: "duplicate_event"');
    const store = source("./saasStore.ts");
    expect(store).toContain("ignoredAsStale");
    expect(store).toContain("lastStripeEventCreatedAt > input.eventCreatedAt");
  });

  it("classifies duplicate, delayed, and out-of-order webhook delivery", () => {
    const latest = new Date("2026-10-25T12:00:00.000Z");
    const seen = new Set(["evt_applied"]);
    expect(
      classifyWebhookDelivery({
        eventId: "evt_applied",
        eventCreatedAt: latest,
        receivedAt: new Date("2026-10-25T12:01:00.000Z"),
        appliedEventIds: seen,
        latestAppliedCreatedAt: latest,
      })
    ).toBe("duplicate");
    expect(
      classifyWebhookDelivery({
        eventId: "evt_late_old",
        eventCreatedAt: new Date("2026-10-25T11:00:00.000Z"),
        receivedAt: new Date("2026-10-25T13:00:00.000Z"),
        appliedEventIds: seen,
        latestAppliedCreatedAt: latest,
      })
    ).toBe("out_of_order");
    expect(
      classifyWebhookDelivery({
        eventId: "evt_delayed_newer",
        eventCreatedAt: new Date("2026-10-25T12:30:00.000Z"),
        receivedAt: new Date("2026-10-25T13:00:00.000Z"),
        appliedEventIds: seen,
        latestAppliedCreatedAt: latest,
      })
    ).toBe("delayed");
    expect(
      classifyWebhookDelivery({
        eventId: "evt_next",
        eventCreatedAt: new Date("2026-10-25T12:05:00.000Z"),
        receivedAt: new Date("2026-10-25T12:06:00.000Z"),
        appliedEventIds: seen,
        latestAppliedCreatedAt: latest,
      })
    ).toBe("in_order");
    expect(deliveryShouldMutateSubscription("duplicate")).toBe(false);
    expect(deliveryShouldMutateSubscription("out_of_order")).toBe(false);
    expect(deliveryShouldMutateSubscription("delayed")).toBe(true);
    expect(deliveryShouldMutateSubscription("in_order")).toBe(true);
  });

  it("allows first and returning login only while the subscription still grants access", () => {
    const open = {
      membershipActive: true,
      tenantStatus: "active",
      entitlementAllows: true,
    };
    expect(decidePaidLogin({ ...open, priorSuccessfulLogin: false })).toEqual({
      allow: true,
      kind: "first",
    });
    expect(decidePaidLogin({ ...open, priorSuccessfulLogin: true })).toEqual({
      allow: true,
      kind: "returning",
    });
    const now = new Date("2026-10-25T12:00:00.000Z");
    const graceEndsAt = new Date("2026-10-26T12:00:00.000Z");
    expect(
      subscriptionAllowsLegacyDayforgeAccess({
        status: "past_due",
        now,
        graceEndsAt,
        accessEndsAt: null,
      })
    ).toBe(true);
    expect(
      decidePaidLogin({
        membershipActive: true,
        tenantStatus: "delinquent",
        entitlementAllows: true,
        priorSuccessfulLogin: true,
      }).allow
    ).toBe(true);
    expect(
      subscriptionAllowsLegacyDayforgeAccess({
        status: "past_due",
        now: new Date(graceEndsAt.getTime() + 1),
        graceEndsAt,
        accessEndsAt: null,
      })
    ).toBe(false);
    expect(
      subscriptionAllowsLegacyDayforgeAccess({
        status: "canceled",
        now,
        accessEndsAt: now,
      })
    ).toBe(false);
    expect(
      subscriptionAllowsLegacyDayforgeAccess({
        status: "unpaid",
        now,
        accessEndsAt: now,
      })
    ).toBe(false);
    for (const tenantStatus of ["delinquent", "canceled", "suspended"]) {
      const decision = decidePaidLogin({
        membershipActive: true,
        tenantStatus,
        entitlementAllows: false,
        priorSuccessfulLogin: true,
      });
      expect(decision.allow).toBe(false);
      if (!decision.allow) expect(decision.httpStatus).toBe(403);
    }
    const auth = source("./saasAuthRoute.ts");
    expect(auth.indexOf("hasTenantEntitlement")).toBeLessThan(
      auth.indexOf("sdk.createSessionToken")
    );
    expect(auth.indexOf("decidePaidLogin")).toBeLessThan(auth.indexOf("sdk.createSessionToken"));
    const router = source("./saasRouter.ts");
    expect(router.indexOf("requirePaidWorkspaceAccess")).toBeLessThan(
      router.indexOf("getTenantConfiguration(ctx.tenantId)")
    );
  });
});

describe("one new mocked tenant through the paid lifecycle", () => {
  it("provisions North Harbor once, then follows payment failure and cancellation", () => {
    const identity = assertNewBusinessIdentity({
      businessName: "North Harbor Laundry",
      contactName: "Ada Owner",
      ownerEmail: "ada.owner@north-harbor.example.invalid",
      timeZone: "America/Los_Angeles",
    });
    assertAdvertisedOfferUnchanged();
    expect(billingSecretGate(undefined).action).toBe("absent");

    const tenantId = "df_paid_lifecycle_north_harbor";
    const seen = new Set<string>();
    let latest: Date | null = null;
    let status: "trialing" | "past_due" | "active" | "canceled" | "unpaid" = "trialing";
    let graceEndsAt: Date | null = null;
    let accessEndsAt: Date | null = null;
    let priorLogin = false;

    function apply(
      eventId: string,
      eventCreatedAt: Date,
      receivedAt: Date,
      mutate: () => void
    ): WebhookDeliveryClass {
      const kind = classifyWebhookDelivery({
        eventId,
        eventCreatedAt,
        receivedAt,
        appliedEventIds: seen,
        latestAppliedCreatedAt: latest,
      });
      if (!deliveryShouldMutateSubscription(kind)) return kind;
      seen.add(eventId);
      latest = eventCreatedAt;
      mutate();
      return kind;
    }

    function entitled(now: Date): boolean {
      return subscriptionAllowsLegacyDayforgeAccess({
        status,
        now,
        graceEndsAt,
        accessEndsAt,
      });
    }

    const checkoutCreated = new Date("2026-10-25T15:00:00.000Z");
    const checkoutPayload = signedEvent({
      id: "evt_north_harbor_checkout",
      object: "event",
      type: "checkout.session.completed",
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: "cs_test_north_harbor", object: "checkout.session" } },
    });
    expect(
      screenPaidLifecycleWebhook({
        rawBody: checkoutPayload.payload,
        signature: checkoutPayload.signature,
        webhookSecret: WEBHOOK_SECRET,
      }).proceed
    ).toBe(true);

    expect(
      apply("evt_north_harbor_checkout", checkoutCreated, checkoutCreated, () => {
        status = "trialing";
      })
    ).toBe("in_order");
    expect(tenantId.startsWith("df_")).toBe(true);
    expect(identity.ownerEmail).toBe("ada.owner@north-harbor.example.invalid");
    // Trial-end denial is owned by PR #686. This exam does not call the
    // entitlement function for a bare trialing status.
    expect(
      decidePaidLogin({
        membershipActive: true,
        tenantStatus: "active",
        entitlementAllows: true,
        priorSuccessfulLogin: priorLogin,
      })
    ).toEqual({ allow: true, kind: "first" });
    priorLogin = true;

    expect(
      apply("evt_north_harbor_checkout", checkoutCreated, new Date(checkoutCreated.getTime() + 1000), () => {
        throw new Error("duplicate delivery mutated the tenant");
      })
    ).toBe("duplicate");

    expect(
      apply(
        "evt_north_harbor_stale",
        new Date(checkoutCreated.getTime() - 60_000),
        new Date(checkoutCreated.getTime() + 60_000),
        () => {
          throw new Error("out-of-order delivery mutated the tenant");
        }
      )
    ).toBe("out_of_order");

    const failureCreated = new Date(checkoutCreated.getTime() + 30 * 60_000);
    const failureReceived = new Date(failureCreated.getTime() + 20 * 60_000);
    expect(
      apply("evt_north_harbor_payment_failed", failureCreated, failureReceived, () => {
        status = "past_due";
        graceEndsAt = new Date(failureCreated.getTime() + 7 * 24 * 60 * 60 * 1000);
      })
    ).toBe("delayed");
    expect(
      decidePaidLogin({
        membershipActive: true,
        tenantStatus: "delinquent",
        entitlementAllows: entitled(new Date(graceEndsAt!.getTime() - 1000)),
        priorSuccessfulLogin: priorLogin,
      })
    ).toEqual({ allow: true, kind: "returning" });
    expect(entitled(new Date(graceEndsAt!.getTime() + 1000))).toBe(false);

    const paidCreated = new Date(failureCreated.getTime() + 60_000);
    expect(
      apply("evt_north_harbor_paid", paidCreated, paidCreated, () => {
        status = "active";
        graceEndsAt = null;
        accessEndsAt = null;
      })
    ).toBe("in_order");
    expect(
      decidePaidLogin({
        membershipActive: true,
        tenantStatus: "active",
        entitlementAllows: entitled(paidCreated),
        priorSuccessfulLogin: true,
      }).allow
    ).toBe(true);

    const cancelCreated = new Date(paidCreated.getTime() + 60_000);
    expect(
      apply("evt_north_harbor_canceled", cancelCreated, cancelCreated, () => {
        status = "canceled";
        accessEndsAt = cancelCreated;
      })
    ).toBe("in_order");
    expect(entitled(cancelCreated)).toBe(false);
    const unpaidCreated = new Date(cancelCreated.getTime() + 1000);
    expect(
      apply("evt_north_harbor_unpaid", unpaidCreated, unpaidCreated, () => {
        status = "unpaid";
        accessEndsAt = unpaidCreated;
      })
    ).toBe("in_order");
    expect(entitled(unpaidCreated)).toBe(false);
    expect(seen.size).toBe(5);
  });
});
