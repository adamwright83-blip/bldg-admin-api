import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ProposalOperatorGateDecisionResult } from "./vendorProposalOperatorGateDecisionPolicy";
import { proposalOperatorGateDecisionKey, VendorProposalOperatorGateDecisionStore } from "./vendorProposalOperatorGateDecisionStore";

const NOW = new Date("2026-06-20T12:00:00Z");
const falseOutcomes = { booked: false, accepted: false, dispatched: false, paid: false, captured: false,
  completed: false, selectedForExecution: false, providerAccepted: false, bookingVerified: false,
  paymentAuthorized: false, paymentCaptured: false, invoiceCreated: false, payableCreated: false,
  outreachSent: false, providerMessageCreated: false, deliveryVerified: false } as const;

function decision(status: ProposalOperatorGateDecisionResult["status"] = "operator_gate_decision_approved_for_next_step_only",
  patch: Partial<ProposalOperatorGateDecisionResult> = {}): ProposalOperatorGateDecisionResult {
  const decisionTypeByStatus: Record<string, string> = {
    operator_gate_decision_approved_for_next_step_only: "approved", operator_gate_decision_rejected: "rejected",
    operator_gate_decision_needs_revision: "needs_revision",
    operator_gate_decision_requires_resident_approval: "requires_resident_approval",
    operator_gate_decision_requires_budget_approval: "requires_budget_approval",
    operator_gate_decision_requires_payment_authorization: "requires_payment_authorization",
    operator_gate_decision_requires_legal_review: "requires_legal_review",
  };
  return { status, decisionAllowed: !status.endsWith("not_allowed") && !status.endsWith("expired"),
    gateId: "38", gateKey: "proposal_gate:42:candidate-1", workflowId: "42", requestId: "request-1",
    proposalId: "proposal-1", candidateId: "candidate-1", decisionType: decisionTypeByStatus[status] ?? "approved",
    reasonCodes: ["manual_review"], riskFlags: ["quoted_terms"], operatorId: "operator-1",
    operatorNoteSummary: "Reviewed", nextRequiredReviewType: null,
    sourceGateSnapshotReference: { id: "38", gateKey: "proposal_gate:42:candidate-1", workflowId: "42",
      proposalId: "proposal-1", status: "pending", deadlineAt: "2026-06-21T12:00:00Z" },
    proposalApprovalGateResultReference: null, recordingCommandReference: null, ...falseOutcomes, ...patch };
}

