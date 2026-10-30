import { expect, test, type Page } from "@playwright/test";
import { FAKE, begin, connectOwn, toTheTable } from "./journey";

/**
 * Slice 6: activation at the moment of value, and the message leaving the table. Locally there is no billing plan, so
 * the page says plainly that JOYSTICK isn't taking payment yet and the message can go. It goes the person's way: their
 * own Gmail opens with it ready; the page records only that, asks "Did it go?", and believes their Sent folder.
 */
async function shots(name: string, page: Page, testInfo: { project: { name: string } }) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `tmp/first-ten-e2e-shots/${testInfo.project.name}-${name}.png`, fullPage: true });
}

test("your own account: the offer stated plainly, Gmail opens with the exact message, and only the truth comes back", async ({ page, request, context }, testInfo) => {
  test.setTimeout(300_000);
  await begin(page, request);
  await connectOwn(page, request);
  await toTheTable(page);

  await expect(page.getByTestId("first-ten-activation")).toContainText("Keep your crew. Continue your story.");
  await expect(page.getByTestId("first-ten-activation")).toContainText("Your business portrait, this conversation, and everything you've prepared will be waiting here.");
  await expect(page.getByTestId("first-ten-offer-closed")).toHaveText("JOYSTICK isn't taking payment yet. Everything here is saved.");
  await expect(page.getByTestId("first-ten-send-says")).toHaveText(
    "Your message to Elena opens in your own Gmail, ready to send. You send it there. JOYSTICK doesn't send it."
  );
  await shots("50-keep-your-crew", page, testInfo);

  // Gmail's own compose window, with the real recipient and the exact message (played here by a stand-in page)
  await context.route("https://mail.google.com/**", route => route.fulfill({ status: 200, contentType: "text/html", body: "<title>Gmail</title>" }));
  const [gmail] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "Open in Gmail" }).click()]);
  await gmail.waitForURL(/mail\.google\.com/);
  const compose = new URL(gmail.url());
  expect(compose.hostname).toBe("mail.google.com");
  expect(compose.searchParams.get("view")).toBe("cm");
  expect(compose.searchParams.get("to")).toBe("elena@larkspurhotel.example");
  expect(compose.searchParams.get("su")).toBe("Re: Friday flowers?");
  expect(compose.searchParams.get("body")).toBe(
    "Hi Elena — you asked earlier this year about Friday flowers. We now have a weekly Friday delivery. Is that still something you're looking for at the hotel?"
  );
  expect(compose.searchParams.get("authuser")).toBe("nina@wildrootflowers.example");
  await gmail.close();

  const status = page.getByTestId("first-ten-send-status");
  await expect(status).toContainText("Opened in your mail at");
  await expect(status).toContainText("JOYSTICK didn't send it.");
  await expect(page.getByText("You said you sent it.")).toHaveCount(0);

  // not yet: the letter keeps
  await page.getByTestId("first-ten-did-it-go").getByRole("button", { name: "Not yet" }).click();
  await expect(page.getByTestId("first-ten-closing")).toHaveAttribute("data-outcome", "not_yet");
  await expect(page.getByTestId("first-ten-closing")).toContainText("It'll keep. Ink does.", { timeout: 10_000 });

  // then they send it from Gmail, and JOYSTICK finds it in their own Sent folder
  await request.post(`${FAKE}/__send-from-gmail`, {
    data: { to: "elena@larkspurhotel.example", toName: "Elena Ruiz", subject: "Re: Friday flowers?", body: "Hi Elena — ..." },
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(status).toContainText("In your Sent folder", { timeout: 20_000 });
  const closing = page.getByTestId("first-ten-closing");
  await expect(closing).toHaveAttribute("data-outcome", "sent");
  await expect(closing).toContainText("Hazel notices the ink on your hand.");
  await expect(closing).toContainText("You'll get used to that.", { timeout: 10_000 });
  await expect(closing).toContainText("Pip retrieves the tea cosy and settles underneath it.", { timeout: 10_000 });
  await shots("51-sent", page, testInfo);

  // a reload keeps what happened
  await page.reload();
  await expect(page.getByTestId("first-ten-send-status")).toContainText("In your Sent folder", { timeout: 60_000 });
});

test("Nina's example is never activated and never sends", async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  await begin(page, request);
  await page.getByTestId("first-ten-example").click();
  await toTheTable(page);
  await expect(page.getByTestId("first-ten-activation-example")).toContainText("This is Nina's example, so nothing here is activated or sent.");
  await expect(page.getByRole("button", { name: "Open in Gmail" })).toHaveCount(0);
  await expect(page.getByTestId("first-ten-send")).toHaveCount(0);
  await shots("52-example-table", page, testInfo);
});
