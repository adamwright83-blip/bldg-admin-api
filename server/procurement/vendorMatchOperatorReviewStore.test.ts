import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { VendorMatchOperatorReviewStore } from "./vendorMatchOperatorReviewStore";

function makeConnection(opts: {
  runRows?: Array<{ id: string; workflow_id: string | null }>;
  candidateRows?: Array<{ id: string }>;
} = {}) {
  const execute = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes("FROM vendor_match_evaluation_runs")) {
      return Promise.resolve([opts.runRows ?? [{ id: "run-1", workflow_id: "1" }], []]);
    }
    if (sql.includes("FROM vendor_match_evaluation_candidates")) {
      return Promise.resolve([opts.candidateRows ?? [{ id: "candidate-row-1" }], []]);
    }
    return Promise.resolve([{ affectedRows: 1 }, []]);
  });
  const beginTransaction = vi.fn().mockResolvedValue(undefined);
  const commit = vi.fn().mockResolvedValue(undefined);
  const rollback = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn();
  return { execute, beginTransaction, commit, rollback, release };
}

describe("VendorMatchOperatorReviewStore", () => {
  it("writes only to procurement_operator_gates when creating a review request", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorMatchOperatorReviewStore(pool as never);

    const { gateKey } = await store.requestOperatorReview({
      evaluationRunId: "run-1", candidateId: "candidate-1", requestedBy: "operator-1",
      promptPayload: { action: "request_vendor_match_review" }, evidencePayload: { score: 94 },
    });

    expect(gateKey).toBe("vendor_match_review:run-1:candidate-1");
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();

    const insertCalls = connection.execute.mock.calls.filter(([sql]) => /INSERT/i.test(String(sql)));
    expect(insertCalls).toHaveLength(1);
    expect(String(insertCalls[0][0])).toMatch(/INSERT IGNORE INTO procurement_operator_gates/i);
  });

  it("only reads vendor_match_evaluation_runs/candidates, never writes them", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorMatchOperatorReviewStore(pool as never);

    await store.requestOperatorReview({
      evaluationRunId: "run-1", candidateId: "candidate-1", requestedBy: "operator-1",
      promptPayload: {}, evidencePayload: {},
    });

    for (const [sql] of connection.execute.mock.calls) {
      const text = String(sql);
      if (text.includes("vendor_match_evaluation_runs") || text.includes("vendor_match_evaluation_candidates")) {
        expect(text).toMatch(/^\s*SELECT/i);
        expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
      }
    }
  });

  it("fails closed when the evaluation run does not exist", async () => {
    const connection = makeConnection({ runRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorMatchOperatorReviewStore(pool as never);

    await expect(store.requestOperatorReview({
      evaluationRunId: "run-1", candidateId: "candidate-1", requestedBy: "operator-1",
      promptPayload: {}, evidencePayload: {},
    })).rejects.toThrow(/not found/);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("fails closed when the evaluation run has no associated workflow", async () => {
    const connection = makeConnection({ runRows: [{ id: "run-1", workflow_id: null }] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorMatchOperatorReviewStore(pool as never);

    await expect(store.requestOperatorReview({
      evaluationRunId: "run-1", candidateId: "candidate-1", requestedBy: "operator-1",
      promptPayload: {}, evidencePayload: {},
    })).rejects.toThrow(/no associated workflow/);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("fails closed when the candidate does not exist on the run", async () => {
    const connection = makeConnection({ candidateRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorMatchOperatorReviewStore(pool as never);

    await expect(store.requestOperatorReview({
      evaluationRunId: "run-1", candidateId: "candidate-1", requestedBy: "operator-1",
      promptPayload: {}, evidencePayload: {},
    })).rejects.toThrow(/not found/);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});

describe("vendor match operator review store source isolation", () => {
  it("writes only to procurement_operator_gates and never mutates evaluation, outreach, dispatch, payment, Stripe, or legacy vendor tables", () => {
    const source = fs.readFileSync("server/procurement/vendorMatchOperatorReviewStore.ts", "utf8");
    const writeStatements = source.match(/\b(INSERT INTO|INSERT IGNORE INTO|UPDATE\s+\w+|DELETE FROM)\b[^;]*/gi) ?? [];
    expect(writeStatements.length).toBeGreaterThan(0);
    for (const statement of writeStatements) {
      expect(statement).toMatch(/procurement_operator_gates/);
    }
    expect(source).not.toMatch(/\bvendor_outreach_drafts\b/);
    expect(source).not.toMatch(/\bvendor_outreach_conversation_events\b/);
    expect(source).not.toMatch(/\b(vendors|vendorProfiles|vendorServices)\b/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
  });

  it("contains no route or worker wiring", () => {
    const source = fs.readFileSync("server/procurement/vendorMatchOperatorReviewStore.ts", "utf8");
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
  });
});
