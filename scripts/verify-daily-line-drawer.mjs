import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const base = process.env.DAILY_LINE_URL ?? "http://127.0.0.1:5188";
const out = "artifacts/daily-line-drawer";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [
    [320, 740],
    [390, 844],
    [430, 932],
    [760, 1024],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${base}/driver?goldlineDayPlanFixture=active`);
    const key = page.getByRole("button", { name: "Unlock vehicle drawer" });
    await key.waitFor();
    assert.equal(
      await page.getByRole("dialog").count(),
      0,
      "Drawer is closed by default"
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      "No horizontal overflow"
    );
    const titleSize = await page
      .locator(".gdp-card-copy h2")
      .first()
      .evaluate(e => parseFloat(getComputedStyle(e).fontSize));
    assert(titleSize >= 17, "Readable stop names");
    await page.screenshot({ path: `${out}/route-${width}.png` });
    const box = await key.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 35);
    await page.mouse.down();
    await page.mouse.move(box.x + 95, box.y + 35, { steps: 8 });
    await page.mouse.up();
    await page.getByRole("heading", { name: "Your mobile base." }).waitFor();
    assert.equal(
      await page.getByRole("progressbar").getAttribute("aria-valuenow"),
      "22"
    );
    await page.screenshot({ path: `${out}/drawer-${width}.png` });
    await page.getByTestId("vehicle-cargo-cta").click();
    await page.getByRole("button", { name: "Close cargo" }).waitFor();
    const detailBox = await page.locator(".gl-cargo-view").boundingBox();
    assert.equal(
      Math.round(detailBox.width),
      width,
      "Nested cargo fills viewport"
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.getByRole("button", { name: "Close cargo" }).count(),
      0
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    await expect(key).toBeFocused();
    await key.click();
    await page.getByRole("button", { name: "Lock vehicle drawer" }).click();
    await page.getByRole("button", { name: "Open menu" }).click();
    await page
      .getByRole("button", { name: "IMPORT ROUTE", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => document.body.dataset.importOpened),
      "true"
    );
    await page.getByRole("button", { name: "Open menu" }).click();
    await page
      .getByRole("button", { name: "EXPLORE OVERLAND", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => document.body.dataset.worldEntered),
      "true"
    );
    await page.locator(".gdp-stop").last().scrollIntoViewIfNeeded();
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const last = await page.locator(".gdp-stop").last().boundingBox();
    const next = await page.locator(".gdp-next-up").boundingBox();
    assert(last.y + last.height <= next.y, "Last stop clears fixed controls");
    assert.deepEqual(errors, [], "No browser errors");
    await page.close();
    console.log(
      `PASS ${width}×${height}: layout, drag, tap, cargo, Escape/focus, actions, scroll`
    );
  }
  const touchPage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await touchPage.goto(`${base}/driver?goldlineDayPlanFixture=active`);
  const touchKey = touchPage.getByRole("button", {
    name: "Unlock vehicle drawer",
  });
  const touchBox = await touchKey.boundingBox();
  const cdp = await touchPage.context().newCDPSession(touchPage);
  const point = { x: touchBox.x + 20, y: touchBox.y + 30 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point],
  });
  for (let x = point.x + 10; x <= point.x + 80; x += 10) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: point.y }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await touchPage.getByRole("heading", { name: "Your mobile base." }).waitFor();
  await touchPage.screenshot({ path: `${out}/touch-unlock.png` });
  await touchPage.keyboard.press("Escape");
  await expect(touchKey).toBeFocused();
  await touchPage.keyboard.press("Enter");
  await touchPage.getByRole("heading", { name: "Your mobile base." }).waitFor();
  await touchPage.close();
  console.log("PASS native touch swipe and keyboard unlock");
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${base}/driver?goldlineDayPlanFixture=director-fallback`);
  const intake = page.getByTestId("day-director-intake");
  await intake.waitFor();
  assert.equal(await intake.getAttribute("open"), null);
  await intake.locator("summary").click();
  await page
    .getByRole("textbox", { name: "Today's commitment" })
    .fill("Visit a customer");
  await page.getByRole("button", { name: "ADD MANUALLY" }).click();
  await page.getByRole("button", { name: "ADD TO PLAN" }).click();
  await page
    .getByRole("button", { name: "Open Visit a customer", exact: true })
    .waitFor();
  console.log("PASS collapsed commitment intake and add-to-plan flow");
} finally {
  await browser.close();
}
