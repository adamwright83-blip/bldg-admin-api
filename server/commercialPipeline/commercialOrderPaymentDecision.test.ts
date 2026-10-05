import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  decideCommercialOrderPayment,
  commercialOrderTenantPredicate,
} from "./commercialOrderPaymentDecision";
import {
  attributeCommercialOrder,
  reconcileCommercialPipelineRevenue,
} from "./commercialPipelineService";
import { attributeOrderFromCampaign } from "../commercialCampaigns/commercialAttributionService";

const mocks = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: async () => mocks.db }));
vi.mock("../commercialMissions/commercialMissionStore", () => ({
  getCommercialMission: async () => ({ id: 3 }),
}));
vi.mock("../legacyDayforgeEvents/legacyDayforgeEventStore", () => ({
  writeLegacyDayforgeEventWith: async () => {},
}));
const date = new Date("2026-10-05T00:00:00Z");
const order = {
  id: 101,
  tenantId: "default",
  paid: true,
  stripePaymentIntentId: "pi_paid",
  total: "100.00",
  status: "delivered" as const,
  paidAt: date,
  createdAt: date,
  email: "fixture@example.invalid",
  address: "Fixture",
};
const receipt = {
  id: "proof",
  tenantId: "default",
  claimType: "payment_verified" as const,
  subjectType: "order",
  subjectId: "101",
  sourceType: "stripe_payment_intent",
  sourceRef: "pi_paid",
  actorType: "system",
  actorId: null,
  evidenceClass: "authoritative_external" as const,
  verificationClass: "VERIFIED" as const,
  admissionPolicy: "native_stripe_payment_v1",
  admittedAt: date.toISOString(),
  occurredAt: date.toISOString(),
  metadata: null,
  idempotencyKey: "proof",
};
const projection = {
  tenantId: "default",
  orderId: 101,
  currency: "usd",
  state: "paid" as const,
  capturedCents: 10000,
  refundedCents: 0,
  netPaidCents: 10000,
};
type Facts = Parameters<typeof decideCommercialOrderPayment>[0];
const cases: Array<{
  name: string;
  order?: Partial<Facts["order"]>;
  receipt?: Facts["receipt"];
  projection?: Facts["projection"];
  cents: number;
  status?: string;
}> = [
  { name: "valid captured payment", cents: 10000 },
  { name: "unpaid native order", order: { paid: false }, cents: 0 },
  {
    name: "another tenant native order",
    order: { tenantId: "another" },
    cents: 0,
  },
  {
    name: "projection cancelled",
    projection: { ...projection, state: "cancelled" },
    cents: 0,
    status: "reversed",
  },
  {
    name: "invalid negative net",
    projection: { ...projection, netPaidCents: -1 },
    cents: 0,
    status: "financial_review",
  },
  { name: "paid flag alone", order: { stripePaymentIntentId: null }, cents: 0 },
  { name: "PaymentIntent without receipt", receipt: null, cents: 0 },
  {
    name: "wrong receipt reference",
    receipt: { ...receipt, sourceRef: "pi_other" },
    cents: 0,
  },
  {
    name: "full refund",
    projection: {
      ...projection,
      state: "refunded",
      refundedCents: 10000,
      netPaidCents: 0,
    },
    cents: 0,
    status: "reversed",
  },
  {
    name: "known partial refund",
    projection: {
      ...projection,
      state: "partially_refunded",
      refundedCents: 3000,
      netPaidCents: 7000,
    },
    cents: 7000,
  },
  {
    name: "unknown partial refund net",
    projection: {
      ...projection,
      state: "partially_refunded",
      refundedCents: 3000,
      netPaidCents: null,
    },
    cents: 0,
    status: "financial_review",
  },
  {
    name: "cancelled",
    order: { status: "cancelled" },
    cents: 0,
    status: "reversed",
  },
  {
    name: "another tenant receipt",
    receipt: { ...receipt, tenantId: "another" },
    cents: 0,
  },
  {
    name: "wrong subject",
    receipt: { ...receipt, subjectId: "102" },
    cents: 0,
  },
  {
    name: "CleanCloud receipt on native order",
    receipt: {
      ...receipt,
      sourceType: "cleancloud_paid_order",
      subjectType: "cleancloud_order",
    },
    cents: 0,
  },
  {
    name: "invalid authority policy",
    receipt: { ...receipt, verificationClass: "ATTESTED" },
    cents: 0,
  },
  {
    name: "no projection",
    projection: null,
    cents: 0,
    status: "financial_review",
  },
  {
    name: "projection review",
    projection: { ...projection, state: "review_required" },
    cents: 0,
    status: "financial_review",
  },
  {
    name: "unpaid projection",
    projection: { ...projection, state: "unpaid" },
    cents: 0,
  },
  {
    name: "wrong tenant projection",
    projection: { ...projection, tenantId: "another" },
    cents: 0,
    status: "financial_review",
  },
];
function facts(test: (typeof cases)[number]): Facts {
  return {
    tenantId: "default",
    order: { ...order, ...test.order },
    receipt: test.receipt === undefined ? receipt : test.receipt,
    projection: test.projection === undefined ? projection : test.projection,
  };
}

