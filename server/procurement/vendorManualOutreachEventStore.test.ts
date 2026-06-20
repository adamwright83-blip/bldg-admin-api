import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { VendorManualOutreachEventStore } from "./vendorManualOutreachEventStore";

const DRAFT_ROW = { id: "draft-1", candidate_id: "candidate-1", workflow_id: "workflow-1" };

function makeExecutor(opts: {
  draftRows?: Array<Record<string, unknown>>;
  gateRows?: Array<Record<string, unknown>>;
} = {}) {
  return vi.fn().mockImplementation((sql: string) => {
    if (sql.includes("FROM vendor_outreach_drafts")) {
      return Promise.resolve([opts.draftRows ?? [DRAFT_ROW], []]);
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

function manualSendInput() {
  return {
    id: "event-1", draftId: "draft-1", channel: "manual", occurredAt: new Date("2026-06-20T10:00:00.000Z"),
    summary: "Called the vendor to check availability.", rawPayload: { note: "left voicemail" },
    evidencePayload: { loggedBy: "operator-1" }, createdBy: "operator-1",
    now: new Date("2026-06-20T12:00:00.000Z"),
  };
}

function vendorResponseInput() {
  return {
    id: "event-2", draftId: "draft-1", responseKind: "availability" as const, channel: "phone",
    occurredAt: new Date("2026-06-20T11:00:00.000Z"), summary: "Vendor said they have openings Tuesday.",
    rawPayload: {}, evidencePayload: { loggedBy: "operator-1" }, createdBy: "operator-1",
    now: new Date("2026-06-20T12:00:00.000Z"),
  };
}

describe("VendorManualOutreachEventStore.logManualSend", () => {
  it("logs a manual send when the gate is operator_approved_for_manual_send_only", async () => {
    const connection = makeConnection({
      gateRows: [{ gate_key: "vendor_outreach_send_review:draft-1", status: "approved",
        decided_at: new Date("2026-06-19T00:00:00.000Z") }],
    });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorManualOutreachEventStore(pool as never);

    const { decision } = await store.logManualSend(manualSendInput());

    expect(decision.outcome).toBe("manual_outreach_logged");
    expect(connection.commit).toHaveBeenCalledOnce();
    const insertCalls = connection.execute.mock.calls.filter(([sql]) => /INSERT/i.test(String(sql)));
    expect(insertCalls).toHaveLength(1);
    expect(String(insertCalls[0][0])).toMatch(/INSERT INTO vendor_outreach_conversation_events/i);
  });

  it("fails closed when the gate is pending, rejected, or absent", async () => {
    for (const gateRows of [
      [], [{ gate_key: "vendor_outreach_send_review:draft-1", status: "pending", decided_at: null }],
      [{ gate_key: "vendor_outreach_send_review:draft-1", status: "rejected",
        decided_at: new Date("2026-06-19T00:00:00.000Z") }],
    ]) {
      const connection = makeConnection({ gateRows });
      const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
      const store = new VendorManualOutreachEventStore(pool as never);

      await expect(store.logManualSend(manualSendInput())).rejects.toThrow(/rejected/);
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.commit).not.toHaveBeenCalled();
    }
  });

  it("fails closed when the draft does not exist", async () => {
    const connection = makeConnection({ draftRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorManualOutreachEventStore(pool as never);

    await expect(store.logManualSend(manualSendInput())).rejects.toThrow(/not found/);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});

describe("VendorManualOutreachEventStore.logVendorResponse", () => {
  it("logs a vendor response against an existing draft context", async () => {
    const connection = makeConnection();
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorManualOutreachEventStore(pool as never);

    const { decision } = await store.logVendorResponse(vendorResponseInput());

    expect(decision.outcome).toBe("vendor_availability_logged");
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("fails closed when the draft does not exist", async () => {
    const connection = makeConnection({ draftRows: [] });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
    const store = new VendorManualOutreachEventStore(pool as never);

    await expect(store.logVendorResponse(vendorResponseInput())).rejects.toThrow(/not found/);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});

describe("vendor manual outreach event store source isolation", () => {
  it("writes only to vendor_outreach_conversation_events -- never to drafts, gates, match evaluation, dispatch, payment, Stripe, or legacy vendor tables", () => {
    const source = fs.readFileSync("server/procurement/vendorManualOutreachEventStore.ts", "utf8");
    const writeStatements = source.match(/\b(INSERT INTO|INSERT IGNORE INTO|UPDATE\s+\w+|DELETE FROM)\b[^;]*/gi) ?? [];
    expect(writeStatements.length).toBeGreaterThan(0);
    for (const statement of writeStatements) {
      expect(statement).toMatch(/vendor_outreach_conversation_events/);
    }
    expect(source).not.toMatch(/\bvendor_match_evaluation/);
    expect(source).not.toMatch(/\b(vendorProfiles|vendorServices|vendorOnboardingAgent)\b/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
  });

  it("contains no route or worker wiring", () => {
    const source = fs.readFileSync("server/procurement/vendorManualOutreachEventStore.ts", "utf8");
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
  });
});
