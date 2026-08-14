import { describe, expect, it, vi } from "vitest";
import type { CommercialMission } from "../../shared/commercialMission";

const getCommercialMission = vi.fn<
  (input: { tenantId: string; missionId: number }) => Promise<CommercialMission | null>
>();

vi.mock("../commercialMissions/commercialMissionStore", () => ({
  getCommercialMission: (input: { tenantId: string; missionId: number }) =>
    getCommercialMission(input),
}));

import { enrichStopsWithLocation } from "./authoritativeVisitRouteService";

function missionWithAddress(address: string | null): CommercialMission {
  return {
    account: { address },
  } as CommercialMission;
}

describe("enrichStopsWithLocation", () => {
  it("attaches the real account address and a derived maps link", async () => {
    getCommercialMission.mockResolvedValueOnce(
      missionWithAddress("500 Real Ave, Los Angeles, CA")
    );
    const [stop] = await enrichStopsWithLocation("tenant-1", [
      { missionId: 1, requiresDriving: true },
    ]);
    expect(stop!.address).toBe("500 Real Ave, Los Angeles, CA");
    expect(stop!.navigationUrl).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=500%20Real%20Ave%2C%20Los%20Angeles%2C%20CA"
    );
  });

  it("fails closed to null — never invents an address — when the account has none on file", async () => {
    getCommercialMission.mockResolvedValueOnce(missionWithAddress(""));
    const [stop] = await enrichStopsWithLocation("tenant-1", [
      { missionId: 2, requiresDriving: false },
    ]);
    expect(stop!.address).toBeNull();
    expect(stop!.navigationUrl).toBeNull();
  });

  it("fails closed to null when the mission cannot be read at all", async () => {
    getCommercialMission.mockResolvedValueOnce(null);
    const [stop] = await enrichStopsWithLocation("tenant-1", [
      { missionId: 3, requiresDriving: false },
    ]);
    expect(stop!.address).toBeNull();
    expect(stop!.navigationUrl).toBeNull();
  });
});
