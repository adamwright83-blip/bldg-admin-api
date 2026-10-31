import { expect, test } from "@playwright/test";
import { FAKE } from "./journey";

/**
 * A controlled preview (FIRST_TEN_E2E_MODE=preview): the server answers only a browser holding the preview pass it
 * issues for ?crew=<JOYSTICK_FIRST_TEN_PREVIEW_CODE>. Without it, the page is today's funnel and every first-ten call is
 * refused; with it, the first ten minutes open and the code is gone from the address bar.
 */
const CODE = "first-ten-e2e-preview-code-0000";
const start = (base: string) =>
  fetch(`${base}/api/trpc/system.firstTenMinutes.start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: { requestId: "11111111-1111-4111-8111-111111111111", kind: "example" } }),
  });

test.skip(process.env.FIRST_TEN_E2E_MODE !== "preview", "runs with FIRST_TEN_E2E_MODE=preview");

test("preview is server-enforced: no pass, nothing opens; the right code opens it, and leaves no code in the URL", async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  await request.post(`${FAKE}/__reset`);
  await page.emulateMedia({ reducedMotion: "reduce" });

  // the old opt-in link and a wrong code open nothing
  for (const link of ["/joystick-start?crew=1", "/joystick-start?crew=not-the-code-at-all"]) {
    await page.goto(link);
    await expect(page.getByRole("button", { name: "Let's find out" })).toHaveCount(0);
    await expect(page.getByTestId("bring-your-business").or(page.locator(".ja-mirror")).first()).toBeVisible({ timeout: 30_000 });
  }
  // the procedures refuse a caller without the pass, whatever the page does
  expect((await start(baseURL!)).status).toBe(403);

  await page.goto(`/joystick-start?crew=${CODE}`);
  await expect(page.getByRole("button", { name: "Let's find out" })).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("crew")).toBeNull();
  const cookies = await page.context().cookies();
  expect(cookies.find(cookie => cookie.name === "joystick_first_ten_preview")).toMatchObject({ httpOnly: true });
  // with the pass, the journey starts
  await page.getByRole("button", { name: "Let's find out" }).click();
  await expect(page.getByTestId("first-ten-connect")).toBeVisible({ timeout: 30_000 });
  // and after a reload the pass, not the link, keeps it open
  await page.goto("/joystick-start");
  await expect(page.getByTestId("first-ten-connect").or(page.getByRole("button", { name: "Let's find out" })).first()).toBeVisible({ timeout: 30_000 });
});
