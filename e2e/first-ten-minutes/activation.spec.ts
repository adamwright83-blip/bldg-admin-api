import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FAKE, begin, connectOwn, toTheTable } from "./journey";

/**
 * Slice 6: activation at the moment of value, and the message leaving the table. Locally there is no billing plan, so
 * the page says plainly that JOYSTICK isn't taking payment yet and the message can go. It goes from inside JOYSTICK,
 * from the person's own Gmail: they see exactly what will go, Google is asked once for permission to send, they
 * confirm the recipient, and it is shown as sent only with Google's message id. No Gmail window, nothing to copy.
 */
async function shots(name: string, page: Page, testInfo: { project: { name: string } }) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `tmp/first-ten-e2e-shots/${testInfo.project.name}-${name}.png`, fullPage: true });
}

const ASTRA = "Hi Elena — you asked earlier this year about Friday flowers. We now have a weekly Friday delivery. Is that still something you're looking for at the hotel?";

async function apiSends(request: APIRequestContext) {
  return ((await (await request.get(`${FAKE}/__api-sends`)).json()) as { sends: Array<{ from: string; to: string; subject: string; body: string; messageId: string }> }).sends;
}

/** Permission to send, from Google's consent screen, back to the same table. */
async function allowSending(page: Page) {
  await page.getByTestId("first-ten-allow-send").click();
  await expect(page.getByTestId("first-ten-send-start")).toBeVisible({ timeout: 60_000 });
}

test("your own account: the exact message reviewed, permission asked once, and it is sent from inside JOYSTICK", async ({ page, request, context }, testInfo) => {
  test.setTimeout(300_000);
  // nothing opens outside JOYSTICK: no Gmail window, no new tab
  const opened: string[] = [];
  context.on("page", other => opened.push(other.url()));
  await begin(page, request);
  await connectOwn(page, request);
  await toTheTable(page);

  await expect(page.getByTestId("first-ten-activation")).toContainText("Keep your crew. Continue your story.");
  await expect(page.getByTestId("first-ten-offer-closed")).toHaveText("JOYSTICK isn't taking payment yet. Everything here is saved.");
  // exactly what will go, and from which account
  await expect(page.getByTestId("first-ten-send-from")).toHaveText("nina@wildrootflowers.example");
  await expect(page.getByTestId("first-ten-send-to")).toHaveText("Elena Ruiz <elena@larkspurhotel.example>");
  await expect(page.getByTestId("first-ten-send-message")).toContainText("Re: Friday flowers?");
  await expect(page.getByTestId("first-ten-send-message")).toContainText(ASTRA);
  await expect(page.getByTestId("first-ten-send-says")).toHaveText(
    "To send it from here, Google needs to let JOYSTICK send from nina@wildrootflowers.example. JOYSTICK sends only what you approve, one message at a time."
  );
  await expect(page.getByRole("button", { name: /Open in Gmail|Copy/ })).toHaveCount(0);
  await shots("50-keep-your-crew", page, testInfo);

  await allowSending(page);
  // one confirmation, naming the recipient; "Not yet" sends nothing
  await page.getByTestId("first-ten-send-start").click();
  await expect(page.getByTestId("first-ten-send-confirm")).toContainText(
    "Send this message to Elena Ruiz (elena@larkspurhotel.example) from nina@wildrootflowers.example?"
  );
  await page.getByTestId("first-ten-send-confirm").getByRole("button", { name: "Not yet" }).click();
  expect(await apiSends(request)).toHaveLength(0);
  await page.getByTestId("first-ten-send-start").click();
  await page.getByTestId("first-ten-send-now").click();

  const status = page.getByTestId("first-ten-send-status");
  await expect(status).toContainText("Sent from your Gmail at", { timeout: 20_000 });
  const sends = await apiSends(request);
  expect(sends).toHaveLength(1);
  expect(sends[0]).toMatchObject({ from: "nina@wildrootflowers.example", to: '"Elena Ruiz" <elena@larkspurhotel.example>', subject: "Re: Friday flowers?", body: ASTRA });
  const closing = page.getByTestId("first-ten-closing");
  await expect(closing).toHaveAttribute("data-outcome", "sent");
  await expect(closing).toContainText("Hazel notices the ink on your hand.");
  await shots("51-sent", page, testInfo);

  // a reload keeps what happened, and nothing is sent twice
  await page.reload();
  await expect(page.getByTestId("first-ten-send-status")).toContainText("Sent from your Gmail", { timeout: 60_000 });
  await expect(page.getByTestId("first-ten-send-start")).toHaveCount(0);
  expect(await apiSends(request)).toHaveLength(1);
  expect(opened).toEqual([]);
});

