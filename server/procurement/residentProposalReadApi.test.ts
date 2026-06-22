import { describe, expect, it, vi } from "vitest";
import { createResidentProposalReadHandlers } from "./residentProposalReadApi";

const card = {
  proposal_id: "proposal-1", proposal_version_id: "version-1", service_category: "dog_grooming",
  service_label: "Dog grooming", resident_safe_summary: "Dog grooming request", vendor_display_name: "Calm Paws",
  vendor_source_display_type: "Permitted public source", offered_window: { start: "2026-06-26T17:00:00Z", end: "2026-06-26T19:00:00Z", label: "Jun 26" },
  quoted_price: { amount_cents: 8500, currency: "USD", label: "Quoted $85.00" }, proposal_expiry: "2026-06-25T00:00:00.000Z",
  readiness: "ready_for_resident", truth_language: { availability: "Available, not booked", authority: "Approve HELD to try to book",
    disclaimer: "Nothing is confirmed until provider acceptance is verified" },
  truth_flags: { available_not_booked: true, provider_not_accepted: true, not_paid: true, not_dispatched: true, not_completed: true },
  fit: { sentence: "Calm handling feedback fits this request." }, reputation: { summary: "4.8 out of 5 across 90 public reviews", source_display_type: "Permitted public source" },
  evidence_labels: ["Public reputation"], cta: { visible: true, primary_text: "Let HELD try to book this",
    reassurance: "Nothing is confirmed until the provider accepts.", authority_only: true }, state_mutated: false, llm_called: false,
} as const;

function req(patch: Record<string, unknown> = {}) {
  return { headers: { "x-app-shared-secret": "secret", "x-resident-session-verified": "true", "x-bldg-user-id": "42", "x-tenant-id": "default" },
    query: {}, params: { versionId: "version-1" }, ...patch } as never;
}
function response() {
  const res: any = { statusCode: 200, body: null };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn((body: unknown) => { res.body = body; return res; });
  return res;
}

describe("resident-safe proposal read API", () => {
  it("rejects a missing or invalid resident app session before store access", async () => {
    process.env.APP_SHARED_API_SECRET = "secret";
    const store = { listVisible: vi.fn(), readOwned: vi.fn() };
    const handlers = createResidentProposalReadHandlers(store as never);
    for (const headers of [{}, { "x-app-shared-secret": "wrong" }, { "x-app-shared-secret": "secret", "x-bldg-user-id": "42" }]) {
      const res = response(); await handlers.list(req({ headers }), res); expect(res.statusCode).toBe(401);
    }
    expect(store.listVisible).not.toHaveBeenCalled();
  });

  it("lists only cards returned by the ownership-filtered store", async () => {
    process.env.APP_SHARED_API_SECRET = "secret";
    const store = { listVisible: vi.fn(async () => ({ items: [card], page: { limit: 10, offset: 0, hasMore: false } })), readOwned: vi.fn() };
    const res = response(); await createResidentProposalReadHandlers(store as never).list(req(), res);
    expect(res.body.items).toEqual([card]);
    expect(store.listVisible).toHaveBeenCalledWith({ bldgUserId: 42, tenantId: "default", limit: 10, offset: 0 });
  });

  it("returns an owned presentable card with fixed truth language", async () => {
    process.env.APP_SHARED_API_SECRET = "secret";
    const store = { listVisible: vi.fn(), readOwned: vi.fn(async () => card) };
    const res = response(); await createResidentProposalReadHandlers(store as never).get(req(), res);
    expect(res.body.truth_language).toEqual({ availability: "Available, not booked", authority: "Approve HELD to try to book",
      disclaimer: "Nothing is confirmed until provider acceptance is verified" });
    expect(res.body.cta).toMatchObject({ primary_text: "Let HELD try to book this", reassurance: "Nothing is confirmed until the provider accepts." });
  });

  it("hides unauthorized, expired, unsafe, unavailable, and not-ready proposals identically", async () => {
    process.env.APP_SHARED_API_SECRET = "secret";
    const store = { listVisible: vi.fn(), readOwned: vi.fn(async () => null) };
    const res = response(); await createResidentProposalReadHandlers(store as never).get(req(), res);
    expect(res.statusCode).toBe(404); expect(res.body).toEqual({ error: "Proposal not found" });
  });

  it("returns no admin, raw JSON, evidence IDs, hashes, or audit metadata and performs no mutation", async () => {
    const serialized = JSON.stringify(card);
    expect(serialized).not.toMatch(/jobCard|snapshotHash|evidenceSnapshotId|evidence_ids|audit|createdBy|rawJson|reviewState|warnings/);
    expect(card.state_mutated).toBe(false); expect(card.llm_called).toBe(false);
  });
});
