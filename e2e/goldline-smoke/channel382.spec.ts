import { expect, test } from "@playwright/test";
import { resetGoldlineProofWorld } from "./proofWorld";

/**
 * CHANNEL 382: direct one commercial in the clay studio and walk away with a real Laundry Farm ad. Every claim must be
 * approved before it exports; the ON AIR sign stays dark until the player says what they did with it, and what they
 * say is recorded as what they said. Nothing posts, sends, spends or writes to the server.
 */
test.describe("Lantern City → CHANNEL 382", () => {
  test.beforeEach(async ({ page }) => {
    await resetGoldlineProofWorld(page.request);
  });

  test("hook → set → light → frame → action → an approved, downloadable ad → on air, as you told us; nothing written", async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    const writes: string[] = [];
    page.on("request", r => {
      if (r.method() === "POST" && r.url().includes("/api/trpc/")) writes.push(r.url());
    });

    await page.goto("/growth/lantern-city?level=channel-382");
    const root = page.getByTestId("channel-382");
    await expect(root).toBeVisible({ timeout: 30_000 });
    const ready = () => page.evaluate(() => !!(window as unknown as { __channel382?: { ready: boolean } }).__channel382?.ready);
    await expect.poll(async () => (await ready()) || (await page.getByTestId("channel-382-unavailable").count()) > 0, { timeout: 120_000 }).toBe(true);
    test.skip(!(await ready()), "no WebGL on this runner");

    // the channel number is the follower count you give it
    await page.getByTestId("channel-382-followers").fill("412");
    await page.getByTestId("channel-382-start").click();
    await expect(root).toContainText("CHANNEL 412");

    // direct it
    await page.getByTestId("channel-382-hook-speed").click();
    await expect(page.getByTestId("channel-382-line")).toBeVisible();
    await page.getByTestId("channel-382-next").click();
    await page.getByTestId("channel-382-prop-washer").click();
    await page.getByTestId("channel-382-next").click();
    await page.getByTestId("channel-382-light-spotlight").click();
    await page.getByTestId("channel-382-next").click();
    await expect(page.getByTestId("channel-382-lens-guide")).toBeVisible();
    await expect(page.getByTestId("channel-382-frame-check")).toContainText("The van's in");
    await page.getByTestId("channel-382-action").click();

    // the captured frame is the ad
    await expect(page.getByTestId("channel-382-review")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("channel-382-ad")).toHaveAttribute("src", /^data:image\/png;base64,/);

    // nothing leaves until every claim is approved
    const download = page.getByTestId("channel-382-download");
    await expect(download).toBeDisabled();
    await page.getByTestId("channel-382-claim-next_day").check();
    await page.getByTestId("channel-382-claim-pickup_la").check();
    await expect(download).toBeDisabled();
    await page.getByTestId("channel-382-checked-all").check();
    await expect(download).toBeEnabled();
    // an offer is yours, and needs its own approval
    await page.getByTestId("channel-382-offer").fill("$10 off your first pickup");
    await expect(download).toBeDisabled();
    await page.getByTestId("channel-382-claim-offer").check();
    await page.getByTestId("channel-382-checked-all").check();
    await expect(download).toBeEnabled();

    // the caption is plain and true
    const caption = await page.getByTestId("channel-382-caption").innerText();
    expect(caption).toContain("laundryfarm.com");
    expect(caption).toContain("$10 off your first pickup");
    expect(caption).not.toMatch(/bertrand|channel|studio|sudsco|broadcast/i);

    const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
    expect(file.suggestedFilename()).toBe("laundry-farm-ad.png");

    // the climax: the sign stays dark until you say what you did
    await page.getByTestId("channel-382-to-air").click();
    await expect(page.getByTestId("channel-382-air")).toBeVisible();
    await expect(root).toHaveAttribute("data-on-air", "dark");
    await page.getByTestId("channel-382-paid").click();
    await expect(root).toHaveAttribute("data-on-air", "paid_promotion");
    await expect(page.getByTestId("channel-382-on")).toContainText("as you told us");
    await expect(page.getByTestId("channel-382-ratings")).toContainText("Waiting for real numbers");

    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
});
