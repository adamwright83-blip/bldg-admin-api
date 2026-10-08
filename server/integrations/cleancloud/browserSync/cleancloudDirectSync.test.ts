/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { describe, expect, it, vi } from "vitest";
import {
  getCleanCloudCredentials,
  isCleanCloudDirectConfigured,
} from "./cleancloudDirectSync";
import {
  isDirectSyncDue,
  isTimeBasedSyncDue,
  isTenantDirectSyncDue,
} from "./cleancloudDirectScheduler";
import * as sourceCoverageModule from "../../../analytics/sourceCoverage";

describe("cleancloud direct sync credentials & configuration", () => {
  it("detects when direct sync credentials are missing", () => {
    const creds = getCleanCloudCredentials({
      baseUrl: "https://cleancloudapp.com/store",
      username: "",
      password: "",
    });
    expect(creds).toBeNull();
    expect(
      isCleanCloudDirectConfigured({
        baseUrl: "https://cleancloudapp.com/store",
        username: "",
        password: "",
      })
    ).toBe(false);
  });

  it("extracts valid direct sync credentials when present", () => {
    const creds = getCleanCloudCredentials({
      baseUrl: "https://cleancloudapp.com/store",
      username: "operator@example.com",
      password: "secretpassword123",
    });
    expect(creds).toEqual({
      baseUrl: "https://cleancloudapp.com/store",
      username: "operator@example.com",
      password: "secretpassword123",
    });
    expect(
      isCleanCloudDirectConfigured({
        username: "operator@example.com",
        password: "secretpassword123",
      })
    ).toBe(true);
  });
});

