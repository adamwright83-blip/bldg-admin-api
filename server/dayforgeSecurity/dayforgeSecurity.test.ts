import { describe, expect, it, vi } from "vitest";
import {
  configuredTrustProxy,
  dayforgeSecurityHeaders,
  evaluateMutationOrigin,
  isAllowedDayforgeOrigin,
  resolveTrustedClientIp,
} from "./dayforgeSecurity";
import { publicProcedure, router } from "../_core/trpc";

const production = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

describe("DayForge request security", () => {
  const mutationRouter = router({
    write: publicProcedure.mutation(() => ({ ok: true as const })),
  });

  it("accepts first-party and configured exact origins, not lookalikes", () => {
    const env = {
      ...production,
      DAYFORGE_ALLOWED_ORIGINS: "https://tenant.example.com",
    };
    expect(isAllowedDayforgeOrigin("https://admin.bldg.chat", env)).toBe(true);
    expect(isAllowedDayforgeOrigin("https://tenant.example.com", env)).toBe(true);
    expect(isAllowedDayforgeOrigin("https://tenant.example.com.evil.test", env)).toBe(false);
    expect(isAllowedDayforgeOrigin("https://admin.bldg.chat@evil.test", env)).toBe(false);
    expect(isAllowedDayforgeOrigin("https://tenant.example.com/path", env)).toBe(false);
    expect(isAllowedDayforgeOrigin("http://localhost:5173", env)).toBe(false);
  });

  it("requires an allowed Origin for production cookie-authenticated writes", () => {
    const base = {
      method: "POST",
      headers: { cookie: "app_session_id=signed" },
    };
    expect(evaluateMutationOrigin({ req: base, env: production })).toEqual({
      allowed: false,
      reason: "missing_origin",
    });
    expect(
      evaluateMutationOrigin({
        req: { ...base, headers: { ...base.headers, origin: "https://evil.test" } },
        env: production,
      })
    ).toEqual({ allowed: false, reason: "disallowed_origin" });
    expect(
      evaluateMutationOrigin({
        req: {
          ...base,
          headers: { ...base.headers, origin: "https://admin.bldg.chat" },
        },
        env: production,
      })
    ).toEqual({ allowed: true, reason: "allowed_origin" });
  });

  it("does not break anonymous or correctly authenticated internal writes", () => {
    expect(
      evaluateMutationOrigin({
        req: { method: "POST", headers: {} },
        env: production,
      })
    ).toEqual({ allowed: true, reason: "no_cookie" });
    expect(
      evaluateMutationOrigin({
        req: {
          method: "POST",
          headers: {
            cookie: "app_session_id=signed",
            "x-app-shared-secret": "correct",
          },
        },
        env: { ...production, APP_SHARED_API_SECRET: "correct" },
      })
    ).toEqual({ allowed: true, reason: "internal" });
  });

  it("enforces the guard in the actual tRPC procedure pipeline", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const context = (origin: string) =>
      ({
        req: {
          method: "POST",
          headers: { cookie: "app_session_id=signed", origin },
        },
        res: {},
        user: null,
        vendorSession: null,
        tenantId: "default",
      }) as never;
    try {
      await expect(
        mutationRouter.createCaller(context("https://evil.test")).write()
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        mutationRouter.createCaller(context("https://admin.bldg.chat")).write()
      ).resolves.toEqual({ ok: true });
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it("uses an explicit trust-proxy policy and never parses forwarded headers itself", () => {
    expect(configuredTrustProxy(production)).toBe(false);
    expect(
      configuredTrustProxy({ ...production, DAYFORGE_TRUST_PROXY_HOPS: "1" })
    ).toBe(1);
    expect(
      configuredTrustProxy({
        ...production,
        DAYFORGE_TRUST_PROXY_CIDRS: "loopback, 10.0.0.0/8",
      })
    ).toEqual(["loopback", "10.0.0.0/8"]);
    expect(
      resolveTrustedClientIp({
        ip: "203.0.113.8",
        socket: { remoteAddress: "10.0.0.2" } as never,
      })
    ).toBe("203.0.113.8");
  });

  it("sets CSP and standard hardening headers", () => {
    const setHeader = vi.fn();
    const next = vi.fn();
    dayforgeSecurityHeaders({
      ...production,
      VITE_SCHEDULER_URL: "https://scheduler.example.com/team/dayforge",
      VITE_API_URL: "https://api.example.com/v1",
    })(
      {} as never,
      { setHeader } as never,
      next
    );
    expect(setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.stringMatching(/frame-ancestors 'none'.*frame-src .*https:\/\/scheduler\.example\.com/)
    );
    expect(setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.stringContaining("connect-src 'self' https://api.stripe.com")
    );
    expect(setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.stringContaining("https://api.example.com")
    );
    expect(setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.stringContaining(
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
      )
    );
    expect(setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.stringContaining(
        "font-src 'self' data: https://fonts.gstatic.com"
      )
    );
    expect(setHeader).toHaveBeenCalledWith(
      "Cross-Origin-Opener-Policy",
      "same-origin-allow-popups"
    );
    expect(setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(next).toHaveBeenCalledOnce();
  });
});
