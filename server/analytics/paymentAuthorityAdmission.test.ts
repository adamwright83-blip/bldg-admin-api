import { afterEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { readCanonicalRevenue } from "./canonicalRevenue";
import {
  loadPaidOrderLedger,
  type LedgerLoaders,
  type NativeOrderRow,
  type CleanCloudOrderRow,
} from "./paidOrderLedger";
import { provenBusinessCoverageSnapshot } from "./businessLedgerFixture";
import {
  readPaymentAuthorityReceipts,
  type AuthorityReceipt,
  type PaymentAuthorityExpectation,
} from "../platform/authority/authorityReceipt";
import {
  readCleanCloudPaidObservationReceipts,
  type CleanCloudPaidObservationExpectation,
} from "../cleancloudPaidEvidence";
import { resetDbForTesting, setDbForTesting } from "../db";
import { getRevenueSummary } from "./analyticsQueries";

const tenantId = "tenant-a",
  timeZone = "America/Los_Angeles";
const now = new Date("2026-10-05T19:00:00Z");
const period = { from: "2026-09-25", to: "2026-10-05" };
const native: NativeOrderRow = {
  id: 701,
  paid: true,
  total: "85.80",
  paidAt: now,
  stripePaymentIntentId: "pi_701",
  serviceType: null,
  firstName: null,
  lastName: null,
  phone: null,
  email: null,
  bldgUserId: null,
};
const cloud: CleanCloudOrderRow = {
  importBatchId: 7,
  cleancloudOrderId: "603",
  cleancloudCustomerId: null,
  sourceReportType: "orders_sales",
  paid: true,
  totalCents: 73739,
  paymentDateUtc: now,
  paidDateUtc: null,
  customerName: null,
  customerPhone: null,
  customerEmail: null,
};
type EvidenceExpectation =
  | PaymentAuthorityExpectation
  | CleanCloudPaidObservationExpectation;

function receipt(
  expected: EvidenceExpectation,
  extra: Partial<AuthorityReceipt> = {}
): AuthorityReceipt {
  const isCleanCloud = expected.sourceType === "cleancloud_paid_order";
  return {
    ...expected,
    sourceRef: expected.sourceRef!,
    id: `auth-${expected.subjectId}`,
    claimType: isCleanCloud ? "cleancloud_paid_observed" : "payment_verified",
    actorType: "system",
    actorId: null,
    evidenceClass: "authoritative_external",
    verificationClass: "VERIFIED",
    admissionPolicy: isCleanCloud
      ? "cleancloud_paid_observation_v1"
      : "native_stripe_payment_v1",
    occurredAt: now.toISOString(),
    admittedAt: now.toISOString(),
    metadata: isCleanCloud
      ? null
      : {
          capturedAmountCents: 8580,
          capturedCurrency: "usd",
          captureEvidence: "stripe_amount_received_v1",
        },
    idempotencyKey: `fixture:${expected.subjectId}`,
    ...extra,
  };
}
function loaders(
  n: NativeOrderRow[],
  c: CleanCloudOrderRow[],
  proof: (e: EvidenceExpectation) => AuthorityReceipt | null = () => null
): LedgerLoaders {
  return {
    laundry_butler: async () => n,
    cleancloud: async () => c,
    paymentAuthority: vi.fn(async ({ expectations }) =>
      expectations.map(proof).filter((r): r is AuthorityReceipt => r !== null)
    ),
    cleancloudAuthority: vi.fn(async ({ expectations }) =>
      expectations.map(proof).filter((r): r is AuthorityReceipt => r !== null)
    ),
  };
}
const read = (source: LedgerLoaders) =>
  readCanonicalRevenue({
    tenantId,
    ...period,
    timeZone,
    now,
    coverage: provenBusinessCoverageSnapshot(tenantId),
    loaders: source,
  });
afterEach(resetDbForTesting);
describe("canonical payment Authority Receipt admission", () => {
  it("withholds Stripe paid + PaymentIntent without matching receipt, preserving held cents and qualification", async () => {
    expect(await read(loaders([native], []))).toMatchObject({
      status: "ok",
      recordedCents: 0,
      statedExactCents: null,
      precision: "recorded_only",
      exactIncludedOrderCount: 0,
      unverifiedPaymentAuthority: { count: 1, cents: 8580 },
    });
  });
  it("keeps an admitted payment amount unknown without provider capture metadata", async () => {
    const result = await read(
      loaders([native], [], e => receipt(e, { metadata: null }))
    );
    expect(result).toMatchObject({
      recordedCents: 0,
      statedExactCents: null,
      precision: "recorded_only",
      exactIncludedOrderCount: 0,
    });
  });
  it("admits matching Stripe proof and retains its receipt provenance", async () => {
    const result = await read(loaders([native], [], e => receipt(e)));
    expect(result).toMatchObject({
      status: "ok",
      recordedCents: 8580,
      precision: "exact",
      exactIncludedOrderCount: 1,
      includedEvents: [
        {
          eventKey: "order:701",
          authorityReceiptId: "auth-701",
          paymentEvidence: {
            sourceType: "stripe_payment_intent",
            sourceRef: "pi_701",
          },
        },
      ],
    });
  });
  it.each([
    { sourceRef: "pi_other" },
    { sourceType: "cleancloud_paid_order" },
    { verificationClass: "ATTESTED" },
    { evidenceClass: "operator_attested" },
  ] as Partial<AuthorityReceipt>[])(
    "rejects wrong Stripe receipt binding or policy %j",
    async extra => {
      expect(
        await read(loaders([native], [], e => receipt(e, extra)))
      ).toMatchObject({
        recordedCents: 0,
        precision: "recorded_only",
        statedExactCents: null,
      });
    }
  );
  it("withholds CleanCloud paid rows without proof", async () => {
    expect(await read(loaders([], [cloud]))).toMatchObject({
      recordedCents: 0,
      precision: "recorded_only",
      statedExactCents: null,
      unverifiedPaymentAuthority: { count: 1, cents: 73739 },
    });
  });
  it("admits selected Sales import proof once despite a Revenue twin from another batch", async () => {
    const source = loaders(
      [],
      [
        cloud,
        {
          ...cloud,
          importBatchId: 8,
          sourceReportType: "orders_revenue",
          paymentDateUtc: null,
          paidDateUtc: now,
        },
      ],
      e => receipt(e)
    );
    const result = await read(source);
    expect(result).toMatchObject({
      recordedCents: 73739,
      exactIncludedOrderCount: 1,
      definiteDuplicateExclusions: { count: 1 },
      includedEvents: [
        {
          authorityReceiptId: "auth-603",
          cleancloudEvidence: {
            subjectType: "cleancloud_order",
            sourceType: "cleancloud_paid_order",
            sourceRef: "cleancloud-import:7:603",
          },
        },
      ],
    });
    expect(source.cleancloudAuthority).toHaveBeenCalledTimes(1);
  });
  it.each([
    { sourceType: "stripe_payment_intent" },
    { sourceRef: "cleancloud-import:8:603" },
    { subjectType: "order" },
  ] as Partial<AuthorityReceipt>[])(
    "rejects wrong CleanCloud source/import/subject %j",
    async extra => {
      expect(
        await read(loaders([], [cloud], e => receipt(e, extra)))
      ).toMatchObject({
        recordedCents: 0,
        statedExactCents: null,
        precision: "recorded_only",
      });
    }
  );
  it("does not invent an import reference when selected CleanCloud row has no batch", async () => {
    expect(
      await read(
        loaders([], [{ ...cloud, importBatchId: null }], e =>
          receipt(e, { sourceRef: "cleancloud-import:7:603" })
        )
      )
    ).toMatchObject({ recordedCents: 0, precision: "recorded_only" });
  });
  it("keeps suspected cross-source duplicate withholding unchanged after both proofs pass", async () => {
    expect(
      await read(
        loaders(
          [{ ...native, total: "10.00", phone: "3105550100" }],
          [{ ...cloud, totalCents: 1000, customerPhone: "3105550100" }],
          e =>
            receipt(e, {
              metadata: {
                capturedAmountCents: 1000,
                capturedCurrency: "usd",
                captureEvidence: "stripe_amount_received_v1",
              },
            })
        )
      )
    ).toMatchObject({
      recordedCents: 1000,
      exactIncludedOrderCount: 1,
      suspectedWithheld: { count: 1, cents: 1000 },
      precision: "recorded_only",
    });
  });
  it("rejects another tenant's otherwise matching receipt", async () => {
    expect(
      await read(
        loaders([native], [cloud], e => receipt(e, { tenantId: "tenant-b" }))
      )
    ).toMatchObject({
      recordedCents: 0,
      unverifiedPaymentAuthority: { count: 2, cents: 82319 },
      precision: "recorded_only",
    });
  });
  it("makes an unread Authority Receipt batch unavailable, never an exact zero", async () => {
    const source = loaders([native], [cloud]);
    source.paymentAuthority = async () => {
      throw new Error("receipts unavailable");
    };
    const result = await read(source);
    expect(result).toMatchObject({
      status: "unavailable",
      exactIncludedCents: null,
    });
  });
  it("keeps missing zero-cent proof visible and refuses an exact claim", async () => {
    expect(
      await read(loaders([], [{ ...cloud, totalCents: 0 }]))
    ).toMatchObject({
      recordedCents: 0,
      unverifiedPaymentAuthority: { count: 1, cents: 0 },
      statedExactCents: null,
      precision: "recorded_only",
    });
  });
  it("shares receipt-admitted combined revenue with the existing analytics/Claire read path", async () => {
    const source = loaders([native], [cloud], e => receipt(e));
    const result = await getRevenueSummary(
      tenantId,
      { range: { start: period.from, end: period.to }, groupBy: "day" },
      {
        loadLedger: input => loadPaidOrderLedger(input, source),
        timeZone: () => timeZone,
      } as any
    );
    expect(result).toMatchObject({ totalRevenue: 823.19, orderCount: 2 });
  });
});
describe("bounded existing authority read path", () => {
  it("uses tenant- and claim-scoped SELECT batches instead of querying one receipt per payment", async () => {
    const filters: any[] = [];
    setDbForTesting({
      select: () => ({
        from: () => ({
          where: async (filter: any) => {
            filters.push(new MySqlDialect().sqlToQuery(filter));
            return [];
          },
        }),
      }),
    });
    const paymentExpectations: PaymentAuthorityExpectation[] = Array.from(
      { length: 401 },
      (_, i) => ({
        tenantId,
        subjectType: "order" as const,
        subjectId: String(i),
        sourceType: "stripe_payment_intent" as const,
        sourceRef: `pi_${i}`,
      })
    );
    const cleanCloudExpectations: CleanCloudPaidObservationExpectation[] =
      Array.from({ length: 201 }, (_, i) => ({
        tenantId,
        subjectType: "cleancloud_order" as const,
        subjectId: String(i),
        sourceType: "cleancloud_paid_order" as const,
        sourceRef: `cleancloud-import:7:${i}`,
      }));

    expect(
      await readPaymentAuthorityReceipts({
        tenantId,
        expectations: paymentExpectations,
      })
    ).toEqual([]);
    expect(
      await readCleanCloudPaidObservationReceipts({
        tenantId,
        expectations: cleanCloudExpectations,
      })
    ).toEqual([]);
    expect(filters).toHaveLength(5);
    expect(
      filters
        .slice(0, 3)
        .every(filter => filter.params.includes("payment_verified"))
    ).toBe(true);
    expect(
      filters
        .slice(3)
        .every(filter => filter.params.includes("cleancloud_paid_observed"))
    ).toBe(true);
    for (const filter of filters) {
      expect(filter.params).toContain(tenantId);
      expect(filter.params.length).toBeLessThanOrEqual(203);
    }
  });
  it("rejects mixed tenants and an implicit empty tenant before reading", async () => {
    await expect(
      readPaymentAuthorityReceipts({
        tenantId,
        expectations: [
          {
            tenantId: "tenant-b",
            subjectType: "order",
            subjectId: "7",
            sourceType: "stripe_payment_intent",
            sourceRef: "pi_7",
          },
        ],
      })
    ).rejects.toThrow("crosses tenant");
    await expect(
      readPaymentAuthorityReceipts({ tenantId: "", expectations: [] })
    ).rejects.toThrow("requires tenantId");
    await expect(
      readCleanCloudPaidObservationReceipts({
        tenantId: "",
        expectations: [],
      })
    ).rejects.toThrow("requires explicit tenantId");
  });
});
