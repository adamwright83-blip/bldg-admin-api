import { test, expect, type Page } from "@playwright/test";

/**
 * Driver Studio, as a driver uses it on a phone. Runs against the harness-only
 * `studio-route` fixture: synthetic customers, every write mocked and recorded
 * on body[data-studio-mutations]. No real order is touched.
 */
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  // Empty profile: no saved Day Line choice, so the default is what loads.
  storageState: { cookies: [], origins: [] },
});

const ROUTE = "/driver?goldlineDayPlanFixture=studio-route";

const mutations = async (page: Page) =>
  JSON.parse((await page.locator("body").getAttribute("data-studio-mutations")) ?? "[]") as Array<Record<string, unknown>>;

async function hold(page: Page, target: ReturnType<Page["locator"]>, ms: number) {
  const box = await target.boundingBox();
  if (!box) throw new Error("hold target not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function pull(page: Page, path: Array<[number, number]>) {
  const head = page.getByTestId("driver-studio-claire");
  const box = await head.boundingBox();
  if (!box) throw new Error("Claire not visible");
  let x = box.x + box.width / 2;
  let y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const [dx, dy] of path) {
    const steps = 12;
    for (let i = 1; i <= steps; i++) await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
    x += dx;
    y += dy;
  }
  await page.mouse.up();
  // Let Claire spring back to her corner before the next gesture.
  await page.waitForTimeout(600);
}

test.beforeEach(async ({ context, page }) => {
  await context.route("https://www.google.com/maps/**", route =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Maps route fixture</h1>" })
  );
  const missing: string[] = [];
  page.on("response", response => {
    const url = response.url();
    if (response.status() >= 400 && /\/(joystick|assets|goldline)\//.test(url)) missing.push(`${response.status()} ${url}`);
  });
  (page as Page & { missingAssets?: string[] }).missingAssets = missing;
});

test("Studio is the default Day Line: route → arrived → cancelled hold → two separate saves → next stop", async ({ page, context }) => {
  await page.goto(ROUTE);
  const studio = page.getByTestId("driver-studio");
  await expect(studio).toBeVisible();
  await expect(page.locator(".gdp-shell")).toHaveCount(0);

  // Real grouping: two jobs at one tower share a card; the evening visit is labelled as such.
  const rows = page.locator(".lc-list-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Century Park East");
  await expect(rows.nth(0)).toContainText("PICK UP · DROP OFF · 2 jobs");
  await expect(rows.nth(1)).toContainText("OPUS LA");
  await expect(page.locator(".lc-section-label")).toHaveText(["DAYTIME", "EVENING"]);
  await expect(page.getByText("0 OF 3 VISITS COMPLETE")).toBeVisible();

  // New Order goes to the existing order sheet.
  await page.getByTestId("driver-studio-new-order").click();
  await expect(page.locator("body")).toHaveAttribute("data-new-order-opened", "true");

  // No sideways scrolling on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await rows.nth(0).click();
  const detail = page.getByTestId("driver-studio-detail");
  await expect(detail).toBeVisible();
  await expect(page.getByTestId("driver-studio-visit-state")).toHaveText("EN ROUTE");
  await expect(page.getByTestId("driver-studio-hold")).toHaveCount(0);

  // Google Maps opens the stop's real address.
  const maps = page.getByTestId("driver-studio-maps");
  const href = (await maps.getAttribute("href"))!;
  expect(new URL(href).searchParams.get("destination")).toBe("2170 Century Park East, Los Angeles, CA 90067");
  const popup = context.waitForEvent("page");
  await maps.click();
  await (await popup).close();

  await page.getByTestId("driver-studio-arrived").click();
  await expect(page.getByTestId("driver-studio-visit-state")).toHaveText("ARRIVED");
  const holds = page.getByTestId("driver-studio-hold");
  await expect(holds).toHaveCount(2);

  // Releasing at 600ms writes nothing and plays nothing.
  const pickup = page.getByTestId("driver-studio-job-external-studio-1");
  await pickup.getByLabel("BAGS").fill("2");
  await hold(page, pickup.getByTestId("driver-studio-hold"), 600);
  await page.waitForTimeout(800);
  expect(await mutations(page)).toEqual([]);
  await expect(page.getByTestId("driver-studio-scene")).toHaveAttribute("data-reacting", "false");
  await expect(pickup.getByTestId("driver-studio-hold")).toHaveAttribute("data-phase", "idle");

  // A full hold saves only the first job, with the counts, and is honest about CleanCloud.
  await hold(page, pickup.getByTestId("driver-studio-hold"), 1400);
  await expect(pickup).toHaveAttribute("data-truth", "pending");
  await expect(pickup).toContainText("SYNC PENDING");
  await expect(page.getByTestId("driver-studio-scene")).toHaveAttribute("data-reacting", "true");
  await expect(detail.getByRole("status").filter({ hasText: "PICK UP SAVED" })).toBeVisible();
  expect(await mutations(page)).toEqual([{ id: "studio-1", counts: { bagCount: 2, garmentCount: 0 } }]);
  await expect(page.getByTestId("driver-studio-visit-state")).toHaveText("ARRIVED");
  await expect(page.getByTestId("driver-studio-next")).toHaveCount(0);

  // The second job is its own earned save.
  const dropoff = page.getByTestId("driver-studio-job-external-studio-2");
  await hold(page, dropoff.getByTestId("driver-studio-hold"), 1400);
  await expect(dropoff).toHaveAttribute("data-truth", "saved");
  expect((await mutations(page)).map(m => m.id)).toEqual(["studio-1", "studio-2"]);
  await expect(page.getByTestId("driver-studio-visit-state")).toHaveText("DONE");

  await page.getByTestId("driver-studio-next").click();
  await expect(detail).toHaveAttribute("data-visit-id", "external-studio-3");
  await expect(detail).toContainText("CONCEPT ART · NOT LIVE GAMEPLAY");

  // Coming back to the app (e.g. from Maps after the tab was discarded) lands on the same stop and submits nothing.
  await page.getByTestId("driver-studio-arrived").click();
  await page.reload();
  await expect(page.getByTestId("driver-studio-detail")).toHaveAttribute("data-visit-id", "external-studio-3");
  await expect(page.getByTestId("driver-studio-visit-state")).toHaveText("ARRIVED");
  expect((await mutations(page)).length).toBe(0); // the reload cleared the fixture's mock log; nothing new was written

  // Keyboard HOLD works too.
  const opus = page.getByTestId("driver-studio-job-external-studio-3");
  await opus.getByLabel("GARMENTS").fill("4");
  await opus.getByTestId("driver-studio-hold").focus();
  await page.keyboard.down(" ");
  await page.waitForTimeout(1400);
  await page.keyboard.up(" ");
  await expect(opus).toHaveAttribute("data-truth", "pending");
  expect(await mutations(page)).toEqual([{ id: "studio-3", counts: { bagCount: 0, garmentCount: 4 } }]);

  expect((page as Page & { missingAssets?: string[] }).missingAssets).toEqual([]);
});

test("a failed save shows retry and no success effect; the retry saves once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${ROUTE}&studioFailOnce=1`);
  await page.locator(".lc-list-row").nth(0).click();
  await page.getByTestId("driver-studio-arrived").click();
  const dropoff = page.getByTestId("driver-studio-job-external-studio-2");
  const ring = dropoff.getByTestId("driver-studio-hold");
  await hold(page, ring, 1400);
  await expect(ring).toHaveAttribute("data-phase", "error");
  await expect(dropoff.getByRole("alert")).toContainText("Nothing was saved");
  await expect(page.getByTestId("driver-studio-scene")).toHaveAttribute("data-reacting", "false");
  await expect(dropoff).toHaveAttribute("data-truth", "ready");
  await hold(page, ring, 1400);
  await expect(dropoff).toHaveAttribute("data-truth", "saved");
  expect(await mutations(page)).toEqual([{ id: "studio-2", failed: true }, { id: "studio-2", counts: null }]);
  // A bridge pickup without counts never reaches the server.
  const pickup = page.getByTestId("driver-studio-job-external-studio-1");
  await hold(page, pickup.getByTestId("driver-studio-hold"), 1400);
  await expect(pickup.getByRole("alert")).toContainText("at least one bag or garment");
  expect((await mutations(page)).length).toBe(2);
});

