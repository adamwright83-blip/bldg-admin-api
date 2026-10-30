import { expect, test, type Page } from "@playwright/test";
import { FAKE, begin, connectOwn, toTheTable } from "./journey";

/**
 * Slice 7, "Your first chapter": back on their portrait, a new entry has appeared from what the person actually did,
 * with the message's real status. Claire answers "Where did we leave things with Elena?" through her engine, from what
 * she reads (the stand-in model writes from it), and remembers.
 * "Tomorrow, we'll pick up from here." The courtyard stays open; no chore list appears.
 */
// Nina is in Los Angeles: Claire gives times in her zone
test.use({ timezoneId: "America/Los_Angeles" });

const ASTRA = "Hi Elena — you asked earlier this year about Friday flowers. We now have a weekly Friday delivery. Is that still something you're looking for at the hotel?";

async function shots(name: string, page: Page, testInfo: { project: { name: string } }) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `tmp/first-ten-e2e-shots/${testInfo.project.name}-${name}.png`, fullPage: true });
}

test("your own account: the entry, the message as it really stands, and Claire's answer from what she read, remembered", async ({ page, request, context }, testInfo) => {
  test.setTimeout(300_000);
  await begin(page, request);
  await connectOwn(page, request);
  await toTheTable(page);

  // the message leaves the table her way, and lands in her own Sent folder
  await context.route("https://mail.google.com/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Gmail</title>" }));
  const [gmail] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "Open in Gmail" }).click()]);
  await gmail.close();
  await request.post(`${FAKE}/__send-from-gmail`, { data: { to: "elena@larkspurhotel.example", toName: "Elena Ruiz", subject: "Re: Friday flowers?", body: ASTRA } });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByTestId("first-ten-send-status")).toContainText("In your Sent folder", { timeout: 20_000 });

  // back to her portrait: a new entry has appeared
  await page.getByTestId("first-ten-back-to-page").click();
  const entry = page.getByTestId("first-ten-first-chapter");
  await expect(entry).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("first-ten-portrait")).toHaveAttribute("data-status", "kept");
  await expect(entry).toContainText("Your first chapter");
  await expect(page.getByTestId("first-ten-first-chapter-entry")).toHaveText(
    "You revisited Elena's Friday request and prepared a reply using the weekly service you now offer."
  );
  await expect(page.getByTestId("first-ten-first-chapter-status")).toContainText("In your Sent folder");
  await expect(page.getByTestId("first-ten-tomorrow")).toHaveCount(0);
  await shots("60-first-chapter", page, testInfo);

  // Claire, with a suggested question. An answer that says what the records don't is never shown
  await request.post(`${FAKE}/__control`, { data: { claireOverclaims: true } });
  await page.getByTestId("first-ten-ask-claire").click();
  await expect(page.getByTestId("first-ten-claire-trouble")).toHaveText("Claire can't answer that properly right now. Try again in a moment.", { timeout: 20_000 });
  await expect(page.getByTestId("first-ten-claire-answer")).toHaveCount(0);
  await request.post(`${FAKE}/__control`, { data: { claireOverclaims: false } });

  // her answer comes from what she read: the request, the message as it stands, where it is
  await page.getByTestId("first-ten-ask-claire").click();
  const answer = page.getByTestId("first-ten-claire-answer");
  await expect(answer).toContainText(`You picked up Elena's Friday request from April 2026. You kept the reply as it was drafted: “${ASTRA}” It's in your Sent folder, sent at`, {
    timeout: 20_000,
  });
  await expect(answer).toContainText("Elena hasn't written back yet.");
  await expect(page.getByTestId("first-ten-claire-question")).toHaveText("“Where did we leave things with Elena?”");
  await expect(page.getByTestId("first-ten-tomorrow")).toHaveText("Tomorrow, we'll pick up from here.");
  await shots("61-claire", page, testInfo);

  // Elena writes back; asked again, Claire says so, in Elena's words
  await request.post(`${FAKE}/__reply-from`, {
    data: { from: "elena@larkspurhotel.example", fromName: "Elena Ruiz", subject: "Re: Friday flowers?", body: "Hi Nina,\n\nYes — we'd love a Friday standing order. Could you start next week?" },
  });
  await page.getByTestId("first-ten-ask-again").click();
  await expect(answer).toContainText("Elena wrote back at", { timeout: 20_000 });
  await expect(answer).toContainText(": “Yes — we'd love a Friday standing order.”");

  // she remembers: a reload comes back to the page, with what she said
  await page.reload();
  await expect(page.getByTestId("first-ten-first-chapter")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("first-ten-claire-answer")).toContainText("Elena wrote back at");

  // the courtyard stays open, and the way back to the page with it; no chore list anywhere
  await page.getByTestId("first-ten-courtyard-link").click();
  await expect(page.getByTestId("first-ten-draft")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("first-ten-send-status")).toContainText("In your Sent folder");
  await page.getByTestId("first-ten-back-to-page").click();
  await expect(page.getByTestId("first-ten-first-chapter")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/to-do|to do list|checklist|next steps/i)).toHaveCount(0);
});

test("Nina's example: the entry says the reply is prepared, and Claire that it hasn't been sent", async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  await begin(page, request);
  await page.getByTestId("first-ten-example").click();
  await toTheTable(page);
  await page.getByTestId("first-ten-back-to-page").click();
  await expect(page.getByTestId("first-ten-first-chapter-entry")).toHaveText(
    "You revisited Elena's Friday request and prepared a reply using the weekly service you now offer.",
    { timeout: 20_000 }
  );
  await expect(page.getByTestId("first-ten-first-chapter-status")).toHaveText("Prepared. Not sent.");
  await page.getByTestId("first-ten-ask-claire").click();
  await expect(page.getByTestId("first-ten-claire-answer")).toContainText(`You kept the reply as it was drafted: “${ASTRA}” It's ready, and it hasn't been sent.`, {
    timeout: 20_000,
  });
  await expect(page.getByTestId("first-ten-tomorrow")).toBeVisible();
  await shots("62-example-first-chapter", page, testInfo);
});
