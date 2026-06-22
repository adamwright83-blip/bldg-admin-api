import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { LegalTemplateStore } from "./legalTemplateStore";

const DRAFT_ROW = {
  template_key: "vendor_availability_request_v0", version: "v1", status: "draft",
  body_template: "Hi {{vendorName}}, ...", variable_schema_json: { type: "object" },
};

function makeConnection(opts: { selectRows?: Array<Record<string, unknown>> } = {}) {
  const execute = vi.fn().mockImplementation((sql: string) => {
    if (/^SELECT/i.test(sql.trim())) {
      return Promise.resolve([opts.selectRows ?? [DRAFT_ROW], []]);
    }
    return Promise.resolve([{ affectedRows: 1 }, []]);
  });
  const beginTransaction = vi.fn().mockResolvedValue(undefined);
  const commit = vi.fn().mockResolvedValue(undefined);
  const rollback = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn();
  return { execute, beginTransaction, commit, rollback, release };
}

function makePool(opts: Parameters<typeof makeConnection>[0] = {}) {
  const connection = makeConnection(opts);
  return { pool: { getConnection: vi.fn().mockResolvedValue(connection) }, connection };
}

describe("LegalTemplateStore.approveOutreachTemplateVersion", () => {
  it("approves an existing draft template version", async () => {
    const { pool, connection } = makePool();
    const store = new LegalTemplateStore(pool as never);

    const result = await store.approveOutreachTemplateVersion({
      templateKey: "vendor_availability_request_v0", version: "v1", approvedBy: "admin:1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.templateKey).toBe("vendor_availability_request_v0");
      expect(result.version).toBe("v1");
      expect(result.effectiveAt).toEqual(result.approvedAt); // defaults effectiveAt to now when not supplied
    }
    expect(connection.commit).toHaveBeenCalledOnce();
    const updateCall = connection.execute.mock.calls.find(([sql]) => /^UPDATE/i.test(String(sql).trim()));
    expect(updateCall).toBeDefined();
    expect(String(updateCall![0])).toMatch(/SET status = 'approved'/i);
    expect(String(updateCall![0])).toMatch(/WHERE template_key = \? AND version = \? AND status = 'draft'/i);
  });

  it("uses a supplied effectiveAt instead of defaulting to now", async () => {
    const { pool, connection } = makePool();
    const store = new LegalTemplateStore(pool as never);
    const effectiveAt = new Date("2026-07-01T00:00:00.000Z");

    const result = await store.approveOutreachTemplateVersion({
      templateKey: "vendor_availability_request_v0", version: "v1", approvedBy: "admin:1", effectiveAt,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.effectiveAt).toEqual(effectiveAt);
    const updateCall = connection.execute.mock.calls.find(([sql]) => /^UPDATE/i.test(String(sql).trim()));
    expect(updateCall![1]).toEqual(expect.arrayContaining([effectiveAt]));
  });

  it("refuses a missing template version without writing", async () => {
    const { pool, connection } = makePool({ selectRows: [] });
    const store = new LegalTemplateStore(pool as never);

    const result = await store.approveOutreachTemplateVersion({
      templateKey: "vendor_availability_request_v0", version: "v1", approvedBy: "admin:1",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    const updateCalls = connection.execute.mock.calls.filter(([sql]) => /^UPDATE/i.test(String(sql).trim()));
    expect(updateCalls).toHaveLength(0);
    expect(connection.commit).toHaveBeenCalledOnce(); // refusal is not an error -- the (no-op) transaction still commits cleanly
  });

  it("refuses when the templateKey/version pair doesn't exist (queried correctly, not a different row)", async () => {
    const { pool, connection } = makePool({ selectRows: [] });
    const store = new LegalTemplateStore(pool as never);

    await store.approveOutreachTemplateVersion({
      templateKey: "wrong_key", version: "v99", approvedBy: "admin:1",
    });

    const selectCall = connection.execute.mock.calls.find(([sql]) => /^SELECT/i.test(String(sql).trim()));
    expect(selectCall![1]).toEqual(["wrong_key", "v99"]);
  });

  it("refuses an already-approved template version without re-approving it", async () => {
    const { pool, connection } = makePool({ selectRows: [{ ...DRAFT_ROW, status: "approved" }] });
    const store = new LegalTemplateStore(pool as never);

    const result = await store.approveOutreachTemplateVersion({
      templateKey: "vendor_availability_request_v0", version: "v1", approvedBy: "admin:1",
    });

    expect(result).toEqual({ ok: false, reason: "not_in_draft_status" });
    const updateCalls = connection.execute.mock.calls.filter(([sql]) => /^UPDATE/i.test(String(sql).trim()));
    expect(updateCalls).toHaveLength(0);
  });

  it("refuses a retired template version without re-approving it", async () => {
    const { pool } = makePool({ selectRows: [{ ...DRAFT_ROW, status: "retired" }] });
    const store = new LegalTemplateStore(pool as never);

    const result = await store.approveOutreachTemplateVersion({
      templateKey: "vendor_availability_request_v0", version: "v1", approvedBy: "admin:1",
    });

    expect(result).toEqual({ ok: false, reason: "not_in_draft_status" });
  });

  it("never touches body_template or variable_schema_json -- only status/approval/effective columns change", async () => {
    const { pool, connection } = makePool();
    const store = new LegalTemplateStore(pool as never);

    await store.approveOutreachTemplateVersion({
      templateKey: "vendor_availability_request_v0", version: "v1", approvedBy: "admin:1",
    });

    const updateCall = connection.execute.mock.calls.find(([sql]) => /^UPDATE/i.test(String(sql).trim()));
    expect(String(updateCall![0])).not.toMatch(/body_template|variable_schema_json|subject_template/i);
  });

  it("never creates a new template row -- only UPDATE statements are issued, no INSERT", async () => {
    const { pool, connection } = makePool();
    const store = new LegalTemplateStore(pool as never);

    await store.approveOutreachTemplateVersion({
      templateKey: "vendor_availability_request_v0", version: "v1", approvedBy: "admin:1",
    });

    const insertCalls = connection.execute.mock.calls.filter(([sql]) => /INSERT/i.test(String(sql)));
    expect(insertCalls).toHaveLength(0);
  });

  it("never touches outreach_template_lint_rules", async () => {
    const { pool, connection } = makePool();
    const store = new LegalTemplateStore(pool as never);

    await store.approveOutreachTemplateVersion({
      templateKey: "vendor_availability_request_v0", version: "v1", approvedBy: "admin:1",
    });

    for (const [sql] of connection.execute.mock.calls) {
      expect(String(sql)).not.toMatch(/outreach_template_lint_rules/i);
    }
  });

  it("does not evaluate or bypass lint -- no lint/render function is called by this method", async () => {
    const source = fs.readFileSync("server/procurement/legalTemplateStore.ts", "utf8");
    expect(source).not.toMatch(/lintOutreachTemplate|renderVendorOutreachDraft|evaluateTemplateForUse/);
  });
});

describe("LegalTemplateStore.approveOutreachTemplateVersion source isolation", () => {
  it("introduces no outreach/send/booking/payment/dispatch/provider-acceptance behavior", () => {
    const source = fs.readFileSync("server/procurement/legalTemplateStore.ts", "utf8");
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/openai|anthropic|chatgpt/i);
    expect(source).not.toMatch(/\bstripe\b/i);
    expect(source).not.toMatch(/provider_acceptance|dispatch_proof|payment_capture/i);
    expect(source).not.toMatch(/router|app\.(get|post|put|delete)/i);
  });

  it("only this method updates outreach_template_versions; the update statement never targets any other table", () => {
    const source = fs.readFileSync("server/procurement/legalTemplateStore.ts", "utf8");
    const updateStatements = source.match(/UPDATE\s+\w+/gi) ?? [];
    expect(updateStatements.length).toBeGreaterThan(0);
    for (const statement of updateStatements) {
      expect(statement).toMatch(/outreach_template_versions/i);
    }
  });
});
