import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CustomerOrderTruthRecord } from "../geography/customerOrderTruth";
import {
  deriveBusinessSourceCoverage,
  type CleanCloudAssimilationReceipt,
} from "./sourceCoverage";
import {
  UNKNOWN_EVIDENCE,
  type LedgerSourceEvidence,
  type SourceBindingState,
  type SourceCoverageRange,
} from "./sourceBindings";
import {
  deriveCanonicalDormantQueue,
  readCanonicalDormantQueue,
  toPublicDormantObjectivePayload,
  DORMANT_QUEUE_RESCUE_INTEGRATION,
} from "./canonicalDormantQueue";

const DORMANCY_NOW = new Date("2026-09-16T12:00:00.000Z");
const LAST_DORMANT = new Date("2026-07-01T12:00:00.000Z");
const LAST_ACTIVE = new Date("2026-09-10T12:00:00.000Z");
/** 2026-09-20 11:00 America/Los_Angeles. Expected CleanCloud coverage through 2026-09-19. */
const BEFORE_DUE = new Date("2026-09-20T18:00:00.000Z");
/** After the 18:00 run plus one-hour grace. Expected coverage through 2026-09-20. */
const AFTER_DUE = new Date("2026-09-21T02:15:00.000Z");

const PHONE = "3105550142";
const EMAIL = "ada.secret@example.com";
const STREET = "3545 Wilshire Blvd, Los Angeles, CA 90010";

function truth(
  overrides: Partial<CustomerOrderTruthRecord> &
    Pick<CustomerOrderTruthRecord, "source" | "sourceOrderId" | "createdAt">
): CustomerOrderTruthRecord {
  return {
    id: overrides.source === "cleancloud" ? 2_000_000_001 : 41,
    firstName: "Ada",
    lastName: "Lovelace",
    phone: PHONE,
    email: EMAIL,
    address: STREET,
    unit: "12B",
    buildingSlug: "opusla",
    bldgUserId: null,
    cleancloudCustomerId: null,
    buildingResolutionStatus: "resolved",
    allowNameComposite: overrides.source !== "cleancloud",
    paid: true,
    totalCents: 4500,
    cancelled: false,
    ...overrides,
  };
}

function range(from: string, to: string, completedAt: Date): SourceCoverageRange {
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
  completedAt: Date
): CleanCloudAssimilationReceipt {
  return {
    from,
    to,
    completedAt: completedAt.toISOString(),
    customerTruth: "refreshed",
    basis: "orders_created",
    provenance: "browser_sync_receipt",
  };
}

function evidence(input: {
  native?: SourceBindingState;
  cleancloud?: SourceBindingState;
  ranges?: SourceCoverageRange[];
}): LedgerSourceEvidence {
  return {
    laundry_butler: {
      state: input.native ?? "bound",
      lastSuccessAt: input.native === "absent" ? null : BEFORE_DUE,
      coverageRanges: [],
      latestAttempt: null,
      isSystemOfRecord: true,
    },
    cleancloud: {
      state: input.cleancloud ?? "bound",
      lastSuccessAt: input.cleancloud === "absent" ? null : BEFORE_DUE,
      coverageRanges: input.ranges ?? [],
      latestAttempt: null,
      isSystemOfRecord: false,
    },
  };
}

function coverageFor(input: {
  tenantId?: string;
  now?: Date;
  native?: SourceBindingState;
  cleancloud?: SourceBindingState;
  ranges?: SourceCoverageRange[];
  receipts?: readonly CleanCloudAssimilationReceipt[] | "unreadable";
}) {
  const ranges = input.ranges ?? [];
  return deriveBusinessSourceCoverage({
    tenantId: input.tenantId ?? "tenant-a",
    now: input.now ?? BEFORE_DUE,
    evidence: evidence({
      native: input.native,
      cleancloud: input.cleancloud,
      ranges,
    }),
    cleancloudReceipts:
      input.receipts ??
      ranges.map(item => receipt(item.from, item.to, item.completedAt)),
  });
}

function freshCoverage(tenantId = "tenant-a") {
  const completedAt = new Date("2026-09-20T01:00:00.000Z");
  return coverageFor({
    tenantId,
    now: BEFORE_DUE,
    ranges: [range("2026-09-01", "2026-09-19", completedAt)],
  });
}

function staleCoverage(tenantId = "tenant-a") {
  return coverageFor({
    tenantId,
    now: AFTER_DUE,
    ranges: [
      range("2026-09-01", "2026-09-19", new Date("2026-09-20T01:00:00.000Z")),
    ],
  });
}

