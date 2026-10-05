import { describe, expect, it } from "vitest";
import { adminProcedure, protectedProcedure, router } from "./trpc";

const authorityRouter = router({
  generic: protectedProcedure.query(() => "generic-ok"),
  platform: adminProcedure.query(() => "platform-ok"),
});

function caller(user: { openId: string; role: "admin" | "driver" | "user" } | null) {
  return authorityRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: user as never,
    vendorSession: null,
    tenantId: "default",
  });
}

describe("platform authority boundary", () => {
  it("rejects the legacy shared admin from platform-only procedures", async () => {
    await expect(
      caller({ openId: "admin-owner", role: "admin" }).platform()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects demo identities from generic authenticated and platform-only procedures", async () => {
    const staleAdminDemo = caller({
      openId: "goldline-demo:wright-contractors",
      role: "admin",
    });
    await expect(staleAdminDemo.generic()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(staleAdminDemo.platform()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("still permits a non-shared authenticated platform administrator", async () => {
    await expect(
      caller({ openId: "oauth-platform-admin", role: "admin" }).platform()
    ).resolves.toBe("platform-ok");
  });

  it("keeps ordinary authenticated sessions on generic protected procedures", async () => {
    await expect(
      caller({ openId: "tenant-member", role: "user" }).generic()
    ).resolves.toBe("generic-ok");
  });
});
