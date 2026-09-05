/** Runs the real authenticated Driver entrance against a simulated API. No live
 * records are touched. Completion must cross the actual tRPC client seam. */
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = process.env.DAILY_LINE_URL ?? "http://127.0.0.1:5188";
const output = "artifacts/driver-connected-chapter";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 390, 430, 760]) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      isMobile: width < 500,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const writes = [];
    let failure = false,
      empty = false,
      offline = false;
    const orders = [
      {
        id: 101,
        firstName: "Century Park East",
        lastName: "",
        address: "101 Century Park East, Los Angeles",
        pickupTimeWindow: "9:00–10:00",
        deliveryTimeWindow: "13:00–14:00",
        status: "new",
        paid: true,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 102,
        firstName: "Park Meridian",
        lastName: "",
        address: "102 Park Meridian, Los Angeles",
        pickupTimeWindow: "10:00–11:00",
        deliveryTimeWindow: "15:00–16:00",
        status: "ready",
        paid: false,
        updatedAt: new Date().toISOString(),
      },
    ];
    await page.route("**/api/trpc/**", async route => {
      const url = new URL(route.request().url());
      const names = decodeURIComponent(
        url.pathname.split("/api/trpc/")[1]
      ).split(",");
      const input = JSON.parse(
        url.searchParams.get("input") ?? route.request().postData() ?? "{}"
      );
      const response = names.map((name, index) => {
        const args = (input[index] ?? input)?.json;
        let value = null;
        if (name === "auth.me")
          value = {
            id: 1,
            openId: "chapter-test",
            name: "Driver",
            role: "driver",
            tenantId: "chapter-test",
          };
        else if (name === "system.goldlineOnboarding.state")
          value = {
            session: {
              id: "first-test",
              tenantId: "chapter-test",
              status: "COMPLETE",
              completedAt: new Date().toISOString(),
              interpretation: null,
              mission: {
                id: "first-test",
                title: "Scout Los Angeles, CA, USA",
                checkpoint: {
                  label: "Los Angeles, CA, USA",
                  latitude: 34.05,
                  longitude: -118.25,
                },
                guardianId: "thunder_king",
                territoryId: "chapter-territory",
                objective: "Record an actual useful observation.",
                avoidance: "delay",
                outcome: null,
                traversalCompletedAt: null,
                gameplayCompletedAt: null,
              },
            },
          };
        else if (name === "admin.listByDate" || name === "admin.listByStatus")
          value = empty
            ? []
            : orders.filter(order => order.status === args?.status);
        else if (name === "admin.updateStatus") {
          writes.push({ name, args });
          if (failure)
            return {
              error: {
                json: {
                  message: "Test connection failure",
                  code: -32603,
                  data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
                },
              },
            };
          const order = orders.find(order => order.id === args.orderId);
          assert(order, "Only a real source order may be mutated");
          assert(
            args.status !== "delivered" || order.paid,
            "Unpaid delivery must stay blocked"
          );
          order.status = args.status;
          value = { success: true, alreadyCompleted: false };
        } else if (name === "system.dayDirector.state")
          value = {
            commitments: [],
            dismissedPromptKeys: ["growth-intake"],
            intelligenceAvailable: false,
            processingLocation: null,
          };
        else if (name === "system.goldlineCargo.state")
          value = { cargo: [], unassigned: [], atProcessor: [] };
        else if (/list$|myBuiltMissions$|myDispatches$|territories$/.test(name))
          value = [];
        if (offline && name === "admin.listByDate")
          return {
            error: {
              json: {
                message: "Route offline",
                code: -32603,
                data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
              },
            },
          };
        return { result: { data: { json: value } } };
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          url.searchParams.get("batch") === "1" ? response : response[0]
        ),
      });
    });
    await page.goto(`${base}/driver`);
    await page.getByTestId("driver-day-home").waitFor();
    await expect(
      page.getByRole("button", { name: "Open Century Park East", exact: true })
    ).toBeVisible();
    assert.equal(
      await page.getByTestId("first-mission-driver").count(),
      0,
      "Unfinished onboarding cannot own home"
    );
    assert.equal(
      await page.locator("canvas").count(),
      0,
      "Home does not wait for a game canvas"
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      ),
      "No horizontal overflow"
    );
    await page.screenshot({ path: `${output}/home-${width}.png` });
    await page
      .getByRole("button", { name: "Open Century Park East", exact: true })
      .click();
    const confirm = page.getByRole("button", {
      name: "CONFIRM PICKUP",
      exact: true,
    });
    await expect(confirm).toBeDisabled();
    await expect(
      page.getByRole("link", { name: "OPEN DIRECTIONS" })
    ).toHaveAttribute("href", /101/);
    await page.getByRole("checkbox").check();
    failure = true;
    await confirm.click();
    await expect(page.locator(".chapter-error")).toBeVisible();
    assert.equal(orders[0].status, "new");
    assert.equal(
      await page.getByText("One promise kept.").count(),
      0,
      "No celebration on a failed save"
    );
    failure = false;
    await confirm.click();
    await expect(
      page.getByRole("heading", { name: "One promise kept." })
    ).toBeVisible();
    assert.equal(orders[0].status, "collected");
    assert.deepEqual(writes.at(-1).args, { orderId: 101, status: "collected" });
    await expect(
      page.getByRole("link", { name: /FOLLOW THE CONSEQUENCE/ })
    ).toHaveAttribute(
      "href",
      /^https:\/\/admin\.bldg\.chat\/growth\/lantern-city/
    );
    await page.screenshot({ path: `${output}/sealed-${width}.png` });
    await page
      .getByRole("button", { name: "NEXT CHAPTER", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open Park Meridian", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "CONFIRM DELIVERY", exact: true })
    ).toBeDisabled();
    await expect(page.getByText(/Payment needs to be resolved/)).toBeVisible();
    await page.getByRole("button", { name: "Close stop" }).click();
    const writeCount = writes.length;
    await page
      .getByRole("navigation", { name: "Goldline navigation" })
      .getByRole("button", { name: "PLAY", exact: true })
      .click();
    await page.getByRole("button", { name: "BEGIN RUN" }).click();
    for (let round = 1; round <= 3; round++) {
      const light = page.getByRole("button", {
        name: `LIGHT LANTERN ${round}`,
        exact: true,
      });
      await expect(light).toBeEnabled();
      await light.tap();
    }
    await expect(
      page.getByRole("button", { name: "AGAIN", exact: true })
    ).toBeVisible();
    assert.equal(
      writes.length,
      writeCount,
      "Playing cannot write business state"
    );
    await page.screenshot({ path: `${output}/lantern-${width}.png` });
    await page
      .getByRole("button", { name: "BACK TO YOUR DAY", exact: true })
      .click();
    await page.reload();
    await expect(
      page.getByTestId("day-plan-stop-native-pickup-101")
    ).toHaveClass(/completed/);
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page.getByRole("button", { name: /SIDE QUEST/ }).click();
    await page.getByTestId("first-mission-driver").waitFor();
    await page.locator("canvas").waitFor();
    await expect(
      page.getByText("ENTERING GOLDLINE…", { exact: false })
    ).toBeHidden({ timeout: 60000 });
    await page.screenshot({ path: `${output}/overworld-${width}.png` });
    await page.getByRole("button", { name: "← YOUR DAY", exact: true }).click();
    await page.getByTestId("driver-day-home").waitFor();
    empty = true;
    await page.reload();
    await expect(
      page.getByText("A blank page. Your next chapter.")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "IMPORT OR ADD STOPS" })
    ).toBeVisible();
    await page.screenshot({ path: `${output}/empty-${width}.png` });
    offline = true;
    await page.reload();
    await expect(page.getByRole("button", { name: "RETRY ROUTE" })).toBeVisible(
      { timeout: 20000 }
    );
    offline = false;
    await page.getByRole("button", { name: "RETRY ROUTE" }).click();
    await expect(page.getByRole("button", { name: "RETRY ROUTE" })).toHaveCount(
      0
    );
    assert.deepEqual(errors, [], "No uncaught browser errors");
    console.log(
      `PASS ${width}px: authenticated entrance, optional onboarding, exact save, failure, payment, replay, play, empty, retry`
    );
    await page.close();
  }
} finally {
  await browser.close();
}
