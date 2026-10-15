import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  claireCustomerTruthWithholdingSentence,
  diagnoseCustomerTruthFreshness,
  loadCustomerTruthFreshnessDiagnostic,
  productionCandidateDiagnosticPlan,
  type CustomerTruthFreshnessDiagnostic,
  type CustomerTruthImporterStatus,
} from "./customerTruthFreshnessDiagnostic";
import {
  CUSTOMER_TRUTH_DISPOSITIONS,
  deriveBusinessSourceCoverage,
  type CleanCloudAssimilationReceipt,
} from "./sourceCoverage";
import {
  type LedgerSourceEvidence,
  type SourceBindingState,
  type SourceCoverageRange,
} from "./sourceBindings";

/**
 * 2026-09-20 11:00 America/Los_Angeles — before the 18:00 Gumball run.
 * Expected CleanCloud coverage through 2026-09-19.
 */
const BEFORE_DUE = new Date("2026-09-20T18:00:00.000Z");
const AFTER_DUE = new Date("2026-09-21T02:15:00.000Z");

const LOOSE_SUCCESS = ["incomplete", "failed", "unavailable", "ok", "success", "fresh", "ready"];

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
  latestAttempt?: LedgerSourceEvidence["cleancloud"]["latestAttempt"];
}): LedgerSourceEvidence {
  return {
    laundry_butler: {
      state: input.native ?? "bound",
      lastSuccessAt:
        input.nativeLastSuccessAt === undefined ? BEFORE_DUE : input.nativeLastSuccessAt,
      coverageRanges: [],
      latestAttempt: null,
      isSystemOfRecord: true,
    },
    cleancloud: {
      state: input.cleancloud ?? "bound",
      lastSuccessAt:
        input.cleancloudLastSuccessAt === undefined ? BEFORE_DUE : input.cleancloudLastSuccessAt,
      coverageRanges: input.ranges ?? [],
      latestAttempt: input.latestAttempt ?? null,
      isSystemOfRecord: false,
    },
  };
}

function coverageOf(input: {
  tenantId?: string;
  now?: Date;
  native?: SourceBindingState;
  nativeLastSuccessAt?: Date | null;
  cleancloud?: SourceBindingState;
  cleancloudLastSuccessAt?: Date | null;
  ranges?: SourceCoverageRange[];
  receipts?: readonly CleanCloudAssimilationReceipt[] | "unreadable";
  latestAttempt?: LedgerSourceEvidence["cleancloud"]["latestAttempt"];
}) {
  const now = input.now ?? BEFORE_DUE;
  const ranges = input.ranges ?? [];
  return deriveBusinessSourceCoverage({
    tenantId: input.tenantId ?? "tenant-a",
    now,
    evidence: evidence(input),
    cleancloudReceipts:
      input.receipts ??
      ranges.map(item => receipt(item.from, item.to, item.completedAt, "refreshed")),
  });
}

function diagnose(
  coverage: ReturnType<typeof coverageOf> | null,
  importer?: CustomerTruthImporterStatus | null
): CustomerTruthFreshnessDiagnostic {
  return diagnoseCustomerTruthFreshness({ coverage, importer, now: BEFORE_DUE });
}

function assertNoCustomerIdentity(diagnostic: CustomerTruthFreshnessDiagnostic) {
  const json = JSON.stringify(diagnostic);
  expect(json).not.toMatch(/phone|email|customerName|identityId|firstName|lastName/i);
  expect(json).not.toMatch(/\b\d{10}\b/);
  expect(CUSTOMER_TRUTH_DISPOSITIONS).toContain(diagnostic.disposition);
  expect(LOOSE_SUCCESS).not.toContain(diagnostic.disposition);
  expect(diagnostic.missingIsNoCustomers).toBe(false);
  expect(["withheld", "empty_verified", "not_evaluated"]).toContain(
    diagnostic.eligiblePopulation
  );
}

