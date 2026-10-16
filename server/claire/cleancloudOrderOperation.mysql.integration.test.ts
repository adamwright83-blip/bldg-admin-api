/**
 * Claire queues CleanCloud intake only after an exact approval.
 * The database is a local disposable schema created by this file.
 * The application DATABASE_URL is unset before any order work. No CleanCloud host is contacted.
 * The unit Vitest config does not collect this file. Run it with the integration config where MySQL is up.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { runAgentTool } from "../agents/agentRuntime";
import type { AgentContext } from "../agents/permissions";
import { resetDbForTesting, setDbForTesting } from "../db";
import {
  authorizeIntakeSubmit,
  captureIntake,
  claimIntake,
  finishIntake,
  listIntake,
} from "../integrations/cleancloud/intake/service";
import { intakeFingerprintText, type IntakePrepared } from "../../shared/cleancloudIntake";
import {
  commitCleanCloudOrderOperation,
  proposeCleanCloudOrderOperation,
} from "./cleancloudOrderOperation";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CLAIRE_ORDER_OPS_PORT ?? 3306);
const USER = process.env.CLAIRE_ORDER_OPS_USER ?? "claire";
const PASSWORD = process.env.CLAIRE_ORDER_OPS_PASSWORD ?? "disposable";

/** Local server account only. A configured DATABASE_URL is read for that account, then unset. */
function disposableAdmin(): { host: string; port: number; user: string; password: string } {
  const configured = process.env.DATABASE_URL;
  if (!configured) return { host: HOST, port: PORT, user: USER, password: PASSWORD };
  const url = new URL(configured);
  if (url.hostname !== "127.0.0.1") throw new Error("Local database host required");
  return {
    host: url.hostname,
    port: Number(url.port || "3306"),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}
const BANNED =
  /sms (?:message )?(?:was )?sent|text (?:message )?(?:was )?sent|charge was made|was charged|card was charged|called the customer|order was submitted|submitted to cleancloud/i;

describe("Claire approved CleanCloud order operation on disposable MySQL", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const databaseName = `claire_cc_ops_${suffix}_disposable`;
  const actor = { tenantId: `ccops-${suffix}`.slice(0, 64), actorId: "test-operator" };
  const other = { tenantId: `other-${suffix}`.slice(0, 64), actorId: "other-operator" };
  const source = { bindingId: randomUUID(), storeLabel: "Example Laundry" };
  const catalog = [
    { id: "201", label: "Laundry", unit: "lb" as const, section: "Laundry" },
    { id: "202", label: "Shirt", unit: "piece" as const, section: "Dry Cleaning" },
  ];
  const plan = { lines: [{ productId: "202", quantity: 4 }] };
  let admin: mysql.Connection;
  let pool: mysql.Pool;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeAll(async () => {
    if (!databaseName.endsWith("_disposable")) throw new Error("Disposable database name required");
    const adminAuth = disposableAdmin();
    if (adminAuth.host !== "127.0.0.1") throw new Error("Local database host required");
    delete process.env.DATABASE_URL;
    if (previousDatabaseUrl) {
      const prior = new URL(previousDatabaseUrl);
      if (prior.pathname.replace(/^\//, "") === databaseName) {
        throw new Error("Refusing to reuse an existing DATABASE_URL database");
      }
    }
    fetchSpy.mockRejectedValue(new Error("live provider blocked"));
    admin = await mysql.createConnection({
      host: adminAuth.host,
      port: adminAuth.port,
      user: adminAuth.user,
      password: adminAuth.password,
      connectTimeout: 5_000,
    });
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    pool = mysql.createPool({
      host: adminAuth.host,
      port: adminAuth.port,
      user: adminAuth.user,
      password: adminAuth.password,
      database: databaseName,
      connectionLimit: 4,
      timezone: "Z",
    });
    // MariaDB returns JSON columns as text through Drizzle's query path.
    // Production MySQL already parses them. This keeps the existing service unchanged.
    const parseJson = (executor: { query: mysql.Pool["query"] }) => {
      const original = executor.query.bind(executor);
      executor.query = (async (...args: Parameters<mysql.Pool["query"]>) => {
        const result = await original(...args);
        const rows = Array.isArray(result) ? result[0] : null;
        const fields = Array.isArray(result) ? result[1] : null;
        if (Array.isArray(rows) && Array.isArray(fields)) {
          for (const row of rows) {
            if (!Array.isArray(row)) continue;
            fields.forEach((field, index) => {
              const value = row[index];
              if (typeof value === "string" && /json$/i.test(String(field.name ?? ""))) {
                try {
                  row[index] = JSON.parse(value);
                } catch {
                  // Leave an unreadable value for the service to reject.
                }
              }
            });
          }
        }
        return result;
      }) as mysql.Pool["query"];
    };
    parseJson(pool);
    const originalGetConnection = pool.getConnection.bind(pool);
    pool.getConnection = async () => {
      const connection = await originalGetConnection();
      parseJson(connection);
      return connection;
    };
    setDbForTesting(drizzle(pool));
    for (const filename of [
      "../integrations/cleancloud/browserSync/schema.sql",
      "../integrations/cleancloud/pickups/schema.sql",
      "../integrations/cleancloud/intake/schema.sql",
    ]) {
      const sql = await readFile(new URL(filename, import.meta.url), "utf8");
      for (const statement of sql.split(";").map(part => part.trim()).filter(Boolean)) {
        await pool.query(statement);
      }
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_events (
        id int NOT NULL AUTO_INCREMENT PRIMARY KEY,
        tenantId varchar(64) NOT NULL DEFAULT 'default',
        sessionId varchar(128) NULL,
        conversationId varchar(128) NULL,
        agentType enum('resident_agent','operator_voice_agent','vendor_agent','driver_agent','gm_agent','building_agent','collections_agent','operator_task_agent','goal_cycle_agent','system_agent') NOT NULL,
        actorType enum('human','voice','resident_chat','driver','vendor','ai_agent','system') NOT NULL,
        actorId varchar(128) NULL,
        toolName varchar(128) NOT NULL,
        entityType varchar(64) NULL,
        entityId varchar(128) NULL,
        inputJson json NULL,
        outputJson json NULL,
        status enum('proposed','policy_denied','write_withheld','approval_required','execution_started','success','failed','blocked') NOT NULL,
        errorMessage text NULL,
        latencyMs int NULL,
        modelUsed varchar(128) NULL,
        inputTokens int NOT NULL DEFAULT 0,
        outputTokens int NOT NULL DEFAULT 0,
        estimatedCostCents int NOT NULL DEFAULT 0,
        requiresHumanApproval boolean NOT NULL DEFAULT false,
        approvedByUserId varchar(128) NULL,
        goalRunId varchar(36) NULL,
        cycleId varchar(36) NULL,
        decisionId varchar(36) NULL,
        obligationId varchar(191) NULL,
        authorityBasis varchar(64) NULL,
        approvalBasis varchar(64) NULL,
        standingAuthorizationId varchar(36) NULL,
        standingAuthorizationVersion int NULL,
        policyVersion varchar(96) NULL,
        operationStatus varchar(32) NULL,
        objectiveId varchar(36) NULL DEFAULT NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.execute(
      "INSERT INTO cleancloud_browser_sync_bindings (tenantId,id,storeId,storeLabel,createdBy) VALUES (?,?,?,?,?)",
      [actor.tenantId, source.bindingId, "42", source.storeLabel, actor.actorId]
    );
    await pool.execute(
      "INSERT INTO cleancloud_pickup_connections (tenantId,bindingId,actorId,enabled,excludedOrderIds) VALUES (?,?,?,true,?)",
      [actor.tenantId, source.bindingId, actor.actorId, JSON.stringify(["104"])]
    );
    await captureIntake(actor, {
      ...source,
      observedAt: new Date().toISOString(),
      catalog,
      rows: [101, 102].map(id => ({
        externalOrderId: String(id),
        customerName: "Example " + id,
        readyBy: "Tomorrow",
      })),
    }, true);
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    resetDbForTesting();
    if (pool) await pool.end();
    if (admin && databaseName.endsWith("_disposable")) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  async function order(externalOrderId = "101") {
    const row = (await listIntake(actor)).orders.find(item => item.externalOrderId === externalOrderId);
    if (!row) throw new Error(`missing disposable order ${externalOrderId}`);
    return row;
  }

  it("proposes, refuses an unapproved commit, then queues preparation once", async () => {
    const row = await order();
    const proposal = await proposeCleanCloudOrderOperation({
      actor,
      orderId: row.id,
      action: "prepare",
      plan,
    });
    expect(proposal.status).toBe("pending_approval");
    expect(proposal.providerContacted).toBe(false);
    expect(proposal.charged).toBe(false);
    expect(proposal.speech).toMatch(/Example 101/);
    expect(proposal.speech).toMatch(/4 Shirt/);
    expect(proposal.speech).not.toMatch(BANNED);
    expect((await order()).state).toBe("detail");
    await expect(commitCleanCloudOrderOperation({
      actor,
      approvedByUserId: null,
      orderId: row.id,
      action: "prepare",
      plan,
      fingerprint: proposal.fingerprint,
      revision: proposal.revision,
      reviewed: true,
    })).rejects.toThrow(/Human approval is required/);
    await expect(commitCleanCloudOrderOperation({
      actor,
      approvedByUserId: "operator-1",
      orderId: row.id,
      action: "prepare",
      plan,
      fingerprint: "0".repeat(64),
      revision: proposal.revision,
      reviewed: true,
    })).rejects.toThrow(/Nothing was queued/);
    expect((await order()).state).toBe("detail");
    const ctx: AgentContext = {
      tenantId: actor.tenantId,
      agentType: "operator_voice_agent",
      actorType: "human",
      actorId: actor.actorId,
    };
    const blocked = await runAgentTool("commitCleanCloudOrderOperationTool", {
      orderId: row.id,
      action: "prepare",
      plan,
      fingerprint: proposal.fingerprint,
      revision: proposal.revision,
      reviewed: true,
    }, ctx);
    expect(blocked).toMatchObject({ approvalRequired: true, toolName: "commitCleanCloudOrderOperationTool" });
    expect((await order()).state).toBe("detail");

    const receipt = await runAgentTool<Awaited<ReturnType<typeof commitCleanCloudOrderOperation>>>("commitCleanCloudOrderOperationTool", {
      orderId: row.id,
      action: "prepare",
      plan,
      fingerprint: proposal.fingerprint,
      revision: proposal.revision,
      reviewed: true,
    }, { ...ctx, approvedByUserId: "operator-1" });
    expect(receipt.status).toBe("queued");
    expect(receipt.state).toBe("prepare_pending");
    expect(receipt.eventId).toBeGreaterThan(0);
    expect(receipt.providerContacted).toBe(false);
    expect(receipt.charged).toBe(false);
    expect(receipt.smsSent).toBe(false);
    expect(receipt.callPlaced).toBe(false);
    const again = await commitCleanCloudOrderOperation({
      actor,
      approvedByUserId: "operator-1",
      orderId: row.id,
      action: "prepare",
      plan,
      fingerprint: proposal.fingerprint,
      revision: proposal.revision,
      reviewed: true,
    });
    expect(again.status).toBe("already_queued");
    expect(again.revision).toBe(receipt.revision);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not let another tenant queue the captured order", async () => {
    const row = await order();
    await expect(proposeCleanCloudOrderOperation({
      actor: other,
      orderId: row.id,
      action: "prepare",
      plan,
    })).rejects.toThrow(/Connect the intake pilot|Order unavailable/);
    expect((await order()).externalOrderId).toBe("101");
  });

  it("queues submit only for the reviewed draft and does not authorize the provider click", async () => {
    const row = await order("102");
    const proposal = await proposeCleanCloudOrderOperation({
      actor,
      orderId: row.id,
      action: "prepare",
      plan,
    });
    await commitCleanCloudOrderOperation({
      actor,
      approvedByUserId: "operator-1",
      orderId: row.id,
      action: "prepare",
      plan,
      fingerprint: proposal.fingerprint,
      revision: proposal.revision,
      reviewed: true,
    });
    let claim = await claimIntake(actor, source);
    for (let attempt = 0; claim && claim.id !== row.id && attempt < 5; attempt += 1) {
      await finishIntake(actor, {
        ...source,
        id: claim.id,
        revision: claim.revision!,
        leaseToken: claim.leaseToken!,
        error: "Released the other disposable command.",
      });
      claim = await claimIntake(actor, source);
    }
    if (!claim || claim.id !== row.id) throw new Error("disposable order 102 was not claimed");
    const prepared: IntakePrepared = {
      externalOrderId: "102",
      customerName: "Example 102",
      readyBy: "Tomorrow",
      priceListId: "default",
      totalCents: 2000,
      bags: 0,
      notes: "",
      tableText: "4 Shirts",
      quantities: [{ productId: "202", quantity: 4 }],
      observedAt: new Date().toISOString(),
      fingerprint: "",
    };
    prepared.fingerprint = createHash("sha256").update(intakeFingerprintText(prepared)).digest("hex");
    await finishIntake(actor, {
      ...source,
      id: row.id,
      revision: claim.revision!,
      leaseToken: claim.leaseToken!,
      prepared,
    });
    const drafted = await order("102");
    expect(drafted.state).toBe("review");
    const approval = await proposeCleanCloudOrderOperation({
      actor,
      orderId: row.id,
      action: "approve_submit",
    });
    expect(approval.fingerprint).toBe(prepared.fingerprint);
    expect(approval.speech).toMatch(/\$20\.00/);
    expect(approval.speech).not.toMatch(BANNED);
    expect(approval.providerContacted).toBe(false);
    const receipt = await commitCleanCloudOrderOperation({
      actor,
      approvedByUserId: "operator-1",
      orderId: row.id,
      action: "approve_submit",
      fingerprint: approval.fingerprint,
      revision: approval.revision,
      reviewed: true,
    });
    expect(receipt.status).toBe("queued");
    expect(receipt.state).toBe("submit_pending");
    expect(receipt.charged).toBe(false);
    const repeat = await commitCleanCloudOrderOperation({
      actor,
      approvedByUserId: "operator-1",
      orderId: row.id,
      action: "approve_submit",
      fingerprint: approval.fingerprint,
      revision: approval.revision,
      reviewed: true,
    });
    expect(repeat.status).toBe("already_queued");
    await expect(authorizeIntakeSubmit(actor, {
      ...source,
      id: row.id,
      revision: receipt.revision!,
      leaseToken: randomUUID(),
    })).rejects.toThrow(/Submission stopped/);
    expect((await order("102")).state).toBe("submit_pending");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
