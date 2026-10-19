import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProactiveObligation } from "../../../shared/claireProactive";
import {
  attachObligationDecisionLineage,
  backfillPersistentOperatorCommercialFollowUpRef,
  listPersistentOperatorObligationPayloads,
  upsertPersistentOperatorObligation,
} from "./obligationStore";

/**
 * Real-MySQL proof of tenant isolation for Claire's proactive obligations.
 * Obligation ids are unique only within a tenant (`recovery:<customer>`): two
 * businesses can derive the same id for different customers' work. Neither
 * may overwrite, hide or touch the other's obligation, however the writes
 * interleave.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;

describeMysql("claire_proactive_obligations is keyed by tenant (real MySQL)", () => {
  let sql: mysql.Connection;
  beforeAll(async () => {
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
  });
  afterAll(async () => {
    await sql?.end();
  });

  const tenants = () => {
    const suffix = randomUUID().slice(0, 8);
    return { a: `obl-a-${suffix}`, b: `obl-b-${suffix}`, id: `recovery:phone:3105550${suffix.slice(0, 3)}` };
  };
  const obligation = (id: string, owner: string, over: Partial<ProactiveObligation> = {}): ProactiveObligation => ({
    id,
    kind: "dormant_recovery",
    subjectKey: id.replace(/^recovery:/, ""),
    subjectName: `${owner} customer`,
    status: "scheduled",
    dueDate: "2026-10-20",
    title: `Win back ${owner}'s customer`,
    why: `${owner}'s customer has not ordered in 40 days.`,
    draft: null,
    historyIntact: true,
    moveCount: 0,
    ...over,
  });
  const rows = async (id: string, ...tenantIds: string[]) => {
    const [found] = await sql.query<mysql.RowDataPacket[]>(
      "SELECT tenantId, operatorUserId, status, dueDate, decisionId, commercialFollowUpRef, JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.title')) AS title FROM claire_proactive_obligations WHERE id = ? AND tenantId IN (?) ORDER BY tenantId",
      [id, tenantIds]
    );
    return found.map(r => ({ ...r }));
  };

  it("two businesses with the same obligation id each keep their own", async () => {
    const t = tenants();
    await upsertPersistentOperatorObligation({ tenantId: t.a, operatorUserId: "owner-a", obligation: obligation(t.id, "A") });
    await upsertPersistentOperatorObligation({ tenantId: t.b, operatorUserId: "owner-b", obligation: obligation(t.id, "B", { dueDate: "2026-10-22" }) });

    expect(await rows(t.id, t.a, t.b)).toEqual([
      expect.objectContaining({ tenantId: t.a, operatorUserId: "owner-a", dueDate: "2026-10-20", title: "Win back A's customer" }),
      expect.objectContaining({ tenantId: t.b, operatorUserId: "owner-b", dueDate: "2026-10-22", title: "Win back B's customer" }),
    ]);
    expect((await listPersistentOperatorObligationPayloads({ tenantId: t.a, operatorUserId: "owner-a" })).map(o => o.title)).toEqual(["Win back A's customer"]);
    expect((await listPersistentOperatorObligationPayloads({ tenantId: t.b, operatorUserId: "owner-b" })).map(o => o.title)).toEqual(["Win back B's customer"]);
  });

  it("a retried write in one business updates its own obligation, once", async () => {
    const t = tenants();
    await upsertPersistentOperatorObligation({ tenantId: t.a, operatorUserId: "owner-a", obligation: obligation(t.id, "A") });
    await upsertPersistentOperatorObligation({ tenantId: t.b, operatorUserId: "owner-b", obligation: obligation(t.id, "B") });
    for (let attempt = 0; attempt < 3; attempt += 1)
      await upsertPersistentOperatorObligation({ tenantId: t.a, operatorUserId: "owner-a", obligation: obligation(t.id, "A", { status: "draft_prepared" }) });

    expect(await rows(t.id, t.a, t.b)).toEqual([
      expect.objectContaining({ tenantId: t.a, status: "draft_prepared", title: "Win back A's customer" }),
      expect.objectContaining({ tenantId: t.b, status: "scheduled", title: "Win back B's customer" }),
    ]);
  });

  it("concurrent writers in two businesses never cross", async () => {
    const t = tenants();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const tenantId = i % 2 ? t.b : t.a;
        const owner = i % 2 ? "B" : "A";
        return upsertPersistentOperatorObligation({
          tenantId, operatorUserId: `owner-${owner.toLowerCase()}`, obligation: obligation(t.id, owner, { moveCount: i }),
        });
      })
    );
    const found = await rows(t.id, t.a, t.b);
    expect(found.map(r => [r.tenantId, r.operatorUserId, r.title])).toEqual([
      [t.a, "owner-a", "Win back A's customer"],
      [t.b, "owner-b", "Win back B's customer"],
    ]);
  });

  it("lineage and follow-up references attach only to their own business's obligation", async () => {
    const t = tenants();
    await upsertPersistentOperatorObligation({ tenantId: t.a, operatorUserId: "owner-a", obligation: obligation(t.id, "A") });
    await upsertPersistentOperatorObligation({ tenantId: t.b, operatorUserId: "owner-b", obligation: obligation(t.id, "B") });
    const decisionId = randomUUID();
    expect(await attachObligationDecisionLineage({
      tenantId: t.a, obligationId: t.id, canonicalOperatorId: "op-a", goalRunId: randomUUID(), cycleId: randomUUID(), decisionId, executionType: "challenge",
    })).toBe(true);
    await backfillPersistentOperatorCommercialFollowUpRef({ tenantId: t.b, operatorUserId: "owner-b", obligationId: t.id, commercialFollowUpRef: "follow-up:b" });

    expect(await rows(t.id, t.a, t.b)).toEqual([
      expect.objectContaining({ tenantId: t.a, decisionId, commercialFollowUpRef: null }),
      expect.objectContaining({ tenantId: t.b, decisionId: null, commercialFollowUpRef: "follow-up:b" }),
    ]);
  });
});
