import { expect, type APIRequestContext } from "@playwright/test";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "goldline-proof-admin-pass";

/**
 * Restore the disposable proof tenant to the deterministic fixture.
 * Call from spec beforeAll so Fast Goldline is order-independent and a dirty
 * local proof DB does not require a human DROP DATABASE.
 */
export async function resetGoldlineProofWorld(request: APIRequestContext) {
  const login = await request.post("/api/auth/login", {
    data: { password: ADMIN_PASSWORD, role: "admin" },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  const reset = await request.post("/api/trpc/system.goldlineWorld.resetProofWorld", {
    data: { json: null },
    timeout: 120_000,
  });
  expect(reset.ok(), await reset.text()).toBeTruthy();
}
