#!/usr/bin/env node
/**
 * Data Migration & Verification Script: Laundry Farm Attribution
 *
 * Attributions:
 * 1. Store #34145 CleanCloud browser sync binding -> laundry_farm
 * 2. All 1,095 CleanCloud paid orders -> laundry_farm
 * 3. All 466 CleanCloud cadence orders in `orders` (goldline:cadence:%) -> laundry_farm
 * 4. 50-active-customer goal lineage (goalRunId: 9e7dd9ae...) -> laundry_farm
 * 5. 16 CleanCloud recovery obligations -> laundry_farm (clearing draft, status = scheduled)
 * 6. Commercial accounts (IDs 3, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17) replicated to laundry_farm
 * 7. Preserves Order #707 and all native Stripe orders in `default`
 * 8. Preserves accounts 15 and 17 as separate records
 *
 * Usage:
 *   node scripts/migrate-laundry-farm-attribution.mjs --dry-run
 *   node scripts/migrate-laundry-farm-attribution.mjs --execute
 *   node scripts/migrate-laundry-farm-attribution.mjs --verify
 *   node scripts/migrate-laundry-farm-attribution.mjs --rollback
 */

import mysql from "mysql2/promise";

const connectionUrl = process.env.DATABASE_URL || "mysql://root:root@127.0.0.1:3437/phase2";
const args = process.argv.slice(2);
const mode = args.includes("--execute")
  ? "execute"
  : args.includes("--verify")
    ? "verify"
    : args.includes("--rollback")
      ? "rollback"
      : "dry-run";

console.log(`[Laundry Farm Attribution Migration] Mode: ${mode.toUpperCase()}`);

const conn = await mysql.createConnection(connectionUrl);

async function getCounts() {
  const [cleancloudOrdersDefault] = await conn.execute(
    "SELECT COUNT(*) AS count FROM cleancloud_paid_orders WHERE tenantId = 'default'"
  );
  const [cleancloudOrdersFarm] = await conn.execute(
    "SELECT COUNT(*) AS count FROM cleancloud_paid_orders WHERE tenantId = 'laundry_farm'"
  );

  const [cadenceOrdersDefault] = await conn.execute(
    "SELECT COUNT(*) AS count FROM orders WHERE residentClientRequestId LIKE 'goldline:cadence:%' AND tenantId = 'default'"
  );
  const [cadenceOrdersFarm] = await conn.execute(
    "SELECT COUNT(*) AS count FROM orders WHERE residentClientRequestId LIKE 'goldline:cadence:%' AND tenantId = 'laundry_farm'"
  );

  const [nativeStripeOrdersDefault] = await conn.execute(
    "SELECT COUNT(*) AS count FROM orders WHERE residentClientRequestId NOT LIKE 'goldline:cadence:%' AND tenantId = 'default'"
  );
  const [order707] = await conn.execute(
    "SELECT id, tenantId, firstName, lastName, paid, total FROM orders WHERE id = 707"
  );

  const [bindingsDefault] = await conn.execute(
    "SELECT * FROM cleancloud_browser_sync_bindings WHERE tenantId = 'default'"
  );
  const [bindingsFarm] = await conn.execute(
    "SELECT * FROM cleancloud_browser_sync_bindings WHERE tenantId = 'laundry_farm'"
  );

  const [commercialDefault] = await conn.execute(
    "SELECT id, identityKey, name FROM commercial_accounts WHERE id IN (3, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17) AND tenantId = 'default'"
  );
  const [commercialFarm] = await conn.execute(
    "SELECT id, identityKey, name FROM commercial_accounts WHERE tenantId = 'laundry_farm'"
  );

  const [goalRunsDefault] = await conn.execute(
    "SELECT id, tenantId, metricKey, status FROM macro_goal_runs WHERE (id LIKE '9e7dd9ae%' OR metricKey = 'active_customers_50') AND tenantId = 'default'"
  );
  const [goalRunsFarm] = await conn.execute(
    "SELECT id, tenantId, metricKey, status FROM macro_goal_runs WHERE (id LIKE '9e7dd9ae%' OR metricKey = 'active_customers_50') AND tenantId = 'laundry_farm'"
  );

  const [recoveryObligationsDefault] = await conn.execute(
    "SELECT COUNT(*) AS count FROM claire_proactive_obligations WHERE tenantId = 'default' AND (kind = 'dormant_recovery' OR subjectKey LIKE 'cleancloud:%')"
  );
  const [recoveryObligationsFarm] = await conn.execute(
    "SELECT COUNT(*) AS count FROM claire_proactive_obligations WHERE tenantId = 'laundry_farm' AND (kind = 'dormant_recovery' OR subjectKey LIKE 'cleancloud:%')"
  );

  return {
    cleancloudOrders: { default: cleancloudOrdersDefault[0].count, laundry_farm: cleancloudOrdersFarm[0].count },
    cadenceOrders: { default: cadenceOrdersDefault[0].count, laundry_farm: cadenceOrdersFarm[0].count },
    nativeStripeOrdersDefault: nativeStripeOrdersDefault[0].count,
    order707: order707[0] || null,
    bindings: { default: bindingsDefault, laundry_farm: bindingsFarm },
    commercial: { default: commercialDefault, laundry_farm: commercialFarm },
    goalRuns: { default: goalRunsDefault, laundry_farm: goalRunsFarm },
    recoveryObligations: { default: recoveryObligationsDefault[0].count, laundry_farm: recoveryObligationsFarm[0].count },
  };
}

