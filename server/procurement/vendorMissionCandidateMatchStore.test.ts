import { describe, expect, it, vi } from "vitest";
import { VendorMissionCandidateMatchStore } from "./vendorMissionCandidateMatchStore";

const MOCK_MATCH_ROW = {
  id: "match-1", tenant_id: "default", mission_id: "mission-1", candidate_id: "candidate-1",
  matched_query: "mobile dog groomers near 90027", query_planner_source: "anthropic_structured",
  service_mode: "mobile_required", rank_score: "9.5000", rank_position: 1, is_shortlisted: 1,
  match_evidence_json: { rating: 4.9 }, created_at: new Date("2026-06-25T00:00:00.000Z"), updated_at: new Date("2026-06-25T00:00:00.000Z"),
};

function makePool(rows: Array<Record<string, unknown>> = []) {
  const execute = vi.fn().mockResolvedValue([rows, []]);
  return { pool: { execute } as never, execute };
}

describe("VendorMissionCandidateMatchStore -- upsertMatch", () => {
  it("inserts with ON DUPLICATE KEY UPDATE, relying on the table's UNIQUE KEY for idempotency", async () => {
    const { pool, execute } = makePool([MOCK_MATCH_ROW]);
    const store = new VendorMissionCandidateMatchStore(pool);
    const saved = await store.upsertMatch({
      tenantId: "default", missionId: "mission-1", candidateId: "candidate-1",
      matchedQuery: "mobile dog groomers near 90027", queryPlannerSource: "anthropic_structured",
      serviceMode: "mobile_required", rankScore: 9.5, rankPosition: 1, isShortlisted: true,
    });
    expect(saved.missionId).toBe("mission-1");
    expect(saved.candidateId).toBe("candidate-1");
    expect(saved.isShortlisted).toBe(true);
    const insertCall = execute.mock.calls.find(([sql]) => /INSERT INTO/i.test(String(sql)));
    expect(String(insertCall?.[0])).toMatch(/ON DUPLICATE KEY UPDATE/i);
  });

  it("never writes to vendor_contact_attempts or sets any truth field", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "vendorMissionCandidateMatchStore.ts"), "utf8");
    expect(source).not.toMatch(/INTO vendor_contact_attempts|FROM vendor_contact_attempts|provider_accepted|booking_confirmed|payment_authorized/);
  });
});

describe("VendorMissionCandidateMatchStore -- listMissionMatches", () => {
  it("returns only shortlisted matches by default, inlining LIMIT (never binding it as a `?` placeholder)", async () => {
    const { pool, execute } = makePool([MOCK_MATCH_ROW]);
    const store = new VendorMissionCandidateMatchStore(pool);
    const matches = await store.listMissionMatches({ tenantId: "default", missionId: "mission-1" });
    expect(matches).toHaveLength(1);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/AND is_shortlisted = 1/);
    expect(sql).not.toMatch(/LIMIT \?/);
    expect(sql).toMatch(/LIMIT 100\s*$/);
    expect(params).toEqual(["default", "mission-1"]);
  });

  it("returns overflow (non-shortlisted) matches too when includeOverflow is set", async () => {
    const { pool, execute } = makePool([]);
    const store = new VendorMissionCandidateMatchStore(pool);
    await store.listMissionMatches({ tenantId: "default", missionId: "mission-1", includeOverflow: true });
    const [sql] = execute.mock.calls[0];
    expect(sql).not.toMatch(/AND is_shortlisted = 1/);
  });

  it("clamps an out-of-range limit", async () => {
    const { pool, execute } = makePool([]);
    const store = new VendorMissionCandidateMatchStore(pool);
    await store.listMissionMatches({ tenantId: "default", missionId: "mission-1", limit: 99999 });
    const [sql] = execute.mock.calls[0];
    expect(sql).toMatch(/LIMIT 250\s*$/);
  });

  it("returns an empty array honestly when no matches exist, rather than fabricating one", async () => {
    const { pool } = makePool([]);
    const store = new VendorMissionCandidateMatchStore(pool);
    const matches = await store.listMissionMatches({ tenantId: "default", missionId: "mission-1" });
    expect(matches).toEqual([]);
  });
});

describe("VendorMissionCandidateMatchStore -- countMissionMatches", () => {
  it("returns total and shortlisted counts", async () => {
    const { pool } = makePool([{ total: 14, shortlisted: 10 }]);
    const store = new VendorMissionCandidateMatchStore(pool);
    const counts = await store.countMissionMatches({ tenantId: "default", missionId: "mission-1" });
    expect(counts).toEqual({ total: 14, shortlisted: 10 });
  });
});
