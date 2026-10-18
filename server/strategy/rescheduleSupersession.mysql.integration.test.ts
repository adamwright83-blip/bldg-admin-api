/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveCanonicalOperatorIdentity, type CanonicalOperatorIdentity } from "../agents/persistentOperator/identity";
import { acceptProposalWithReceipt, getDayDirectorState } from "../planning/dayDirector/dayDirectorService";
import { emptyCommandMetadata } from "../../shared/claireWorkdayCommand";
import { operatorInstructionAdmission } from "../planning/dayDirector/dayLineAdmission";
import { assertSupersededRetirable, retireSupersededOrRollBack } from "./strategicApproval";
import { readDayLineOverlay } from "../../shared/goldlineDayLine";

const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;

describeMysql("rescheduling never leaves two active meetings", () => {
  let sql: mysql.Connection;
  let identity: CanonicalOperatorIdentity;
  let tenantId = "";
  beforeAll(async () => {
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    tenantId = `resched-${suffix}`;
    const operator = `resched-owner-${suffix}`;
    await sql.execute("INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status) VALUES (?,?,?,?,?,?,?,?,'active')", [tenantId, tenantId, "R", "R", "#123456", "Op", "op@example.invalid", "America/Los_Angeles"]);
    await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')", [tenantId, operator, "Op", "op@example.invalid"]);
    await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [tenantId, operator]);
    const r = await resolveCanonicalOperatorIdentity({ tenantId, source: { type: "open_id", value: operator }, subsystem: "resched_test" });
    if (!r.ok) throw new Error("identity");
    identity = r.identity;
  });
  afterAll(async () => sql?.end());

  const meeting = async (date: string, key: string) =>
    (await acceptProposalWithReceipt({
      tenantId, actorId: identity.dayDirectorActorId, actorIds: identity.dayDirectorActorIds, businessDate: date,
      proposal: { promptKey: key, title: "Meet Maria at Sunset Junction", kind: "growth", quantity: null, sourceText: "Meeting", prerequisites: [], question: null, intelligence: "manual_fallback", targetBusinessDate: date, command: emptyCommandMetadata() },
      admission: operatorInstructionAdmission({ operatorUserId: identity.canonicalOpenId, surface: "day_line_ui", sourceRef: key }),
    })).stored!.id;
  const active = async (date: string) =>
    (await getDayDirectorState({ tenantId, actorId: identity.dayDirectorActorId, actorIds: identity.dayDirectorActorIds, businessDate: date })).commitments.map(c => c.id);
  const overlayOf = async (id: string) =>
    readDayLineOverlay(((await sql.execute<mysql.RowDataPacket[]>("SELECT metadataJson FROM day_director_commitments WHERE id = ?", [id]))[0][0]!).metadataJson);

  it("a failed retirement rolls the replacement back and keeps the original active; a retry then succeeds", async () => {
    const wednesday = await meeting("2026-10-21", `wed-${randomUUID()}`);
    const thursday = await meeting("2026-10-22", `thu-${randomUUID()}`);
    const failingCancel = (async () => { throw new Error("cancel failed"); }) as never;
    await expect(
      retireSupersededOrRollBack({ tenantId, identity, replacementId: thursday, replacementTitle: "Meet Maria", supersededIds: [wednesday], reason: "Rescheduled", cancel: failingCancel })
    ).rejects.toThrow("cancel failed");
    expect(await active("2026-10-21")).toEqual([wednesday]);
    expect(await active("2026-10-22")).toEqual([]);
    expect((await overlayOf(thursday)).cancelledReason).toMatch(/^Rollback:/); // history kept, not deleted

    await retireSupersededOrRollBack({ tenantId, identity, replacementId: thursday, replacementTitle: "Meet Maria", supersededIds: [wednesday], reason: "Rescheduled" });
    expect(await active("2026-10-21")).toEqual([]);
    expect(await active("2026-10-22")).toEqual([thursday]);
    expect((await overlayOf(wednesday)).cancelledReason).toBe("Rescheduled"); // retired as history
  });

  it("refuses before creating anything when the earlier slot isn't this operator's", async () => {
    await expect(assertSupersededRetirable(tenantId, identity, [randomUUID()])).rejects.toThrow(/not found/);
  });
});
