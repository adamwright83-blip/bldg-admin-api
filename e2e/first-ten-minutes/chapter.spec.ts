import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * THE IMPOSSIBLE MACHINE — Full Production E2E Suite
 * Tests physical railway puzzle mechanics, deterministic graph state transitions,
 * business correspondence integration, both winning paths (Route A & Route B),
 * mobile responsive layouts, reduced motion, keyboard interaction, and captures all 10 required screenshots.
 */
const FAKE = "http://127.0.0.1:4999";

async function takeScreenshot(name: string, page: Page) {
  await page.waitForTimeout(600);
  await page.screenshot({
    path: `tmp/first-ten-e2e-shots/${name}.png`,
    fullPage: true,
  });
}

test.beforeEach(async ({ page, request }) => {
  await request.post(`${FAKE}/__reset`);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/joystick-start");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/joystick-start");
  await page.getByRole("button", { name: "Let's find out" }).click();
});

async function advanceToMachineWithAccount(page: Page, request: APIRequestContext) {
  await request.post(`${FAKE}/__control`, { data: { googleEmail: "nina@wildrootflowers.example" } });
  await page.getByTestId("first-ten-connect-google").click();
  await expect(page.getByTestId("first-ten-crew-scene")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("first-ten-sable-answers").getByRole("button", { name: "Still the rule" }).click();
  await expect(page.getByTestId("first-ten-portrait")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "That sounds like me" }).click();
  await expect(page.getByTestId("first-ten-impossible-machine")).toBeVisible({ timeout: 30_000 });
}

async function advanceToMachineWithExample(page: Page) {
  await page.getByTestId("first-ten-example").click();
  await expect(page.getByTestId("first-ten-crew-scene")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("first-ten-sable-answers").getByRole("button", { name: "Still the rule" }).click();
  await expect(page.getByTestId("first-ten-portrait")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "That sounds like me" }).click();
  await expect(page.getByTestId("first-ten-impossible-machine")).toBeVisible({ timeout: 30_000 });
}