// Exercise real writers and reconciliation against a transaction fixture; only database I/O is replaced.
function database(
  input: Facts,
  options: { noLink?: boolean; noCustomer?: boolean; conflict?: boolean } = {}
) {
  const rows = new Map<string, any[]>([
    ["orders", [input.order]],
    [
      "authority_receipts",
      input.receipt
        ? [{ ...input.receipt, admittedAt: date, occurredAt: date }]
        : [],
    ],
    ["order_payment_projections", input.projection ? [input.projection] : []],
    [
      "commercial_pipeline_records",
      [
        {
          id: 2,
          tenantId: "default",
          missionId: 3,
          accountId: 4,
          stage: "won",
          commercialCustomerId: 5,
          firstOrderId: null,
          nextFollowUpAt: null,
        },
      ],
    ],
    [
      "commercial_customers",
      options.noCustomer
        ? []
        : [
            {
              id: 5,
              tenantId: "default",
              accountId: 4,
              convertedAt: date,
              createdAt: date,
              updatedAt: date,
            },
          ],
    ],
    [
      "commercial_campaign_links",
      options.noLink
        ? []
        : [
            {
              id: "link",
              tenantId: "default",
              status: "active",
              accountId: 4,
              missionId: 3,
              pipelineId: 2,
            },
          ],
    ],
    [
      "commercial_customer_acquisition_sources",
      [
        {
          id: "source",
          tenantId: "default",
          accountId: options.conflict ? 99 : 4,
          campaignLinkId: "link",
          firstTouchAt: date,
        },
      ],
    ],
    ["commercial_order_attributions", []],
  ]);
  const writes: Array<{ table: string; values: any }> = [];
  const db: any = {
    transaction: async (callback: any) => callback(db),
    select: (fields?: any) => {
      let name = "";
      const q: any = {
        from: (table: any) => {
          name = getTableName(table);
          return q;
        },
        where: () => q,
        limit: () => q,
        for: () => q,
        orderBy: () => q,
        then: (resolve: any, reject: any) =>
          Promise.resolve(
            fields?.invoiced
              ? [
                  {
                    invoiced: 0,
                    paid:
                      rows
                        .get("commercial_order_attributions")
                        ?.reduce((s, r) => s + r.paidCents, 0) ?? 0,
                    realized:
                      rows
                        .get("commercial_order_attributions")
                        ?.reduce((s, r) => s + r.realizedCents, 0) ?? 0,
                  },
                ]
              : (rows.get(name) ?? [])
          ).then(resolve, reject),
      };
      return q;
    },
    insert: (table: any) => ({
      values: (value: any) => {
        const name = getTableName(table);
        const row = { id: 1, createdAt: date, updatedAt: date, ...value };
        rows.set(name, [...(rows.get(name) ?? []), row]);
        writes.push({ table: name, values: value });
        return {
          onDuplicateKeyUpdate: async () => {},
          then: (resolve: any) =>
            Promise.resolve([{ affectedRows: 1 }]).then(resolve),
        };
      },
    }),
    update: (table: any) => ({
      set: (value: any) => ({
        where: async () => {
          const name = getTableName(table);
          writes.push({ table: name, values: value });
          rows.set(
            name,
            (rows.get(name) ?? []).map(row => ({ ...row, ...value }))
          );
          return [{ affectedRows: 1 }];
        },
      }),
    }),
  };
  mocks.db = db;
  return { rows, writes };
}
const input = {
  tenantId: "default",
  orderId: 101,
  actorId: "fixture",
  requestId: "fixture-request",
  pipelineId: 2,
};
beforeEach(() => {
  mocks.db = null;
});