test("Claire: pull down to message, pull down then right to call, tap for the same choices", async ({ page }) => {
  await page.goto(ROUTE);
  await expect(page.getByTestId("driver-studio-claire")).toBeVisible();
  // A short pull that stops above the line does nothing.
  await pull(page, [[0, 260]]);
  await expect(page.locator("body")).not.toHaveAttribute("data-claire-composer", "open");
  await pull(page, [[0, 720]]);
  await expect(page.locator("body")).toHaveAttribute("data-claire-composer", "open");
  await expect(page.locator("body")).not.toHaveAttribute("data-claire-called", "true");
  await pull(page, [[0, 720], [40, 0]]);
  await expect(page.locator("body")).toHaveAttribute("data-claire-called", "true");
  await expect(page.getByText("Claire is calling your phone now.")).toBeVisible();
  await page.getByTestId("driver-studio-claire").click();
  await expect(page.getByRole("menu", { name: "Claire" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /MESSAGE CLAIRE/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Claire" })).toHaveCount(0);
});

test("the previous Day Line stays one reversible switch away", async ({ page }) => {
  await page.goto(ROUTE);
  await page.getByRole("button", { name: "Use the previous Day Line" }).click();
  await expect(page).toHaveURL(/dayline=legacy/);
  await expect(page.locator(".gdp-shell")).toBeVisible();
  await expect(page.getByTestId("driver-studio")).toHaveCount(0);
  await page.goto(ROUTE);
  await expect(page.locator(".gdp-shell")).toBeVisible();
  await expect(page.getByTestId("driver-studio")).toHaveCount(0);
  await page.goto(`${ROUTE}&dayline=studio`);
  await expect(page.getByTestId("driver-studio")).toBeVisible();
  await page.goto(ROUTE);
  await expect(page.getByTestId("driver-studio")).toBeVisible();
});
