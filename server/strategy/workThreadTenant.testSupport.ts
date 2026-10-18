/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import { formatInTimeZone } from "date-fns-tz";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../shared/saasTenant";
import { createDaphneGoal } from "../agents/daphne/goalsPreferences";
import {
  resolveCanonicalOperatorIdentity,
  type CanonicalOperatorIdentity,
} from "../agents/persistentOperator/identity";
import { activateCurrentMacroGoalRun } from "../agents/persistentOperator/macroGoalRuns";
import { setActiveMacroGoal } from "../claire/macroGoalService";
import { cleancloudBrowserSyncRouter } from "../integrations/cleancloud/browserSync/router";
import { dayDirectorRouter } from "../planning/dayDirector/dayDirectorRouter";
import { configureTenantStrategyVertical } from "./marketContext";
import { defaultVerticalRegistry } from "./verticalTemplates/defaultRegistry";

/**
 * A disposable tenant for Work Thread MySQL tests, built through normal paths:
 * membership and entitlement rows, the operator's macro goal and Daphne focus,
 * and paid CleanCloud history imported through the browser-sync router (which
 * admits each paid observation and records source coverage). Nothing here
 * writes a diagnosis, decision, objective or thread.
 */
export const WORK_THREAD_ZONE = "America/Los_Angeles";

export type LedgerCustomer = {
  name: string;
  customerId: string;
  address: string;
  /** Days before `now` each paid order was placed. */
  daysAgo: number[];
  total: string;
};

/** Silver Lake: Alma and Bea have lapsed, Cruz is active. Beverly Hills: Dana is active. */
export const SILVER_LAKE_LEDGER: LedgerCustomer[] = [
  { name: "Alma Reyes", customerId: "c1", address: "2300 Silver Lake Blvd Los Angeles CA 90039", daysAgo: [150, 120, 95], total: "48.00" },
  { name: "Bea Lund", customerId: "c2", address: "1800 Griffith Park Blvd Los Angeles CA 90026", daysAgo: [140, 100, 75], total: "61.00" },
  { name: "Cruz Ortega", customerId: "c3", address: "3100 Sunset Blvd Los Angeles CA 90026", daysAgo: [20, 5], total: "40.00" },
  { name: "Dana Kim", customerId: "c4", address: "262 North Rodeo Drive Beverly Hills CA 90210", daysAgo: [40, 10], total: "33.00" },
];

const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;
const DAY_MS = 86_400_000;

export type WorkThreadTenant = Awaited<ReturnType<typeof createWorkThreadTenant>>;