describe("canonical coverage-driven scheduler due checks", () => {
  it("triggers direct sync when CleanCloud coverage status is stale", async () => {
    const spy = vi
      .spyOn(sourceCoverageModule, "loadBusinessSourceCoverage")
      .mockResolvedValueOnce({
        contractVersion: 1,
        tenantId: "tenant-x",
        checkedAt: new Date().toISOString(),
        timeZone: "America/Los_Angeles",
        sources: [
          {
            sourceId: "cleancloud",
            name: "CleanCloud",
            type: "cleancloud_paid_book",
            availability: "available",
            includedInCombinedBook: true,
            status: "stale",
            lastSuccessfulAssimilationAt: null,
            assimilationKind: "never",
            coveredThrough: "2026-09-18",
            provenFrom: "2026-09-01",
            expectedThrough: "2026-09-29",
            records: "readable",
            supportsExhaustiveCurrentClaim: false,
            emptyReadMeansNoRecords: false,
            reason: "The due Gumball checkpoint is not covered.",
            provenance: {
              bindingState: "bound",
              schedule: "gumball_daily_18_america_los_angeles",
              coverageBasis: "orders_created",
              receiptProvenance: "browser_sync_receipt",
              paymentEventsProven: false,
              decidedBy: "deterministic_rules",
            },
          },
        ],
        book: {
          status: "stale",
          exhaustiveCurrent: false,
          current: false,
          scope: {
            native: "unavailable",
            cleancloudOrdersCreated: null,
            cleancloudEconomicEvents: null,
          },
          paymentEventsProven: false,
          knownRecordsReadable: true,
          interpretEmptyAsNoCustomers: false,
          outsideProvenSpan: "unknown_not_empty",
          allCustomersLicensed: false,
          staleIsZero: false,
          missingIsNoCustomers: false,
        },
        blockingSources: [],
      });

    const result = await isTenantDirectSyncDue("tenant-x");
    expect(result.due).toBe(true);
    expect(result.reason).toContain('CleanCloud coverage status is "stale"');
    spy.mockRestore();
  });

  it("triggers direct sync when orders-created is fresh BUT payment/economic events are unproven", async () => {
    // This is the exact partial-sync vulnerability identified in review
    const spy = vi
      .spyOn(sourceCoverageModule, "loadBusinessSourceCoverage")
      .mockResolvedValueOnce({
        contractVersion: 1,
        tenantId: "tenant-x",
        checkedAt: new Date().toISOString(),
        timeZone: "America/Los_Angeles",
        sources: [
          {
            sourceId: "cleancloud",
            name: "CleanCloud",
            type: "cleancloud_paid_book",
            availability: "available",
            includedInCombinedBook: true,
            status: "fresh", // Orders (Sales) covered through expected day
            lastSuccessfulAssimilationAt: "2026-09-29T18:00:00Z",
            assimilationKind: "customer_truth_refreshed",
            coveredThrough: "2026-09-29",
            provenFrom: "2026-09-01",
            expectedThrough: "2026-09-29",
            records: "readable",
            supportsExhaustiveCurrentClaim: true,
            emptyReadMeansNoRecords: false,
            reason: "Orders (Sales) covers checkpoint and customer truth was assimilated.",
            provenance: {
              bindingState: "bound",
              schedule: "gumball_daily_18_america_los_angeles",
              coverageBasis: "orders_created",
              receiptProvenance: "browser_sync_receipt",
              paymentEventsProven: false, // Orders (Revenue) missing!
              decidedBy: "deterministic_rules",
            },
          },
        ],
        book: {
          status: "fresh",
          exhaustiveCurrent: true,
          current: true,
          scope: {
            native: "unavailable",
            cleancloudOrdersCreated: null,
            cleancloudEconomicEvents: null,
          },
          paymentEventsProven: false,
          knownRecordsReadable: true,
          interpretEmptyAsNoCustomers: false,
          outsideProvenSpan: "unknown_not_empty",
          allCustomersLicensed: false,
          staleIsZero: false,
          missingIsNoCustomers: false,
        },
        blockingSources: [],
      });

    // Even if lastSuccessAt was 2 minutes ago from a sales-only browser sync,
    // the canonical coverage engine detects paymentEventsProven is false and triggers sync!
    const result = await isTenantDirectSyncDue(
      "tenant-x",
      new Date(),
      new Date() // 0 seconds ago
    );
    expect(result.due).toBe(true);
    expect(result.reason).toContain("economic/payment events are not proven");
    spy.mockRestore();
  });

  it("does not trigger direct sync when CleanCloud is fully fresh and payment events are proven", async () => {
    const spy = vi
      .spyOn(sourceCoverageModule, "loadBusinessSourceCoverage")
      .mockResolvedValueOnce({
        contractVersion: 1,
        tenantId: "tenant-x",
        checkedAt: new Date().toISOString(),
        timeZone: "America/Los_Angeles",
        sources: [
          {
            sourceId: "cleancloud",
            name: "CleanCloud",
            type: "cleancloud_paid_book",
            availability: "available",
            includedInCombinedBook: true,
            status: "fresh",
            lastSuccessfulAssimilationAt: "2026-09-29T18:00:00Z",
            assimilationKind: "customer_truth_refreshed",
            coveredThrough: "2026-09-29",
            provenFrom: "2026-09-01",
            expectedThrough: "2026-09-29",
            records: "readable",
            supportsExhaustiveCurrentClaim: true,
            emptyReadMeansNoRecords: false,
            reason: "Orders and Revenue cover checkpoint.",
            provenance: {
              bindingState: "bound",
              schedule: "gumball_daily_18_america_los_angeles",
              coverageBasis: "orders_created",
              receiptProvenance: "browser_sync_receipt",
              paymentEventsProven: true, // Both proven!
              decidedBy: "deterministic_rules",
            },
          },
        ],
        book: {
          status: "fresh",
          exhaustiveCurrent: true,
          current: true,
          scope: {
            native: "unavailable",
            cleancloudOrdersCreated: null,
            cleancloudEconomicEvents: null,
          },
          paymentEventsProven: true,
          knownRecordsReadable: true,
          interpretEmptyAsNoCustomers: false,
          outsideProvenSpan: "unknown_not_empty",
          allCustomersLicensed: false,
          staleIsZero: false,
          missingIsNoCustomers: false,
        },
        blockingSources: [],
      });

    const result = await isTenantDirectSyncDue("tenant-x");
    expect(result.due).toBe(false);
    expect(result.reason).toContain("fully fresh and payment events proven");
    spy.mockRestore();
  });

  it("does not trigger direct sync for tenants where CleanCloud is not held", async () => {
    const spy = vi
      .spyOn(sourceCoverageModule, "loadBusinessSourceCoverage")
      .mockResolvedValueOnce({
        contractVersion: 1,
        tenantId: "tenant-native-only",
        checkedAt: new Date().toISOString(),
        timeZone: "America/Los_Angeles",
        sources: [
          {
            sourceId: "cleancloud",
            name: "CleanCloud",
            type: "cleancloud_paid_book",
            availability: "not_held",
            includedInCombinedBook: false,
            status: "unavailable",
            lastSuccessfulAssimilationAt: null,
            assimilationKind: "never",
            coveredThrough: null,
            provenFrom: null,
            expectedThrough: null,
            records: "unknown",
            supportsExhaustiveCurrentClaim: false,
            emptyReadMeansNoRecords: false,
            reason: "This tenant has no CleanCloud source on file.",
            provenance: {
              bindingState: "absent",
              schedule: "none",
              coverageBasis: null,
              receiptProvenance: null,
              paymentEventsProven: false,
              decidedBy: "deterministic_rules",
            },
          },
        ],
        book: {
          status: "fresh",
          exhaustiveCurrent: true,
          current: true,
          scope: {
            native: "system_of_record",
            cleancloudOrdersCreated: null,
            cleancloudEconomicEvents: null,
          },
          paymentEventsProven: true,
          knownRecordsReadable: true,
          interpretEmptyAsNoCustomers: false,
          outsideProvenSpan: "unknown_not_empty",
          allCustomersLicensed: false,
          staleIsZero: false,
          missingIsNoCustomers: false,
        },
        blockingSources: [],
      });

    const result = await isTenantDirectSyncDue("tenant-native-only");
    expect(result.due).toBe(false);
    expect(result.reason).toContain("not held");
    spy.mockRestore();
  });
});

describe("time-based fallback heuristics", () => {
  it("marks sync due when there has never been a successful sync", () => {
    const due = isTimeBasedSyncDue(null, new Date("2026-09-29T18:05:00.000Z"));
    expect(due).toBe(true);
  });

  it("marks sync due when last sync was more than 20 hours ago", () => {
    const now = new Date("2026-09-29T19:00:00.000Z");
    const last = new Date(now.getTime() - 21 * 3600 * 1000);
    const due = isTimeBasedSyncDue(last, now);
    expect(due).toBe(true);
  });

  it("marks sync due after 6 PM Pacific when last success was from a prior day", () => {
    const now = new Date("2026-09-30T01:05:00.000Z");
    const last = new Date("2026-09-28T17:00:00.000Z");
    const due = isTimeBasedSyncDue(last, now);
    expect(due).toBe(true);
  });

  it("does not trigger redundant sync if already synced today within 20 hours", () => {
    const now = new Date("2026-09-30T01:15:00.000Z");
    const last = new Date("2026-09-30T01:02:00.000Z");
    const due = isTimeBasedSyncDue(last, now);
    expect(due).toBe(false);
  });

  it("does not trigger before 6 PM Pacific if last sync was 5 hours ago", () => {
    const now = new Date("2026-09-29T21:00:00.000Z");
    const last = new Date("2026-09-29T16:00:00.000Z");
    const due = isTimeBasedSyncDue(last, now);
    expect(due).toBe(false);
  });
});
