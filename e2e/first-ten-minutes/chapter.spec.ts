import { expect, test, type Page } from "@playwright/test";

/**
 * Slice 5: the revelation and "A Proper Letter". The calendar turns back to Elena's April request, the Friday
 * crossing is folded shut, Rook tries it; Nina turns the calendar to today and brings the invitation onto today's map.
 * Then Hazel's errand in the courtyard, and the real draft at the same writing table, to the real recipient.
 */
const FAKE = "http://127.0.0.1:4999";

async function shots(name: string, page: Page, testInfo: { project: { name: string } }) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `tmp/first-ten-e2e-shots/${testInfo.project.name}-${name}.png`, fullPage: true });
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

const ASTRA = "Hi Elena — you asked earlier this year about Friday flowers. We now have a weekly Friday delivery. Is that still something you're looking for at the hotel?";

async function toTheChapter(page: Page) {
  await page.getByTestId("first-ten-example").click();
  await expect(page.getByTestId("first-ten-crew-scene")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("first-ten-sable-answers").getByRole("button", { name: "Still the rule" }).click();
  await expect(page.getByTestId("first-ten-portrait")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "That sounds like me" }).click();
  await expect(page.getByTestId("first-ten-revelation")).toBeVisible({ timeout: 20_000 });
}

test("the Friday that didn't exist, Hazel's proper letter, and the real draft at the same table", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await toTheChapter(page);
  const revelation = page.getByTestId("first-ten-revelation");
  const line = page.getByTestId("first-ten-chapter-line");

  // then: April, Elena's request, Nina's reply, the crossing folded shut
  await expect(revelation).toHaveAttribute("data-phase", "then", { timeout: 20_000 });
  await expect(page.getByTestId("first-ten-calendar")).toHaveAttribute("data-month", "April");
  await expect(page.getByTestId("first-ten-invitation")).toContainText("Could you do fresh arrangements every Friday?");
  await expect(page.getByTestId("first-ten-invitation")).toContainText("Elena Ruiz · Apr 18");
  await expect(page.getByTestId("first-ten-old-reply")).toContainText("Ask me again once we have a Friday delivery.");
  await expect(page.getByTestId("first-ten-crossing")).toHaveAttribute("data-crossing", "closed");
  await expect(page.getByTestId("first-ten-crossing")).toContainText("FRIDAY — UNAVAILABLE");
  await expect(line).toContainText("Well, that's inconvenient.");
  // nothing announces it
  await expect(revelation).not.toContainText("Someone already asked");
  await shots("40-then", page, testInfo);

  // now: today, the Friday delivery, the route; the invitation brought onto today's map.
  // "Today" is the clock's UTC month (RevelationScene), not a month frozen when this was written.
  const todayMonth = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date());
  await page.getByTestId("first-ten-turn-to-today").click();
  await expect(revelation).toHaveAttribute("data-phase", "now", { timeout: 20_000 });
  await expect(page.getByTestId("first-ten-calendar")).toHaveAttribute("data-month", todayMonth);
  await expect(page.getByTestId("first-ten-service-now")).toContainText("Wildroot has a weekly Friday delivery");
  await page.getByRole("button", { name: "Bring Elena Ruiz's request onto today's map" }).click();
  await expect(page.getByTestId("first-ten-crossing")).toHaveAttribute("data-crossing", "open");
  await expect(line).toContainText("Oh. Well, look at that.");
  await shots("41-now", page, testInfo);

  // the full explanation, for whoever wants it
  await page.getByTestId("first-ten-why").click();
  await expect(page.getByTestId("first-ten-why-sheet")).toContainText("Someone already asked for what you now offer.");
  await expect(page.getByTestId("first-ten-why-sheet")).toContainText("Elena asked before Friday delivery existed. It exists now, and your route passes the hotel.");
  await page.getByTestId("first-ten-why-sheet").getByRole("button", { name: "Close" }).click();

  await page.getByTestId("first-ten-pick-up").click();
  const courtyard = page.getByTestId("first-ten-letter");
  await expect(courtyard).toBeVisible();
  const say = page.getByTestId("first-ten-letter-line");
  await expect(say).toContainText("A letter? Excellent. I have several opinions about letters.");
  await expect(say).toContainText("I said proper.", { timeout: 10_000 });
  await expect(courtyard).toHaveAttribute("data-phase", "explore", { timeout: 10_000 });
  await shots("42-courtyard", page, testInfo);

  // Pip, without protection: ow, and Sable's hint
  await page.getByRole("button", { name: "Shake the porcupine" }).click();
  await expect(say).toContainText("OW. Pip is mostly quills.");
  await expect(say).toContainText("Thick. Knitted. Currently protecting a teapot.", { timeout: 10_000 });

  await page.getByRole("button", { name: "Put on the tea cosy" }).click();
  await expect(say).toContainText("an excellent oven glove");
  await page.getByRole("button", { name: "Shake the porcupine" }).click();
  await expect(say).toContainText("one shed quill floats down");
  await page.getByRole("button", { name: "Pick up the quill" }).click();
  await expect(say).toContainText("Very pointy at one end, very fancy at the other.");
  await page.getByRole("button", { name: "Dip the quill in the ink well" }).click();
  await expect(say).toContainText("Dip, dab, drip.");
  await expect(courtyard).toHaveAttribute("data-step", "4");
  await shots("43-inked", page, testInfo);

  // the table opens only once the draft is prepared: when that fails, it can be tried again without a reload
  await page.route(/system\.firstTenMinutes\.prepareDraft/, route => route.abort(), { times: 1 });
  await page.getByRole("button", { name: "Give Hazel the quill" }).click();
  await expect(say).toContainText("Is that a quill? Inked? Then sit. Write. I'm listening.");
  await expect(page.getByTestId("first-ten-hazel-reply")).toContainText("Dear Hazel");
  await expect(say).toContainText("Complaint withdrawn.", { timeout: 15_000 });
  await expect(say).toContainText("I'm keeping the stamp.", { timeout: 10_000 });
  await expect(say).toContainText("Now. Yours.", { timeout: 10_000 });
  await page.getByTestId("first-ten-table-retry").click({ timeout: 15_000 });

  // the same table, now for Nina's business: the real recipient and the exact message
  const draft = page.getByTestId("first-ten-draft");
  await expect(draft).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("first-ten-draft-boundary")).toHaveText("Your business · Elena at the hotel");
  await expect(page.getByTestId("first-ten-then")).toContainText("Could you do fresh arrangements every Friday?");
  await expect(page.getByTestId("first-ten-now")).toContainText("Wildroot has a weekly Friday delivery");
  await expect(page.getByTestId("first-ten-message")).toContainText("Elena Ruiz <elena@larkspurhotel.example>");
  await expect(page.getByTestId("first-ten-message")).toContainText("Re: Friday flowers?");
  await expect(page.getByTestId("first-ten-message-body")).toHaveText(ASTRA);
  await expect(page.getByTestId("first-ten-table-line")).toContainText("Short enough to answer.");
  await expect(draft).toHaveAttribute("data-status", "prepared");
  // nothing claims it was sent
  await expect(page.getByTestId("first-ten-send-status")).toHaveCount(0);
  await expect(page.getByText(/In your Sent folder|You said you sent it/)).toHaveCount(0);
  await shots("44-draft", page, testInfo);

  // another way, then Nina's own words, then not now, then back
  await draft.getByRole("button", { name: "Try another way" }).click();
  await expect(page.getByTestId("first-ten-message-body")).toContainText("the Friday route already goes past the Larkspur Hotel");
  await draft.getByRole("button", { name: "Edit" }).click();
  await draft.getByLabel("Your message").fill("Hi Elena — Friday delivery exists now. Shall I bring a sample this Friday?");
  await draft.getByRole("button", { name: "Keep these words" }).click();
  await expect(page.getByTestId("first-ten-message-body")).toHaveText("Hi Elena — Friday delivery exists now. Shall I bring a sample this Friday?");
  await draft.getByRole("button", { name: "Not now" }).click();
  await expect(draft).toHaveAttribute("data-status", "declined");
  await expect(draft).toContainText("Not now. It stays here, unsent.");
  await draft.getByRole("button", { name: "Bring it back" }).click();
  await expect(draft).toHaveAttribute("data-status", "prepared");

  // a reload lands back at the table with Nina's words
  await page.reload();
  await expect(page.getByTestId("first-ten-draft")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("first-ten-message-body")).toContainText("Shall I bring a sample this Friday?");
});
