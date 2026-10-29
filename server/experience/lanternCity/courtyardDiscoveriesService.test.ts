import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetCourtyardDiscoveriesTestStore,
  loadCourtyardDiscoveries,
  recordCourtyardObservation,
} from "./courtyardDiscoveriesService";
import { isSpecialDeliveryEnabled } from "./specialDeliveryFlag";

describe("courtyard discoveries service", () => {
  beforeEach(() => _resetCourtyardDiscoveriesTestStore());

  it("remembers per business and neighbourhood, and counts a retried flight once", async () => {
    const flight = {
      kind: "flight" as const,
      flight: {
        flightId: "f_abcdef1",
        delivered: true,
        via: ["fan", "cup0", "cup1", "cup2"],
        cups: [0, 1, 2],
      },
    };
    await recordCourtyardObservation({
      tenantId: "t_one",
      observation: flight,
    });
    await recordCourtyardObservation({
      tenantId: "t_one",
      observation: flight,
    });
    const one = await loadCourtyardDiscoveries({ tenantId: "t_one" });
    expect(one.deliveries).toBe(1);
    expect(one.discoveries.three_cups?.count).toBe(1);
    const other = await loadCourtyardDiscoveries({ tenantId: "t_two" });
    expect(other.deliveries).toBe(0);
    expect(other.discoveries).toEqual({});
  });
});

describe("special delivery flag", () => {
  it("is on only for listed businesses, never by wildcard", () => {
    expect(
      isSpecialDeliveryEnabled("laundry_farm", {} as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(
      isSpecialDeliveryEnabled("laundry_farm", {
        JOYSTICK_SPECIAL_DELIVERY_TENANTS: "*",
      } as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(
      isSpecialDeliveryEnabled("laundry_farm", {
        JOYSTICK_SPECIAL_DELIVERY_TENANTS: " default, laundry_farm ",
      } as NodeJS.ProcessEnv)
    ).toBe(true);
    expect(
      isSpecialDeliveryEnabled("other", {
        JOYSTICK_SPECIAL_DELIVERY_TENANTS: "laundry_farm",
      } as NodeJS.ProcessEnv)
    ).toBe(false);
  });
});
