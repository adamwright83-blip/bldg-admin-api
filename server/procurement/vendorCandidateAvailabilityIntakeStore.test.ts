import { describe, expect, it, vi } from "vitest";
import { VendorCandidateAvailabilityIntakeStore } from "./vendorCandidateAvailabilityIntakeStore";

const MOCK_ROW = {
  id: "intake-1", tenant_id: "default", candidate_id: "candidate-1", mobile_service_confirmed: "yes",
  service_areas_json: { areas: ["90027"] }, recurring_availability_json: [{ days: ["Tue"], startTime: "10:00", endTime: "13:00" }],
  minimum_notice_hours: 24, appointment_duration_minutes: 60, travel_buffer_minutes: 30,
  booking_url: "https://example.com/book", calendar_method: "booking_url", preferred_contact_channel: "phone",
  blackout_notes: null, onboarding_notes: null, created_by: "admin",
  created_at: new Date("2026-06-25T00:00:00.000Z"), updated_at: new Date("2026-06-25T00:00:00.000Z"),
};

function makePool(rows: Array<Record<string, unknown>> = []) {
  const execute = vi.fn().mockResolvedValue([rows, []]);
  return { pool: { execute } as never, execute };
}

describe("VendorCandidateAvailabilityIntakeStore -- getByCandidateId", () => {
  it("returns the intake row scoped to tenant and candidate", async () => {
    const { pool, execute } = makePool([MOCK_ROW]);
    const store = new VendorCandidateAvailabilityIntakeStore(pool);
    const result = await store.getByCandidateId({ tenantId: "default", candidateId: "candidate-1" });
    expect(result?.candidateId).toBe("candidate-1");
    expect(result?.mobileServiceConfirmed).toBe("yes");
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("WHERE tenant_id = ? AND candidate_id = ?"), ["default", "candidate-1"]);
  });

  it("returns null honestly when no intake exists -- never fabricates one", async () => {
    const { pool } = makePool([]);
    const store = new VendorCandidateAvailabilityIntakeStore(pool);
    const result = await store.getByCandidateId({ tenantId: "default", candidateId: "candidate-2" });
    expect(result).toBeNull();
  });
});

describe("VendorCandidateAvailabilityIntakeStore -- upsertForCandidate", () => {
  it("inserts with ON DUPLICATE KEY UPDATE, relying on the table's UNIQUE KEY for idempotency", async () => {
    const { pool, execute } = makePool([MOCK_ROW]);
    const store = new VendorCandidateAvailabilityIntakeStore(pool);
    const saved = await store.upsertForCandidate({
      tenantId: "default", candidateId: "candidate-1", mobileServiceConfirmed: "yes",
      bookingUrl: "https://example.com/book", createdBy: "admin",
    });
    expect(saved.candidateId).toBe("candidate-1");
    const insertCall = execute.mock.calls.find(([sql]) => /INSERT INTO/i.test(String(sql)));
    expect(String(insertCall?.[0])).toMatch(/ON DUPLICATE KEY UPDATE/i);
  });

  it("never writes to vendor_contact_attempts or any truth-bearing table", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "vendorCandidateAvailabilityIntakeStore.ts"), "utf8");
    const sqlLines = source.split("\n").filter(line => !line.trim().startsWith("//") && !line.trim().startsWith("*"));
    const sqlSource = sqlLines.join("\n");
    expect(sqlSource).not.toMatch(/FROM vendor_contact_attempts|INTO vendor_contact_attempts|provider_accepted|booking_confirmed|payment_authorized/);
  });

  it("never imports a calendar OAuth, send, or outreach adapter", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "vendorCandidateAvailabilityIntakeStore.ts"), "utf8");
    expect(source).not.toMatch(/google.*oauth|agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid/i);
  });
});
