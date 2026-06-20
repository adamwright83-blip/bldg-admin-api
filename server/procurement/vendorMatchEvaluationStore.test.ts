import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { VendorMatchEvaluationStore, type VendorMatchEvaluationRunRecord } from "./vendorMatchEvaluationStore";

function makeConnection(opts: { candidateRows?: Array<{ id: string }>; workflowRows?: Array<{ id: string }> } = {}) {
  const query = vi.fn().mockResolvedValueOnce([opts.candidateRows ?? [{ id: "candidate-1" }], []]);
  const execute = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes("FROM procurement_workflows")) {
      return Promise.resolve([opts.workflowRows ?? [{ id: "1" }], []]);
    }
    return Promise.resolve([{ affectedRows: 1 }, []]);
  });
  const beginTransaction = vi.fn().mockResolvedValue(undefined);
  const commit = vi.fn().mockResolvedValue(undefined);
  const rollback = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn();
  return { query, execute, beginTransaction, commit, rollback, release };
}

function makeRunInput(patch: Partial<VendorMatchEvaluationRunRecord> = {}): VendorMatchEvaluationRunRecord {
  return {
    id: "run-1", workflowId: null, evaluationStatus: "evaluated",
    requestContext: { requestId: "req-1" }, preferenceRequest: { minimumRating: 4.3 },
    evaluationSummary: { matchedCount: 1 }, createdBy: "operator-1",
    candidates: [{
      id: "candidate-row-1", candidateId: "candidate-1", evidenceSnapshotId: "evidence-1",
      matchStatus: "matched", rankOrder: 1, score: 94,
      decisionReasons: ["eligible"], riskFlags: [], evidenceSummary: { selectedEvidenceId: "evidence-1" },
    }],
    ...patch,
  };
}

describe("VendorMatchEvaluationStore", () => {
  it("writes only to vendor_match_evaluation_runs and vendor_match_evaluation_candidates", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorMatchEvaluationStore(pool as never);

    await store.createEvaluationRun(makeRunInput());

    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();

    const insertCalls = connection.execute.mock.calls.filter(([sql]) => /INSERT INTO/i.test(String(sql)));
    expect(insertCalls).toHaveLength(2);
    expect(String(insertCalls[0][0])).toMatch(/INSERT INTO vendor_match_evaluation_runs/i);
    expect(String(insertCalls[1][0])).toMatch(/INSERT INTO vendor_match_evaluation_candidates/i);
  });

  it("only reads vendor_sourcing_candidates and procurement_workflows for FK validation, never writes them", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorMatchEvaluationStore(pool as never);

    await store.createEvaluationRun(makeRunInput({ workflowId: "1" }));

    const candidateReadSql = String(connection.query.mock.calls[0][0]);
    expect(candidateReadSql).toMatch(/^\s*SELECT/i);
    expect(candidateReadSql).toMatch(/vendor_sourcing_candidates/);

    const workflowReadCall = connection.execute.mock.calls.find(([sql]) =>
      String(sql).includes("procurement_workflows"));
    expect(String(workflowReadCall?.[0])).toMatch(/^\s*SELECT/i);

    for (const [sql] of [...connection.query.mock.calls, ...connection.execute.mock.calls]) {
      const text = String(sql);
      if (text.includes("vendor_sourcing_candidates") || text.includes("procurement_workflows")) {
        expect(text).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
      }
    }
  });

  it("rolls back and rethrows when a referenced candidate does not exist", async () => {
    const connection = makeConnection({ candidateRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorMatchEvaluationStore(pool as never);

    await expect(store.createEvaluationRun(makeRunInput())).rejects.toThrow(/not found/);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("rolls back and rethrows when a referenced workflow does not exist", async () => {
    const connection = makeConnection({ workflowRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorMatchEvaluationStore(pool as never);

    await expect(store.createEvaluationRun(makeRunInput({ workflowId: "999" })))
      .rejects.toThrow(/workflow not found/i);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});

describe("vendor match evaluation store source isolation", () => {
  it("contains no writes to candidates, evidence, gates, outreach, dispatch, payment, or legacy vendor tables", () => {
    const source = fs.readFileSync("server/procurement/vendorMatchEvaluationStore.ts", "utf8");
    const writeStatements = source.match(/\b(INSERT INTO|UPDATE\s+\w+|DELETE FROM)\b[^;]*/gi) ?? [];
    for (const statement of writeStatements) {
      expect(statement).toMatch(/vendor_match_evaluation_(runs|candidates)/);
    }
    expect(source).not.toMatch(/\b(vendors|vendorProfiles|vendorServices)\b/);
    expect(source).not.toMatch(/procurement_operator_gates/);
    expect(source).not.toMatch(/vendor_reputation_evidence_snapshots/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
  });

  it("contains no route or worker wiring", () => {
    const source = fs.readFileSync("server/procurement/vendorMatchEvaluationStore.ts", "utf8");
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
  });
});

describe("vendor match evaluation migration isolation", () => {
  it("migration adds only the two new tables, additive only, with no forbidden columns or legacy FKs", () => {
    const sql = fs.readFileSync("procurement/migrations/0013_vendor_match_evaluation_runs.sql", "utf8");
    expect(sql).toContain("vendor_match_evaluation_runs");
    expect(sql).toContain("vendor_match_evaluation_candidates");
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDROP\s+/i);
    expect(sql).not.toMatch(/\bINSERT INTO\b/i);
    expect(sql).not.toMatch(/REFERENCES\s+`?(vendors|vendorProfiles|vendorServices)`?/i);
    expect(sql).not.toMatch(
      /\b(booked|booking|accepted|dispatched|completed|paid|captured|payment|stripe|outreach_sent|contacted|selected_for_execution|provider_message)\b/i,
    );
    expect(sql).not.toMatch(/race|ethnicity|gender|religion|disability|protected_class/i);
  });
});
