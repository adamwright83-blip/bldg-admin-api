import { describe, expect, it } from "vitest";
import { adminProcedure, router } from "./trpc";

const testRouter = router({
  platformOnly: adminProcedure.query(() => "ok"),
});

function callerFor(user: { openId: string; role: "admin" | "driver" | "user" }) {
  return testRouter.createCaller({
    req: { headers: {} },
    res: {},
    user: {
      id: 1,
      openId: user.openId,
      role: user.role,
      name: null,
      email: null,
      loginMethod: "test",
      tenantId: "default",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    vendorSession: null,
    tenantId: "default",
  } as never);
}

describe("platform admin principal", () => {
  it("allows a real platform admin identity", async () => {
    await expect(
      callerFor({ openId: "oauth:platform-admin", role: "admin" }).platformOnly()
    ).resolves.toBe("ok");
  });

  it("rejects the legacy shared-password admin identity", async () => {
    await expect(
      callerFor({ openId: "admin-owner", role: "admin" }).platformOnly()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a demo identity even if a stale session says role admin", async () => {
    await expect(
      callerFor({ openId: "goldline-demo:wright-contractors", role: "admin" }).platformOnly()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not accidentally promote an ordinary tenant user", async () => {
    await expect(
      callerFor({ openId: "dayforge:member-a", role: "user" }).platformOnly()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