const before = await getCounts();
console.log("Current Database Attribution State:", JSON.stringify(before, null, 2));

if (mode === "dry-run") {
  console.log("\n[DRY RUN COMPLETE] No data was modified. Use --execute to apply changes.");
  await conn.end();
  process.exit(0);
}

if (mode === "verify") {
  console.log("\n[VERIFICATION AUDIT]");
  console.log(`- CleanCloud paid orders in laundry_farm: ${before.cleancloudOrders.laundry_farm}`);
  console.log(`- Cadence orders in laundry_farm: ${before.cadenceOrders.laundry_farm}`);
  console.log(`- Native Stripe orders preserved in default: ${before.nativeStripeOrdersDefault}`);
  console.log(`- Order #707 preserved in default: ${before.order707?.tenantId === "default" ? "YES" : "NO"}`);
  console.log(`- Store #34145 bound to laundry_farm: ${before.bindings.laundry_farm.some(b => b.storeId === "34145") ? "YES" : "NO"}`);
  console.log(`- Commercial accounts in laundry_farm: ${before.commercial.laundry_farm.length}`);
  console.log(`- 50-active-customer goal run in laundry_farm: ${before.goalRuns.laundry_farm.length > 0 ? "YES" : "NO"}`);
  console.log(`- CleanCloud recovery obligations in laundry_farm: ${before.recoveryObligations.laundry_farm}`);
  await conn.end();
  process.exit(0);
}

