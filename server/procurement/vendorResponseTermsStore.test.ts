import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { VendorResponseTermsStore } from "./vendorResponseTermsStore";

const MOCK_EVENT_ROW = {
  id: "event-1",
  candidate_id: "candidate-1",
  workflow_id: "workflow-1",
  direction: "inbound" as const,
  occurred_at: new Date("2026-06-20T10:00:00.000Z"),
  summary: "Vendor claims availability next Tuesday.",
  raw_payload_json: { availabilityWindows: [{ start: "2026-06-23T09:00:00Z" }] },
  created_by: "operator-1",
};

function makeExecutor(opts: {
  eventRows?: Array<Record<string, unknown>>;
} = {}) {
  return vi.fn().mockImplementation((sql: string) => {
    if (sql.includes("FROM vendor_outreach_conversation_events")) {
      return Promise.resolve([opts.eventRows ?? [MOCK_EVENT_ROW], []]);
    }
    return Promise.resolve([{ affectedRows: 1 }, []]);
  });
}

function makeConnection(opts: Parameters<typeof makeExecutor>[0] = {}) {
  const execute = makeExecutor(opts);
  const beginTransaction = vi.fn().mockResolvedValue(undefined);
  const commit = vi.fn().mockResolvedValue(undefined);
  const rollback = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn();
  return { execute, beginTransaction, commit, rollback, release };
}

function storeInput() {
  return {
    id: "terms-1",
    outreachEventId: "event-1",
    now: new Date("2026-06-20T12:00:00.000Z"),
  };
}

describe("VendorResponseTermsStore -- storage cases", () => {
  it("stores terms successfully when outreach event exists and passes validation", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorResponseTermsStore(pool as any);

    const { decision } = await store.storeResponseTerms(storeInput());

    expect(decision.allowed).toBe(true);
    expect(decision.terms!.interpretationStatus).toBe("interpreted");
    expect(decision.terms!.availabilityStatus).toBe("available");
    expect(connection.commit).toHaveBeenCalledOnce();

    const insertCalls = connection.execute.mock.calls.filter(([sql]) => /INSERT/i.test(String(sql)));
    expect(insertCalls).toHaveLength(1);
    expect(String(insertCalls[0][0])).toMatch(/INSERT INTO vendor_response_terms/i);
  });

  it("fails closed when the outreach event does not exist", async () => {
    const connection = makeConnection({ eventRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorResponseTermsStore(pool as any);

    await expect(store.storeResponseTerms(storeInput())).rejects.toThrow(/not found/i);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("fails closed when evaluation fails (e.g. forbidden claims)", async () => {
    const connection = makeConnection({
      eventRows: [{
        ...MOCK_EVENT_ROW,
        summary: "Vendor booked the job.", // Forbidden phrase 'booked'
      }],
    });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorResponseTermsStore(pool as any);

    await expect(store.storeResponseTerms(storeInput())).rejects.toThrow(/Response terms disallowed or invalid/i);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });
});

describe("vendor response terms store source isolation", () => {
  it("writes only to vendor_response_terms -- never to outreach events, drafts, gates, match evaluation, dispatch, payment, Stripe, or legacy vendor tables", () => {
    const source = fs.readFileSync("server/procurement/vendorResponseTermsStore.ts", "utf8");
    const writeStatements = source.match(/\b(INSERT INTO|INSERT IGNORE INTO|UPDATE\s+\w+|DELETE FROM)\b[^;]*/gi) ?? [];
    expect(writeStatements.length).toBeGreaterThan(0);
    for (const statement of writeStatements) {
      expect(statement).toMatch(/vendor_response_terms/);
    }
    expect(source).not.toMatch(/\b(vendorProfiles|vendorServices|vendorOnboardingAgent)\b/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
  });

  it("contains no route or worker wiring", () => {
    const source = fs.readFileSync("server/procurement/vendorResponseTermsStore.ts", "utf8");
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
  });
});
