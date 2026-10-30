import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Walking a journey to a given point, for the later slices' tests. Reduced motion keeps the crew brisk. */
export const FAKE = "http://127.0.0.1:4999";

export async function begin(page: Page, request: APIRequestContext) {
  await request.post(`${FAKE}/__reset`);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/joystick-start");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/joystick-start");
  await page.getByRole("button", { name: "Let's find out" }).click();
}

/** Nina's corpus, read as the person's own Google account (through the stand-in Gmail, Calendar, Drive and model). */
export async function connectOwn(page: Page, request: APIRequestContext) {
  await request.post(`${FAKE}/__control`, { data: { googleEmail: "nina@wildrootflowers.example" } });
  await page.getByTestId("first-ten-connect-google").click();
}

/** Through the crew, Claire's page and the chapter's opening, to where the chapter begins. */
export async function toTheChapter(page: Page) {
  await expect(page.getByTestId("first-ten-crew-scene")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("first-ten-sable-answers").getByRole("button", { name: "Still the rule" }).click();
  await expect(page.getByTestId("first-ten-portrait")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "That sounds like me" }).click();
}

/** "The Friday That Didn't Exist": the old request onto today's route, and straight to Rook's message at the table. */
export async function toTheTable(page: Page) {
  await toTheChapter(page);
  await expect(page.getByTestId("first-ten-revelation")).toHaveAttribute("data-phase", "then", { timeout: 30_000 });
  await page.getByTestId("first-ten-turn-to-today").click();
  await expect(page.getByTestId("first-ten-revelation")).toHaveAttribute("data-phase", "now", { timeout: 20_000 });
  await page.getByRole("button", { name: /onto today's map/ }).click();
  await page.getByTestId("first-ten-pick-up").click({ timeout: 20_000 });
  await expect(page.getByTestId("first-ten-draft")).toBeVisible({ timeout: 30_000 });
}