test("the person's own words go exactly as approved; a refusal keeps the message, and a lost answer is settled from Sent", async ({ page, request }) => {
  test.setTimeout(300_000);
  await begin(page, request);
  await connectOwn(page, request);
  await toTheTable(page);
  const draft = page.getByTestId("first-ten-draft");
  await draft.getByRole("button", { name: "Edit" }).click();
  await draft.getByLabel("Your message").fill("Hi Elena — Friday delivery exists now. Shall I bring a sample this Friday?");
  await draft.getByRole("button", { name: "Keep these words" }).click();
  await expect(page.getByTestId("first-ten-send-message")).toContainText("Shall I bring a sample this Friday?");
  await allowSending(page);

  // permission taken away at Google since: nothing went, and permission can be given again from the table
  await request.post(`${FAKE}/__control`, { data: { revokeSend: true } });
  await page.getByTestId("first-ten-send-start").click();
  await page.getByTestId("first-ten-send-now").click();
  await expect(page.getByTestId("first-ten-send-problem")).toHaveText(
    "Google didn't allow JOYSTICK to send from this account. Nothing was sent; allow it again to send from here."
  );
  await expect(page.getByTestId("first-ten-send")).toHaveAttribute("data-status", "prepared");
  await allowSending(page);

  // Google refuses it: nothing went, and the message is still at the table
  await request.post(`${FAKE}/__control`, { data: { sendAnswer: "refuse" } });
  await page.getByTestId("first-ten-send-start").click();
  await page.getByTestId("first-ten-send-now").click();
  await expect(page.getByTestId("first-ten-send-problem")).toHaveText("Google didn't send it. Nothing went; your message is still here. You can try again.");
  await expect(page.getByTestId("first-ten-send")).toHaveAttribute("data-status", "prepared");

  // Google takes it but the answer never arrives: JOYSTICK finds it in Sent by its own Message-ID, and says so then
  await request.post(`${FAKE}/__control`, { data: { sendAnswer: "lose" } });
  await page.getByTestId("first-ten-send-start").click();
  await page.getByTestId("first-ten-send-now").click();
  await expect(page.getByTestId("first-ten-send-status")).toContainText("Sent from your Gmail", { timeout: 30_000 });
  const sends = await apiSends(request);
  expect(sends).toHaveLength(1);
  expect(sends[0].body).toBe("Hi Elena — Friday delivery exists now. Shall I bring a sample this Friday?");
});

test("when Google isn't allowed to send, nothing is sent and the message stays", async ({ page, request }) => {
  test.setTimeout(300_000);
  await begin(page, request);
  await connectOwn(page, request);
  await toTheTable(page);
  await request.post(`${FAKE}/__control`, { data: { refuseSend: true } });
  await page.getByTestId("first-ten-allow-send").click();
  await expect(page.getByText("Google didn't give JOYSTICK permission to send. Nothing was sent; your message is still here.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("first-ten-allow-send")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("first-ten-send")).toHaveAttribute("data-status", "prepared");
  expect(await apiSends(request)).toHaveLength(0);
});

test("Nina's example is never activated and never sends", async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  await begin(page, request);
  await page.getByTestId("first-ten-example").click();
  await toTheTable(page);
  await expect(page.getByTestId("first-ten-activation-example")).toContainText("This is Nina's example, so nothing here is activated or sent.");
  await expect(page.getByTestId("first-ten-allow-send")).toHaveCount(0);
  await expect(page.getByTestId("first-ten-send")).toHaveCount(0);
  await shots("52-example-table", page, testInfo);
});
