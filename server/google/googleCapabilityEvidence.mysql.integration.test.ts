import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCapabilityEvidence, recordCapabilityEvidence } from "./googleCapabilityEvidence";
import { capabilityStateFrom } from "./googleWorldService";

/**
 * Google capability evidence on real MySQL (migration 0158): a failure, then a success, survive a "restart" (read
 * back from the table, not memory), and the capability view reads them with their times. Disposable database only.
 */
const url = process.env.DATABASE_URL ?? "";
const allowed = (() => {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1"].includes(parsed.hostname) && ["/google_integrations_test", "/first_ten_test"].includes(parsed.pathname);
  } catch {
    return false;
  }
})();

describe.skipIf(!allowed)("Google capability evidence on MySQL", () => {
  let connection: mysql.Connection;
  beforeAll(async () => {
    connection = await mysql.createConnection(url);
    await connection.query("DELETE FROM google_capability_evidence");
  });
  afterAll(async () => connection?.end());

  it("keeps the newest answer, the last success and the last failure across restarts", async () => {
    await recordCapabilityEvidence({ capability: "geocoding", status: "permission_denied", success: false, at: new Date("2026-10-30T10:00:00Z"), error: "REQUEST_DENIED", latencyMs: 40 });
    let evidence = (await loadCapabilityEvidence()).get("geocoding")!;
    expect(evidence).toMatchObject({ lastStatus: "permission_denied", lastSuccessAt: null, lastError: "REQUEST_DENIED" });
    expect(evidence.lastFailureAt?.toISOString()).toBe("2026-10-30T10:00:00.000Z");

    await recordCapabilityEvidence({ capability: "geocoding", status: "available", success: true, at: new Date("2026-10-31T09:00:00Z"), error: null, latencyMs: 25 });
    evidence = (await loadCapabilityEvidence()).get("geocoding")!;
    expect(evidence.lastStatus).toBe("available");
    expect(evidence.lastSuccessAt?.toISOString()).toBe("2026-10-31T09:00:00.000Z");
    expect(evidence.lastFailureAt?.toISOString()).toBe("2026-10-30T10:00:00.000Z");

    // a new process: no telemetry in memory, only what was kept
    const state = capabilityStateFrom({ name: "geocoding", hasCredential: true, memory: null, persisted: evidence, now: new Date("2026-10-31T12:00:00Z") });
    expect(state).toMatchObject({ status: "available", lastCheckedAt: "2026-10-31T09:00:00.000Z", lastFailureAt: "2026-10-30T10:00:00.000Z" });
  });
});
