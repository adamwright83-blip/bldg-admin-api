#!/usr/bin/env node
/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/**
 * Data Migration & Verification Script: Laundry Farm Attribution
 *
 * Attributions:
 * 0. Register Laundry Farm SaaS tenant and operator memberships (0142)
 * 1. Store #34145 CleanCloud browser sync binding -> laundry_farm
 * 2. All CleanCloud paid orders -> laundry_farm
 * 3. All CleanCloud cadence orders in `orders` (goldline:cadence:%) -> laundry_farm
 * 4. 50-active-customer goal lineage (goalRunId: 9e7dd9ae...) -> laundry_farm
 * 5. 16 CleanCloud recovery obligations -> laundry_farm (clearing draft, status = scheduled)
 * 6. Commercial properties (accounts and locations) replicated to laundry_farm
 *    (commercial contacts and customer relationships remain independent)
 * 7. Preserves Order #707 and all native Stripe orders in `default`
 * 8. Preserves accounts 15 and 17 as separate records
 *
 * Usage:
 *   node scripts/migrate-laundry-farm-attribution.mjs --dry-run
 *   node scripts/migrate-laundry-farm-attribution.mjs --execute [--production]
 *   node scripts/migrate-laundry-farm-attribution.mjs --verify
 *   node scripts/migrate-laundry-farm-attribution.mjs --rollback
 */

import mysql from "mysql2/promise";

const connectionUrl = process.env.DATABASE_URL;
if (!connectionUrl) {
  console.error("FATAL: DATABASE_URL environment variable is required. Silent fallback is prohibited.");
  process.exit(1);
}

const args = process.argv.slice(2);
const mode = args.includes("--execute")
  ? "execute"
  : args.includes("--verify")
    ? "verify"
    : args.includes("--rollback")
      ? "rollback"
      : "dry-run";

const BUTLER_TENANT = "default";
const FARM_TENANT = "laundry_farm";

const isProductionTarget =
  connectionUrl.includes("railway") ||
  connectionUrl.includes("rds.amazonaws.com") ||
  connectionUrl.includes("production") ||
  process.env.NODE_ENV === "production";

if (isProductionTarget && mode === "execute" && !args.includes("--production")) {
  console.error("FATAL: Production database detected. You must explicitly supply the --production flag with --execute to apply changes in production.");
  process.exit(1);
}

console.log(`[Laundry Farm Attribution Migration] Mode: ${mode.toUpperCase()}`);

const conn = await mysql.createConnection(connectionUrl);

