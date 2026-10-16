import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalPhoneCustomerId,
  isSilverLakeRecoveryCustomer,
  resolveHomeCityClick,
  silverLakeVillagerPath,
  type HomeCityCustomer,
} from "./homeCityClick";

const MEI: HomeCityCustomer = {
  identityKey: "hash-mei",
  displayName: "Mei Lin",
  phone: "3105550141",
  address: "2418 Silver Lake Blvd, Los Angeles, CA 90039",
  cadence: { state: "dimming" },
  location: {
    latitude: 34.098,
    longitude: -118.267,
    canonicalAddress: "2418 Silver Lake Blvd, Los Angeles, CA 90039",
  },
};

describe("resolveHomeCityClick", () => {
  it("keeps Opus LA on building inspection and Century Park East on Tower Wars", () => {
    expect(resolveHomeCityClick({ kind: "building", buildingId: "opus_la" })).toEqual({
      action: "navigate",
      path: "/growth/opus-la-inspection",
    });
    expect(resolveHomeCityClick({ kind: "building", buildingId: "century_park_east" })).toEqual({
      action: "navigate",
      path: "/growth/tower-wars?building=century_park_east",
    });
  });

  it("does not send a customer inspection or a recovery customer through Tower Wars", () => {
    expect(
      resolveHomeCityClick({
        kind: "customer_inspection",
        customerId: "phone:3105550102",
      })
    ).toEqual({ action: "inspect", customerId: "phone:3105550102" });
    const recovery = resolveHomeCityClick({
      kind: "recovery_customer",
      customerId: "phone:3105550141",
      territoryId: "silver-lake",
    });
    expect(recovery).toEqual({
      action: "navigate",
      path: silverLakeVillagerPath("phone:3105550141"),
    });
    expect(recovery.action === "navigate" && recovery.path).not.toMatch(/tower-wars/);
    expect(
      resolveHomeCityClick({
        kind: "recovery_customer",
        customerId: "phone:3105550141",
        territoryId: "century-city",
      })
    ).toEqual({ action: "none" });
  });

  it("uses Mei Lin's phone identity on the villager route", () => {
    expect(canonicalPhoneCustomerId("(310) 555-0141")).toBe("phone:3105550141");
    expect(isSilverLakeRecoveryCustomer(MEI)).toBe(true);
    expect(isSilverLakeRecoveryCustomer({ ...MEI, cadence: { state: "active" } })).toBe(false);
    const path = silverLakeVillagerPath("phone:3105550141");
    expect(path).toBe(
      "/growth/lantern-city?cozy=1&territory=silver-lake&customer=phone%3A3105550141"
    );
    expect(new URLSearchParams(path.split("?")[1]).get("customer")).toBe("phone:3105550141");
  });

  it("calls the building resolver only for strongholds", () => {
    const source = readFileSync(new URL("./homeCityClick.ts", import.meta.url), "utf8");
    expect(source).toContain("resolveLanternCityClick");
    expect(source).not.toContain("kind === \"recovery_customer\" && resolveLanternCityClick");
    const home = readFileSync(new URL("./JoystickHome.tsx", import.meta.url), "utf8");
    expect(home).toContain("resolveHomeCityClick");
    expect(home).toContain("item.destinationPath");
    expect(home).not.toContain("lanternClickResolver");
  });
});
