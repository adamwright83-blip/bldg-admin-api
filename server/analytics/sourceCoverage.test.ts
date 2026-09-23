import { describe, expect, it, vi } from "vitest";
import {
  assimilationReceiptsFromRows,
  deriveBusinessSourceCoverage,
  loadBusinessSourceCoverage,
  type CleanCloudAssimilationReceipt,
} from "./sourceCoverage";
import {
  coverageRangesFromReceiptRows,
  UNKNOWN_EVIDENCE,
  type LedgerSourceEvidence,
  type SourceBindingState,
  type SourceCoverageRange,
} from "./sourceBindings";

/**
 * 2026-09-20 11:00 America/Los_Angeles — before the 18:00 Gumball run.
 * Expected CleanCloud coverage through 2026-09-19.
 */
const BEFORE_DUE = new Date("2026-09-20T18:00:00.000Z");
/**
 * 2026-09-20 19:15 America/Los_Angeles — after the 18:00 run plus one-hour grace.
 * Expected CleanCloud coverage through 2026-09-20.
 */
const AFTER_DUE = new Date("2026-09-21T02:15:00.000Z");

function range(
  from: string,
  to: string,
  completedAt: Date
): SourceCoverageRange {
  return {
    from,
    to,
    completedAt,
    basis: "orders_created",
    provenance: "browser_sync_receipt",
  };
}

function receipt(
  from: string,
  to: string,
  completedAt: Date,
  customerTruth: CleanCloudAssimilationReceipt["customerTruth"]
): CleanCloudAssimilationReceipt {
  return {
    from,
    to,
    completedAt: completedAt.toISOString(),
    customerTruth,
    basis: "orders_created",
    provenance: "browser_sync_receipt",
  };
}

function evidence(input: {
  native?: SourceBindingState;
  nativeLastSuccessAt?: Date | null;
  cleancloud?: SourceBindingState;
  cleancloudLastSuccessAt?: Date | null;
  ranges?: SourceCoverageRange[];
}): LedgerSourceEvidence {
  const nativeState = input.native ?? "bound";
  return {
    laundry_butler: {
      state: nativeState,
      lastSuccessAt:
        input.nativeLastSuccessAt === undefined
          ? BEFORE_DUE
          : input.nativeLastSuccessAt,
      coverageRanges: [],
      latestAttempt: null,
      isSystemOfRecord: true,
    },
    cleancloud: {
      state: input.cleancloud ?? "bound",
      lastSuccessAt:
        input.cleancloudLastSuccessAt === undefined
          ? BEFORE_DUE
          : input.cleancloudLastSuccessAt,
      coverageRanges: input.ranges ?? [],
      latestAttempt: null,
      isSystemOfRecord: false,
    },
  };
}

function snapshot(input: {
  tenantId?: string;
  now?: Date;
  native?: SourceBindingState;
  nativeLastSuccessAt?: Date | null;
  cleancloud?: SourceBindingState;
  cleancloudLastSuccessAt?: Date | null;
  ranges?: SourceCoverageRange[];
  receipts?: readonly CleanCloudAssimilationReceipt[] | "unreadable";
}) {
  const now = input.now ?? BEFORE_DUE;
  const ranges = input.ranges ?? [];
  return deriveBusinessSourceCoverage({
    tenantId: input.tenantId ?? "tenant-a",
    now,
    evidence: evidence({
      native: input.native,
      nativeLastSuccessAt: input.nativeLastSuccessAt,
      cleancloud: input.cleancloud,
      cleancloudLastSuccessAt: input.cleancloudLastSuccessAt,
      ranges,
    }),
    cleancloudReceipts:
      input.receipts ??
      ranges.map(item =>
        receipt(item.from, item.to, item.completedAt, "refreshed")
      ),
  });
}

function source(
  result: ReturnType<typeof snapshot>,
  sourceId: "laundry_butler" | "cleancloud"
) {
  const found = result.sources.find(item => item.sourceId === sourceId);
  if (!found) throw new Error(`missing ${sourceId}`);
  return found;
}