test.describe("THE IMPOSSIBLE MACHINE — Production Tests", () => {
  test("Route A: Outbound upper -> Key capture -> Sourced correspondence -> Verified Send -> Central bridge restored -> Dome unlock & Theft", async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    await advanceToMachineWithAccount(page, request);

    const machine = page.getByTestId("first-ten-impossible-machine");
    await expect(machine).toBeVisible();

    // 1. Screenshot 01: Rook under dome, key across railway, dial in THEN
    await expect(page.getByTestId("machine-glass-dome")).toBeVisible();
    await expect(page.getByTestId("machine-rook")).toBeVisible();
    await expect(page.getByTestId("machine-station-key")).toBeVisible();
    await expect(machine).toHaveAttribute("data-dial", "THEN");
    await takeScreenshot("01-rook-under-dome", page);

    // 2. State B & Screenshot 02: Disconnected railway & failed experiment
    // Wind crank while route is incomplete
    await page.getByTestId("machine-wind-crank").click();
    await expect(page.getByTestId("machine-halt-feedback")).toBeVisible({ timeout: 10_000 });
    await takeScreenshot("02-disconnected-railway", page);

    // 3. State C & Screenshot 03: Upper route aligned in THEN
    while ((await page.getByTestId("machine-west-junction").getAttribute("data-position")) !== "upper") {
      await page.getByTestId("machine-west-junction").click();
      await page.waitForTimeout(150);
    }
    if ((await page.getByTestId("machine-upper-rotor").getAttribute("data-orientation")) !== "aligned") {
      await page.getByTestId("machine-upper-rotor").click();
      await page.waitForTimeout(150);
    }
    while ((await page.getByTestId("machine-east-junction").getAttribute("data-position")) !== "upper") {
      await page.getByTestId("machine-east-junction").click();
      await page.waitForTimeout(150);
    }
    await takeScreenshot("03-upper-route-aligned", page);

    // Wind crank to send carriage outbound
    await page.getByTestId("machine-wind-crank").click();

    // 4. State D & Screenshot 04: Key capture & machine shifts into NOW
    await expect(machine).toHaveAttribute("data-key-retrieved", "yes", { timeout: 15_000 });
    await expect(machine).toHaveAttribute("data-dial", "NOW", { timeout: 15_000 });
    await expect(page.getByTestId("machine-carriage-key")).toBeVisible();
    await takeScreenshot("04-key-capture", page);

    // 5. State E & Screenshot 05: Examine center correspondence note
    await page.getByTestId("machine-center-crossing").click();
    await expect(page.getByTestId("machine-correspondence-panel")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("first-ten-then")).toContainText("Could you do fresh arrangements every Friday?");
    await expect(page.getByTestId("first-ten-now")).toContainText("Wildroot has a weekly Friday delivery");
    await takeScreenshot("05-then-now-correspondence", page);

    // 6. State F: Prepare reply, edit message, and send through Gmail stand-in
    await page.getByTestId("machine-choice-prepare").click();
    const draft = page.getByTestId("first-ten-draft");
    await expect(draft).toBeVisible({ timeout: 10_000 });

    // Draft editing test: "Try another way", custom edit, "Keep these words"
    await draft.getByRole("button", { name: "Try another way" }).click();
    await expect(page.getByTestId("first-ten-message-body")).toContainText("the Friday route already goes past");

    await draft.getByRole("button", { name: "Edit" }).click();
    await draft.getByLabel("Your message").fill("Hi Elena — Friday delivery exists now. Shall I bring a sample this Friday?");
    await draft.getByRole("button", { name: "Keep these words" }).click();
    await expect(page.getByTestId("first-ten-message-body")).toHaveText("Hi Elena — Friday delivery exists now. Shall I bring a sample this Friday?");

    // Allow sending through stand-in
    await page.getByTestId("first-ten-allow-send").click();
    await expect(page.getByTestId("first-ten-send-start")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("first-ten-send-start").click();
    await page.getByTestId("first-ten-send-now").click();
    await expect(page.getByTestId("first-ten-send-status")).toContainText("Sent from your Gmail", { timeout: 20_000 });

    // 7. State G & Screenshot 06: Verified send restores central bridge
    // Close correspondence drawer to return to board
    await page.getByTestId("machine-correspondence-close").click();
    await expect(page.getByTestId("center-crossing-restored-rails")).toBeVisible({ timeout: 15_000 });
    await expect(machine).toHaveAttribute("data-center-restored", "yes");
    await takeScreenshot("06-central-track-restored", page);

    // Rotate west and east junctions to center to cross restored bridge
    while ((await page.getByTestId("machine-west-junction").getAttribute("data-position")) !== "center") {
      await page.getByTestId("machine-west-junction").click();
      await page.waitForTimeout(150);
    }
    while ((await page.getByTestId("machine-east-junction").getAttribute("data-position")) !== "center") {
      await page.getByTestId("machine-east-junction").click();
      await page.waitForTimeout(150);
    }

    // Wind crank for center return
    await page.getByTestId("machine-wind-crank").click();

    // 8. State I & Screenshot 08: Dome unlocks in layers, Rook escapes
    await expect(machine).toHaveAttribute("data-dome-unlocked", "yes", { timeout: 15_000 });
    await expect(page.getByTestId("machine-rook")).toBeVisible({ timeout: 10_000 });
    await takeScreenshot("08-rook-escape", page);

    // 9. Comedic ending & Screenshot 09: Rook tries to steal machine
    await expect(machine).toHaveAttribute("data-rook-stealing", "yes", { timeout: 15_000 });
    await expect(page.getByTestId("machine-ending-banner")).toBeVisible({ timeout: 15_000 });
    await takeScreenshot("09-rook-theft-attempt", page);
  });

  test("Route B: Outbound upper -> Key capture -> Alternate lower return in NOW (No email send)", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await advanceToMachineWithExample(page);

    const machine = page.getByTestId("first-ten-impossible-machine");
    await expect(machine).toBeVisible();

    // Outbound solve
    while ((await page.getByTestId("machine-west-junction").getAttribute("data-position")) !== "upper") {
      await page.getByTestId("machine-west-junction").click();
      await page.waitForTimeout(150);
    }
    if ((await page.getByTestId("machine-upper-rotor").getAttribute("data-orientation")) !== "aligned") {
      await page.getByTestId("machine-upper-rotor").click();
      await page.waitForTimeout(150);
    }
    while ((await page.getByTestId("machine-east-junction").getAttribute("data-position")) !== "upper") {
      await page.getByTestId("machine-east-junction").click();
      await page.waitForTimeout(150);
    }
    await page.getByTestId("machine-wind-crank").click();
    await expect(machine).toHaveAttribute("data-key-retrieved", "yes", { timeout: 15_000 });

    // Inspect note and choose "Keep for later" (NO send)
    await page.getByTestId("machine-center-crossing").click();
    await expect(page.getByTestId("machine-choice-later")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("machine-choice-later").click();

    // Close note drawer to see board
    await page.getByTestId("machine-correspondence-close").click();

    // Screenshot 07: Alternate lower return route aligned in NOW
    while ((await page.getByTestId("machine-west-junction").getAttribute("data-position")) !== "lower") {
      await page.getByTestId("machine-west-junction").click();
      await page.waitForTimeout(150);
    }
    if ((await page.getByTestId("machine-lower-rotor").getAttribute("data-orientation")) !== "aligned") {
      await page.getByTestId("machine-lower-rotor").click();
      await page.waitForTimeout(150);
    }
    while ((await page.getByTestId("machine-east-junction").getAttribute("data-position")) !== "lower") {
      await page.getByTestId("machine-east-junction").click();
      await page.waitForTimeout(150);
    }
    await takeScreenshot("07-alternate-lower-route", page);

    // Wind crank for lower return trip
    await page.getByTestId("machine-wind-crank").click();

    // Dome unlocks and Rook escapes without sending any email!
    await expect(machine).toHaveAttribute("data-dome-unlocked", "yes", { timeout: 15_000 });
    await expect(page.getByTestId("machine-rook")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("machine-ending-banner")).toBeVisible({ timeout: 15_000 });
  });

  test("Route C: No eligible business opportunity (opportunity = null) -> Outbound upper -> Key capture -> Alternate lower return in NOW (Zero email send)", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // Intercept chapter query to simulate an operator with NO eligible business opportunity
    await page.route("**/api/trpc/*", async route => {
      const decoded = decodeURIComponent(route.request().url());
      if (!decoded.includes("firstTenMinutes.chapter")) {
        return route.continue();
      }
      try {
        const response = await route.fetch();
        const json = await response.json();
        const stripOpp = (target: any) => {
          if (!target) return;
          if (target.json && typeof target.json === "object") {
            target.json.opportunity = null;
            target.json.draft = null;
          }
          if ("opportunity" in target) {
            target.opportunity = null;
            target.draft = null;
          }
        };
        if (Array.isArray(json)) {
          for (const item of json) {
            if (item?.result?.data) stripOpp(item.result.data);
          }
        } else if (json?.result?.data) {
          stripOpp(json.result.data);
        }
        await route.fulfill({ json });
      } catch {
        return route.continue().catch(() => undefined);
      }
    });

    await page.getByTestId("first-ten-example").click();
    await expect(page.getByTestId("first-ten-crew-scene")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("first-ten-sable-answers").getByRole("button", { name: "Still the rule" }).click();
    await expect(page.getByTestId("first-ten-portrait")).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "That sounds like me" }).click();

    // User B threshold
    const threshold = page.getByTestId("first-ten-chapter-threshold");
    await expect(threshold).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("first-ten-enter-simulated-machine").click();

    const machine = page.getByTestId("first-ten-impossible-machine");
    await expect(machine).toBeVisible({ timeout: 20_000 });

    // Outbound solve in THEN
    while ((await page.getByTestId("machine-west-junction").getAttribute("data-position")) !== "upper") {
      await page.getByTestId("machine-west-junction").click();
      await page.waitForTimeout(150);
    }
    if ((await page.getByTestId("machine-upper-rotor").getAttribute("data-orientation")) !== "aligned") {
      await page.getByTestId("machine-upper-rotor").click();
      await page.waitForTimeout(150);
    }
    while ((await page.getByTestId("machine-east-junction").getAttribute("data-position")) !== "upper") {
      await page.getByTestId("machine-east-junction").click();
      await page.waitForTimeout(150);
    }
    await page.getByTestId("machine-wind-crank").click();
    await expect(machine).toHaveAttribute("data-key-retrieved", "yes", { timeout: 15_000 });
    await expect(machine).toHaveAttribute("data-dial", "NOW", { timeout: 15_000 });

    // Solve lower route in NOW
    while ((await page.getByTestId("machine-west-junction").getAttribute("data-position")) !== "lower") {
      await page.getByTestId("machine-west-junction").click();
      await page.waitForTimeout(150);
    }
    if ((await page.getByTestId("machine-lower-rotor").getAttribute("data-orientation")) !== "aligned") {
      await page.getByTestId("machine-lower-rotor").click();
      await page.waitForTimeout(150);
    }
    while ((await page.getByTestId("machine-east-junction").getAttribute("data-position")) !== "lower") {
      await page.getByTestId("machine-east-junction").click();
      await page.waitForTimeout(150);
    }

    // Wind crank for lower return trip
    await page.getByTestId("machine-wind-crank").click();

    // Dome unlocks, Rook escapes, ending appears — 100% complete without business opportunity or email send!
    await expect(machine).toHaveAttribute("data-dome-unlocked", "yes", { timeout: 15_000 });
    await expect(page.getByTestId("machine-rook")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("machine-ending-banner")).toBeVisible({ timeout: 15_000 });
  });

  test("User B (No real opportunity exists): Claire threshold -> Enter simulated machine -> Three Days Later -> Simulated Reply & Coupling -> Rescue & Ending", async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    await request.post(`${FAKE}/__control`, { data: { noOpportunities: true, googleEmail: "nina@wildrootflowers.example" } });
    await page.getByTestId("first-ten-connect-google").click();
    await expect(page.getByTestId("first-ten-crew-scene")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("first-ten-sable-answers").getByRole("button", { name: "Still the rule" }).click();
    await expect(page.getByTestId("first-ten-portrait")).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "That sounds like me" }).click();

    // Verify Claire's threshold appears
    const threshold = page.getByTestId("first-ten-chapter-threshold");
    await expect(threshold).toBeVisible({ timeout: 20_000 });
    await expect(threshold).toContainText("I haven’t found a customer conversation waiting for you yet. But let me show you what happens when one arrives.");

    // Enter simulated machine
    await page.getByTestId("first-ten-enter-simulated-machine").click();
    const machine = page.getByTestId("first-ten-impossible-machine");
    await expect(machine).toBeVisible({ timeout: 20_000 });

    // Solve outbound route (West=upper, East=upper, Upper Rotor=aligned)
    while ((await page.getByTestId("machine-west-junction").getAttribute("data-position")) !== "upper") {
      await page.getByTestId("machine-west-junction").click();
      await page.waitForTimeout(150);
    }
    if ((await page.getByTestId("machine-upper-rotor").getAttribute("data-orientation")) !== "aligned") {
      await page.getByTestId("machine-upper-rotor").click();
      await page.waitForTimeout(150);
    }
    while ((await page.getByTestId("machine-east-junction").getAttribute("data-position")) !== "upper") {
      await page.getByTestId("machine-east-junction").click();
      await page.waitForTimeout(150);
    }

    // Wind crank to fetch key
    await page.getByTestId("machine-wind-crank").click();
    await expect(machine).toHaveAttribute("data-key-retrieved", "yes", { timeout: 15_000 });
    await expect(machine).toHaveAttribute("data-dial", "NOW");

    // Open correspondence drawer & inspect simulated inquiry
    await page.getByTestId("machine-center-crossing").click();
    const drawer = page.getByTestId("machine-correspondence-panel");
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId("machine-simulated-banner")).toBeVisible();
    await expect(page.getByTestId("machine-simulated-banner")).toContainText("THREE DAYS LATER — AN IMAGINED SCENARIO");
    await takeScreenshot("user-b-01-simulated-scenario", page);

    // Prepare simulated reply
    await page.getByTestId("machine-choice-prepare").click();
    await expect(page.getByTestId("first-ten-send-desk")).toBeVisible();

    // Simulate reply and couple central bridge
    await page.getByTestId("first-ten-send-now").click();
    await expect(page.getByTestId("machine-bridge-restored-banner")).toBeVisible({ timeout: 10_000 });
    await takeScreenshot("user-b-02-bridge-restored", page);

    // Close correspondence drawer
    await page.getByTestId("machine-correspondence-close").click();

    // Align central bridge (West=center, East=center)
    while ((await page.getByTestId("machine-west-junction").getAttribute("data-position")) !== "center") {
      await page.getByTestId("machine-west-junction").click();
      await page.waitForTimeout(150);
    }
    while ((await page.getByTestId("machine-east-junction").getAttribute("data-position")) !== "center") {
      await page.getByTestId("machine-east-junction").click();
      await page.waitForTimeout(150);
    }

    // Wind crank to return across central bridge
    await page.getByTestId("machine-wind-crank").click();

    // Dome unlocks and Rook escape sequence plays
    await expect(machine).toHaveAttribute("data-dome-unlocked", "yes", { timeout: 15_000 });
    await expect(page.getByTestId("machine-rook")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("machine-ending-banner")).toBeVisible({ timeout: 15_000 });
  });

  test("Mobile responsive layout, camera panning, and Screenshot 10", async ({ page }) => {
    test.setTimeout(180_000);
    // Set viewport to mobile portrait
    await page.setViewportSize({ width: 390, height: 844 });
    await advanceToMachineWithExample(page);

    const machine = page.getByTestId("first-ten-impossible-machine");
    await expect(machine).toBeVisible();

    // Camera panning controls should be visible on mobile
    await expect(page.getByTestId("machine-camera-west")).toBeVisible();
    await expect(page.getByTestId("machine-camera-center")).toBeVisible();
    await expect(page.getByTestId("machine-camera-east")).toBeVisible();

    // Switch camera to center
    await page.getByTestId("machine-camera-center").click();
    await page.waitForTimeout(300);

    // Switch camera to east
    await page.getByTestId("machine-camera-east").click();
    await page.waitForTimeout(300);

    // Screenshot 10: Mobile viewport
    await takeScreenshot("10-mobile-viewport", page);

    // Test mobile landscape
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(300);
    await expect(machine).toBeVisible();
  });

  test("Keyboard interaction and accessibility navigation", async ({ page }) => {
    test.setTimeout(120_000);
    await advanceToMachineWithExample(page);

    // Navigate with Tab key and activate with Space / Enter
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toBeVisible();
  });
});
