import { describe, expect, it } from "vitest";
import { driveReader, googleClient } from "./googleReaders";
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

describe("the crew's reading never carries a secret forward", () => {
  const key = ["sk", "ant", "api03", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4"].join("-");
  const access = {
    accessToken: "t",
    refreshToken: null,
    accessExpiresAt: new Date(Date.now() + 3_600_000),
    grantedScopes: ["https://www.googleapis.com/auth/drive.readonly"],
    ownerEmail: "owner@example.com",
    onRefreshed: async () => undefined,
  };
  const DOC = "application/vnd.google-apps.document";

  it("skips key files by name, drops documents holding a bare key, and redacts the rest", async () => {
    const exported: string[] = [];
    const fake = (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/export")) {
        const id = url.pathname.split("/").at(-2)!;
        exported.push(id);
        const body = { notes: `Untitled notes\n${key}`, plan: "Laundry plan. Card 4111 1111 1111 1111 on file." }[id] ?? "";
        return new Response(body, { status: 200 });
      }
      return new Response(
        JSON.stringify({
          files: [
            { id: "keys", name: "10292026 Claire_Test_Anthropic_api_key", mimeType: DOC, modifiedTime: "2026-10-29T00:00:00Z" },
            { id: "notes", name: "Untitled document", mimeType: DOC, modifiedTime: "2026-10-30T00:00:00Z" },
            { id: "plan", name: "Laundry plan", mimeType: DOC, modifiedTime: "2026-10-31T00:00:00Z" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;
    const { items } = await driveReader(access, { fetch: fake }).drive(10, 10, new Date("2026-10-01T00:00:00Z"));
    const text = (id: string) => items.find(item => item.id === id)!.text;
    expect(exported).not.toContain("keys");
    expect(text("keys")).toBeNull();
    expect(text("notes")).toBeNull();
    expect(text("plan")).toBe("Laundry plan. Card [redacted] on file.");
    expect(JSON.stringify(items)).not.toContain(key);
  });
});