if (mode === "execute") {
  console.log("\nApplying Laundry Farm data reattribution...");

  // 1. CleanCloud Store #34145 browser sync binding
  await conn.execute(`
    INSERT INTO cleancloud_browser_sync_bindings (tenantId, id, storeId, storeLabel, createdBy, createdAt, lastSuccessAt)
    SELECT 'laundry_farm', id, storeId, storeLabel, createdBy, createdAt, lastSuccessAt
    FROM cleancloud_browser_sync_bindings
    WHERE storeId = '34145' AND tenantId = 'default'
    ON DUPLICATE KEY UPDATE storeLabel = VALUES(storeLabel), lastSuccessAt = VALUES(lastSuccessAt)
  `);
  await conn.execute("DELETE FROM cleancloud_browser_sync_bindings WHERE storeId = '34145' AND tenantId = 'default'");
  await conn.execute("UPDATE cleancloud_browser_sync_receipts SET tenantId = 'laundry_farm' WHERE storeId = '34145' AND tenantId = 'default'");
  await conn.execute("UPDATE cleancloud_browser_sync_attempts SET tenantId = 'laundry_farm' WHERE tenantId = 'default'");

  // 2. CleanCloud paid orders
  const [ccRes] = await conn.execute("UPDATE cleancloud_paid_orders SET tenantId = 'laundry_farm' WHERE tenantId = 'default'");
  console.log(`- Reassigned ${ccRes.affectedRows} CleanCloud paid orders to laundry_farm`);

  // 3. Cadence orders in orders table (preserving Stripe orders)
  const [cadenceRes] = await conn.execute(
    "UPDATE orders SET tenantId = 'laundry_farm' WHERE residentClientRequestId LIKE 'goldline:cadence:%' AND tenantId = 'default'"
  );
  console.log(`- Reassigned ${cadenceRes.affectedRows} cadence orders to laundry_farm`);

  // 4. 50-active-customer goal lineage
  const [runs] = await conn.execute(
    "SELECT id, macroGoalId FROM macro_goal_runs WHERE (id LIKE '9e7dd9ae%' OR metricKey = 'active_customers_50' OR goalSnapshotJson LIKE '%50%') AND tenantId IN ('default', 'laundry_farm') ORDER BY createdAt DESC LIMIT 1"
  );
  if (runs.length > 0) {
    const goalRunId = runs[0].id;
    const macroGoalId = runs[0].macroGoalId;
    console.log(`- Migrating lineage for goal run ${goalRunId} (macroGoal: ${macroGoalId})...`);

    await conn.execute("UPDATE macro_goal_runs SET tenantId = 'laundry_farm' WHERE id = ? AND tenantId = 'default'", [goalRunId]);
    await conn.execute("UPDATE operator_macro_goals SET tenantId = 'laundry_farm' WHERE id = ? AND tenantId = 'default'", [macroGoalId]);
    await conn.execute("UPDATE goal_cycle_requests SET tenantId = 'laundry_farm' WHERE goalRunId = ? AND tenantId = 'default'", [goalRunId]);
    await conn.execute("UPDATE goal_cycle_decisions SET tenantId = 'laundry_farm' WHERE goalRunId = ? AND tenantId = 'default'", [goalRunId]);
    await conn.execute("UPDATE goal_cycle_objectives SET tenantId = 'laundry_farm' WHERE goalRunId = ? AND tenantId = 'default'", [goalRunId]);
    await conn.execute("UPDATE goal_cycle_outcomes SET tenantId = 'laundry_farm' WHERE goalRunId = ? AND tenantId = 'default'", [goalRunId]);
    await conn.execute("UPDATE goal_cycle_learned_deltas SET tenantId = 'laundry_farm' WHERE goalRunId = ? AND tenantId = 'default'", [goalRunId]);
    await conn.execute("UPDATE goal_cycle_history SET tenantId = 'laundry_farm' WHERE goalRunId = ? AND tenantId = 'default'", [goalRunId]);
    await conn.execute("UPDATE goal_cycle_dead_letters SET tenantId = 'laundry_farm' WHERE goalRunId = ? AND tenantId = 'default'", [goalRunId]);
    await conn.execute(
      "UPDATE work_threads SET tenantId = 'laundry_farm' WHERE (firstSourceRef LIKE ? OR opportunityJson LIKE '%cleancloud%' OR title LIKE '%CleanCloud%') AND tenantId = 'default'",
      [`%${goalRunId}%`]
    );
  }

  // 5. 16 CleanCloud recovery obligations
  const [obRes] = await conn.execute(`
    UPDATE claire_proactive_obligations
    SET tenantId = 'laundry_farm',
        status = 'scheduled',
        payloadJson = JSON_SET(payloadJson, '$.draft', NULL)
    WHERE tenantId = 'default'
      AND (kind = 'dormant_recovery' OR subjectKey LIKE 'cleancloud:%' OR payloadJson LIKE '%CleanCloud%')
  `);
  console.log(`- Reassigned and sanitized ${obRes.affectedRows} CleanCloud recovery obligations`);

  // 6. Replicate commercial accounts (IDs 3, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17)
  await conn.execute(`
    INSERT INTO commercial_accounts (tenantId, identityKey, name, accountType, providerName, providerAccountId, website)
    SELECT 'laundry_farm', CONCAT('farm:', COALESCE(identityKey, id)), name, accountType, providerName, providerAccountId, website
    FROM commercial_accounts
    WHERE id IN (3, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17) AND tenantId = 'default'
    ON DUPLICATE KEY UPDATE name = VALUES(name)
  `);

  await conn.execute(`
    INSERT INTO commercial_account_locations (tenantId, accountId, locationKey, label, address, latitude, longitude, isPrimary)
    SELECT 'laundry_farm', ca_farm.id, cal.locationKey, cal.label, cal.address, cal.latitude, cal.longitude, cal.isPrimary
    FROM commercial_account_locations cal
    JOIN commercial_accounts ca_default ON cal.accountId = ca_default.id AND cal.tenantId = 'default'
    JOIN commercial_accounts ca_farm ON ca_farm.tenantId = 'laundry_farm'
      AND ca_farm.identityKey = CONCAT('farm:', COALESCE(ca_default.identityKey, ca_default.id))
    WHERE ca_default.id IN (3, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17)
    ON DUPLICATE KEY UPDATE label = VALUES(label)
  `);

  await conn.execute(`
    INSERT INTO commercial_account_contacts (tenantId, accountId, contactKey, name, title, email, phone, relationshipType)
    SELECT 'laundry_farm', ca_farm.id, cac.contactKey, cac.name, cac.title, cac.email, cac.phone, cac.relationshipType
    FROM commercial_account_contacts cac
    JOIN commercial_accounts ca_default ON cac.accountId = ca_default.id AND cac.tenantId = 'default'
    JOIN commercial_accounts ca_farm ON ca_farm.tenantId = 'laundry_farm'
      AND ca_farm.identityKey = CONCAT('farm:', COALESCE(ca_default.identityKey, ca_default.id))
    WHERE ca_default.id IN (3, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17)
    ON DUPLICATE KEY UPDATE name = VALUES(name)
  `);
  console.log("- Replicated commercial accounts and associations to laundry_farm");

  const after = await getCounts();
  console.log("\nPost-Migration Attribution State:", JSON.stringify(after, null, 2));
}