function connection(options: { row?: Record<string, unknown> | null; affectedRows?: number } = {}) {
  const defaultRow = { id: "38", workflow_id: "42", gate_key: "proposal_gate:42:candidate-1", status: "pending",
    evidence_json: { existingEvidence: true }, deadline_at: new Date("2026-06-21T12:00:00Z"), decided_at: null };
  const execute = vi.fn().mockImplementation((sql: string) => {
    if (/SELECT/i.test(sql)) return Promise.resolve([[options.row === undefined ? defaultRow : options.row].filter(Boolean), []]);
    return Promise.resolve([{ affectedRows: options.affectedRows ?? 1 }, []]);
  });
  return { execute, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
}

async function record(value: ProposalOperatorGateDecisionResult, options: Parameters<typeof connection>[0] = {}) {
  const conn = connection(options); const pool = { getConnection: vi.fn().mockResolvedValue(conn) };
  const result = await new VendorProposalOperatorGateDecisionStore(pool as never).recordDecision({ decision: value, now: NOW });
  return { result, conn, pool };
}

describe("vendor proposal operator gate decision store", () => {
  it.each([
    ["operator_gate_decision_approved_for_next_step_only", "approved"],
    ["operator_gate_decision_rejected", "rejected"],
    ["operator_gate_decision_needs_revision", "rejected"],
    ["operator_gate_decision_requires_resident_approval", "rejected"],
    ["operator_gate_decision_requires_budget_approval", "rejected"],
    ["operator_gate_decision_requires_payment_authorization", "rejected"],
    ["operator_gate_decision_requires_legal_review", "rejected"],
  ] as const)("records %s only on the existing gate", async (status, projectedStatus) => {
    const { result, conn } = await record(decision(status));
    expect(result).toMatchObject({ gateStatus: projectedStatus, executionPerformed: false,
      paymentAuthorized: false, outreachSent: false });
    const writes = conn.execute.mock.calls.filter(([sql]) => /^\s*UPDATE/i.test(String(sql)));
    expect(writes).toHaveLength(1);
    expect(String(writes[0][0])).toMatch(/UPDATE procurement_operator_gates/);
    const args = writes[0][1] as unknown[];
    const evidence = JSON.parse(String(args[4]));
    expect(evidence.existingEvidence).toBe(true);
    expect(evidence.proposalOperatorGateDecision).toMatchObject({ decisionStatus: status,
      nextStepOnlyNotExecution: true, paymentAuthorized: false, dispatched: false, outreachSent: false });
  });

  it.each([
    ["not allowed", decision("operator_gate_decision_not_allowed")],
    ["expired", decision("operator_gate_decision_expired")],
    ["missing identifiers", decision(undefined, { proposalId: null })],
    ["missing actor", decision(undefined, { operatorId: null })],
    ["unsupported", decision(undefined, { status: "unsupported" as never })],
    ["forbidden claim", decision(undefined, { booked: true as never })],
    ["nested provider-message claim", decision(undefined, {
      sourceGateSnapshotReference: { ...decision().sourceGateSnapshotReference!,
        evidenceJson: { providerMessageCreated: true } },
    })],
  ])("fails before DB work for %s", async (_name, value) => {
    const conn = connection(); const pool = { getConnection: vi.fn().mockResolvedValue(conn) };
    await expect(new VendorProposalOperatorGateDecisionStore(pool as never)
      .recordDecision({ decision: value, now: NOW })).rejects.toThrow();
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it.each(["booked", "paymentAuthorized", "dispatched", "outreachSent", "providerMessageCreated",
    "deliveryVerified"] as const)("rejects a true %s claim before DB work", async key => {
    const conn = connection(); const pool = { getConnection: vi.fn().mockResolvedValue(conn) };
    const value = decision();
    (value as unknown as Record<string, unknown>)[key] = true;
    await expect(new VendorProposalOperatorGateDecisionStore(pool as never)
      .recordDecision({ decision: value, now: NOW })).rejects.toThrow(/Forbidden/);
    expect(pool.getConnection).not.toHaveBeenCalled();
  });

  it("fails closed for an already resolved or expired stored gate", async () => {
    await expect(record(decision(), { row: { id: "38", workflow_id: "42", gate_key: "proposal_gate:42:candidate-1",
      status: "approved", evidence_json: {}, deadline_at: null, decided_at: NOW } })).rejects.toThrow(/already resolved/);
    await expect(record(decision(), { row: { id: "38", workflow_id: "42", gate_key: "proposal_gate:42:candidate-1",
      status: "pending", evidence_json: {}, deadline_at: NOW, decided_at: null } })).rejects.toThrow(/expired/);
  });

  it("rejects a duplicate deterministic decision key", async () => {
    const value = decision();
    await expect(record(value, { row: { id: "38", workflow_id: "42", gate_key: value.gateKey!, status: "pending",
      evidence_json: { proposalOperatorGateDecision: { decisionKey: proposalOperatorGateDecisionKey(value) } },
      deadline_at: new Date("2026-06-21T12:00:00Z"), decided_at: null } })).rejects.toThrow(/Duplicate/);
  });

  it("rolls back when the atomic update loses its pending-state race", async () => {
    const conn = connection({ affectedRows: 0 }); const pool = { getConnection: vi.fn().mockResolvedValue(conn) };
    await expect(new VendorProposalOperatorGateDecisionStore(pool as never)
      .recordDecision({ decision: decision(), now: NOW })).rejects.toThrow(/persistence failed/);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("writes only procurement_operator_gates and contains no external or runtime wiring", () => {
    const source = readFileSync("server/procurement/vendorProposalOperatorGateDecisionStore.ts", "utf8");
    const writeTables = [...source.matchAll(/(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_]+)/gi)]
      .map(match => match[1]);
    expect(writeTables).toEqual(["procurement_operator_gates"]);
    expect(source).not.toMatch(/vendor_response_terms|vendor_outreach_|vendor_match_evaluation|dispatch_|proof_|marketplace_|stripe|vendorProfiles|vendorServices/i);
    expect(source).not.toMatch(/\b(fetch|axios|Router|worker|connector)\b/i);
  });
});