async function getCounts() {
  const [cleancloudOrdersDefault] = await conn.execute(
    "SELECT COUNT(*) AS count FROM cleancloud_paid_orders WHERE tenantId = ?",
    [BUTLER_TENANT]
  );
  const [cleancloudOrdersFarm] = await conn.execute(
    "SELECT COUNT(*) AS count FROM cleancloud_paid_orders WHERE tenantId = ?",
    [FARM_TENANT]
  );

  const [cadenceOrdersDefault] = await conn.execute(
    "SELECT COUNT(*) AS count FROM orders WHERE residentClientRequestId LIKE 'goldline:cadence:%' AND tenantId = ?",
    [BUTLER_TENANT]
  );
  const [cadenceOrdersFarm] = await conn.execute(
    "SELECT COUNT(*) AS count FROM orders WHERE residentClientRequestId LIKE 'goldline:cadence:%' AND tenantId = ?",
    [FARM_TENANT]
  );

  const [nativeStripeOrdersDefault] = await conn.execute(
    "SELECT COUNT(*) AS count FROM orders WHERE residentClientRequestId NOT LIKE 'goldline:cadence:%' AND tenantId = ?",
    [BUTLER_TENANT]
  );
  const [order707] = await conn.execute(
    "SELECT id, tenantId, firstName, lastName, paid, total FROM orders WHERE id = 707"
  );

  const [bindingsDefault] = await conn.execute(
    "SELECT * FROM cleancloud_browser_sync_bindings WHERE tenantId = ?",
    [BUTLER_TENANT]
  );
  const [bindingsFarm] = await conn.execute(
    "SELECT * FROM cleancloud_browser_sync_bindings WHERE tenantId = ?",
    [FARM_TENANT]
  );

  const [commercialDefault] = await conn.execute(
    "SELECT id, identityKey, name FROM commercial_accounts WHERE tenantId = ?",
    [BUTLER_TENANT]
  );
  const [commercialFarm] = await conn.execute(
    "SELECT id, identityKey, name FROM commercial_accounts WHERE tenantId = ?",
    [FARM_TENANT]
  );

  const [goalRunsDefault] = await conn.execute(
    "SELECT id, tenantId, metricKey, status FROM macro_goal_runs WHERE (id = '9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff' OR metricKey = 'active_customers_50') AND tenantId = ?",
    [BUTLER_TENANT]
  );
  const [goalRunsFarm] = await conn.execute(
    "SELECT id, tenantId, metricKey, status FROM macro_goal_runs WHERE (id = '9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff' OR metricKey = 'active_customers_50') AND tenantId = ?",
    [FARM_TENANT]
  );

  const [recoveryObligationsDefault] = await conn.execute(
    "SELECT COUNT(*) AS count FROM claire_proactive_obligations WHERE tenantId = ? AND (goalRunId = '9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff' OR subjectKey LIKE 'cleancloud:%')",
    [BUTLER_TENANT]
  );
  const [recoveryObligationsFarm] = await conn.execute(
    "SELECT COUNT(*) AS count FROM claire_proactive_obligations WHERE tenantId = ? AND (goalRunId = '9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff' OR subjectKey LIKE 'cleancloud:%')",
    [FARM_TENANT]
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
  const errors = [];

  console.log(`- CleanCloud paid orders in laundry_farm: ${before.cleancloudOrders.laundry_farm}`);
  console.log(`- Cadence orders in laundry_farm: ${before.cadenceOrders.laundry_farm}`);
  console.log(`- Native Stripe orders preserved in default: ${before.nativeStripeOrdersDefault}`);
  console.log(`- Order #707 preserved in default: ${before.order707?.tenantId === BUTLER_TENANT ? "YES" : "NO"}`);
  console.log(`- Store #34145 bound to laundry_farm: ${before.bindings.laundry_farm.some(b => b.storeId === "34145") ? "YES" : "NO"}`);
  console.log(`- Commercial accounts in laundry_farm: ${before.commercial.laundry_farm.length}`);
  console.log(`- 50-active-customer goal run in laundry_farm: ${before.goalRuns.laundry_farm.length > 0 ? "YES" : "NO"}`);
  console.log(`- CleanCloud recovery obligations in laundry_farm: ${before.recoveryObligations.laundry_farm}`);

  if (before.cleancloudOrders.laundry_farm === 0 && before.cleancloudOrders.default > 0) {
    errors.push("CleanCloud paid orders remain in default instead of laundry_farm");
  }
  if (before.cadenceOrders.laundry_farm === 0 && before.cadenceOrders.default > 0) {
    errors.push("Cadence orders remain in default instead of laundry_farm");
  }
  if (before.order707 && before.order707.tenantId !== BUTLER_TENANT) {
    errors.push(`Order #707 incorrectly attributed to ${before.order707.tenantId}`);
  }
  const hasFarmBinding = before.bindings.laundry_farm.some(b => b.storeId === "34145");
  const hasDefaultBinding = before.bindings.default.some(b => b.storeId === "34145");
  if (!hasFarmBinding) {
    errors.push("CleanCloud Store #34145 is NOT bound to laundry_farm");
  }
  if (hasDefaultBinding) {
    errors.push("CleanCloud Store #34145 remains bound to default");
  }
  if (before.goalRuns.laundry_farm.length === 0 && before.goalRuns.default.length > 0) {
    errors.push("50-active-customer goal run remains in default");
  }
  const [farmTenant] = await conn.execute("SELECT id FROM dayforge_saas_tenants WHERE id = ?", [FARM_TENANT]);
  if (farmTenant.length === 0) {
    errors.push("Tenant laundry_farm does not exist in dayforge_saas_tenants");
  }
  const [adamMemberships] = await conn.execute(
    "SELECT tenantId FROM dayforge_saas_memberships WHERE userOpenId = 'adam-admin' AND active = 1"
  );
  const adamTenantIds = adamMemberships.map(r => r.tenantId);
  if (!adamTenantIds.includes(BUTLER_TENANT)) {
    errors.push("adam-admin missing active membership for default");
  }
  if (!adamTenantIds.includes(FARM_TENANT)) {
    errors.push("adam-admin missing active membership for laundry_farm");
  }
  if (before.commercial.default.length > 0 && before.commercial.laundry_farm.length === 0) {
    errors.push("Commercial accounts exist in default but none were provisioned in laundry_farm");
  }

  if (errors.length > 0) {
    console.error(`\n❌ VERIFICATION FAILED (${errors.length} invariant violations):`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    await conn.end();
    process.exit(1);
  }

  console.log("\n✅ ALL ATTRIBUTION INVARIANTS VERIFIED SUCCESSFULLY.");
  await conn.end();
  process.exit(0);
}

if (mode === "execute") {
  console.log("\nApplying Laundry Farm data reattribution in transaction...");
  await conn.beginTransaction();

  try {
    // Checkpoint 0: Audit log table for migration tracking
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS _migration_laundry_farm_attribution_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tableName VARCHAR(64) NOT NULL,
        recordId VARCHAR(64) NOT NULL,
        action VARCHAR(32) NOT NULL,
        fromTenant VARCHAR(64) NOT NULL,
        toTenant VARCHAR(64) NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 0. Register laundry_farm SaaS tenant and operator memberships (0142)
    await conn.execute(`
      INSERT INTO dayforge_saas_tenants (
        id, slug, businessName, brandName, logoUrl, primaryColor,
        contactName, contactEmail, contactPhone, website, timeZone,
        status, onboardingStep, strategyVerticalKey
      ) VALUES (
        ?, 'laundry-farm', 'Laundry Farm', 'Laundry Farm',
        'https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/TnWYaeVttBiuZTNp.png',
        '#1B4D3E', 'Adam Wright', 'support@laundryfarm.com', '(424) 394-0344',
        'https://laundryfarm.com', 'America/Los_Angeles', 'active', 'complete', 'laundry_fluff_fold'
      ) ON DUPLICATE KEY UPDATE businessName = VALUES(businessName)
    `, [FARM_TENANT]);

    await conn.execute(`
      INSERT INTO dayforge_saas_tenants (
        id, slug, businessName, brandName, logoUrl, primaryColor,
        contactName, contactEmail, contactPhone, website, timeZone,
        status, onboardingStep, strategyVerticalKey
      ) VALUES (
        ?, 'laundry-butler', 'Laundry Butler', 'Laundry Butler', NULL,
        '#2563EB', 'Adam Wright', 'adam@laundrybutler.com', '(310) 906-8968',
        'https://laundrybutler.com', 'America/Los_Angeles', 'active', 'complete', 'laundry_fluff_fold'
      ) ON DUPLICATE KEY UPDATE businessName = VALUES(businessName)
    `, [BUTLER_TENANT]);

    await conn.execute(`
      INSERT INTO dayforge_saas_memberships (tenantId, userOpenId, role, active)
      VALUES (?, 'adam-admin', 'owner', 1)
      ON DUPLICATE KEY UPDATE role = VALUES(role), active = 1
    `, [FARM_TENANT]);

    await conn.execute(`
      INSERT INTO dayforge_saas_memberships (tenantId, userOpenId, role, active)
      VALUES (?, 'adam-admin', 'owner', 1)
      ON DUPLICATE KEY UPDATE role = VALUES(role), active = 1
    `, [BUTLER_TENANT]);
    console.log("- Ensured Laundry Farm and Laundry Butler SaaS tenants and operator memberships exist");

    // 1. CleanCloud Store #34145 browser sync binding
    await conn.execute(`
      INSERT INTO cleancloud_browser_sync_bindings (tenantId, id, storeId, storeLabel, createdBy, createdAt, lastSuccessAt)
      SELECT ?, id, storeId, storeLabel, createdBy, createdAt, lastSuccessAt
      FROM cleancloud_browser_sync_bindings
      WHERE storeId = '34145' AND tenantId = ?
      ON DUPLICATE KEY UPDATE storeLabel = VALUES(storeLabel), lastSuccessAt = VALUES(lastSuccessAt)
    `, [FARM_TENANT, BUTLER_TENANT]);
    await conn.execute(`
      INSERT INTO cleancloud_browser_sync_bindings (tenantId, id, storeId, storeLabel, createdBy, createdAt)
      VALUES (?, '34145-farm-binding', '34145', 'Laundry Farm CleanCloud Store', 'adam-admin', NOW())
      ON DUPLICATE KEY UPDATE storeId = VALUES(storeId)
    `, [FARM_TENANT]);
    await conn.execute("DELETE FROM cleancloud_browser_sync_bindings WHERE storeId = '34145' AND tenantId = ?", [BUTLER_TENANT]);
    await conn.execute("UPDATE cleancloud_browser_sync_receipts SET tenantId = ? WHERE storeId = '34145' AND tenantId = ?", [FARM_TENANT, BUTLER_TENANT]);
    await conn.execute("UPDATE cleancloud_browser_sync_attempts SET tenantId = ? WHERE tenantId = ?", [FARM_TENANT, BUTLER_TENANT]);

    // 2. CleanCloud paid orders
    const [ccRes] = await conn.execute("UPDATE cleancloud_paid_orders SET tenantId = ? WHERE tenantId = ?", [FARM_TENANT, BUTLER_TENANT]);
    console.log(`- Reassigned ${ccRes.affectedRows} CleanCloud paid orders to laundry_farm`);

    // 3. Cadence orders in orders table (preserving Stripe orders)
    const [cadenceRes] = await conn.execute(
      "UPDATE orders SET tenantId = ? WHERE residentClientRequestId LIKE 'goldline:cadence:%' AND tenantId = ?",
      [FARM_TENANT, BUTLER_TENANT]
    );
    console.log(`- Reassigned ${cadenceRes.affectedRows} cadence orders to laundry_farm`);

    // 4. 50-active-customer goal lineage (authoritative ID)
    const exactGoalRunId = "9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff";
    const [runs] = await conn.execute(
      "SELECT id, macroGoalId FROM macro_goal_runs WHERE (id = ? OR metricKey = 'active_customers_50') AND tenantId IN (?, ?) ORDER BY createdAt DESC LIMIT 1",
      [exactGoalRunId, BUTLER_TENANT, FARM_TENANT]
    );
    if (runs.length > 0) {
      const goalRunId = runs[0].id;
      const macroGoalId = runs[0].macroGoalId;
      console.log(`- Migrating lineage for goal run ${goalRunId} (macroGoal: ${macroGoalId})...`);

      await conn.execute("UPDATE macro_goal_runs SET tenantId = ? WHERE id = ? AND tenantId = ?", [FARM_TENANT, goalRunId, BUTLER_TENANT]);
      await conn.execute("UPDATE operator_macro_goals SET tenantId = ? WHERE (id = ? OR metricKey = 'active_customers_50') AND tenantId = ?", [FARM_TENANT, macroGoalId, BUTLER_TENANT]);
      await conn.execute("UPDATE goal_cycle_requests SET tenantId = ? WHERE goalRunId = ? AND tenantId = ?", [FARM_TENANT, goalRunId, BUTLER_TENANT]);
      await conn.execute("UPDATE goal_cycle_decisions SET tenantId = ? WHERE goalRunId = ? AND tenantId = ?", [FARM_TENANT, goalRunId, BUTLER_TENANT]);
      await conn.execute("UPDATE goal_cycle_objectives SET tenantId = ? WHERE goalRunId = ? AND tenantId = ?", [FARM_TENANT, goalRunId, BUTLER_TENANT]);
      await conn.execute("UPDATE goal_cycle_outcomes SET tenantId = ? WHERE goalRunId = ? AND tenantId = ?", [FARM_TENANT, goalRunId, BUTLER_TENANT]);
      await conn.execute("UPDATE goal_cycle_learned_deltas SET tenantId = ? WHERE goalRunId = ? AND tenantId = ?", [FARM_TENANT, goalRunId, BUTLER_TENANT]);
      await conn.execute("UPDATE goal_cycle_history SET tenantId = ? WHERE goalRunId = ? AND tenantId = ?", [FARM_TENANT, goalRunId, BUTLER_TENANT]);
      await conn.execute("UPDATE goal_cycle_dead_letters SET tenantId = ? WHERE goalRunId = ? AND tenantId = ?", [FARM_TENANT, goalRunId, BUTLER_TENANT]);
      await conn.execute(
        "UPDATE work_threads SET tenantId = ? WHERE (firstSourceRef LIKE ? OR opportunityKey LIKE 'cleancloud:%') AND tenantId = ?",
        [FARM_TENANT, `%${goalRunId}%`, BUTLER_TENANT]
      );
    }

    // 5. 16 CleanCloud recovery obligations
    const [obRes] = await conn.execute(`
      UPDATE claire_proactive_obligations
      SET tenantId = ?,
          status = 'scheduled',
          payloadJson = JSON_SET(payloadJson, '$.draft', NULL)
      WHERE tenantId = ?
        AND (goalRunId = ? OR subjectKey LIKE 'cleancloud:%')
    `, [FARM_TENANT, BUTLER_TENANT, exactGoalRunId]);
    console.log(`- Reassigned and sanitized ${obRes.affectedRows} CleanCloud recovery obligations`);

    // 6. Replicate commercial accounts and locations (shared-property provisioning without contact replication)
    await conn.execute(`
      INSERT INTO commercial_accounts (tenantId, identityKey, name, accountType, providerName, providerAccountId, website)
      SELECT ?, identityKey, name, accountType, providerName, providerAccountId, website
      FROM commercial_accounts
      WHERE tenantId = ? AND identityKey IS NOT NULL
      ON DUPLICATE KEY UPDATE name = VALUES(name)
    `, [FARM_TENANT, BUTLER_TENANT]);

    await conn.execute(`
      INSERT INTO commercial_account_locations (tenantId, accountId, locationKey, label, address, latitude, longitude, isPrimary)
      SELECT ?, ca_farm.id, cal.locationKey, cal.label, cal.address, cal.latitude, cal.longitude, cal.isPrimary
      FROM commercial_account_locations cal
      JOIN commercial_accounts ca_default ON cal.accountId = ca_default.id AND cal.tenantId = ?
      JOIN commercial_accounts ca_farm ON ca_farm.tenantId = ?
        AND ca_farm.identityKey = ca_default.identityKey
      WHERE ca_default.tenantId = ?
      ON DUPLICATE KEY UPDATE label = VALUES(label)
    `, [FARM_TENANT, BUTLER_TENANT, FARM_TENANT, BUTLER_TENANT]);
    console.log("- Replicated commercial accounts and locations to laundry_farm (contacts remain independent)");

    await conn.commit();
    console.log("Migration transaction committed successfully.");

    const after = await getCounts();
    console.log("\nPost-Migration Attribution State:", JSON.stringify(after, null, 2));
  } catch (err) {
    await conn.rollback();
    console.error("Migration failed, transaction rolled back:", err);
    throw err;
  }
}

if (mode === "rollback") {
  console.log("\nRolling back Laundry Farm data reattribution...");
  const exactGoalRunId = "9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff";

  // Check for any subsequent pipeline/contract records on the migrated accounts
  const [activePipelines] = await conn.execute(`
    SELECT COUNT(*) AS count
    FROM commercial_pipeline_records cpr
    JOIN commercial_accounts ca_farm ON cpr.accountId = ca_farm.id AND cpr.tenantId = ca_farm.tenantId
    JOIN commercial_accounts ca_default ON ca_farm.identityKey = ca_default.identityKey AND ca_default.tenantId = ?
    WHERE ca_farm.tenantId = ?
  `, [BUTLER_TENANT, FARM_TENANT]);
  if (activePipelines[0].count > 0) {
    throw new Error(`Rollback blocked: ${activePipelines[0].count} commercial pipeline records exist for migrated accounts.`);
  }

  // Check for legitimate Farm contacts
  const [farmContacts] = await conn.execute(`
    SELECT COUNT(*) AS count
    FROM commercial_account_contacts
    WHERE tenantId = ?
  `, [FARM_TENANT]);
  if (farmContacts[0].count > 0) {
    throw new Error(`Rollback blocked: ${farmContacts[0].count} legitimate commercial contacts exist in laundry_farm.`);
  }

  // Check for legitimate Farm native orders
  const [farmNativeOrders] = await conn.execute(`
    SELECT COUNT(*) AS count
    FROM orders
    WHERE tenantId = ? AND residentClientRequestId NOT LIKE 'goldline:cadence:%'
  `, [FARM_TENANT]);
  if (farmNativeOrders[0].count > 0) {
    throw new Error(`Rollback blocked: ${farmNativeOrders[0].count} legitimate native orders exist in laundry_farm.`);
  }

  await conn.beginTransaction();
  try {
    // Reassign CleanCloud paid orders back to default
    await conn.execute("UPDATE cleancloud_paid_orders SET tenantId = ? WHERE tenantId = ?", [BUTLER_TENANT, FARM_TENANT]);
    // Reassign cadence orders back to default
    await conn.execute("UPDATE orders SET tenantId = ? WHERE residentClientRequestId LIKE 'goldline:cadence:%' AND tenantId = ?", [BUTLER_TENANT, FARM_TENANT]);
    // Move binding back
    await conn.execute(`
      INSERT INTO cleancloud_browser_sync_bindings (tenantId, id, storeId, storeLabel, createdBy, createdAt, lastSuccessAt)
      SELECT ?, id, storeId, storeLabel, createdBy, createdAt, lastSuccessAt
      FROM cleancloud_browser_sync_bindings
      WHERE storeId = '34145' AND tenantId = ?
      ON DUPLICATE KEY UPDATE storeLabel = VALUES(storeLabel), lastSuccessAt = VALUES(lastSuccessAt)
    `, [BUTLER_TENANT, FARM_TENANT]);
    await conn.execute("DELETE FROM cleancloud_browser_sync_bindings WHERE storeId = '34145' AND tenantId = ?", [FARM_TENANT]);

    // Scoped deletion: only remove accounts and locations in laundry_farm that match accounts replicated from default
    await conn.execute(`
      DELETE cal FROM commercial_account_locations cal
      JOIN commercial_accounts ca_farm ON cal.accountId = ca_farm.id AND cal.tenantId = ca_farm.tenantId
      JOIN commercial_accounts ca_default ON ca_farm.identityKey = ca_default.identityKey AND ca_default.tenantId = ?
      WHERE ca_farm.tenantId = ?
    `, [BUTLER_TENANT, FARM_TENANT]);
    await conn.execute(`
      DELETE ca_farm FROM commercial_accounts ca_farm
      JOIN commercial_accounts ca_default ON ca_farm.identityKey = ca_default.identityKey AND ca_default.tenantId = ?
      WHERE ca_farm.tenantId = ?
    `, [BUTLER_TENANT, FARM_TENANT]);

    // Move goal lineage back
    const [runs] = await conn.execute(
      "SELECT id, macroGoalId FROM macro_goal_runs WHERE (id = ? OR metricKey = 'active_customers_50') AND tenantId IN (?, ?) ORDER BY createdAt DESC LIMIT 1",
      [exactGoalRunId, BUTLER_TENANT, FARM_TENANT]
    );
    if (runs.length > 0) {
      const goalRunId = runs[0].id;
      const macroGoalId = runs[0].macroGoalId;
      await conn.execute("UPDATE macro_goal_runs SET tenantId = ? WHERE id = ?", [BUTLER_TENANT, goalRunId]);
      await conn.execute("UPDATE operator_macro_goals SET tenantId = ? WHERE (id = ? OR metricKey = 'active_customers_50')", [BUTLER_TENANT, macroGoalId]);
      await conn.execute("UPDATE goal_cycle_requests SET tenantId = ? WHERE goalRunId = ?", [BUTLER_TENANT, goalRunId]);
      await conn.execute("UPDATE goal_cycle_decisions SET tenantId = ? WHERE goalRunId = ?", [BUTLER_TENANT, goalRunId]);
      await conn.execute("UPDATE goal_cycle_objectives SET tenantId = ? WHERE goalRunId = ?", [BUTLER_TENANT, goalRunId]);
      await conn.execute("UPDATE goal_cycle_outcomes SET tenantId = ? WHERE goalRunId = ?", [BUTLER_TENANT, goalRunId]);
      await conn.execute("UPDATE goal_cycle_learned_deltas SET tenantId = ? WHERE goalRunId = ?", [BUTLER_TENANT, goalRunId]);
      await conn.execute("UPDATE goal_cycle_history SET tenantId = ? WHERE goalRunId = ?", [BUTLER_TENANT, goalRunId]);
      await conn.execute("UPDATE goal_cycle_dead_letters SET tenantId = ? WHERE goalRunId = ?", [BUTLER_TENANT, goalRunId]);
      await conn.execute("UPDATE work_threads SET tenantId = ? WHERE firstSourceRef LIKE ? OR opportunityKey LIKE 'cleancloud:%'", [BUTLER_TENANT, `%${goalRunId}%`]);
      await conn.execute("UPDATE claire_proactive_obligations SET tenantId = ? WHERE goalRunId = ? OR subjectKey LIKE 'cleancloud:%'", [BUTLER_TENANT, goalRunId]);
    }
    await conn.commit();
    console.log("Rollback transaction completed successfully.");
  } catch (err) {
    await conn.rollback();
    console.error("Rollback failed, transaction rolled back:", err);
    throw err;
  }
}

await conn.end();
