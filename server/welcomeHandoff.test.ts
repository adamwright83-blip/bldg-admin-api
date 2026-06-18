import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPortalWelcomeUrl,
  decodeWelcomeUrlForTest,
  stripeObjectsMatchOrder,
  submittedIdentityMatchesOrder,
} from "./welcomeHandoff";

const order = {
  id: 42,
  phone: "(310) 555-1234",
  firstName: " Ada ",
  lastName: " Lovelace ",
  email: "ADA@EXAMPLE.COM",
  unit: " 8B ",
  address: "3545 Wilshire Blvd, Los Angeles, CA 90010",
  buildingSlug: null,
};

afterEach(() => vi.unstubAllEnvs());

describe("Laundry Butler welcome handoff", () => {
  it("signs only the agreed claims and builds the configured welcome URL", async () => {
    vi.stubEnv(
      "APP_SHARED_API_SECRET",
      "a-secure-shared-test-secret-at-least-32-chars"
    );
    vi.stubEnv(
      "RESIDENT_WEB_ORIGIN",
      "https://resident.example.test/some-path"
    );
    const url = await createPortalWelcomeUrl(order);
    const { payload } = await decodeWelcomeUrlForTest(
      url,
      "a-secure-shared-test-secret-at-least-32-chars"
    );

    expect(url).toMatch(/^https:\/\/resident\.example\.test\/welcome\?token=/);
    expect(payload).toMatchObject({
      phone: "+13105551234",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      unit: "8B",
      buildingSlug: "opusla",
      orderId: 42,
      iss: "laundry-butler",
      aud: "held-resident-app",
    });
    expect(payload.jti).toEqual(expect.any(String));
    expect(payload.exp! - payload.iat!).toBe(300);
    expect(Object.keys(payload).sort()).toEqual(
      [
        "aud",
        "buildingSlug",
        "email",
        "exp",
        "firstName",
        "iat",
        "iss",
        "jti",
        "lastName",
        "orderId",
        "phone",
        "unit",
      ].sort()
    );
    expect(JSON.stringify(payload)).not.toMatch(/stripe|payment|address/i);
  });

  it("falls back to the production HELD origin", async () => {
    vi.stubEnv(
      "APP_SHARED_API_SECRET",
      "a-secure-shared-test-secret-at-least-32-chars"
    );
    vi.stubEnv("RESIDENT_WEB_ORIGIN", "");
    expect(await createPortalWelcomeUrl(order)).toMatch(
      /^https:\/\/app\.bldg\.chat\/welcome\?token=/
    );
  });

  it("requires succeeded Stripe objects owned by the customer and tagged for the order", () => {
    const input = {
      orderId: 42,
      stripeCustomerId: "cus_1",
      stripePaymentMethodId: "pm_1",
    };
    const intent = {
      status: "succeeded",
      customer: "cus_1",
      payment_method: "pm_1",
      metadata: { orderId: "42" },
    };
    const method = { customer: "cus_1" };
    expect(stripeObjectsMatchOrder(input, intent, method)).toBe(true);
    expect(
      stripeObjectsMatchOrder(
        input,
        { ...intent, metadata: { orderId: "43" } },
        method
      )
    ).toBe(false);
    expect(
      stripeObjectsMatchOrder(input, intent, { customer: "cus_other" })
    ).toBe(false);
    expect(
      stripeObjectsMatchOrder(
        input,
        { ...intent, status: "requires_payment_method" },
        method
      )
    ).toBe(false);
  });

  it("does not bootstrap Stripe proof from only a guessed order ID", () => {
    expect(
      submittedIdentityMatchesOrder(order, {
        firstName: "Mallory",
        lastName: "Attacker",
        phone: "3105559999",
        email: "mallory@example.com",
      })
    ).toBe(false);
    expect(
      submittedIdentityMatchesOrder(order, {
        firstName: "Ada",
        lastName: "Lovelace",
        phone: "+1 310 555 1234",
        email: "ada@example.com",
      })
    ).toBe(true);
  });

  it("keeps failure recovery on the booked success screen and removes landing-page continuation", () => {
    const source = readFileSync(
      resolve("client/src/components/SchedulePickupModal.tsx"),
      "utf8"
    );
    expect(source).toContain('"Continue to HELD"');
    expect(source).toContain("Your pickup remains booked—please try again.");
    expect(source).toMatch(
      /window\.setTimeout\([\s\S]*window\.location\.assign\(welcomeUrl\)[\s\S]*2500/
    );
    expect(source).not.toContain('window.location.assign("/")');
  });

  it("keeps orderId-only token generation admin-authorized", () => {
    const source = readFileSync(resolve("server/routers.ts"), "utf8");
    expect(source).toMatch(/generatePortalToken:\s*adminProcedure/);
    expect(source).not.toMatch(/generatePortalToken:\s*publicProcedure/);
  });
});
