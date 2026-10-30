import { expect, test, type Page } from "@playwright/test";
import { begin } from "./journey";

/**
 * Slice 8: Astra's "The Estimate That Wouldn't Fit", on Dev's invented electrical business. Bront's cart carries the
 * estimate as a paper house that won't pass the arch; Hazel says so. Each room unfolds to its own lines and source.
 * Sable brings Marisol's later message, Bront puts out two trays, and the rooms go onto them; nothing is taken out,
 * and the open charger detail stays visibly open. Then the real estimate at the table, with Astra's cover message.
 */
async function shots(name: string, page: Page, testInfo: { project: { name: string } }) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `tmp/first-ten-e2e-shots/${testInfo.project.name}-${name}.png`, fullPage: true });
}

const COVER = "Hi Marisol — I've separated the garage work from the house work so we can move ahead with the first part. The later work is listed separately.";

test("The Estimate That Wouldn't Fit: the paper house, the two trays, and the real estimate at the table", async ({ page, request }, testInfo) => {
  test.setTimeout(300_000);
  await begin(page, request);
  await page.getByTestId("first-ten-example-dev").click();
  await expect(page.getByTestId("first-ten-example-label")).toContainText("Example: Dev's electrical business, invented. Nothing here is yours.");

  // the crew gets acquainted with Dev: his own rule first
  await expect(page.getByTestId("first-ten-crew-scene")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("first-ten-object-rule")).toContainText("I only quote after a site visit");
  await page.getByTestId("first-ten-sable-answers").getByRole("button", { name: "Still the rule" }).click();
  await expect(page.getByTestId("first-ten-portrait")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("first-ten-portrait")).toContainText("Dev, here's where you are.");
  await expect(page.getByTestId("first-ten-portrait")).toContainText("An estimate still holds more than the client asked for first.");
  await page.getByRole("button", { name: "That sounds like me" }).click();

  // the cart, the paper house, the arch; Hazel examines it
  const scene = page.getByTestId("first-ten-estimate");
  await expect(scene).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("first-ten-chapter-title")).toHaveText("The Estimate That Wouldn't Fit");
  const line = page.getByTestId("first-ten-estimate-line");
  await expect(line).toContainText("You may bring a letter through.", { timeout: 10_000 });
  await expect(line).toContainText("This appears to be a residence.", { timeout: 10_000 });
  const house = page.getByTestId("first-ten-paper-house");
  for (const room of ["Garage", "Kitchen", "Upstairs hallway"]) await expect(house.locator(`[data-room="${room}"]`)).toBeVisible();
  await shots("70-paper-house", page, testInfo);

  // Sable with what Marisol said later; Bront's two trays
  await expect(line).toContainText("“Let's do the garage first; the house can wait.” That came after the original request.", { timeout: 15_000 });
  await expect(page.getByTestId("first-ten-scope-note")).toContainText("Marisol Ortega · Oct 21");
  await expect(line).toContainText("We've put tomorrow's dinner on today's plate.", { timeout: 15_000 });

  // a room unfolds to its own lines and its source; the open detail is open, with no price
  await house.locator('[data-room="Garage"]').click();
  const open = page.getByTestId("first-ten-room-open");
  await expect(open).toContainText("New 50A circuit for an EV charger");
  await expect(open).toContainText("$1,450");
  await expect(open.locator("li[data-open]")).toContainText("EV charger installation — charger model TBD by client");
  await expect(open).toContainText("Your Drive: Estimate — Ortega residence (draft)");
  await shots("71-room-open", page, testInfo);
  await page.getByTestId("first-ten-tray-thisJob").getByRole("button", { name: "This job" }).click();
  await expect(line).toContainText("That's a question wearing a price tag.");
  await expect(page.getByTestId("first-ten-tray-thisJob").locator('[data-room="Garage"]')).toContainText("?");

  await house.locator('[data-room="Kitchen"]').click();
  await page.getByTestId("first-ten-tray-later").getByRole("button", { name: "Possible later work" }).click();
  await house.locator('[data-room="Upstairs hallway"]').click();
  await page.getByTestId("first-ten-tray-later").getByRole("button", { name: "Possible later work" }).click();

  // a compact package and an envelope; the cart fits through the arch
  await expect(page.getByTestId("first-ten-package")).toContainText("Garage", { timeout: 10_000 });
  await expect(page.getByTestId("first-ten-envelope")).toContainText("Kitchen · Upstairs hallway");
  await expect(line).toContainText("Acceptable. Barely.", { timeout: 10_000 });
  await shots("72-through-the-arch", page, testInfo);

  // the real estimate, ready to inspect: the focused estimate, or the question that finishes it
  await page.getByRole("button", { name: "Prepare the garage estimate" }).click({ timeout: 10_000 });
  const draft = page.getByTestId("first-ten-draft");
  await expect(draft).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("first-ten-draft-boundary")).toHaveText("Your business · Marisol");
  await expect(page.getByTestId("first-ten-then")).toContainText("Could you look at the garage, the kitchen lighting and the upstairs hallway while you're out here?");
  await expect(page.getByTestId("first-ten-now")).toContainText("Let's do the garage first; the house can wait.");
  await expect(page.getByTestId("first-ten-message")).toContainText("Marisol Ortega <marisol.ortega@mail.example>");
  await expect(page.getByTestId("first-ten-message")).toContainText("Re: Electrical work at Avenue 54");
  const body = page.getByTestId("first-ten-message-body");
  await expect(body).toContainText(COVER);
  await expect(body).toContainText("EV charger installation — charger model TBD by client");
  await expect(body).toContainText("Later work");
  await expect(body).not.toContainText("$4,360");
  await expect(page.getByTestId("first-ten-table-line")).toHaveCount(0);
  await shots("73-estimate-table", page, testInfo);

  await draft.getByRole("button", { name: "Ask the open question first" }).click();
  await expect(body).toHaveText("Hi Marisol — before I finish the garage estimate, I need one detail from you: the charger model. Could you let me know?");
  await draft.getByRole("button", { name: "The focused estimate" }).click();
  await expect(body).toContainText(COVER);

  // Dev's example never activates and never sends; deciding against it keeps the trays as he arranged them
  await expect(page.getByTestId("first-ten-activation-example")).toContainText("This is Dev's example, so nothing here is activated or sent.");
  await draft.getByRole("button", { name: "Not now" }).click();
  const closing = page.getByTestId("first-ten-closing");
  await expect(closing).toContainText("The workbench keeps the two-tray arrangement you chose.");
  await expect(closing.getByTestId("first-ten-workbench")).toContainText("Garage");
  await expect(closing.getByTestId("first-ten-workbench")).toContainText("Kitchen · Upstairs hallway");

  // a reload keeps the arrangement and the decision
  await page.reload();
  await expect(page.getByTestId("first-ten-draft")).toHaveAttribute("data-status", "declined", { timeout: 60_000 });
});
