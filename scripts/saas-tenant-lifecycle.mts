import { writeFile } from "node:fs/promises";
import {
  deleteTenantData,
  exportTenantData,
  planTenantDeletion,
} from "../server/saas/tenantLifecycle";

const [, , action, tenantId, ...rest] = process.argv;
if (!action || !tenantId) {
  console.error("Usage: pnpm exec tsx scripts/saas-tenant-lifecycle.mts <export|delete-plan|delete> <tenantId> [options]");
  process.exit(2);
}

if (action === "export") {
  const outputFlag = rest.indexOf("--output");
  const output = outputFlag >= 0 ? rest[outputFlag + 1] : null;
  const data = await exportTenantData(tenantId);
  const json = JSON.stringify(data, null, 2);
  if (output) {
    await writeFile(output, json + "\n", { mode: 0o600 });
    console.log(`Tenant export written to ${output}`);
  } else {
    console.log(json);
  }
  process.exit(0);
}

if (action === "delete-plan") {
  console.log(JSON.stringify(await planTenantDeletion(tenantId), null, 2));
  process.exit(0);
}

if (action === "delete") {
  const rowsFlag = rest.indexOf("--expected-rows");
  const confirmFlag = rest.indexOf("--confirm");
  const expectedTotalRows = Number(rowsFlag >= 0 ? rest[rowsFlag + 1] : NaN);
  const confirmation = confirmFlag >= 0 ? rest[confirmFlag + 1] : "";
  if (!Number.isInteger(expectedTotalRows) || expectedTotalRows < 0 || !confirmation) {
    throw new Error("delete requires --expected-rows <dry-run total> --confirm <exact tenant id>");
  }
  const result = await deleteTenantData({
    tenantId,
    expectedTotalRows,
    confirmation,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

throw new Error(`Unknown lifecycle action: ${action}`);