export async function createWorkThreadTenant(
  sql: mysql.Connection,
  input: { prefix: string; focus: string; now: Date }
) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const tenantId = `${input.prefix}-${suffix}`;
  const openId = `${input.prefix}-owner-${suffix}`;
  const zone = WORK_THREAD_ZONE;
  await sql.execute(
    "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
    [tenantId, tenantId, "Work thread test", "Work thread test", "#123456", "Op", "op@example.invalid", zone]
  );
  await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')", [tenantId, openId, "Op", "op@example.invalid"]);
  await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [tenantId, openId]);
  await sql.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,?,'manual',true)", [tenantId, PERSISTENT_OPERATOR_ENTITLEMENT]);
  const [users] = await sql.execute<mysql.RowDataPacket[]>("SELECT id FROM users WHERE tenantId = ? AND openId = ?", [tenantId, openId]);
  const userId = Number(users[0]!.id);
  const resolved = await resolveCanonicalOperatorIdentity({ tenantId, source: { type: "open_id", value: openId }, subsystem: "work_thread_test" });
  if (!resolved.ok) throw new Error(`Test identity did not resolve: ${resolved.reason}`);
  const identity: CanonicalOperatorIdentity = resolved.identity;
  await configureTenantStrategyVertical({ identity, verticalKey: "laundry_fluff_fold" });
  await setActiveMacroGoal({
    tenantId,
    operatorUserId: openId,
    objective: "Get to 50 active customers",
    metricKey: "active_customers",
    targetValue: 50,
    unit: "customers",
    targetDate: formatInTimeZone(new Date(input.now.getTime() + 90 * DAY_MS), zone, "yyyy-MM-dd"),
    source: "operator_attested",
    sourceNote: "Work thread test goal",
  });
  // The run row only; its occurrences are queued by the caller on an isolated queue.
  const run = await activateCurrentMacroGoalRun({
    tenantId,
    identity,
    verticalKey: "laundry_fluff_fold",
    policyVersion: "v1",
    registry: defaultVerticalRegistry,
    now: input.now,
  });
  if (!run) throw new Error("Test macro goal run not activated");

  const ctx = { tenantId, user: { id: userId, openId, role: "user", name: "Op" }, req: undefined, res: undefined, vendorSession: null } as never;
  const dayDirector = dayDirectorRouter.createCaller(ctx);
  const browserSync = cleancloudBrowserSyncRouter.createCaller({ ...(ctx as object), user: { id: userId, openId, role: "admin", name: "Op" } } as never);

  let focusGoalId: string | null = null;
  /** The operator states (or restates) the neighborhood they care about; the previous focus is superseded. */
  const focusOn = async (statement: string) => {
    const goal = await createDaphneGoal({
      tenantId,
      canonicalOperatorId: identity.canonicalOperatorId,
      goalKey: `focus_${randomUUID().slice(0, 8)}`,
      horizon: "current",
      statement,
      sourceObservationId: `obs_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      supersedesGoalId: focusGoalId,
    });
    if (focusGoalId)
      await sql.execute("UPDATE daphne_goals SET status = 'superseded', closedAt = CURRENT_TIMESTAMP(3) WHERE tenantId = ? AND id = ?", [tenantId, focusGoalId]);
    focusGoalId = goal.id;
    return goal;
  };
  await focusOn(input.focus);

  let nextOrderId = 9000;
  let binding: { id: string } | null = null;
  const ledger: Array<{ paidAt: Date; line: string[] }> = [];
  const mdy = (d: Date) => formatInTimeZone(d, zone, "MM/dd/yyyy");
  const ymd = (d: Date) => formatInTimeZone(d, zone, "yyyy-MM-dd");
  /**
   * Paid history through the browser-sync import: new customers' orders are
   * dated relative to `now` once, then every order on record is (re)sent in
   * 30-day export windows back over a year, the way a sync covers a new day.
   * Re-sending an order is an idempotent update, never a second order.
   */
  const importLedger = async (customers: LedgerCustomer[], now: Date) => {
    for (const c of customers)
      for (const days of c.daysAgo) {
        const paidAt = new Date(now.getTime() - days * DAY_MS);
        ledger.push({ paidAt, line: [String(++nextOrderId), mdy(new Date(paidAt.getTime() - DAY_MS)), c.name, c.customerId, c.address, "Yes", mdy(paidAt), c.total] });
      }
    const account = { tenantId, actorId: openId, storeId: "123", storeLabel: "Work thread store" };
    binding ??= await browserSync.pair(account);
    for (let end = 0; end < 400; end += 30) {
      const to = new Date(now.getTime() - end * DAY_MS);
      const from = new Date(now.getTime() - (end + 29) * DAY_MS);
      const [fy, fm, fd] = ymd(from).split("-");
      const [ty, tm, td] = ymd(to).split("-");
      const inWindow = ledger.filter(r => ymd(r.paidAt) >= ymd(from) && ymd(r.paidAt) <= ymd(to)).map(r => r.line.map(csvCell).join(","));
      const result = (await browserSync.import({
        ...account,
        bindingId: binding.id,
        requestId: randomUUID(),
        from: ymd(from),
        to: ymd(to),
        exportUrl: `https://cleancloudapp.com/include/data-export-endpoint.php?type=1&d1=${fd}&m1=${fm}&y1=${fy}&d2=${td}&m2=${tm}&y2=${ty}&stores=[123]&group=`,
        csv: ["Order ID,Placed,Customer,Customer ID,Address,Paid,Payment Date,Total", ...inWindow].join("\n"),
      })) as { importCommitted?: boolean; error?: unknown };
      if (!result.importCommitted) throw new Error(`Ledger import was not committed: ${String(result.error ?? "")}`);
    }
  };

  /** The operator tells the Day Line to do something (an authenticated direct instruction). */
  const instruct = async (title: string, businessDate: string) => {
    const stored = (await dayDirector.accept({
      businessDate,
      proposal: {
        promptKey: `instruction-${randomUUID().slice(0, 8)}`,
        title,
        kind: "growth",
        quantity: null,
        sourceText: title,
        prerequisites: [],
        question: null,
        intelligence: "manual_fallback",
      },
    } as never)) as { id: string } | null;
    if (!stored?.id) throw new Error("Instruction was not stored");
    return stored.id;
  };

  return { tenantId, openId, userId, identity, run, zone, focusOn, importLedger, instruct, dayDirector };
}
