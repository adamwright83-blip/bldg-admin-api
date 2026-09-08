import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserByOpenId: vi.fn(),
}));

vi.mock("../db", () => ({ getUserByOpenId: mocks.getUserByOpenId }));

vi.mock("../_core/env", () => ({
  ENV: {
    ownerOpenId: "owner-open-id",
  },
}));

import { ENV } from "../_core/env";
import { resolveAutonomousNightShiftScope } from "./nightShiftScope";

describe("resolveAutonomousNightShiftScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ENV.ownerOpenId = "owner-open-id";
  });

  it("resolves scope from OWNER_OPEN_ID and a real user row", async () => {
    mocks.getUserByOpenId.mockResolvedValue({
      id: 42,
      tenantId: "default",
      openId: "owner-open-id",
    });
    await expect(resolveAutonomousNightShiftScope()).resolves.toEqual({
      tenantId: "default",
      operatorId: "owner-open-id",
      userId: "42",
    });
  });

  it("fails closed when OWNER_OPEN_ID is missing", async () => {
    ENV.ownerOpenId = "   ";
    await expect(resolveAutonomousNightShiftScope()).resolves.toBeNull();
  });

  it("fails closed when the owner user row does not exist", async () => {
    mocks.getUserByOpenId.mockResolvedValue(undefined);
    await expect(resolveAutonomousNightShiftScope()).resolves.toBeNull();
  });
});
