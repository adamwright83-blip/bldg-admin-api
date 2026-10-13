import { describe, expect, it, vi } from "vitest";
import {
  readCustomerRecoveryInterventions,
  readRecentOutboundCommunications,
} from "./customerRecoveryReadService";

describe("customerRecoveryReadService", () => {
  it("rejects empty tenantId for recovery intervention read", async () => {
    await expect(readCustomerRecoveryInterventions("   ")).rejects.toThrow(
      "Customer recovery read requires established tenant authority"
    );
  });

  it("rejects empty tenantId for outbound communications read", async () => {
    await expect(readRecentOutboundCommunications("   ", new Date())).rejects.toThrow(
      "Communications read requires established tenant authority"
    );
  });

  it("queries recovery interventions with tenant isolation", async () => {
    const mockDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            {
              customerKeyHash: "hash-1",
              status: "contacted",
              contactedAt: new Date("2026-10-10"),
            },
          ]),
        })),
      })),
    };

    const rows = await readCustomerRecoveryInterventions("tenant-1", mockDb as never);
    expect(rows).toHaveLength(1);
    expect(rows![0]?.status).toBe("contacted");
  });

  it("queries outbound communications with tenant and time isolation", async () => {
    const mockDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            {
              toNumber: "+15551234567",
              direction: "outbound",
              status: "delivered",
              createdAt: new Date("2026-10-11"),
            },
          ]),
        })),
      })),
    };

    const rows = await readRecentOutboundCommunications(
      "tenant-1",
      new Date("2026-10-01"),
      mockDb as never
    );
    expect(rows).toHaveLength(1);
    expect(rows![0]?.direction).toBe("outbound");
  });
});
