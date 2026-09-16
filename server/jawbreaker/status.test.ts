import { describe, expect, it } from "vitest";
import { speakJawbreakerPipelineStatus, type JawbreakerPipelineStatus } from "./status";

function base(): JawbreakerPipelineStatus {
  return {
    checkedAt: "2026-09-15T20:00:00.000Z",
    timeZone: "America/Los_Angeles",
    pairedStore: { storeId: "123", storeLabel: "Laundry Farm" },
    gumball: { latestExport: null, latestFailure: null },
    jawbreaker: {
      latestSuccess: null,
      latestFailure: null,
      latestHeartbeat: null,
      pendingCount: null,
      oldestPending: null,
      latestReceipt: null,
    },
  };
}

describe("Jawbreaker pipeline speech", () => {
  it("does not equate a Gumball export with an import", () => {
    const status = base();
    status.gumball.latestExport = {
      at: "2026-09-15T18:00:00.000Z",
      outcome: "extension_exported",
      message: null,
      rowCount: null,
    };
    const spoken = speakJawbreakerPipelineStatus(status);
    expect(spoken).toMatch(/Gumball completed an export/i);
    expect(spoken).toMatch(/do not have a confirmed Jawbreaker import/i);
  });

  it("reports queued inbox work independently", () => {
    const status = base();
    status.gumball.latestExport = {
      at: "2026-09-15T18:00:00.000Z",
      outcome: "extension_exported",
      message: null,
      rowCount: null,
    };
    status.jawbreaker.latestHeartbeat = {
      at: "2026-09-15T18:01:00.000Z",
      outcome: "jawbreaker_heartbeat",
      message: "gumball-orders_sales-store-123-2026-09-15-2026-09-15-123e4567-e89b-42d3-a456-426614174000.csv | 2026-09-15T18:00:30.000Z",
      rowCount: 1,
    };
    status.jawbreaker.pendingCount = 1;
    status.jawbreaker.oldestPending = status.jawbreaker.latestHeartbeat.message;
    expect(speakJawbreakerPipelineStatus(status)).toMatch(/1 artifact still waiting/i);
  });

  it("treats zero new rows as a successful import", () => {
    const status = base();
    status.jawbreaker.latestSuccess = {
      at: "2026-09-15T18:02:00.000Z",
      outcome: "jawbreaker_imported",
      message: null,
      rowCount: 10,
    };
    status.jawbreaker.latestHeartbeat = {
      at: "2026-09-15T18:03:00.000Z",
      outcome: "jawbreaker_heartbeat",
      message: null,
      rowCount: 0,
    };
    status.jawbreaker.pendingCount = 0;
    status.jawbreaker.latestReceipt = { inserted: 0, updated: 0, unchanged: 10 };
    const spoken = speakJawbreakerPipelineStatus(status);
    expect(spoken).toMatch(/confirmed a CleanCloud import/i);
    expect(spoken).toMatch(/0 new, 0 updated, 10 unchanged/i);
  });
});
