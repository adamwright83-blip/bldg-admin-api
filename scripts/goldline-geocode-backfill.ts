import { geocodePendingLocations } from "../server/geography/geographicTruthService";

const tenantId =
  process.argv
    .find(value => value.startsWith("--tenant="))
    ?.slice("--tenant=".length) || "default";
const batchArg = process.argv
  .find(value => value.startsWith("--batch="))
  ?.slice("--batch=".length);
const batchSize = Math.max(1, Math.min(50, Number(batchArg ?? 20) || 20));

const result = await geocodePendingLocations({ tenantId, batchSize });
console.log(JSON.stringify({ tenantId, ...result }, null, 2));