describe("customer truth freshness diagnostic", () => {
  const completedAt = new Date("2026-09-20T01:00:00.000Z");

  it("reports a current book without a withholding sentence or a customer", () => {
    const coverage = coverageOf({
      ranges: [range("2026-09-01", "2026-09-19", completedAt)],
    });
    const diagnostic = diagnose(coverage, {
      lastSuccessfulSyncAt: completedAt.toISOString(),
      latestAttempt: { at: completedAt.toISOString(), outcome: "imported" },
    });

    expect(coverage.book.customerTruthDisposition).toBe("current");
    expect(diagnostic.disposition).toBe("current");
    expect(diagnostic.lastSuccessfulSyncAt).toBe(completedAt.toISOString());
    expect(diagnostic.lastSuccessfulAssimilationAt).toBe(completedAt.toISOString());
    expect(diagnostic.latestAttemptAt).toBe(completedAt.toISOString());
    expect(diagnostic.latestAttemptFailed).toBe(false);
    expect(diagnostic.latestAttemptOutcome).toBe("imported");
    expect(diagnostic.coverageWatermark).toBe("2026-09-19");
    expect(diagnostic.withholdingSentence).toBeNull();
    expect(diagnostic.coverageGap).toBe("none");
    expect(diagnostic.eligiblePopulation).toBe("not_evaluated");
    expect(diagnostic.cleancloudPresence).toBe("held");
    expect(diagnostic.interpretEmptyAsNoCustomers).toBe(false);
    assertNoCustomerIdentity(diagnostic);
  });

  it("withholds the book when the source cannot be read", () => {
    const coverage = coverageOf({
      native: "unknown",
      nativeLastSuccessAt: null,
      cleancloud: "unknown",
      cleancloudLastSuccessAt: null,
      ranges: [],
      receipts: "unreadable",
    });
    const diagnostic = diagnose(coverage, null);

    expect(diagnostic.disposition).toBe("source_unavailable");
    expect(diagnostic.coverageGap).toBe("cleancloud_unreadable");
    expect(diagnostic.cleancloudPresence).toBe("unreadable");
    expect(diagnostic.cleancloudDisposition).toBe("source_unavailable");
    expect(diagnostic.eligiblePopulation).toBe("withheld");
    expect(diagnostic.interpretEmptyAsNoCustomers).toBe(false);
    expect(diagnostic.withholdingSentence).toBe(
      "CleanCloud customer truth is source_unavailable. Personalized outreach is withheld until the book is current."
    );
    expect(diagnostic.latestAttemptAt).toBeNull();
    expect(diagnostic.latestAttemptFailed).toBeNull();
    expect(diagnostic.coverageWatermark).toBeNull();
    assertNoCustomerIdentity(diagnostic);
  });

  it("reports a failed latest attempt and withholds an import_failed book", () => {
    const failedAt = new Date("2026-09-20T02:00:00.000Z");
    const coverage = coverageOf({
      cleancloudLastSuccessAt: completedAt,
      ranges: [range("2026-09-01", "2026-09-19", completedAt)],
      latestAttempt: {
        at: failedAt,
        outcome: "failed",
        rangeFrom: "2026-09-01",
        rangeTo: "2026-09-19",
      },
    });
    const diagnostic = diagnose(coverage, {
      lastSuccessfulSyncAt: completedAt.toISOString(),
      latestAttempt: { at: failedAt.toISOString(), outcome: "failed" },
    });

    expect(coverage.book.customerTruthDisposition).toBe("import_failed");
    expect(coverage.book.current).toBe(false);
    expect(diagnostic.disposition).toBe("import_failed");
    expect(diagnostic.latestAttemptAt).toBe(failedAt.toISOString());
    expect(diagnostic.latestAttemptFailed).toBe(true);
    expect(diagnostic.lastSuccessfulSyncAt).toBe(completedAt.toISOString());
    expect(diagnostic.coverageWatermark).toBe("2026-09-19");
    expect(diagnostic.eligiblePopulation).toBe("withheld");
    expect(diagnostic.withholdingSentence).toBe(
      "CleanCloud customer truth is import_failed. Personalized outreach is withheld until the book is current."
    );
    assertNoCustomerIdentity(diagnostic);
  });

  it("excludes absent CleanCloud and does not call that absence an empty population", () => {
    const heldNative = diagnose(
      coverageOf({
        cleancloud: "absent",
        cleancloudLastSuccessAt: null,
        ranges: [],
        receipts: [],
      })
    );
    expect(heldNative.cleancloudPresence).toBe("absent");
    expect(heldNative.cleancloudDisposition).toBe("missing");
    expect(heldNative.disposition).toBe("current");
    expect(heldNative.eligiblePopulation).toBe("not_evaluated");
    expect(heldNative.withholdingSentence).toBeNull();
    expect(heldNative.coverageWatermark).toBeNull();
    expect(heldNative.lastSuccessfulSyncAt).toBeNull();
    expect(heldNative.missingIsNoCustomers).toBe(false);
    assertNoCustomerIdentity(heldNative);

    const emptyNative = diagnose(
      coverageOf({
        nativeLastSuccessAt: null,
        cleancloud: "absent",
        cleancloudLastSuccessAt: null,
        ranges: [],
        receipts: [],
      })
    );
    expect(emptyNative.cleancloudPresence).toBe("absent");
    expect(emptyNative.disposition).toBe("current");
    expect(emptyNative.eligiblePopulation).toBe("empty_verified");
    expect(emptyNative.interpretEmptyAsNoCustomers).toBe(true);
    expect(emptyNative.missingIsNoCustomers).toBe(false);
    expect(emptyNative.withholdingSentence).toBeNull();
    assertNoCustomerIdentity(emptyNative);
  });

  it("withholds a book that is not current", () => {
    const coverage = coverageOf({
      now: AFTER_DUE,
      ranges: [range("2026-09-01", "2026-09-19", new Date("2026-09-20T01:00:00.000Z"))],
    });
    const diagnostic = diagnoseCustomerTruthFreshness({
      coverage,
      importer: {
        lastSuccessfulSyncAt: "2026-09-20T01:00:00.000Z",
        latestAttempt: { at: "2026-09-20T01:00:00.000Z", outcome: "imported" },
      },
      now: AFTER_DUE,
    });

    expect(coverage.book.current).toBe(false);
    expect(diagnostic.disposition).toBe("stale");
    expect(diagnostic.eligiblePopulation).toBe("withheld");
    expect(diagnostic.interpretEmptyAsNoCustomers).toBe(false);
    expect(diagnostic.withholdingSentence).toBe(
      claireCustomerTruthWithholdingSentence(diagnostic.disposition)
    );
    expect(diagnostic.withholdingSentence).toMatch(/Personalized outreach is withheld/);
    expect(diagnostic.coverageWatermark).toBe("2026-09-19");
    assertNoCustomerIdentity(diagnostic);
  });

  it("names a partial book coverage_incomplete and still withholds it", () => {
    const diagnostic = diagnose(
      coverageOf({
        cleancloud: "disconnected",
        cleancloudLastSuccessAt: new Date("2026-06-01T00:00:00.000Z"),
        ranges: [],
        receipts: [],
      })
    );
    expect(diagnostic.disposition).toBe("coverage_incomplete");
    expect(diagnostic.cleancloudPresence).toBe("held");
    expect(diagnostic.eligiblePopulation).toBe("withheld");
    expect(diagnostic.withholdingSentence).toBe(
      "CleanCloud customer truth is coverage_incomplete. Personalized outreach is withheld until the book is current."
    );
    expect(diagnostic.interpretEmptyAsNoCustomers).toBe(false);
    assertNoCustomerIdentity(diagnostic);
  });

  it("does not treat an older failed attempt as the latest failure", () => {
    const diagnostic = diagnose(
      coverageOf({
        ranges: [range("2026-09-01", "2026-09-19", completedAt)],
      }),
      {
        lastSuccessfulSyncAt: completedAt.toISOString(),
        latestAttempt: { at: "2026-09-19T01:00:00.000Z", outcome: "failed" },
      }
    );
    expect(diagnostic.disposition).toBe("current");
    expect(diagnostic.latestAttemptFailed).toBe(false);
    expect(diagnostic.eligiblePopulation).toBe("not_evaluated");
  });

  it("names a missing CleanCloud connection without calling absence zero customers", () => {
    const diagnostic = diagnose(
      coverageOf({
        cleancloud: "absent",
        cleancloudLastSuccessAt: null,
        ranges: [],
        receipts: [],
      }),
      null
    );
    expect(diagnostic.coverageGap).toBe("cleancloud_not_connected");
    expect(diagnostic.cleancloudPresence).toBe("absent");
    expect(diagnostic.missingIsNoCustomers).toBe(false);
    expect(diagnostic.eligiblePopulation).not.toBe("empty_verified");
    assertNoCustomerIdentity(diagnostic);
  });

  it("prepares a production candidate diagnostic and does not execute it", () => {
    expect(productionCandidateDiagnosticPlan({})).toEqual({
      executes: false,
      selectsIdentityColumns: false,
      procedure: "customerTruthFreshness.diagnostic",
      reason: "Missing founder authorization. No production read was opened.",
    });
    expect(
      productionCandidateDiagnosticPlan({
        authorization: "founder_authorized_non_identifying",
      }).executes
    ).toBe(false);
    expect(diagnose(null, null).coverageGap).toBe("coverage_unreadable");
  });

  it("fails closed without a database when coverage cannot be read", async () => {
    const priorDatabase = process.env.DATABASE_URL;
    const priorAllow = process.env.ALLOW_TEST_DB;
    delete process.env.DATABASE_URL;
    delete process.env.ALLOW_TEST_DB;
    try {
      const diagnostic = await loadCustomerTruthFreshnessDiagnostic({
        tenantId: "freshness-diagnostic-unread",
        now: BEFORE_DUE,
      });
      expect(diagnostic.disposition).toBe("source_unavailable");
      expect(diagnostic.eligiblePopulation).toBe("withheld");
      expect(diagnostic.interpretEmptyAsNoCustomers).toBe(false);
      expect(diagnostic.withholdingSentence).toMatch(/source_unavailable/);
      assertNoCustomerIdentity(diagnostic);
    } finally {
      if (priorDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = priorDatabase;
      if (priorAllow === undefined) delete process.env.ALLOW_TEST_DB;
      else process.env.ALLOW_TEST_DB = priorAllow;
    }
  });
});

describe("Claire withholding sentences", () => {
  it("uses the dossier sentence for every non-current disposition and none for current", () => {
    expect(claireCustomerTruthWithholdingSentence("current")).toBeNull();
    for (const disposition of CUSTOMER_TRUTH_DISPOSITIONS) {
      if (disposition === "current") continue;
      expect(claireCustomerTruthWithholdingSentence(disposition)).toBe(
        `CleanCloud customer truth is ${disposition}. Personalized outreach is withheld until the book is current.`
      );
    }
  });
});

describe("customer truth freshness operator query", () => {
  const routerSource = readFileSync(
    new URL("./customerTruthFreshnessRouter.ts", import.meta.url),
    "utf8"
  );
  const system = readFileSync(new URL("../_core/systemRouter.ts", import.meta.url), "utf8");
  const dossier = readFileSync(new URL("../strategy/winBackDossier.ts", import.meta.url), "utf8");
  const gate = readFileSync(new URL("../strategy/dormantOutreachGate.ts", import.meta.url), "utf8");

  it("is a read-only operator query and does not weaken the current-book gate", () => {
    expect(routerSource).toContain(
      "diagnostic: customerTruthFreshnessDiagnosticProcedure"
    );
    expect(routerSource).toContain("legacyDayforgeTenantOperatorProcedure.query");
    expect(routerSource).not.toMatch(/\.mutation\s*\(/);
    expect(routerSource).not.toMatch(/\.input\s*\(/);
    expect(system).toContain("customerTruthFreshness: customerTruthFreshnessRouter");
    expect(dossier).toContain('if (freshness !== "current")');
    expect(dossier).toContain("claireCustomerTruthWithholdingSentence(freshness)");
    expect(dossier).not.toContain("communication_permissions");
    expect(gate).toContain('eq(customerContactPermissions.purpose, "win_back_marketing")');
    expect(gate).toContain('input.permission !== "opted_in"');
    expect(gate).toContain('input.freshness !== "current"');
  });
});