describe("canonical dormant queue", () => {
  it("includes a native paid customer who has been inactive for 30 days", () => {
    const coverage = freshCoverage();
    expect(coverage.book.exhaustiveCurrent).toBe(true);

    const result = deriveCanonicalDormantQueue({
      tenantId: "tenant-a",
      now: DORMANCY_NOW,
      records: [
        truth({
          source: "laundry_butler",
          sourceOrderId: "native-1",
          createdAt: LAST_DORMANT,
          firstName: "Ada",
        }),
        truth({
          source: "laundry_butler",
          sourceOrderId: "native-unpaid",
          createdAt: LAST_DORMANT,
          phone: "3105550143",
          email: "unpaid@example.com",
          unit: "9A",
          firstName: "Unpaid",
          paid: false,
        }),
      ],
      coverage,
    });

    expect(result.claim).toBe("current_held_book");
    expect(result.exhaustive).toBe(true);
    expect(result.allCustomersLicensed).toBe(false);
    expect(result.customers.map(customer => customer.firstName)).toEqual(["Ada"]);
    expect(result.customers[0]).toMatchObject({
      sources: ["laundry_butler"],
      daysSinceLastOrder: 77,
      paidOrderCount: 1,
      buildingName: "Opus Los Angeles",
    });
  });

  it("includes a CleanCloud paid customer from the same book", () => {
    const result = deriveCanonicalDormantQueue({
      tenantId: "tenant-a",
      now: DORMANCY_NOW,
      records: [
        truth({
          source: "cleancloud",
          sourceOrderId: "cc-9",
          createdAt: LAST_DORMANT,
          phone: "3105550177",
          firstName: "Nia",
          cleancloudCustomerId: "cc-cust-9",
        }),
      ],
      coverage: freshCoverage(),
    });

    expect(result.customers).toHaveLength(1);
    expect(result.customers[0]).toMatchObject({
      firstName: "Nia",
      sources: ["cleancloud"],
      paidOrderCount: 1,
      daysSinceLastOrder: 77,
    });
  });

  it("leaves a source out of the queue when coverage says it is not held", () => {
    const completedAt = new Date("2026-09-20T01:00:00.000Z");
    const coverage = coverageFor({
      native: "absent",
      ranges: [range("2026-09-01", "2026-09-19", completedAt)],
    });
    expect(
      coverage.sources.find(source => source.sourceId === "laundry_butler")
        ?.includedInCombinedBook
    ).toBe(false);

    const result = deriveCanonicalDormantQueue({
      tenantId: "tenant-a",
      now: DORMANCY_NOW,
      records: [
        truth({
          source: "laundry_butler",
          sourceOrderId: "native-1",
          createdAt: LAST_DORMANT,
          phone: "3105550101",
          email: "ada@example.com",
          unit: "12B",
          firstName: "Ada",
        }),
        truth({
          source: "cleancloud",
          sourceOrderId: "cc-1",
          createdAt: LAST_DORMANT,
          phone: "3105550177",
          email: "nia@example.com",
          unit: "8D",
          firstName: "Nia",
        }),
      ],
      coverage,
    });

    expect(result.customers.map(customer => customer.firstName)).toEqual(["Nia"]);
    expect(result.customers[0]?.sources).toEqual(["cleancloud"]);
  });

  it("excludes a customer whose last order is still inside the active window", () => {
    const result = deriveCanonicalDormantQueue({
      tenantId: "tenant-a",
      now: DORMANCY_NOW,
      records: [
        truth({
          source: "laundry_butler",
          sourceOrderId: "native-old",
          createdAt: LAST_DORMANT,
          phone: "3105550101",
          email: "ada@example.com",
          unit: "12B",
          firstName: "Ada",
        }),
        truth({
          source: "laundry_butler",
          sourceOrderId: "native-new",
          createdAt: LAST_ACTIVE,
          phone: "3105550102",
          email: "recent@example.com",
          unit: "4C",
          firstName: "Recent",
        }),
      ],
      coverage: freshCoverage(),
    });

    expect(result.customers.map(customer => customer.firstName)).toEqual(["Ada"]);
    expect(result.customerCount).toBe(1);
  });

  it("returns one customer when native and CleanCloud rows share a phone", () => {
    const result = deriveCanonicalDormantQueue({
      tenantId: "tenant-a",
      now: DORMANCY_NOW,
      records: [
        truth({
          source: "laundry_butler",
          sourceOrderId: "native-1",
          createdAt: LAST_DORMANT,
          phone: "3105550101",
          firstName: "Ada",
        }),
        truth({
          source: "cleancloud",
          sourceOrderId: "cc-1",
          createdAt: LAST_DORMANT,
          phone: "(310) 555-0101",
          firstName: "Ada",
          cleancloudCustomerId: "cc-cust-1",
        }),
      ],
      coverage: freshCoverage(),
    });

    expect(result.customers).toHaveLength(1);
    expect(result.customers[0]).toMatchObject({
      firstName: "Ada",
      paidOrderCount: 2,
      sources: ["cleancloud", "laundry_butler"],
    });
  });

  it("returns known candidates when a source is stale and does not call the list exhaustive", () => {
    const coverage = staleCoverage();
    expect(coverage.book.exhaustiveCurrent).toBe(false);
    expect(coverage.sources.find(source => source.sourceId === "cleancloud")?.status).toBe(
      "stale"
    );

    const result = deriveCanonicalDormantQueue({
      tenantId: "tenant-a",
      now: DORMANCY_NOW,
      records: [
        truth({
          source: "cleancloud",
          sourceOrderId: "cc-stale",
          createdAt: LAST_DORMANT,
          phone: "3105550188",
          firstName: "Nia",
        }),
      ],
      coverage,
    });

    expect(result.claim).toBe("known_candidates");
    expect(result.exhaustive).toBe(false);
    expect(result.allCustomersLicensed).toBe(false);
    expect(result.emptyMeansNoDormantCustomers).toBe(false);
    expect(result.missingIsNoCustomers).toBe(false);
    expect(result.coverage.incomplete).toBe(true);
    expect(result.coverage.bookStatus).not.toBe("fresh");
    expect(result.coverage.blockingSources).toEqual([
      expect.objectContaining({ sourceId: "cleancloud", status: "stale" }),
    ]);
    expect(result.customers.map(customer => customer.firstName)).toEqual(["Nia"]);
    expect(result.listReason).toMatch(/not exhaustive/);
  });

  it("does not cap the queue at Claire's prompt size", () => {
    const source = readFileSync(new URL("./canonicalDormantQueue.ts", import.meta.url), "utf8");
    expect(source).not.toContain("MAX_DORMANT_ELIGIBLE_IN_SNAPSHOT");
    expect(source).not.toContain(".slice(");

    const records = Array.from({ length: 13 }, (_, index) =>
      truth({
        source: "laundry_butler",
        sourceOrderId: `native-${index}`,
        id: index + 1,
        createdAt: LAST_DORMANT,
        phone: `3105551${String(index).padStart(3, "0")}`,
        email: null,
        unit: `U${index}`,
        firstName: `Customer${index}`,
      })
    );
    const result = deriveCanonicalDormantQueue({
      tenantId: "tenant-a",
      now: DORMANCY_NOW,
      records,
      coverage: freshCoverage(),
    });

    expect(result.customers).toHaveLength(13);
    expect(result.customerCount).toBe(13);
    expect(result.exhaustive).toBe(true);
  });

  it("keeps tenants on separate books and separate ids", async () => {
    const row = truth({
      source: "laundry_butler",
      sourceOrderId: "native-1",
      createdAt: LAST_DORMANT,
      phone: "3105550101",
      firstName: "Ada",
    });
    const other = truth({
      source: "laundry_butler",
      sourceOrderId: "native-9",
      createdAt: LAST_DORMANT,
      phone: "3105550999",
      firstName: "Other",
    });
    const tenantA = deriveCanonicalDormantQueue({
      tenantId: "tenant-a",
      now: DORMANCY_NOW,
      records: [row],
      coverage: freshCoverage("tenant-a"),
    });
    const tenantB = deriveCanonicalDormantQueue({
      tenantId: "tenant-b",
      now: DORMANCY_NOW,
      records: [row],
      coverage: freshCoverage("tenant-b"),
    });
    expect(tenantA.customers[0]?.id).not.toBe(tenantB.customers[0]?.id);
    expect(tenantA.customers[0]?.id.startsWith("cust_")).toBe(true);

    const seen: string[] = [];
    const read = await readCanonicalDormantQueue({
      tenantId: "tenant-a",
      now: DORMANCY_NOW,
      loaders: {
        loadCoverage: async ({ tenantId }) => {
          seen.push(`coverage:${tenantId}`);
          return freshCoverage(tenantId);
        },
        loadTruth: async tenantId => {
          seen.push(`truth:${tenantId}`);
          return tenantId === "tenant-a" ? [row] : [other];
        },
      },
    });
    expect(seen).toEqual(["coverage:tenant-a", "truth:tenant-a"]);
    expect(read.tenantId).toBe("tenant-a");
    expect(read.customers.map(customer => customer.firstName)).toEqual(["Ada"]);

    const foreignCoverage = deriveCanonicalDormantQueue({
      tenantId: "tenant-a",
      now: DORMANCY_NOW,
      records: [row],
      coverage: freshCoverage("tenant-b"),
    });
    expect(foreignCoverage.coverage.snapshotRead).toBe(false);
    expect(foreignCoverage.exhaustive).toBe(false);
    expect(foreignCoverage.claim).toBe("known_candidates");
  });

  it("explains qualification with a reason that does not change between reads", () => {
    const input = {
      tenantId: "tenant-a",
      now: DORMANCY_NOW,
      records: [
        truth({
          source: "laundry_butler",
          sourceOrderId: "native-1",
          createdAt: LAST_DORMANT,
          firstName: "Ada",
        }),
      ],
      coverage: freshCoverage(),
    };
    const first = deriveCanonicalDormantQueue(input);
    const second = deriveCanonicalDormantQueue(input);
    const reason = first.customers[0]?.reason;
    expect(reason).toBe(second.customers[0]?.reason);
    expect(reason).toBe(
      "paid_customer_inactive days_since_last_order=77 threshold_days=30 paid_orders=1 sources=laundry_butler last_order_at=2026-07-01T12:00:00.000Z"
    );
    expect(first.decidedBy).toBe("deterministic_rules");
  });

  it("keeps phone, email, and street address off the public Objective payload", () => {
    const source = readFileSync(new URL("./canonicalDormantQueue.ts", import.meta.url), "utf8");
    expect(source).not.toContain("rescueMissionService");

    const queue = deriveCanonicalDormantQueue({
      tenantId: "tenant-a",
      now: DORMANCY_NOW,
      records: [
        truth({
          source: "laundry_butler",
          sourceOrderId: "native-1",
          createdAt: LAST_DORMANT,
          phone: PHONE,
          email: EMAIL,
          address: STREET,
          unit: "12B",
          firstName: "Ada",
        }),
      ],
      coverage: freshCoverage(),
    });
    const payload = toPublicDormantObjectivePayload(queue);
    const serialized = JSON.stringify(payload);

    expect(payload.kind).toBe("challenge");
    expect(payload.objective).toBe("dormant_customer_queue");
    expect(payload.rescueIntegration).toEqual(DORMANT_QUEUE_RESCUE_INTEGRATION);
    expect(payload.rescueIntegration.wired).toBe(false);
    expect(serialized).not.toContain(PHONE);
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain("Wilshire");
    expect(serialized).not.toContain("12B");
    expect(serialized).not.toMatch(/"phone"|"email"|"address"|"unit"|"street"/);
    expect(JSON.stringify(queue)).not.toContain(PHONE);
    expect(JSON.stringify(queue)).not.toContain(EMAIL);
    expect(JSON.stringify(queue)).not.toContain("Wilshire");
  });

  it("does not treat an unreadable book as zero dormant customers", async () => {
    const result = await readCanonicalDormantQueue({
      tenantId: "tenant-a",
      now: DORMANCY_NOW,
      coverage: freshCoverage(),
      loaders: {
        loadTruth: async () => {
          throw new Error("orders unavailable");
        },
      },
    });
    expect(result.claim).toBe("unreadable");
    expect(result.customerCount).toBeNull();
    expect(result.customers).toEqual([]);
    expect(result.exhaustive).toBe(false);
    expect(result.emptyMeansNoDormantCustomers).toBe(false);
    expect(result.listReason).toMatch(/not an empty dormant queue/i);

    const unknown = deriveCanonicalDormantQueue({
      tenantId: "tenant-a",
      now: DORMANCY_NOW,
      records: [],
      coverage: deriveBusinessSourceCoverage({
        tenantId: "tenant-a",
        now: BEFORE_DUE,
        evidence: UNKNOWN_EVIDENCE,
        cleancloudReceipts: "unreadable",
      }),
    });
    expect(unknown.coverage.bookStatus).toBe("unavailable");
    expect(unknown.exhaustive).toBe(false);
    expect(unknown.emptyMeansNoDormantCustomers).toBe(false);
  });
});