if (mode === "rollback") {
  console.log("\nRolling back Laundry Farm data reattribution...");
  // Reassign CleanCloud paid orders back to default
  await conn.execute("UPDATE cleancloud_paid_orders SET tenantId = 'default' WHERE tenantId = 'laundry_farm'");
  // Reassign cadence orders back to default
  await conn.execute("UPDATE orders SET tenantId = 'default' WHERE residentClientRequestId LIKE 'goldline:cadence:%' AND tenantId = 'laundry_farm'");
  // Move binding back
  await conn.execute(`
    INSERT INTO cleancloud_browser_sync_bindings (tenantId, id, storeId, storeLabel, createdBy, createdAt, lastSuccessAt)
    SELECT 'default', id, storeId, storeLabel, createdBy, createdAt, lastSuccessAt
    FROM cleancloud_browser_sync_bindings
    WHERE storeId = '34145' AND tenantId = 'laundry_farm'
    ON DUPLICATE KEY UPDATE storeLabel = VALUES(storeLabel), lastSuccessAt = VALUES(lastSuccessAt)
  `);
  await conn.execute("DELETE FROM cleancloud_browser_sync_bindings WHERE storeId = '34145' AND tenantId = 'laundry_farm'");
  // Delete replicated accounts
  await conn.execute("DELETE FROM commercial_account_contacts WHERE tenantId = 'laundry_farm'");
  await conn.execute("DELETE FROM commercial_account_locations WHERE tenantId = 'laundry_farm'");
  await conn.execute("DELETE FROM commercial_accounts WHERE tenantId = 'laundry_farm'");
  // Move goal lineage back
  const [runs] = await conn.execute(
    "SELECT id, macroGoalId FROM macro_goal_runs WHERE (id LIKE '9e7dd9ae%' OR metricKey = 'active_customers_50') AND tenantId IN ('default', 'laundry_farm') ORDER BY createdAt DESC LIMIT 1"
  );
  if (runs.length > 0) {
    const goalRunId = runs[0].id;
    const macroGoalId = runs[0].macroGoalId;
    await conn.execute("UPDATE macro_goal_runs SET tenantId = 'default' WHERE id = ?", [goalRunId]);
    await conn.execute("UPDATE operator_macro_goals SET tenantId = 'default' WHERE id = ?", [macroGoalId]);
    await conn.execute("UPDATE goal_cycle_requests SET tenantId = 'default' WHERE goalRunId = ?", [goalRunId]);
    await conn.execute("UPDATE goal_cycle_decisions SET tenantId = 'default' WHERE goalRunId = ?", [goalRunId]);
    await conn.execute("UPDATE goal_cycle_objectives SET tenantId = 'default' WHERE goalRunId = ?", [goalRunId]);
    await conn.execute("UPDATE goal_cycle_outcomes SET tenantId = 'default' WHERE goalRunId = ?", [goalRunId]);
    await conn.execute("UPDATE goal_cycle_learned_deltas SET tenantId = 'default' WHERE goalRunId = ?", [goalRunId]);
    await conn.execute("UPDATE goal_cycle_history SET tenantId = 'default' WHERE goalRunId = ?", [goalRunId]);
    await conn.execute("UPDATE goal_cycle_dead_letters SET tenantId = 'default' WHERE goalRunId = ?", [goalRunId]);
    await conn.execute("UPDATE work_threads SET tenantId = 'default' WHERE tenantId = 'laundry_farm'");
    await conn.execute("UPDATE claire_proactive_obligations SET tenantId = 'default' WHERE tenantId = 'laundry_farm'");
  }
  console.log("Rollback completed.");
}

await conn.end();
