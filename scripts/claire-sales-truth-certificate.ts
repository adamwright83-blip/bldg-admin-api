import { readFileSync } from "node:fs";
import { certifyHistoricalSales } from "../server/analytics/salesTruthCertificate";

const [ordersPath, revenuePath] = process.argv.slice(2);
if (!ordersPath || !revenuePath)
  throw new Error(
    "Usage: tsx scripts/claire-sales-truth-certificate.ts ORDERS_CSV REVENUE_CSV"
  );
const certificate = certifyHistoricalSales({
  ordersCsv: readFileSync(ordersPath, "utf8"),
  revenueCsv: readFileSync(revenuePath, "utf8"),
});
console.log(JSON.stringify(certificate, null, 2));
if (!certificate.passed) process.exitCode = 1;