describe("commercial authority + projection net decision", () => {
  it.each(cases)("$name", test => {
    const result = decideCommercialOrderPayment(facts(test));
    expect(result.paidCents).toBe(test.cents);
    expect(result.realizedCents).toBe(test.cents);
    expect(result.status).toBe(test.status ?? "active");
    expect(result.netPaidCents).toBe(
      facts(test).projection?.tenantId === "default"
        ? (facts(test).projection?.netPaidCents ?? null)
        : null
    );
  });
  it("binds null-tenant compatibility only to default and refuses blank tenant", () => {
    expect(
      decideCommercialOrderPayment({
        ...facts(cases[0]),
        order: { ...order, tenantId: null },
      }).paidCents
    ).toBe(10000);
    expect(
      decideCommercialOrderPayment({
        ...facts(cases[0]),
        tenantId: "other",
        order: { ...order, tenantId: null },
      }).paidCents
    ).toBe(0);
    expect(() => commercialOrderTenantPredicate("")).toThrow();
    const dialect = new MySqlDialect();
    expect(
      dialect.sqlToQuery(commercialOrderTenantPredicate("default")!).sql
    ).toContain("is null");
    expect(
      dialect.sqlToQuery(commercialOrderTenantPredicate("other")!).sql
    ).not.toContain("is null");
  });
  it("keeps full refunds zero even with a stale positive net and preserves captured/refunded facts", () => {
    const result = decideCommercialOrderPayment({
      ...facts(cases[0]),
      projection: { ...projection, state: "refunded", refundedCents: 10000 },
    });
    expect(result).toMatchObject({
      paidCents: 0,
      realizedCents: 0,
      status: "reversed",
      capturedCents: 10000,
      refundedCents: 10000,
      netPaidCents: 10000,
    });
  });
});

describe("actual manual/campaign/reconciliation cross-path invariants", () => {
  it.each(cases)(
    "$name produces identical financial writes and activation",
    async test => {
      const values = facts(test);
      const manual = database(values);
      await attributeCommercialOrder(input);
      const manualRow = manual.rows.get("commercial_order_attributions")![0];
      const campaign = database(values);
      await attributeOrderFromCampaign({
        ...input,
        campaignToken: "fixture-token",
      });
      const campaignRow = campaign.rows.get(
        "commercial_order_attributions"
      )![0];
      expect(campaignRow).toBeDefined();
      // Seed stale legacy values to force reconciliation to correct them, including activation behavior.
      const reconcile = database(values);
      reconcile.rows.set("commercial_order_attributions", [
        { ...campaignRow, paidCents: 99999, realizedCents: 99999 },
      ]);
      await reconcileCommercialPipelineRevenue("default");
      const reconciledRow = reconcile.rows.get(
        "commercial_order_attributions"
      )![0];
      for (const key of [
        "paidCents",
        "realizedCents",
        "status",
        "capturedCents",
        "refundedCents",
        "netPaidCents",
        "financialReviewReason",
        "currency",
      ]) {
        expect(manualRow[key]).toEqual(campaignRow[key]);
        expect(reconciledRow[key]).toEqual(campaignRow[key]);
      }
      expect(reconciledRow.paidCents).toBe(test.cents);
      expect(
        reconcile.rows.get("commercial_pipeline_records")![0]
      ).toMatchObject({
        paidRevenueCents: test.cents,
        realizedRevenueCents: test.cents,
      });
      const activation = reconcile.writes.filter(w =>
        [
          "commercial_service_expectations",
          "commercial_route_assignments",
        ].includes(w.table)
      );
      expect(activation).toHaveLength(test.cents > 0 ? 2 : 0);
      expect(activation.every(w => w.values.status === "active")).toBe(true);
    }
  );
  it("cannot raise an authority-withheld zero using the legacy paid flag", async () => {
    const db = database({ ...facts(cases[0]), receipt: null });
    db.rows.set("commercial_order_attributions", [
      {
        id: 1,
        tenantId: "default",
        orderId: 101,
        missionId: 3,
        commercialCustomerId: 5,
        paidCents: 0,
        realizedCents: 0,
      },
    ]);
    await reconcileCommercialPipelineRevenue("default");
    expect(db.rows.get("commercial_order_attributions")![0].paidCents).toBe(0);
    expect(
      db.writes.filter(w =>
        [
          "commercial_service_expectations",
          "commercial_route_assignments",
        ].includes(w.table)
      )
    ).toEqual([]);
  });
  it.each([{ noLink: true }, { noCustomer: true }, { conflict: true }])(
    "preserves campaign prerequisites: %j",
    async options => {
      const db = database(facts(cases[0]), options);
      await attributeOrderFromCampaign({
        ...input,
        campaignToken: "fixture-token",
      });
      expect(db.rows.get("commercial_order_attributions")).toEqual([]);
    }
  );
});
