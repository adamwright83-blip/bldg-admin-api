import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { VendorOutreachSendReviewStore } from "./vendorOutreachSendReviewStore";

const DRAFT_ROW = {
  id: "draft-1", candidate_id: "candidate-1", workflow_id: "workflow-1", draft_status: "draft",
  template_key: "vendor_availability_request", template_version: "v1",
  legal_document_key: null, legal_document_version: null, outreach_channel: "email",
  subject_rendered: "Quick question", body_rendered: "Hi Acme, checking availability only -- no commitment yet.",
};

const APPROVED_TEMPLATE_ROW = {
  template_key: "vendor_availability_request", version: "v1", status: "approved",
  template_purpose: "vendor_availability_request", subject_template: "Quick question",
  body_template: "Hi {{vendorName}}, checking availability only -- no commitment yet.",
  body_hash: "a".repeat(64), approved_at: new Date("2026-06-01T00:00:00.000Z"),
  effective_at: new Date("2026-06-02T00:00:00.000Z"), retired_at: null,
  required_legal_document_key: null, required_legal_document_version: null,
};

function makeExecutor(opts: {
  draftRows?: Array<Record<string, unknown>>;
  templateRows?: Array<Record<string, unknown>>;
  gateRows?: Array<Record<string, unknown>>;
} = {}) {
  return vi.fn().mockImplementation((sql: string) => {
    if (sql.includes("FROM vendor_outreach_drafts")) {
      return Promise.resolve([opts.draftRows ?? [DRAFT_ROW], []]);
    }
    if (sql.includes("FROM outreach_template_versions")) {
      return Promise.resolve([opts.templateRows ?? [APPROVED_TEMPLATE_ROW], []]);
    }
    if (sql.includes("FROM legal_document_versions")) {
      return Promise.resolve([[], []]);
    }
    if (sql.includes("FROM procurement_operator_gates")) {
      return Promise.resolve([opts.gateRows ?? [], []]);
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

function baseInput() {
  return {
    draftId: "draft-1", requestedBy: "operator-1",
    promptPayload: { action: "request_send_review" }, evidencePayload: { reviewedBy: "operator-1" },
    now: new Date("2026-06-20T12:00:00.000Z"),
  };
}

describe("VendorOutreachSendReviewStore.requestSendReview", () => {
  it("requests a send-review gate for an eligible internal draft", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorOutreachSendReviewStore(pool as never);

    const { gateKey, decision } = await store.requestSendReview(baseInput());

    expect(gateKey).toBe("vendor_outreach_send_review:draft-1");
    expect(decision.status).toBe("awaiting_operator_send_review");
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();

    const insertCalls = connection.execute.mock.calls.filter(([sql]) => /INSERT/i.test(String(sql)));
    expect(insertCalls).toHaveLength(1);
    expect(String(insertCalls[0][0])).toMatch(/INSERT IGNORE INTO procurement_operator_gates/i);
  });

  it("writes only to procurement_operator_gates -- never to outreach drafts, evaluation, conversation events, dispatch, payment, Stripe, or legacy vendor tables", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorOutreachSendReviewStore(pool as never);

    await store.requestSendReview(baseInput());

    for (const [sql] of connection.execute.mock.calls) {
      const text = String(sql);
      if (/\b(INSERT|UPDATE|DELETE)\b/i.test(text)) {
        expect(text).toMatch(/procurement_operator_gates/i);
      }
    }
  });

  it("fails closed when the draft does not exist", async () => {
    const connection = makeConnection({ draftRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorOutreachSendReviewStore(pool as never);

    await expect(store.requestSendReview(baseInput())).rejects.toThrow(/not found/);
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("fails closed when the draft's status is not draft", async () => {
    const connection = makeConnection({ draftRows: [{ ...DRAFT_ROW, draft_status: "approved_for_manual_send" }] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorOutreachSendReviewStore(pool as never);

    await expect(store.requestSendReview(baseInput())).rejects.toThrow(/denied/);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("fails closed when the template is missing", async () => {
    const connection = makeConnection({ templateRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorOutreachSendReviewStore(pool as never);

    await expect(store.requestSendReview(baseInput())).rejects.toThrow(/denied/);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("fails closed when the gate is already rejected", async () => {
    const connection = makeConnection({
      gateRows: [{ id: "gate-1", gate_key: "vendor_outreach_send_review:draft-1", status: "rejected",
        deadline_at: null, decided_at: new Date("2026-06-19T00:00:00.000Z") }],
    });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorOutreachSendReviewStore(pool as never);

    await expect(store.requestSendReview(baseInput())).rejects.toThrow(/denied/);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});

describe("VendorOutreachSendReviewStore.getSendReviewDecision", () => {
  it("returns operator_approved_for_manual_send_only, never sent, when the gate is approved", async () => {
    const execute = makeExecutor({
      gateRows: [{ id: "gate-1", gate_key: "vendor_outreach_send_review:draft-1", status: "approved",
        deadline_at: null, decided_at: new Date("2026-06-19T00:00:00.000Z") }],
    });
    const pool = { execute };
    const store = new VendorOutreachSendReviewStore(pool as never);

    const decision = await store.getSendReviewDecision({ draftId: "draft-1", now: new Date("2026-06-20T12:00:00.000Z") });

    expect(decision.status).toBe("operator_approved_for_manual_send_only");
    expect(decision.outreachSent).toBe(false);
    expect(decision.liveSendReady).toBe(false);
  });
});

describe("vendor outreach send review store source isolation", () => {
  it("writes only procurement_operator_gates and never mutates outreach drafts, conversation events, match evaluation, dispatch, payment, Stripe, or legacy vendor tables", () => {
    const source = fs.readFileSync("server/procurement/vendorOutreachSendReviewStore.ts", "utf8");
    const writeStatements = source.match(/\b(INSERT INTO|INSERT IGNORE INTO|UPDATE\s+\w+|DELETE FROM)\b[^;]*/gi) ?? [];
    expect(writeStatements.length).toBeGreaterThan(0);
    for (const statement of writeStatements) {
      expect(statement).toMatch(/procurement_operator_gates/);
    }
    expect(source).not.toMatch(/\bvendor_outreach_conversation_events\b/);
    expect(source).not.toMatch(/\bvendor_match_evaluation/);
    expect(source).not.toMatch(/\b(vendors|vendorProfiles|vendorServices)\b/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/sent_at|delivery_status|send_status|provider_message_id/i);
  });

  it("contains no route or worker wiring", () => {
    const source = fs.readFileSync("server/procurement/vendorOutreachSendReviewStore.ts", "utf8");
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
  });
});
