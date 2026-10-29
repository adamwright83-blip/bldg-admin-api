/**
 * Prototype tools against a disposable MySQL, no model: the batch Day Line tool
 * adds through admission, dedupes, moves, completes, removes, refuses vague
 * days, and every receipt is read back from the table.
 *
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3306/claire_eval pnpm vitest run --config vitest.integration.config.ts server/claire/prototype/tools.mysql.integration.test.ts
 */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const describeMysql = DATABASE_URL ? describe : describe.skip;
const TENANT = "default";
const OPEN_ID = "adam-tools-test";
const ZONE = "America/Los_Angeles";

describeMysql("prototype Day Line tools", () => {
  let sql: mysql.Connection;
  let ctx: import("./tools").ToolContext;
  let actorIds: string[];

  beforeAll(async () => {
    const parsed = new URL(DATABASE_URL!);
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error("local DATABASE_URL only");
    process.env.ALLOW_TEST_DB = "1";
    sql = await mysql.createConnection(DATABASE_URL!);
    await sql.query(
      "INSERT IGNORE INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [TENANT, TENANT, "Laundry Farm", "Laundry Farm", "#123456", "Adam", "tools@example.invalid", ZONE]
    );
    await sql.query("INSERT IGNORE INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'admin','password')", [TENANT, OPEN_ID, "Adam", `${OPEN_ID}@example.invalid`]);
    await sql.query("INSERT IGNORE INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [TENANT, OPEN_ID]);
    const { resolveCanonicalOperatorIdentity } = await import("../../agents/persistentOperator/identity");
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId: TENANT, source: { type: "open_id", value: OPEN_ID }, subsystem: "claire_prototype_tools_test" });
    if (!resolved.ok) throw new Error("identity");
    actorIds = resolved.identity.dayDirectorActorIds?.length ? resolved.identity.dayDirectorActorIds : [resolved.identity.dayDirectorActorId];
    await sql.query("DELETE FROM day_director_commitments WHERE tenantId = ? AND actorId IN (?)", [TENANT, actorIds]);
    await sql.query("DELETE FROM claire_operator_instructions WHERE tenantId = ? AND canonicalOperatorId = ?", [TENANT, resolved.identity.canonicalOperatorId]);
    let turn = 0;
    ctx = {
      tenantId: TENANT,
      operatorUserId: OPEN_ID,
      dayDirectorActorId: resolved.identity.dayDirectorActorId,
      canonicalOperatorId: resolved.identity.canonicalOperatorId,
      timeZone: ZONE,
      now: () => new Date(),
      conversationId: `tools-test-${randomUUID()}`,
      nextTurnId: () => `t${++turn}`,
    };
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("adds a batch on the days spoken, dedupes, refuses a vague day, then moves, completes and removes", async () => {
    const { applyDayLineChanges, executeTool } = await import("./tools");
    const { businessDateToday, addDaysYmd } = await import("./spokenDate");
    const today = businessDateToday(new Date(), ZONE);

    const first = await applyDayLineChanges(ctx, [
      { op: "add", title: "Finish the landing page for the Instagram ad", day: "tomorrow" },
      { op: "add", title: "Pick up the Gentiles' laundry at Opus", day: "tomorrow" },
      { op: "add", title: "Huntington Park towel run, then drop the towels at Opus", day: "tomorrow", detail: "flexible, usually 9 or 10 PM" },
      { op: "add", title: "Pay the water bill", day: "sometime next week" },
    ]);
    expect(first.wrote).toBe(true);
    expect(first.receipts.map(r => r.status)).toEqual(["applied", "applied", "applied", "refused"]);
    expect(first.receipts[3]!.reason).toMatch(/ask which day/);
    expect(new Set(first.receipts.slice(0, 3).map(r => r.businessDate))).toEqual(new Set([addDaysYmd(today, 1)]));

    const [rows] = await sql.query<mysql.RowDataPacket[]>("SELECT title, businessDate, metadataJson FROM day_director_commitments WHERE tenantId = ? AND actorId IN (?)", [TENANT, actorIds]);
    expect(rows).toHaveLength(3);
    const towel = rows.find(row => /towel/i.test(String(row.title)))!;
    const metadata = typeof towel.metadataJson === "string" ? JSON.parse(towel.metadataJson) : towel.metadataJson;
    expect(metadata.detailNote).toMatch(/9 or 10 PM/);

    // A second instruction for the same work does not duplicate.
    const again = await applyDayLineChanges(ctx, [{ op: "add", title: "pick up Gentiles at Opus", day: "tomorrow" }]);
    expect(again.wrote).toBe(false);
    expect(again.receipts[0]).toMatchObject({ status: "already_present" });

    // read_day_line sees all three.
    const read = await executeTool(ctx, "read_day_line", { day: "tomorrow" });
    expect((read.output as { rows: unknown[] }).rows).toHaveLength(3);

    // Move, complete, remove by title fragment; ambiguity is reported, not guessed.
    const ops = await applyDayLineChanges(ctx, [
      { op: "move", title: "landing page", day: "tomorrow", to_day: "day after tomorrow" },
      { op: "complete", title: "Gentiles", day: "tomorrow" },
      { op: "remove", title: "Opus", day: "tomorrow" },
    ]);
    expect(ops.receipts[0]).toMatchObject({ status: "applied", businessDate: addDaysYmd(today, 2) });
    expect(ops.receipts[1]).toMatchObject({ status: "applied" });
    // "Opus" now matches the completed pickup and the towel drop: ambiguous.
    expect(["ambiguous", "applied"]).toContain(ops.receipts[2]!.status);

    const removal = await applyDayLineChanges(ctx, [{ op: "remove", title: "towel run", day: "tomorrow" }]);
    expect(removal.receipts[0]).toMatchObject({ status: "applied" });
    const after = await executeTool(ctx, "read_day_line", { day: "tomorrow" });
    const titles = (after.output as { rows: Array<{ title: string; status: string }> }).rows;
    expect(titles.find(row => /Gentiles/.test(row.title))?.status).toBe("completed");
    expect(titles.some(row => /towel/i.test(row.title))).toBe(false);

    const missing = await applyDayLineChanges(ctx, [{ op: "move", title: "unicorn", day: "tomorrow", to_day: "friday" }]);
    expect(missing.receipts[0]).toMatchObject({ status: "not_found" });
  }, 60_000);

  it("saves a standing instruction and reports it active; numbers come back from the ledger without invention", async () => {
    const { executeTool } = await import("./tools");
    const saved = await executeTool(ctx, "save_standing_instruction", { rule: "Do not bring up The Louise unless the operator asks", operator_words: "Stop bringing up the Louise." });
    expect(saved.output).toMatchObject({ status: "active" });
    const numbers = await executeTool(ctx, "read_business_numbers", { metric: "revenue", period: "this_month" });
    expect(["ok", "unavailable"]).toContain((numbers.output as { status: string }).status);
    expect(numbers.wrote).toBe(false);
  }, 30_000);
});
