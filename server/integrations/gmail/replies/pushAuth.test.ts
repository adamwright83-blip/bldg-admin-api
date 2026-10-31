import { describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { parseGmailPush, pushAuthConfig, verifyPushAuthorization } from "./pushAuth";

const AUDIENCE = "https://admin.bldg.chat/api/integrations/gmail/push";
const ACCOUNT = "joystick-gmail-push@gen-lang-client-0159109182.iam.gserviceaccount.com";
const config = { audience: AUDIENCE, serviceAccount: ACCOUNT };

async function keys() {
  const google = await generateKeyPair("RS256");
  const stranger = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(google.publicKey)), kid: "g1", alg: "RS256" };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, key = google.privateKey, kid = "g1") =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid }).setIssuedAt().setExpirationTime("5m").sign(key);
  return { jwks, sign, stranger };
}

describe("only Google's Pub/Sub, for JOYSTICK's subscription, may report a mailbox change", () => {
  it("accepts a Google-signed token for the push account and audience", async () => {
    const { jwks, sign } = await keys();
    const token = await sign({ iss: "https://accounts.google.com", aud: AUDIENCE, email: ACCOUNT, email_verified: true, sub: "123" });
    expect(await verifyPushAuthorization(`Bearer ${token}`, config, jwks)).toEqual({ ok: true, subject: "123" });
  });

  it("refuses a wrong signature, issuer, audience, account, an unverified email, or no token", async () => {
    const { jwks, sign, stranger } = await keys();
    const good = { iss: "https://accounts.google.com", aud: AUDIENCE, email: ACCOUNT, email_verified: true };
    const cases = [
      await sign(good, stranger.privateKey),
      await sign({ ...good, iss: "https://evil.example" }),
      await sign({ ...good, aud: "https://other.example/push" }),
      await sign({ ...good, email: "someone@gen-lang-client-0159109182.iam.gserviceaccount.com" }),
      await sign({ ...good, email_verified: false }),
    ];
    for (const token of cases) expect((await verifyPushAuthorization(`Bearer ${token}`, config, jwks)).ok).toBe(false);
    expect((await verifyPushAuthorization(undefined, config, jwks)).ok).toBe(false);
  });

  it("refuses everything when push authentication isn't configured", async () => {
    const { jwks, sign } = await keys();
    const token = await sign({ iss: "https://accounts.google.com", aud: AUDIENCE, email: ACCOUNT, email_verified: true });
    expect(pushAuthConfig({})).toBeNull();
    expect(await verifyPushAuthorization(`Bearer ${token}`, null, jwks)).toEqual({ ok: false, reason: "push authentication is not configured" });
  });
});

describe("a push says which mailbox changed, nothing more", () => {
  const push = (data: unknown, extra: Record<string, unknown> = {}) => ({
    message: { data: Buffer.from(JSON.stringify(data)).toString("base64"), messageId: "pm-1", publishTime: "2026-10-31T03:00:00Z", ...extra },
    subscription: "projects/gen-lang-client-0159109182/subscriptions/joystick-gmail-inbox-push",
  });
  it("reads the address and history id", () => {
    expect(parseGmailPush(push({ emailAddress: "Owner@Example.com", historyId: 9876543 }))).toEqual({
      pubsubMessageId: "pm-1",
      emailAddress: "owner@example.com",
      historyId: "9876543",
      publishTime: "2026-10-31T03:00:00Z",
    });
  });
  it("drops anything malformed", () => {
    expect(parseGmailPush(null)).toBeNull();
    expect(parseGmailPush({ message: { data: "not-base64-json", messageId: "x" } })).toBeNull();
    expect(parseGmailPush(push({ emailAddress: "owner@example.com", historyId: "1; DROP" }))).toBeNull();
    expect(parseGmailPush(push({ historyId: 1 }))).toBeNull();
  });
});
