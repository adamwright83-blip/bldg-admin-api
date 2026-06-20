import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { VendorOutreachDraftBridgeStore } from "./vendorOutreachDraftBridgeStore";

const APPROVED_GATE_ROW = {
  id: "gate-1", gate_key: "vendor_match_review:run-1:candidate-1", status: "approved",
  deadline_at: null, decided_at: new Date("2026-06-19T00:00:00.000Z"),
};

const APPROVED_TEMPLATE_ROW = {
  template_key: "vendor_availability_request", version: "v1", status: "approved",
  template_purpose: "vendor_availability_request", subject_template: "Hi {{vendorName}}",
  body_template: "Hi {{vendorName}}, can you support a {{category}} request? No commitment yet.",
  body_hash: "a".repeat(64), approved_at: new Date("2026-06-01T00:00:00.000Z"),
  effective_at: new Date("2026-06-02T00:00:00.000Z"), retired_at: null,
  required_legal_document_key: null, required_legal_document_version: null, outreach_channel: "email",
};

function makeConnection(opts: {
  runRows?: Array<Record<string, unknown>>;
  candidateRows?: Array<Record<string, unknown>>;
  gateRows?: Array<Record<string, unknown>>;
  templateRows?: Array<Record<string, unknown>>;
} = {}) {
  const execute = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes("FROM vendor_match_evaluation_runs")) {
      return Promise.resolve([opts.runRows ?? [{ id: "run-1", workflow_id: "1", evaluation_status: "evaluated" }], []]);
    }
    if (sql.includes("FROM vendor_match_evaluation_candidates")) {
      return Promise.resolve([opts.candidateRows ?? [{ id: "candidate-row-1", match_status: "matched" }], []]);
    }
    if (sql.includes("FROM procurement_operator_gates")) {
      return Promise.resolve([opts.gateRows ?? [APPROVED_GATE_ROW], []]);
    }
    if (sql.includes("FROM outreach_template_versions")) {
      return Promise.resolve([opts.templateRows ?? [APPROVED_TEMPLATE_ROW], []]);
    }
    if (sql.includes("FROM legal_document_versions")) {
      return Promise.resolve([[], []]);
    }
    if (sql.includes("FROM outreach_template_lint_rules")) {
      return Promise.resolve([[], []]);
    }
    return Promise.resolve([{ affectedRows: 1 }, []]);
  });
  const beginTransaction = vi.fn().mockResolvedValue(undefined);
  const commit = vi.fn().mockResolvedValue(undefined);
  const rollback = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn();
  return { execute, beginTransaction, commit, rollback, release };
}

function baseInput() {
  return {
    id: "draft-1", evaluationRunId: "run-1", candidateId: "candidate-1",
    templateKey: "vendor_availability_request", templateVersion: "v1",
    variables: { vendorName: "Acme Dog Grooming", category: "dog grooming" }, createdBy: "operator-1",
    now: new Date("2026-06-19T12:00:00.000Z"),
  };
}

describe("VendorOutreachDraftBridgeStore", () => {
  it("creates a draft only when the Slice 27 review gate is already approved", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorOutreachDraftBridgeStore(pool as never);

    const result = await store.createDraftFromApprovedReview(baseInput());

    expect(result).toEqual({ id: "draft-1", status: "draft_created_internally", sendable: false });
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();

    const insertCalls = connection.execute.mock.calls.filter(([sql]) => /INSERT/i.test(String(sql)));
    expect(insertCalls).toHaveLength(1);
    expect(String(insertCalls[0][0])).toMatch(/INSERT INTO vendor_outreach_drafts/i);
  });

  it("writes only to vendor_outreach_drafts -- never to operator gates, evaluation, conversation events, dispatch, payment, Stripe, or legacy vendor tables", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorOutreachDraftBridgeStore(pool as never);

    await store.createDraftFromApprovedReview(baseInput());

    for (const [sql] of connection.execute.mock.calls) {
      const text = String(sql);
      if (/\b(INSERT|UPDATE|DELETE)\b/i.test(text)) {
        expect(text).toMatch(/vendor_outreach_drafts/i);
      }
    }
  });

  it("fails closed when the evaluation run does not exist", async () => {
    const connection = makeConnection({ runRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorOutreachDraftBridgeStore(pool as never);

    await expect(store.createDraftFromApprovedReview(baseInput())).rejects.toThrow(/not found/);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("fails closed when the review gate is pending, not approved", async () => {
    const connection = makeConnection({ gateRows: [{ ...APPROVED_GATE_ROW, status: "pending", decided_at: null }] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorOutreachDraftBridgeStore(pool as never);

    await expect(store.createDraftFromApprovedReview(baseInput())).rejects.toThrow(/denied/);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("fails closed when no review gate exists at all", async () => {
    const connection = makeConnection({ gateRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorOutreachDraftBridgeStore(pool as never);

    await expect(store.createDraftFromApprovedReview(baseInput())).rejects.toThrow(/denied/);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("fails closed when the template is missing", async () => {
    const connection = makeConnection({ templateRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorOutreachDraftBridgeStore(pool as never);

    await expect(store.createDraftFromApprovedReview(baseInput())).rejects.toThrow(/denied/);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});

describe("vendor outreach draft bridge store source isolation", () => {
  it("writes only vendor_outreach_drafts and never mutates match evaluation, operator gates, conversation events, dispatch, payment, Stripe, or legacy vendor tables", () => {
    const source = fs.readFileSync("server/procurement/vendorOutreachDraftBridgeStore.ts", "utf8");
    const writeStatements = source.match(/\b(INSERT INTO|INSERT IGNORE INTO|UPDATE\s+\w+|DELETE FROM)\b[^;]*/gi) ?? [];
    expect(writeStatements.length).toBeGreaterThan(0);
    for (const statement of writeStatements) {
      expect(statement).toMatch(/vendor_outreach_drafts/);
    }
    expect(source).not.toMatch(/\bvendor_outreach_conversation_events\b/);
    expect(source).not.toMatch(/\b(vendors|vendorProfiles|vendorServices)\b/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
  });

  it("contains no route or worker wiring", () => {
    const source = fs.readFileSync("server/procurement/vendorOutreachDraftBridgeStore.ts", "utf8");
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
  });
});
