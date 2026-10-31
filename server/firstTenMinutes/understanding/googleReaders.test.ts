import { describe, expect, it } from "vitest";
import { googleClient } from "./googleReaders";
import { ProviderError } from "../providerFetch";

const access = {
  accessToken: "token",
  refreshToken: null,
  accessExpiresAt: null,
  grantedScopes: [],
  ownerEmail: "owner@example.com",
  onRefreshed: async () => undefined,
};

describe("a refused Google read says why (finding 7)", () => {
  it("names a disabled API apart from a missing scope, without any token or body text", async () => {
    const disabled = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 403,
            status: "PERMISSION_DENIED",
            message: "Google Calendar API has not been used in project 123 before or it is disabled. secret-ish detail",
            details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED" }],
          },
        }),
        { status: 403 }
      );
    const error = await googleClient(access, { fetch: disabled as any }).json("https://www.googleapis.com/calendar/v3/calendars/primary/events").catch(e => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.message).toBe("Google answered 403 (SERVICE_DISABLED)");

    const scope = async () => new Response(JSON.stringify({ error: { code: 403, status: "PERMISSION_DENIED", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } }), { status: 403 });
    const missing = await googleClient(access, { fetch: scope as any }).json("https://www.googleapis.com/calendar/v3/calendars/primary/events").catch(e => e);
    expect(missing.message).toBe("Google answered 403 (ACCESS_TOKEN_SCOPE_INSUFFICIENT)");
    expect(missing.message).not.toContain("token\"");
  });
});
