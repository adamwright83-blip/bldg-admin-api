/* LEGACY DAYFORGE COMPATIBILITY: retained historical literals only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getSessionCookieOptions } from "../server/_core/cookies";
import { DEFAULT_ADMIN_BASE_URL } from "../server/_core/env";
import { OAUTH_CALLBACK_REDIRECT_PATH } from "../server/_core/oauth";
import { normalizeSessionRole } from "../server/_core/sdk";
import { getLegacyDayforgeBillingStripe } from "../server/saas/saasBilling";
import { isValidTwilioWebhook } from "../server/claire/conversation/twilioSignature";
import {
  createAuthorizationPaymentIntent,
  marketplacePaymentsEnabled,
} from "../server/marketplacePayments/marketplaceStripeAdapter";
import {
  JOYSTICK_MAIN_API_RAILWAY_HOST,
  JOYSTICK_MAIN_API_SERVICE_NAME,
  MAIN_API_REWRITE,
  RESIDENT_API_HOST,
  RESIDENT_API_REWRITE,
  isCustomerHostView,
  isPlatformAdminPath,
  resolveJoystickHostView,
  wwwGojoystickRedirectTarget,
} from "./joystickHostRouting";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("JOYSTICK host front doors", () => {
  it("sends each production hostname to its own surface", () => {
    expect(resolveJoystickHostView("admin.gojoystick.com", "/")).toBe("admin-shell");
    expect(resolveJoystickHostView("admin.gojoystick.com", "/home")).toBe("admin-shell");
    expect(resolveJoystickHostView("ADMIN.GOJOYSTICK.COM", "/claire")).toBe("admin-shell");
    expect(resolveJoystickHostView("driver.gojoystick.com", "/")).toBe("driver-shell");
    expect(resolveJoystickHostView("driver.gojoystick.com", "/claire")).toBe("driver-shell");
    expect(resolveJoystickHostView("app.gojoystick.com", "/")).toBe("customer-root");
    expect(resolveJoystickHostView("app.gojoystick.com", "/onboarding")).toBe("customer-onboarding");
    expect(resolveJoystickHostView("app.gojoystick.com", "/dayforge-login")).toBe("customer-root");
    expect(resolveJoystickHostView("app.gojoystick.com", "/play")).toBe("customer-play");
    expect(resolveJoystickHostView("app.gojoystick.com", "/claire")).toBe("customer-claire");
    expect(resolveJoystickHostView("app.gojoystick.com", "/growth/lantern-city")).toBe(
      "customer-lantern"
    );
    expect(resolveJoystickHostView("gojoystick.com", "/")).toBe("marketing-root");
    expect(resolveJoystickHostView("gojoystick.com", "/play")).toBe("continue");
    expect(resolveJoystickHostView("www.gojoystick.com", "/")).toBe("www-redirect");
    expect(resolveJoystickHostView("www.gojoystick.com", "/joystick-start")).toBe("www-redirect");
  });

  it("preserves legacy admin, driver, vendor, and laundry hosts", () => {
    expect(resolveJoystickHostView("admin.bldg.chat", "/home")).toBe("admin-shell");
    expect(resolveJoystickHostView("api.bldg.chat", "/")).toBe("admin-shell");
    expect(resolveJoystickHostView("driver.bldg.chat", "/")).toBe("driver-shell");
    expect(resolveJoystickHostView("laundrybutler.bldg.chat", "/")).toBe("laundry-butler");
    expect(resolveJoystickHostView("laundrybutler.bldg.chat", "/play")).toBe("laundry-butler");
    expect(resolveJoystickHostView("laundryfarm.bldg.chat", "/")).toBe("laundry-farm");
    expect(resolveJoystickHostView("laundryfarm.bldg.chat", "/product")).toBe("laundry-farm");
    expect(resolveJoystickHostView("north.ops.bldg.chat", "/")).toBe("continue");
    expect(resolveJoystickHostView("boreslay.com", "/")).toBe("continue");
  });

  it("refuses platform-admin routes on the customer host", () => {
    for (const path of [
      "/home",
      "/admin",
      "/pnl",
      "/war-room",
      "/president",
      "/driver/cockpit",
      "/claire/scheduled-outreach",
      "/growth",
      "/growth/tower-wars",
      "/legacy-driver-login",
    ]) {
      const view = resolveJoystickHostView("app.gojoystick.com", path);
      expect(view).toBe("customer-forbidden");
      expect(isCustomerHostView(view)).toBe(true);
      expect(isPlatformAdminPath(path)).toBe(true);
    }
    expect(isPlatformAdminPath("/growth/lantern-city")).toBe(false);
    expect(isPlatformAdminPath("/claire")).toBe(false);
  });

  it("redirects www to the apex and keeps the path and query", () => {
    expect(wwwGojoystickRedirectTarget("/", "", "")).toBe("https://gojoystick.com/");
    expect(wwwGojoystickRedirectTarget("/joystick-start", "?x=1", "#how")).toBe(
      "https://gojoystick.com/joystick-start?x=1#how"
    );
    const vercel = JSON.parse(source("vercel.json")) as {
      redirects: Array<{
        source: string;
        has: Array<{ type: string; value: string }>;
        destination: string;
        permanent: boolean;
      }>;
      rewrites: Array<{ source: string; destination: string }>;
    };
    expect(vercel.redirects).toEqual([
      {
        source: "/",
        has: [{ type: "host", value: "www.gojoystick.com" }],
        destination: "https://gojoystick.com/",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.gojoystick.com" }],
        destination: "https://gojoystick.com/:path*",
        permanent: true,
      },
    ]);
    expect(JSON.stringify(vercel.redirects)).not.toContain("*.gojoystick.com");
  });

  it("points api.gojoystick.com at the main API and leaves the resident rewrite alone", () => {
    expect(resolveJoystickHostView("api.gojoystick.com", "/")).toBe("api-host-refused");
    expect(resolveJoystickHostView("api.gojoystick.com", "/admin")).toBe("api-host-refused");
    expect(JOYSTICK_MAIN_API_SERVICE_NAME).toBe("bldg-admin-api");
    expect(MAIN_API_REWRITE).toEqual({
      source: "/api/:path*",
      destination: `https://${JOYSTICK_MAIN_API_RAILWAY_HOST}/api/:path*`,
    });
    expect(RESIDENT_API_REWRITE).toEqual({
      source: "/resident-api/:path*",
      destination: `https://${RESIDENT_API_HOST}/api/:path*`,
    });
    expect(MAIN_API_REWRITE.destination).not.toContain(RESIDENT_API_HOST);
    const vercel = JSON.parse(source("vercel.json")) as {
      rewrites: Array<{ source: string; destination: string }>;
    };
    expect(vercel.rewrites).toContainEqual(MAIN_API_REWRITE);
    expect(vercel.rewrites).toContainEqual(RESIDENT_API_REWRITE);
  });

  it("wires the router to the host contract without removing legacy host checks", () => {
    const app = source("client/src/App.tsx");
    expect(app).toContain("resolveJoystickHostView");
    expect(app).toContain("<CustomerHostApp />");
    expect(app).toContain("<PreservedLaundryHost />");
    expect(app).toContain("<JoystickLandingRoute />");
    expect(app).toContain("<WwwGojoystickRedirect />");
    expect(app).toContain("<JoystickApiHostRefused />");
    expect(app).toContain('const isDriverHost = hostname === "driver.bldg.chat"');
    expect(app).toContain("if (isDriverHost)");
    expect(app).toContain("isAdminHost || isLocalAdminPath");
    expect(app).toContain('hostname === "admin.bldg.chat" || hostname === "api.bldg.chat"');
    expect(app).toContain('return <Redirect to="/" />');
    expect(app).toContain('path.startsWith("/claire")');
    const customer = source("client/src/hostRouting/CustomerHostApp.tsx");
    expect(customer).not.toContain("AdminHostApp");
    expect(customer).not.toContain('role="admin"');
    expect(customer).toContain('mode="membership"');
    expect(customer).toContain("<GoldlineOnboarding");
    expect(customer).toContain('path === "/onboarding" ? "onboarding"');
    expect(customer).toContain("<ClaireDesk />");
    expect(customer).toContain("<JoystickWorld />");
    expect(customer).toContain("<Driver />");
    const laundry = source("client/src/hostRouting/PreservedLaundryHost.tsx");
    expect(laundry).toContain("<LaundryFarmHome />");
    expect(laundry).toContain("<LaundryButlerAccount />");
    expect(laundry).not.toContain("AdminHostApp");
    expect(laundry).not.toContain("JoystickLanding");
    expect(laundry).not.toContain("ProductShell");
  });
});

describe("JOYSTICK host auth and callback boundaries", () => {
  it("keeps session cookies host-only on new and legacy hosts", () => {
    for (const hostname of [
      "app.gojoystick.com",
      "admin.gojoystick.com",
      "driver.gojoystick.com",
      "gojoystick.com",
      "admin.bldg.chat",
      "driver.bldg.chat",
      "laundrybutler.bldg.chat",
      "laundryfarm.bldg.chat",
    ]) {
      const options = getSessionCookieOptions({
        hostname,
        protocol: "https",
        headers: {},
      } as never);
      expect(options.domain).toBeUndefined();
      expect(options.httpOnly).toBe(true);
      expect(options.secure).toBe(true);
      expect(options.sameSite).toBe("none");
    }
  });

  it("does not promote a session role and leaves OAuth on the same host", () => {
    expect(normalizeSessionRole("admin")).toBe("admin");
    expect(normalizeSessionRole("driver")).toBe("driver");
    expect(normalizeSessionRole("user")).toBe("user");
    expect(normalizeSessionRole("owner")).toBe("user");
    expect(normalizeSessionRole("superadmin")).toBe("user");
    expect(OAUTH_CALLBACK_REDIRECT_PATH).toBe("/");
    expect(source("server/_core/oauth.ts")).toContain(
      "res.redirect(302, OAUTH_CALLBACK_REDIRECT_PATH)"
    );
    expect(source("server/_core/sdk.ts")).not.toContain("gojoystick.com");
  });

  it("leaves Claire callbacks and ADMIN_BASE_URL on the legacy admin origin", () => {
    expect(DEFAULT_ADMIN_BASE_URL).toBe("https://admin.bldg.chat");
    expect(DEFAULT_ADMIN_BASE_URL).not.toContain("gojoystick.com");
    const twilio = source("server/claire/claireTwilio.ts");
    expect(twilio).toContain("return ENV.adminBaseUrl.replace(/\\/$/, \"\");");
    expect(twilio).not.toContain("gojoystick.com");
    expect(source("server/_core/index.ts")).toContain('req.hostname === "driver.bldg.chat"');
    expect(source("server/_core/index.ts")).not.toContain("driver.gojoystick.com");
    expect(
      isValidTwilioWebhook({
        authToken: "token",
        signature: "",
        urls: ["https://admin.bldg.chat/api/claire/twilio/voice"],
        body: { CallSid: "CA123" },
        nodeEnv: "production",
      })
    ).toBe(false);
  });

  it("leaves Stripe return URLs unchanged and refuses an unconfigured checkout", () => {
    const billing = source("server/saas/saasBilling.ts");
    expect(billing).toContain('process.env.DAYFORGE_BILLING_APP_URL?.replace(/\\/$/, "") ||');
    expect(billing).toContain('"https://admin.bldg.chat"');
    expect(billing).toContain("success_url: `${appUrl()}${returnPath}?session=${onboarding.id}&checkout=success`");
    expect(billing).toContain("cancel_url: `${appUrl()}${returnPath}?session=${onboarding.id}&checkout=cancelled`");
    expect(billing).toContain("return_url: `${appUrl()}/dayforge-settings`");
    expect(billing).not.toContain("gojoystick.com");
    expect(source("server/saas/saasBillingWebhookRoute.ts")).toContain(
      '"/api/dayforge/billing/stripe-webhook"'
    );
    const previous = process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY;
    const previousMarketplace = process.env.MARKETPLACE_PAYMENTS_ENABLED;
    delete process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY;
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    try {
      expect(() => getLegacyDayforgeBillingStripe()).toThrow(/not configured/);
      expect(marketplacePaymentsEnabled()).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY;
      else process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY = previous;
      if (previousMarketplace === undefined) delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
      else process.env.MARKETPLACE_PAYMENTS_ENABLED = previousMarketplace;
    }
  });

  it("refuses a live marketplace charge while payments are disabled", async () => {
    const previous = process.env.MARKETPLACE_PAYMENTS_ENABLED;
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    try {
      await expect(
        createAuthorizationPaymentIntent(
          {
            idempotencyKey: "host-contract",
            customerId: "cus_test",
            paymentMethodId: "pm_test",
            amountCents: 100,
            currency: "usd",
            metadata: {},
          },
          { getStripe: () => { throw new Error("stripe client must not be resolved"); } }
        )
      ).rejects.toThrow(/MARKETPLACE_PAYMENTS_ENABLED is not set/);
    } finally {
      if (previous === undefined) delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
      else process.env.MARKETPLACE_PAYMENTS_ENABLED = previous;
    }
  });
});
