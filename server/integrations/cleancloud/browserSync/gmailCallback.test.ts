import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { assertTrpcMutationOrigin } from "../../../legacy/dayforge/security/legacyDayforgeSecurity";
import { COOKIE_NAME } from "../../../../shared/const";
import { handleJawbreakerGmailCallback } from "./gmailCallback";

// What Google's redirect looks like: top-level GET, no Origin header.
const googleRedirect = (query: Record<string, string>) =>
  ({
    method: "GET",
    query,
    headers: {
      host: "admin.gojoystick.com",
      cookie: `${COOKIE_NAME}=session-jwt`,
      "sec-fetch-site": "cross-site",
      referer: "https://accounts.google.com/",
    },
  }) as unknown as Request;

function response() {
  const out = { status: 0, body: "" };
  const res = {
    status(code: number) { out.status = code; return res; },
    send(body: string) { out.body = body; return res; },
  } as unknown as Response;
  return { res, out };
}

const operator = { tenantId: "default", user: { openId: "adam-admin", role: "admin" as const } };

describe("Jawbreaker Gmail OAuth callback", () => {
  it("reproduces the production failure: the mutation origin guard rejects Google's redirect", () => {
    const decision = assertTrpcMutationOrigin({
      req: googleRedirect({ code: "c", state: "s" }),
      isMutation: true,
      env: { NODE_ENV: "production" },
    });
    expect(decision).toEqual({ allowed: false, reason: "missing_origin" });
  });

  it("completes through the server-side callback for a signed-in operator", async () => {
    const complete = vi.fn(async () => ({ connected: true, connectedEmail: "ops@example.invalid" }));
    const { res, out } = response();
    await handleJawbreakerGmailCallback(googleRedirect({ code: "auth-code", state: "signed-state" }), res, {
      createContext: async () => operator,
      resolveMembership: async () => ({ role: "owner" }) as never,
      complete,
    });
    expect(out.status).toBe(200);
    expect(complete).toHaveBeenCalledWith({ code: "auth-code", state: "signed-state", sessionTenantId: "default", sessionUserId: "adam-admin" });
    expect(out.body).not.toContain("auth-code");
  });

  it("refuses without a session, without an operator role, or without code and state", async () => {
    const complete = vi.fn();
    for (const [ctx, role] of [
      [{ tenantId: "default", user: null }, "owner"],
      [operator, "field"],
    ] as const) {
      const { res, out } = response();
      await handleJawbreakerGmailCallback(googleRedirect({ code: "c", state: "s" }), res, {
        createContext: async () => ctx,
        resolveMembership: async () => ({ role }) as never,
        complete,
      });
      expect(out.status).toBe(403);
    }
    const { res, out } = response();
    await handleJawbreakerGmailCallback(googleRedirect({}), res, { createContext: async () => operator, complete });
    expect(out.status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });
});