describe("business source coverage contract", () => {
  it("is fresh when native is readable and the due Gumball checkpoint was assimilated", () => {
    const completedAt = new Date("2026-09-20T01:00:00.000Z");
    const result = snapshot({
      ranges: [range("2026-09-01", "2026-09-19", completedAt)],
    });

    expect(result.contractVersion).toBe(1);
    expect(result.timeZone).toBe("America/Los_Angeles");
    expect(result.book.status).toBe("fresh");
    expect(result.book.exhaustiveCurrent).toBe(true);
    expect(result.book.current).toBe(true);
    expect(result.book.paymentEventsProven).toBe(false);
    expect("exactRevenueLicensed" in result.book).toBe(false);
    expect(result.book.allCustomersLicensed).toBe(false);
    expect(result.book.outsideProvenSpan).toBe("unknown_not_empty");
    expect(result.blockingSources).toEqual([]);
    expect(source(result, "cleancloud")).toMatchObject({
      name: "CleanCloud",
      type: "cleancloud_paid_book",
      availability: "available",
      status: "fresh",
      lastSuccessfulAssimilationAt: completedAt.toISOString(),
      assimilationKind: "customer_truth_refreshed",
      provenFrom: "2026-09-01",
      coveredThrough: "2026-09-19",
      expectedThrough: "2026-09-19",
      supportsExhaustiveCurrentClaim: true,
      emptyReadMeansNoRecords: false,
      provenance: {
        schedule: "gumball_daily_18_america_los_angeles",
        coverageBasis: "orders_created",
        receiptProvenance: "browser_sync_receipt",
        paymentEventsProven: false,
        decidedBy: "deterministic_rules",
      },
    });
    expect(source(result, "laundry_butler").provenance.decidedBy).toBe(
      "deterministic_rules"
    );
  });

  it("requires today's assimilated receipt after the Gumball grace", () => {
    const yesterday = new Date("2026-09-20T01:00:00.000Z");
    const today = new Date("2026-09-21T02:00:00.000Z");
    const behind = snapshot({
      now: AFTER_DUE,
      ranges: [range("2026-09-19", "2026-09-19", yesterday)],
    });
    const current = snapshot({
      now: AFTER_DUE,
      ranges: [
        range("2026-09-19", "2026-09-19", yesterday),
        range("2026-09-20", "2026-09-20", today),
      ],
    });

    expect(source(behind, "cleancloud").status).toBe("stale");
    expect(source(behind, "cleancloud").expectedThrough).toBe("2026-09-20");
    expect(current.book.status).toBe("fresh");
    expect(source(current, "cleancloud").expectedThrough).toBe("2026-09-20");
  });

  it("does not let a recent success timestamp freshen a missed checkpoint", () => {
    const result = snapshot({
      now: AFTER_DUE,
      cleancloudLastSuccessAt: AFTER_DUE,
      ranges: [range("2026-09-02", "2026-09-02", AFTER_DUE)],
    });
    expect(source(result, "cleancloud").status).toBe("stale");
    expect(result.book.exhaustiveCurrent).toBe(false);
    expect(result.book.current).toBe(false);
  });

  it("keeps a stale CleanCloud book from being called complete, and does not treat it as zero", () => {
    const result = snapshot({
      now: AFTER_DUE,
      ranges: [
        range("2026-09-01", "2026-09-19", new Date("2026-09-20T01:00:00.000Z")),
      ],
    });

    expect(result.book.status).toBe("partial");
    expect(result.book.exhaustiveCurrent).toBe(false);
    expect(result.book.current).toBe(false);
    expect(result.book.staleIsZero).toBe(false);
    expect(result.book.missingIsNoCustomers).toBe(false);
    expect(result.book.interpretEmptyAsNoCustomers).toBe(false);
    expect(result.book.knownRecordsReadable).toBe(true);
    expect(source(result, "cleancloud")).toMatchObject({
      status: "stale",
      records: "readable",
      emptyReadMeansNoRecords: false,
      supportsExhaustiveCurrentClaim: false,
    });
    expect(source(result, "laundry_butler").status).toBe("fresh");
    expect(result.blockingSources.map(item => item.sourceId)).toEqual([
      "cleancloud",
    ]);
    expect(result.book.status).not.toBe("fresh");
  });

  it("marks a CleanCloud-only missed checkpoint as a stale book, not an empty one", () => {
    const result = snapshot({
      now: AFTER_DUE,
      native: "absent",
      nativeLastSuccessAt: null,
      ranges: [
        range("2026-09-19", "2026-09-19", new Date("2026-09-20T01:00:00.000Z")),
      ],
    });
    expect(source(result, "laundry_butler").availability).toBe("not_held");
    expect(source(result, "laundry_butler").includedInCombinedBook).toBe(false);
    expect(result.book.status).toBe("stale");
    expect(result.book.exhaustiveCurrent).toBe(false);
    expect(result.book.knownRecordsReadable).toBe(true);
    expect(result.book.interpretEmptyAsNoCustomers).toBe(false);
  });

  it("is unavailable when neither source can be read, and missing is not no customers", () => {
    const result = deriveBusinessSourceCoverage({
      tenantId: "tenant-a",
      now: BEFORE_DUE,
      evidence: UNKNOWN_EVIDENCE,
      cleancloudReceipts: "unreadable",
    });
    expect(result.book.status).toBe("unavailable");
    expect(result.book.exhaustiveCurrent).toBe(false);
    expect(result.book.knownRecordsReadable).toBe(false);
    expect(result.book.interpretEmptyAsNoCustomers).toBe(false);
    expect(result.book.missingIsNoCustomers).toBe(false);
    expect(source(result, "cleancloud").reason).toMatch(/not zero customers/i);
    expect(source(result, "laundry_butler").reason).toMatch(
      /not an empty customer book/i
    );
  });

  it("treats a partial unified book as known records, not the whole current business", () => {
    const early = new Date("2026-09-11T01:00:00.000Z");
    const checkpoint = new Date("2026-09-20T01:00:00.000Z");
    const gapped = snapshot({
      ranges: [
        range("2026-09-01", "2026-09-10", early),
        range("2026-09-19", "2026-09-19", checkpoint),
      ],
    });
    expect(source(gapped, "cleancloud")).toMatchObject({
      status: "partial",
      provenFrom: "2026-09-01",
      coveredThrough: "2026-09-19",
    });
    expect(gapped.book.status).toBe("partial");
    expect(gapped.book.exhaustiveCurrent).toBe(false);
    expect(gapped.book.knownRecordsReadable).toBe(true);
    expect(gapped.book.interpretEmptyAsNoCustomers).toBe(false);

    const legacy = snapshot({
      cleancloud: "legacy_history",
      cleancloudLastSuccessAt: new Date("2026-06-01T00:00:00.000Z"),
      ranges: [],
      receipts: [],
    });
    expect(source(legacy, "cleancloud").status).toBe("partial");
    expect(source(legacy, "cleancloud").records).toBe("readable");
    expect(legacy.book.exhaustiveCurrent).toBe(false);
    expect(
      source(legacy, "cleancloud").lastSuccessfulAssimilationAt
    ).toBeNull();
  });

  it("stays partial when the checkpoint imported but customer truth did not assimilate", () => {
    const completedAt = new Date("2026-09-20T01:00:00.000Z");
    const imported = range("2026-09-01", "2026-09-19", completedAt);
    const result = snapshot({
      ranges: [imported],
      receipts: [receipt(imported.from, imported.to, completedAt, "failed")],
    });
    expect(source(result, "cleancloud").status).toBe("partial");
    expect(source(result, "cleancloud").assimilationKind).toBe("never");
    expect(result.book.exhaustiveCurrent).toBe(false);
    expect(result.book.current).toBe(false);
  });

  it("fails closed when assimilation receipts cannot be read", () => {
    const result = snapshot({
      ranges: [
        range("2026-09-01", "2026-09-19", new Date("2026-09-20T01:00:00.000Z")),
      ],
      receipts: "unreadable",
    });
    expect(source(result, "cleancloud").status).toBe("partial");
    expect(result.book.status).not.toBe("fresh");
  });

  it("does not call a configured or disconnected CleanCloud feed a current book", () => {
    const configured = snapshot({
      cleancloud: "configured",
      cleancloudLastSuccessAt: null,
      ranges: [],
      receipts: [],
    });
    expect(source(configured, "cleancloud").status).toBe("unavailable");
    expect(configured.book.interpretEmptyAsNoCustomers).toBe(false);
    expect(source(configured, "cleancloud").reason).toMatch(
      /not zero customers/i
    );

    const disconnected = snapshot({
      cleancloud: "disconnected",
      cleancloudLastSuccessAt: new Date("2026-06-01T00:00:00.000Z"),
      ranges: [],
      receipts: [],
    });
    expect(source(disconnected, "cleancloud").status).toBe("partial");
    expect(disconnected.book.exhaustiveCurrent).toBe(false);
  });

  it("allows a real empty native book only when CleanCloud is not held", () => {
    const emptyNative = snapshot({
      nativeLastSuccessAt: null,
      cleancloud: "absent",
      cleancloudLastSuccessAt: null,
      ranges: [],
      receipts: [],
    });
    expect(emptyNative.book.status).toBe("fresh");
    expect(emptyNative.book.interpretEmptyAsNoCustomers).toBe(true);
    expect(emptyNative.book.paymentEventsProven).toBe(true);
    expect(emptyNative.book.allCustomersLicensed).toBe(false);
    expect(source(emptyNative, "cleancloud").includedInCombinedBook).toBe(
      false
    );

    const blindCleanCloud = snapshot({
      nativeLastSuccessAt: null,
      cleancloud: "unknown",
      cleancloudLastSuccessAt: null,
      ranges: [],
      receipts: "unreadable",
    });
    expect(blindCleanCloud.book.status).toBe("partial");
    expect(blindCleanCloud.book.interpretEmptyAsNoCustomers).toBe(false);
    expect(blindCleanCloud.book.missingIsNoCustomers).toBe(false);
  });

  it("keeps tenants on separate snapshots", () => {
    const completedAt = new Date("2026-09-20T01:00:00.000Z");
    const tenantA = snapshot({
      tenantId: "tenant-a",
      ranges: [range("2026-09-19", "2026-09-19", completedAt)],
    });
    const tenantB = snapshot({
      tenantId: "tenant-b",
      now: AFTER_DUE,
      ranges: [range("2026-09-19", "2026-09-19", completedAt)],
    });
    expect(tenantA.tenantId).toBe("tenant-a");
    expect(tenantB.tenantId).toBe("tenant-b");
    expect(tenantA.book.status).toBe("fresh");
    expect(tenantB.book.status).toBe("partial");
    expect(tenantA.sources).not.toEqual(tenantB.sources);
  });

  it("is deterministic for the same clock and evidence", () => {
    const input = {
      tenantId: "tenant-a",
      now: BEFORE_DUE,
      ranges: [
        range("2026-09-19", "2026-09-19", new Date("2026-09-20T01:00:00.000Z")),
      ],
    };
    expect(snapshot(input)).toEqual(snapshot(input));
    expect(snapshot({ ...input, now: AFTER_DUE }).book.status).not.toBe(
      snapshot(input).book.status
    );
  });

  it("proves payment events only from an economic-event span, never from Orders (Sales)", () => {
    const completedAt = new Date("2026-09-20T01:00:00.000Z");
    const ordersOnly = snapshot({
      ranges: [range("2026-09-01", "2026-09-19", completedAt)],
    });
    expect(ordersOnly.book.paymentEventsProven).toBe(false);
    expect(ordersOnly.book.scope.cleancloudEconomicEvents).toBeNull();

    const withPayments = deriveBusinessSourceCoverage({
      tenantId: "tenant-a",
      now: BEFORE_DUE,
      evidence: {
        ...evidence({
          ranges: [range("2026-09-01", "2026-09-19", completedAt)],
        }),
        cleancloud: {
          ...evidence({
            ranges: [range("2026-09-01", "2026-09-19", completedAt)],
          }).cleancloud,
          coverageRanges: [
            range("2026-09-01", "2026-09-19", completedAt),
            {
              from: "2026-09-01",
              to: "2026-09-19",
              completedAt,
              basis: "economic_event",
              provenance: "test_fixture",
            },
          ],
        },
      },
      cleancloudReceipts: [
        receipt("2026-09-01", "2026-09-19", completedAt, "refreshed"),
      ],
    });
    expect(withPayments.book.status).toBe("fresh");
    expect(withPayments.book.paymentEventsProven).toBe(true);
    expect(withPayments.book.scope.cleancloudOrdersCreated).toEqual({
      from: "2026-09-01",
      through: "2026-09-19",
    });
    expect(withPayments.book.scope.cleancloudEconomicEvents).toEqual({
      from: "2026-09-01",
      through: "2026-09-19",
    });
    expect("exactRevenueLicensed" in withPayments.book).toBe(false);
  });

  it("parses Gumball receipts without treating a cancelled export as coverage", () => {
    const parsed = assimilationReceiptsFromRows([
      {
        createdAt: new Date("2026-09-20T01:00:00.000Z"),
        receiptJson: {
          status: "imported",
          from: "2026-09-19",
          to: "2026-09-19",
          completedAt: "2026-09-20T01:00:00.000Z",
          customerTruth: "refreshed",
        },
      },
      {
        createdAt: new Date("2026-09-20T02:00:00.000Z"),
        receiptJson: {
          status: "cancelled",
          from: "2026-09-20",
          to: "2026-09-20",
          completedAt: "2026-09-20T02:00:00.000Z",
          customerTruth: "refreshed",
        },
      },
    ]);
    expect(parsed).toEqual([
      {
        from: "2026-09-19",
        to: "2026-09-19",
        completedAt: "2026-09-20T01:00:00.000Z",
        customerTruth: "refreshed",
        basis: "orders_created",
        provenance: "browser_sync_receipt",
      },
    ]);
  });

  it("loads each tenant through its own evidence and receipts", async () => {
    const completedAt = new Date("2026-09-20T01:00:00.000Z");
    const loadEvidence = vi.fn(async (tenantId: string) =>
      tenantId === "tenant-a"
        ? evidence({ ranges: [range("2026-09-19", "2026-09-19", completedAt)] })
        : UNKNOWN_EVIDENCE
    );
    const loadReceipts = vi.fn(async (tenantId: string) =>
      tenantId === "tenant-a"
        ? [receipt("2026-09-19", "2026-09-19", completedAt, "refreshed")]
        : ("unreadable" as const)
    );

    const tenantA = await loadBusinessSourceCoverage(
      { tenantId: "tenant-a", now: BEFORE_DUE },
      { loadEvidence, loadReceipts }
    );
    const tenantB = await loadBusinessSourceCoverage(
      { tenantId: "tenant-b", now: BEFORE_DUE },
      { loadEvidence, loadReceipts }
    );

    expect(loadEvidence).toHaveBeenCalledWith("tenant-a");
    expect(loadEvidence).toHaveBeenCalledWith("tenant-b");
    expect(loadReceipts).toHaveBeenCalledWith("tenant-a");
    expect(loadReceipts).toHaveBeenCalledWith("tenant-b");
    expect(tenantA.book.status).toBe("fresh");
    expect(tenantB.book.status).toBe("unavailable");
    expect(tenantA.tenantId).not.toBe(tenantB.tenantId);
  });

  it("fails closed when the evidence read throws", async () => {
    const result = await loadBusinessSourceCoverage(
      { tenantId: "tenant-a", now: BEFORE_DUE },
      {
        loadEvidence: async () => {
          throw new Error("database down");
        },
        loadReceipts: async () => {
          throw new Error("database down");
        },
      }
    );
    expect(result.book.status).toBe("unavailable");
    expect(result.book.interpretEmptyAsNoCustomers).toBe(false);
    expect(result.book.missingIsNoCustomers).toBe(false);
  });

  it("does not query for a blank tenant", async () => {
    const loadEvidence = vi.fn(async () => UNKNOWN_EVIDENCE);
    const loadReceipts = vi.fn(async () => [] as const);
    const result = await loadBusinessSourceCoverage(
      { tenantId: "   ", now: BEFORE_DUE },
      { loadEvidence, loadReceipts }
    );
    expect(loadEvidence).not.toHaveBeenCalled();
    expect(loadReceipts).not.toHaveBeenCalled();
    expect(result.book.status).toBe("unavailable");
    expect(result.book.exhaustiveCurrent).toBe(false);
    expect(result.book.interpretEmptyAsNoCustomers).toBe(false);
    expect(result.book.missingIsNoCustomers).toBe(false);
  });

  it("joins the real receipt parsers, and pending map geocoding does not block fresh", () => {
    const rows = [
      {
        createdAt: new Date("2026-09-20T01:00:00.000Z"),
        receiptJson: {
          tenantId: "someone-else",
          reportType: "orders_sales",
          from: "2026-09-01",
          to: "2026-09-19",
          completedAt: "2026-09-20T01:00:00.000Z",
          customerTruth: "refreshed",
          map: "pending",
        },
      },
    ];
    const ranges = coverageRangesFromReceiptRows(rows);
    const receipts = assimilationReceiptsFromRows(rows);
    const result = deriveBusinessSourceCoverage({
      tenantId: "tenant-a",
      now: BEFORE_DUE,
      evidence: evidence({ ranges }),
      cleancloudReceipts: receipts,
    });
    expect(ranges).toHaveLength(1);
    expect(receipts).toHaveLength(1);
    expect(source(result, "cleancloud").status).toBe("fresh");
    expect(result.book.exhaustiveCurrent).toBe(true);
    expect(result.book.paymentEventsProven).toBe(false);
    expect("exactRevenueLicensed" in result.book).toBe(false);
  });

  it("does not let skipped, pending, missing, or cancelled customer truth freshen the book", () => {
    const completedAt = new Date("2026-09-20T01:00:00.000Z");
    const covered = [range("2026-09-01", "2026-09-19", completedAt)];
    for (const customerTruth of ["skipped", "pending", null] as const) {
      const result = snapshot({
        ranges: covered,
        receipts: [receipt(covered[0]!.from, covered[0]!.to, completedAt, customerTruth)],
      });
      expect(source(result, "cleancloud").status).toBe("partial");
      expect(result.book.exhaustiveCurrent).toBe(false);
    }

    const cancelledOnly = [
      {
        createdAt: completedAt,
        receiptJson: {
          status: "cancelled",
          from: "2026-09-01",
          to: "2026-09-19",
          completedAt: completedAt.toISOString(),
          customerTruth: "refreshed",
        },
      },
    ];
    const dropped = deriveBusinessSourceCoverage({
      tenantId: "tenant-a",
      now: BEFORE_DUE,
      evidence: evidence({
        ranges: coverageRangesFromReceiptRows(cancelledOnly),
      }),
      cleancloudReceipts: assimilationReceiptsFromRows(cancelledOnly),
    });
    expect(source(dropped, "cleancloud").status).toBe("stale");
    expect(dropped.book.exhaustiveCurrent).toBe(false);
    expect(dropped.book.interpretEmptyAsNoCustomers).toBe(false);
  });

  it("drops malformed receipts instead of inventing a span", () => {
    expect(
      assimilationReceiptsFromRows([
        { receiptJson: "not-json" },
        { receiptJson: null },
        {
          receiptJson: {
            from: "2026-09-19",
            to: "2026-09-01",
            completedAt: "2026-09-20T01:00:00.000Z",
            customerTruth: "refreshed",
          },
        },
        {
          receiptJson: {
            from: "09-19-2026",
            to: "2026-09-19",
            completedAt: "not-a-date",
            customerTruth: "refreshed",
          },
        },
        {
          receiptJson: {
            from: "2026-02-31",
            to: "2026-02-31",
            completedAt: "2026-09-20T01:00:00.000Z",
            customerTruth: "refreshed",
          },
        },
      ])
    ).toEqual([]);
  });

  it("does not prove payment events from an economic span that misses the due day", () => {
    const completedAt = new Date("2026-09-20T01:00:00.000Z");
    const orders = range("2026-09-01", "2026-09-19", completedAt);
    const base = evidence({ ranges: [orders] });
    const withEconomic = (
      economic: SourceCoverageRange[]
    ) =>
      deriveBusinessSourceCoverage({
        tenantId: "tenant-a",
        now: BEFORE_DUE,
        evidence: {
          ...base,
          cleancloud: {
            ...base.cleancloud,
            coverageRanges: [orders, ...economic],
          },
        },
        cleancloudReceipts: [
          receipt(orders.from, orders.to, completedAt, "refreshed"),
        ],
      });

    const afterDueDay = withEconomic([
      {
        from: "2026-09-20",
        to: "2026-09-21",
        completedAt,
        basis: "economic_event",
        provenance: "test_fixture",
      },
    ]);
    expect(afterDueDay.book.status).toBe("fresh");
    expect(afterDueDay.book.paymentEventsProven).toBe(false);
    expect(source(afterDueDay, "cleancloud").provenance.paymentEventsProven).toBe(
      false
    );

    const gapped = withEconomic([
      {
        from: "2026-09-01",
        to: "2026-09-10",
        completedAt,
        basis: "economic_event",
        provenance: "test_fixture",
      },
      {
        from: "2026-09-19",
        to: "2026-09-19",
        completedAt,
        basis: "economic_event",
        provenance: "test_fixture",
      },
    ]);
    expect(gapped.book.status).toBe("fresh");
    expect(gapped.book.paymentEventsProven).toBe(false);
    expect(gapped.book.scope.cleancloudEconomicEvents).toBeNull();
    expect(gapped.book.scope.cleancloudEconomicEvents).not.toEqual({
      from: "2026-09-01",
      through: "2026-09-19",
    });

    const checkpointDay = withEconomic([
      {
        from: "2026-09-19",
        to: "2026-09-19",
        completedAt,
        basis: "economic_event",
        provenance: "test_fixture",
      },
    ]);
    expect(checkpointDay.book.paymentEventsProven).toBe(true);
    expect(checkpointDay.book.scope.cleancloudEconomicEvents).toEqual({
      from: "2026-09-19",
      through: "2026-09-19",
    });
    expect(checkpointDay.book.scope.cleancloudOrdersCreated).toEqual({
      from: "2026-09-01",
      through: "2026-09-19",
    });
    expect("exactRevenueLicensed" in checkpointDay.book).toBe(false);
  });

  it("stays partial when assimilation receipts are unreadable and no checkpoint range was loaded", () => {
    const result = snapshot({
      cleancloudLastSuccessAt: null,
      ranges: [],
      receipts: "unreadable",
    });
    expect(source(result, "cleancloud")).toMatchObject({
      status: "partial",
      availability: "unavailable",
      records: "unknown",
      supportsExhaustiveCurrentClaim: false,
      emptyReadMeansNoRecords: false,
    });
    expect(result.book.status).toBe("partial");
    expect(result.book.exhaustiveCurrent).toBe(false);
    expect(result.book.interpretEmptyAsNoCustomers).toBe(false);
    expect(result.book.missingIsNoCustomers).toBe(false);
  });

  it("uses the shared Gumball clock at the grace boundary", () => {
    const completedAt = new Date("2026-09-21T02:00:00.000Z");
    const coveredToday = [
      range("2026-09-19", "2026-09-19", new Date("2026-09-20T01:00:00.000Z")),
      range("2026-09-20", "2026-09-20", completedAt),
    ];
    const duringGrace = snapshot({
      now: new Date("2026-09-21T01:59:00.000Z"),
      ranges: coveredToday,
    });
    const graceElapsed = snapshot({
      now: new Date("2026-09-21T02:00:00.000Z"),
      ranges: coveredToday,
    });
    expect(source(duringGrace, "cleancloud").expectedThrough).toBe("2026-09-19");
    expect(source(duringGrace, "cleancloud").status).toBe("fresh");
    expect(source(graceElapsed, "cleancloud").expectedThrough).toBe("2026-09-20");
    expect(source(graceElapsed, "cleancloud").status).toBe("fresh");
  });

  it("calls the book stale only when every held source missed the checkpoint", () => {
    const result = snapshot({
      now: AFTER_DUE,
      native: "absent",
      nativeLastSuccessAt: null,
      ranges: [
        range("2026-09-01", "2026-09-19", new Date("2026-09-20T01:00:00.000Z")),
      ],
    });
    expect(result.book.status).toBe("stale");
    expect(result.book.staleIsZero).toBe(false);
    expect(result.book.interpretEmptyAsNoCustomers).toBe(false);
    expect(result.book.knownRecordsReadable).toBe(true);
    expect(result.book.missingIsNoCustomers).toBe(false);
    expect(source(result, "cleancloud").emptyReadMeansNoRecords).toBe(false);
    expect(result.blockingSources).toEqual([
      expect.objectContaining({ sourceId: "cleancloud", status: "stale" }),
    ]);
    expect(source(result, "laundry_butler").includedInCombinedBook).toBe(false);
  });

  it("publishes a contiguous economic-event span and does not invent one", () => {
    const completedAt = new Date("2026-09-20T01:00:00.000Z");
    const orders = range("2026-09-01", "2026-09-19", completedAt);
    const economic = (
      from: string,
      to: string
    ): SourceCoverageRange => ({
      from,
      to,
      completedAt,
      basis: "economic_event",
      provenance: "test_fixture",
    });
    const withEconomic = (ranges: SourceCoverageRange[]) =>
      deriveBusinessSourceCoverage({
        tenantId: "tenant-a",
        now: BEFORE_DUE,
        evidence: evidence({ ranges: [orders, ...ranges] }),
        cleancloudReceipts: [
          receipt(orders.from, orders.to, completedAt, "refreshed"),
        ],
      });

    expect(
      withEconomic([economic("2026-09-19", "2026-09-19")]).book.scope
        .cleancloudEconomicEvents
    ).toEqual({ from: "2026-09-19", through: "2026-09-19" });

    expect(
      withEconomic([economic("2026-09-01", "2026-09-19")]).book.scope
        .cleancloudEconomicEvents
    ).toEqual({ from: "2026-09-01", through: "2026-09-19" });

    const gapped = withEconomic([
      economic("2026-09-01", "2026-09-10"),
      economic("2026-09-19", "2026-09-19"),
    ]);
    expect(gapped.book.scope.cleancloudEconomicEvents).toBeNull();
    expect(gapped.book.outsideProvenSpan).toBe("unknown_not_empty");

    const missing = snapshot({
      cleancloud: "unknown",
      cleancloudLastSuccessAt: null,
      ranges: [],
      receipts: "unreadable",
    });
    expect(missing.book.scope.cleancloudEconomicEvents).toBeNull();
    expect(missing.book.missingIsNoCustomers).toBe(false);
    expect(missing.book.interpretEmptyAsNoCustomers).toBe(false);

    const ordersOnly = snapshot({
      ranges: [range("2026-09-01", "2026-09-19", completedAt)],
    });
    expect(ordersOnly.book.status).toBe("fresh");
    expect(ordersOnly.book.scope.cleancloudOrdersCreated).toEqual({
      from: "2026-09-01",
      through: "2026-09-19",
    });
    expect(ordersOnly.book.scope.cleancloudEconomicEvents).toBeNull();
    expect(ordersOnly.book.paymentEventsProven).toBe(false);
  });
});
