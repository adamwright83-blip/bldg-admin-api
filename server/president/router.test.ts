import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
vi.mock("../_core/env", () => ({ ENV: { ownerOpenId: "fixture-founder" } }));
vi.mock("./database", () => ({
  presidentPool: () => {
    throw new Error("Fixture infrastructure unavailable");
  },
}));
import { presidentRouter } from "./router";

const caller = (openId: string | null, role: string) =>
  presidentRouter.createCaller({
    user: openId ? { openId, role } : null,
    tenantId: "fixture-tenant",
    vendorSession: null,
  } as TrpcContext);
describe("President company founder authorization", () => {
  it.each([
    [null, "admin"],
    ["other-founder", "admin"],
    ["fixture-founder", "user"],
    ["tenant-operator", "driver"],
  ])("rejects %s / %s before any company DB access", async (openId, role) => {
    await expect(caller(openId, role).founderSurface()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller(openId, role).configureAuthority({
        policyVersion: "fixture",
        maxAutonomousUsdPerDay: 0,
        allowedRepositories: [],
        allowedEnvironments: [],
        prohibitedDomains: [],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("configured founder receives honest infrastructure failure", async () => {
    await expect(
      caller("fixture-founder", "admin").founderSurface()
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Fixture infrastructure unavailable",
    });
  });
});
