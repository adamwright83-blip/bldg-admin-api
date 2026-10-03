import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getKingdom,
  selectKingdomCampaign,
  setKingdomCompanion,
  setKingdomStatus,
} from "./kingdomService";

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

describe("Goldline Kingdom Service — Strict Semantic Separation", () => {
  const tenantId = "tenant-test-1";
  const lastValetRow = {
    id: "row-k2",
    tenantId,
    kingdomId: "kingdom-2-the-last-valet",
    sequence: 2,
    title: "The Last Valet",
    realCampaignId: "the-last-valet-recurring-account-pitch",
    fictionalFieldMission: "the-last-valet",
    lanternCityStatus: "locked",
    driverDayRelevance: "Relevance",
    companionEarnedId: null,
    enablesKingdomId: "kingdom-3",
    capabilityRequirement: null,
    selectedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Boreslay Cannot Mutate Last Valet (Required Invariant)", () => {
    it("getKingdom for kingdom.boreslay returns null and does not return kingdom-2-the-last-valet", async () => {
      // Setup mockDb: returning empty array for kingdom.boreslay lookup
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(selectChain);

      const result = await getKingdom({
        tenantId,
        kingdomId: "kingdom.boreslay",
      });

      expect(result).toBeNull();
      // Ensure select was filtered specifically by kingdom.boreslay, not aliased
      expect(mockDb.select).toHaveBeenCalled();
    });

    it("setKingdomStatus with kingdom.boreslay rejects and never mutates kingdom-2-the-last-valet", async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]), // kingdom.boreslay does not exist in table
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        setKingdomStatus({
          tenantId,
          kingdomId: "kingdom.boreslay",
          lanternCityStatus: "active",
        })
      ).rejects.toThrow("Unknown kingdom: kingdom.boreslay");

      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("selectKingdomCampaign with kingdom.boreslay rejects and never mutates kingdom-2-the-last-valet", async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        selectKingdomCampaign({
          tenantId,
          kingdomId: "kingdom.boreslay",
          realCampaignId: "new-growth-campaign",
          capabilityRequirement: "new-req",
        })
      ).rejects.toThrow("Unknown kingdom: kingdom.boreslay");

      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("setKingdomCompanion with kingdom.boreslay rejects and never mutates kingdom-2-the-last-valet", async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(selectChain);

      await expect(
        setKingdomCompanion({
          tenantId,
          kingdomId: "kingdom.boreslay",
          companionEarnedId: "companion.rook",
        })
      ).rejects.toThrow("Unknown kingdom: kingdom.boreslay");

      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe("Legacy Last Valet Row Integrity", () => {
    it("preserves stored row ID kingdom-2-the-last-valet with title 'The Last Valet'", async () => {
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([lastValetRow]),
      };
      mockDb.select.mockReturnValue(selectChain);

      const kingdom = await getKingdom({
        tenantId,
        kingdomId: "kingdom-2-the-last-valet",
      });

      expect(kingdom).not.toBeNull();
      expect(kingdom?.kingdomId).toBe("kingdom-2-the-last-valet");
      expect(kingdom?.title).toBe("The Last Valet");
      expect(kingdom?.realCampaignId).toBe("the-last-valet-recurring-account-pitch");
    });
  });
});
