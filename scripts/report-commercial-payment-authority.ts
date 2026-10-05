import { readCommercialPaymentAuthorityMismatchReport } from "../server/commercialPipeline/commercialPaymentAuthorityReport";

const tenantId = process.argv[2]?.trim();
if (!tenantId) {
  console.error(
    "Usage: pnpm report:commercial-payment-authority -- <tenantId>"
  );
  process.exit(2);
}

const report = await readCommercialPaymentAuthorityMismatchReport(tenantId);
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
