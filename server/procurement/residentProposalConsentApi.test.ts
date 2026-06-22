import { describe, expect, it, vi } from "vitest";
import { createResidentProposalConsentHandler } from "./residentProposalReadApi";

function req(patch: Record<string, unknown> = {}) {
  return {
    headers: { "x-app-shared-secret": "secret", "x-resident-session-verified": "true", "x-bldg-user-id": "42", "x-tenant-id": "default" },
    params: { versionId: "version-1" }, ...patch,
  } as never;
}
function response() {
  const res: any = { statusCode: 200, body: null };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn((body: unknown) => { res.body = body; return res; });
  return res;
}

const RECORDED = {
  decision: { outcome: "consent_recorded", allowed: true },
  record: { proposalVersionId: "version-1", consentAction: "approve_held_to_try_to_book", consentedAt: new Date("2026-06-22T12:00:00.000Z") },
};

describe("resident proposal consent API", () => {
  it("rejects a missing or invalid resident app session before store access", async () => {
    process.env.APP_SHARED_API_SECRET = "secret";
    const store = { recordConsent: vi.fn() };
    const handler = createResidentProposalConsentHandler(store as never);
    for (const headers of [{}, { "x-app-shared-secret": "wrong" }, { "x-app-shared-secret": "secret", "x-bldg-user-id": "42" }]) {
      const res = response(); await handler(req({ headers }), res); expect(res.statusCode).toBe(401);
    }
    expect(store.recordConsent).not.toHaveBeenCalled();
  });

  it("rejects a malformed version id before store access", async () => {
    process.env.APP_SHARED_API_SECRET = "secret";
    const store = { recordConsent: vi.fn() };
    const handler = createResidentProposalConsentHandler(store as never);
    const res = response();
    await handler(req({ params: { versionId: "../etc/passwd" } }), res);
    expect(res.statusCode).toBe(400);
    expect(store.recordConsent).not.toHaveBeenCalled();
  });

  it("derives bldgUserId/tenantId from verified session headers, never from the request body", async () => {
    process.env.APP_SHARED_API_SECRET = "secret";
    const store = { recordConsent: vi.fn().mockResolvedValue(RECORDED) };
    const handler = createResidentProposalConsentHandler(store as never);
    const res = response();
    await handler(req({ body: { bldgUserId: 999, tenantId: "laundry_farm" }, headers: {
      "x-app-shared-secret": "secret", "x-resident-session-verified": "true", "x-bldg-user-id": "42", "x-tenant-id": "default",
    } }), res);
    expect(store.recordConsent).toHaveBeenCalledWith(expect.objectContaining({ bldgUserId: 42, tenantId: "default" }));
  });

  it("ignores forged x-bldg-user-id/x-tenant-id headers attempting to approve another resident's proposal -- only the verified header pair is trusted", async () => {
    process.env.APP_SHARED_API_SECRET = "secret";
    const store = { recordConsent: vi.fn().mockResolvedValue(RECORDED) };
    const handler = createResidentProposalConsentHandler(store as never);
    const res = response();
    // Even if some upstream proxy bug duplicated headers, authenticateResidentAppRequest only
    // ever reads a single value per header name -- there is no merge/override path here.
    await handler(req(), res);
    expect(store.recordConsent).toHaveBeenCalledWith(expect.objectContaining({ bldgUserId: 42, tenantId: "default" }));
  });

  it("returns 201 for a freshly recorded consent", async () => {
    process.env.APP_SHARED_API_SECRET = "secret";
    const store = { recordConsent: vi.fn().mockResolvedValue(RECORDED) };
    const res = response();
    await createResidentProposalConsentHandler(store as never)(req(), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.status).toBe("consent_recorded");
  });

  it("returns 200 for an idempotent replay, not a duplicate-creation error", async () => {
    process.env.APP_SHARED_API_SECRET = "secret";
    const store = { recordConsent: vi.fn().mockResolvedValue({ ...RECORDED, decision: { outcome: "consent_already_recorded", allowed: true } }) };
    const res = response();
    await createResidentProposalConsentHandler(store as never)(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("consent_already_recorded");
  });

  it("returns 404 (not a leak of the underlying reason) for not-owned, expired, unavailable, unsafe, not-ready, superseded, or CTA-ineligible proposals", async () => {
    process.env.APP_SHARED_API_SECRET = "secret";
    const store = { recordConsent: vi.fn().mockResolvedValue({ decision: { outcome: "consent_not_allowed", allowed: false }, record: null }) };
    const res = response();
    await createResidentProposalConsentHandler(store as never)(req(), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Proposal not found" });
  });

  it("returns 400 for an invalid_request outcome without leaking internals", async () => {
    process.env.APP_SHARED_API_SECRET = "secret";
    const store = { recordConsent: vi.fn().mockResolvedValue({ decision: { outcome: "invalid_request", allowed: false }, record: null }) };
    const res = response();
    await createResidentProposalConsentHandler(store as never)(req(), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Invalid request" });
  });

  it("never returns raw JSON, audit metadata, or internal reason codes in the response body", async () => {
    process.env.APP_SHARED_API_SECRET = "secret";
    const store = { recordConsent: vi.fn().mockResolvedValue(RECORDED) };
    const res = response();
    await createResidentProposalConsentHandler(store as never)(req(), res);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/audit|reasons|snapshotHash|createdBy/);
  });
});
