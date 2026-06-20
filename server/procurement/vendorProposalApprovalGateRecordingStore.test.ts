import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { VendorProposalApprovalGateRecordingStore } from "./vendorProposalApprovalGateRecordingStore";
import type { ProposalApprovalGateRecordingCommand } from "./vendorProposalApprovalGateRecordingPolicy";

const NOW = new Date("2026-06-20T12:00:00.000Z");

const mockIdentifiers = {
  workflowId: "123",
  proposalId: "proposal-456",
  candidateId: "candidate-789",
};

const mockPayload = {
  approvalType: "proposal_requires_operator_review",
  reasonCodes: ["risk_flag"],
  riskFlags: ["low_confidence"],
  expiresAt: new Date("2026-06-21T12:00:00.000Z").toISOString(),
  proposalSnapshotReference: { status: "proposal_ready_for_review" },
  contexts: {},
};

function makeMockCommand(
  command: ProposalApprovalGateRecordingCommand["command"],
  allowed: boolean = true
): ProposalApprovalGateRecordingCommand {
  return {
    command,
    allowed,
    gateKey: "proposal_gate:123:candidate-789",
    commandKey: "proposal_recording:123:proposal-456:idemp-abc",
    idempotencyKey: "idemp-abc",
    workflowId: mockIdentifiers.workflowId,
    proposalId: mockIdentifiers.proposalId,
    candidateId: mockIdentifiers.candidateId,
    payload: mockPayload,
    booked: false,
    accepted: false,
    dispatched: false,
    paid: false,
    captured: false,
    completed: false,
    selectedForExecution: false,
    providerAccepted: false,
    bookingVerified: false,
    paymentAuthorized: false,
    paymentCaptured: false,
    invoiceCreated: false,
    payableCreated: false,
    outreachSent: false,
    providerMessageCreated: false,
    deliveryVerified: false,
  };
}

function makeConnection(opts: {
  existingRows?: any[];
} = {}) {
  const execute = vi.fn().mockImplementation((sql: string) => {
    if (sql.includes("FROM procurement_operator_gates")) {
      return Promise.resolve([opts.existingRows ?? [], []]);
    }
    return Promise.resolve([{ affectedRows: 1, insertId: 42 }, []]);
  });
  const beginTransaction = vi.fn().mockResolvedValue(undefined);
  const commit = vi.fn().mockResolvedValue(undefined);
  const rollback = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn();
  return { execute, beginTransaction, commit, rollback, release };
}

describe("VendorProposalApprovalGateRecordingStore", () => {
  it("record_operator_review_required writes one procurement_operator_gates insert row", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorProposalApprovalGateRecordingStore(pool as never);

    const command = makeMockCommand("record_operator_review_required");
    const result = await store.recordApprovalGate({ command, now: NOW });

    expect(result.id).toBe(42);
    expect(result.gateKey).toBe("proposal_gate:123:candidate-789");
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();

    const insertCalls = connection.execute.mock.calls.filter(([sql]) => /INSERT/i.test(String(sql)));
    expect(insertCalls).toHaveLength(1);
    expect(String(insertCalls[0][0])).toMatch(/INSERT INTO procurement_operator_gates/i);
    // Verifying status 'pending' was passed
    const insertArgs = insertCalls[0][1] as any[];
    expect(insertArgs[2]).toBe("pending");
  });

  it("next-step-only approval writes with status approved", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorProposalApprovalGateRecordingStore(pool as never);

    const command = makeMockCommand("record_next_step_only_approval");
    await store.recordApprovalGate({ command, now: NOW });

    const insertCalls = connection.execute.mock.calls.filter(([sql]) => /INSERT/i.test(String(sql)));
    const insertArgs = insertCalls[0][1] as any[];
    expect(insertArgs[2]).toBe("approved");
  });

  it("rejection records rejection status", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorProposalApprovalGateRecordingStore(pool as never);

    const command = makeMockCommand("record_rejection");
    await store.recordApprovalGate({ command, now: NOW });

    const insertCalls = connection.execute.mock.calls.filter(([sql]) => /INSERT/i.test(String(sql)));
    const insertArgs = insertCalls[0][1] as any[];
    expect(insertArgs[2]).toBe("rejected");
  });

  it("duplicate gate key fails closed and throws error", async () => {
    const connection = makeConnection({ existingRows: [{ id: 42 }] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorProposalApprovalGateRecordingStore(pool as never);

    const command = makeMockCommand("record_operator_review_required");
    await expect(store.recordApprovalGate({ command, now: NOW })).rejects.toThrow(/already exists/);

    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("expired command fails closed", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorProposalApprovalGateRecordingStore(pool as never);

    const command = makeMockCommand("record_operator_review_required");
    // Expired relative to NOW (which is June 20, 2026)
    command.payload!.expiresAt = new Date("2026-06-19T12:00:00.000Z").toISOString();

    await expect(store.recordApprovalGate({ command, now: NOW })).rejects.toThrow(/expired/);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("recording_not_allowed does not write and throws error", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorProposalApprovalGateRecordingStore(pool as never);

    const command = makeMockCommand("recording_not_allowed", false);

    await expect(store.recordApprovalGate({ command, now: NOW })).rejects.toThrow(/not allowed/);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
});

describe("vendor proposal approval gate recording store source isolation", () => {
  it("writes only to procurement_operator_gates and never mutates outreach drafts, conversation events, match evaluation, dispatch, payment, Stripe, or legacy vendor tables", () => {
    const source = fs.readFileSync("server/procurement/vendorProposalApprovalGateRecordingStore.ts", "utf8");
    const writeStatements = source.match(/\b(INSERT INTO|INSERT IGNORE INTO|UPDATE\s+\w+|DELETE FROM)\b[^;]*/gi) ?? [];
    expect(writeStatements.length).toBeGreaterThan(0);
    for (const statement of writeStatements) {
      expect(statement).toMatch(/procurement_operator_gates/);
    }
    expect(source).not.toMatch(/\bvendor_outreach_drafts\b/);
    expect(source).not.toMatch(/\bvendor_outreach_conversation_events\b/);
    expect(source).not.toMatch(/\b(vendors|vendorProfiles|vendorServices)\b/);
    expect(source).not.toMatch(/\bvendor_match_evaluation_runs\b/);
    expect(source).not.toMatch(/\bdispatch\w*\b/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
  });

  it("contains no route or worker wiring", () => {
    const source = fs.readFileSync("server/procurement/vendorProposalApprovalGateRecordingStore.ts", "utf8");
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
  });
});
