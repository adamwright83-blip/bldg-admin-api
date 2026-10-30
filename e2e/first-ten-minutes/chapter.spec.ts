import { expect, test, type Page } from "@playwright/test";
import { FAKE, begin, connectOwn, toTheChapter } from "./journey";

/**
 * Slices 5 and 8: the chapter, chosen by the opportunity found. When something became possible it is Astra's "The
 * Friday That Didn't Exist": the calendar turns back to Elena's April request, the Friday crossing is folded shut,
 * and Rook tries it; Nina turns between then and now, brings the invitation onto today's route, and the crossing
 * unfolds (Sunday, which she keeps closed, stays folded). Then straight to Rook's message at the table. For any other
 * opportunity it is Hazel's "A Proper Letter", and then the same table.
 */
async function shots(name: string, page: Page, testInfo: { project: { name: string } }) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `tmp/first-ten-e2e-shots/${testInfo.project.name}-${name}.png`, fullPage: true });
}

const ASTRA = "Hi Elena — you asked earlier this year about Friday flowers. We now have a weekly Friday delivery. Is that still something you're looking for at the hotel?";

test("The Friday That Didn't Exist: then and now, Sunday kept closed, Rook's fall, and the real draft at the table", async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  await begin(page, request);
  await page.getByTestId("first-ten-example").click();
  await toTheChapter(page);
  const revelation = page.getByTestId("first-ten-revelation");
  const line = page.getByTestId("first-ten-chapter-line");

  // then: April, Elena's request, Nina's reply, the crossing folded shut; Sable puts the message down
  await expect(revelation).toHaveAttribute("data-phase", "then", { timeout: 20_000 });
  await expect(page.getByTestId("first-ten-chapter-title")).toHaveText("The Friday That Didn't Exist");
  await expect(page.getByTestId("first-ten-calendar")).toHaveAttribute("data-month", "April");
  await expect(page.getByTestId("first-ten-invitation")).toContainText("Could you do fresh arrangements every Friday?");
  await expect(page.getByTestId("first-ten-invitation")).toContainText("Elena Ruiz · Apr 18");
  await expect(page.getByTestId("first-ten-old-reply")).toContainText("Ask me again once we have a Friday delivery.");
  await expect(page.getByTestId("first-ten-crossing")).toHaveAttribute("data-crossing", "closed");
  await expect(page.getByTestId("first-ten-crossing")).toContainText("FRIDAY — UNAVAILABLE");
  await expect(page.getByTestId("first-ten-chapter-sable")).toHaveText(/This is where the conversation stopped\./);
  await expect(line).toContainText("Well, that's inconvenient.", { timeout: 10_000 });
  // nothing announces it
  await expect(revelation).not.toContainText("You can now");
  await shots("40-then", page, testInfo);

  // now: today, the Friday delivery, the cart on the route, Sunday still folded; the invitation onto today's route
  await page.getByTestId("first-ten-turn-to-today").click();
  await expect(revelation).toHaveAttribute("data-phase", "now", { timeout: 20_000 });
  await expect(page.getByTestId("first-ten-calendar")).toHaveAttribute("data-month", "October");
  await expect(page.getByTestId("first-ten-service-now")).toContainText("Wildroot has a weekly Friday delivery");
  await expect(page.getByTestId("first-ten-cart-on-route")).toHaveCount(1);
  await expect(page.getByTestId("first-ten-kept-closed")).toContainText("SUNDAY — CLOSED");
  await page.getByRole("button", { name: "Bring Elena Ruiz's request onto today's map" }).click();
  await expect(page.getByTestId("first-ten-crossing")).toHaveAttribute("data-crossing", "open");
  await expect(page.getByTestId("first-ten-kept-closed")).toContainText("SUNDAY — CLOSED");
  await expect(line).toContainText("Oh. Well, look at that.");
  // Rook steps onto it a little too enthusiastically
  await expect(line).toContainText("I was going there.", { timeout: 10_000 });
  await expect(page.locator('[data-crew="rook"]')).toHaveAttribute("data-fell", "yes");
  await shots("41-now", page, testInfo);

  // the same place behaves differently across time: turn back, the crossing is shut; forward, it's open again
  await page.getByTestId("first-ten-turn-page").click();
  await expect(revelation).toHaveAttribute("data-view", "then");
  await expect(page.getByTestId("first-ten-calendar")).toHaveAttribute("data-month", "April");
  await expect(page.getByTestId("first-ten-crossing")).toHaveAttribute("data-crossing", "closed");
  await page.getByTestId("first-ten-turn-page").click();
  await expect(revelation).toHaveAttribute("data-view", "now");
  await expect(page.getByTestId("first-ten-crossing")).toHaveAttribute("data-crossing", "open");

  // the full explanation, for whoever wants it: the chapter's reveal, by name, with then and now side by side
  await page.getByTestId("first-ten-why").click();
  const why = page.getByTestId("first-ten-why-sheet");
  await expect(why).toContainText("Elena asked before you could. You can now.");
  await expect(why).toContainText("Elena asked before Friday delivery existed. It exists now, and your route passes the hotel.");
  await expect(page.getByTestId("first-ten-why-then-now")).toContainText("Then “We're only doing events at the moment. Ask me again once we have a Friday delivery.”");
  await expect(page.getByTestId("first-ten-why-then-now")).toContainText("Now “Wildroot has a weekly Friday delivery”");
  await why.getByRole("button", { name: "Close" }).click();

  // the next move is Nina's: Rook already has the message at the table, the real recipient and the exact words
  await page.getByTestId("first-ten-pick-up").click();
  const draft = page.getByTestId("first-ten-draft");
  await expect(draft).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("first-ten-letter")).toHaveCount(0);
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
  // the route Nina opened stays open on the map, with the message pinned
  const closing = page.getByTestId("first-ten-closing");
  await expect(closing).toHaveAttribute("data-outcome", "not_now");
  await expect(closing).toContainText("A newly opened route remains on the map.");
  await expect(closing.getByTestId("first-ten-pinned-message")).toContainText("Could you do fresh arrangements every Friday?");
  await draft.getByRole("button", { name: "Bring it back" }).click();
  await expect(draft).toHaveAttribute("data-status", "prepared");

  // a reload lands back at the table with Nina's words
  await page.reload();
  await expect(page.getByTestId("first-ten-draft")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("first-ten-message-body")).toContainText("Shall I bring a sample this Friday?");
});

test("A Proper Letter, when no Part 3 chapter fits: Hazel's errand, then a message that claims nothing new", async ({ page, request }, testInfo) => {
  test.setTimeout(300_000);
  await begin(page, request);
  // the reading finds Elena's request with no reply, and nothing new to offer
  await request.post(`${FAKE}/__control`, { data: { opportunity: "unanswered" } });
  await connectOwn(page, request);
  await toTheChapter(page);
  const revelation = page.getByTestId("first-ten-revelation");
  await expect(revelation).toHaveAttribute("data-phase", "then", { timeout: 30_000 });
  // not Part 3's chapter: no title, no unavailable sign (nothing was missing), no turning back
  await expect(page.getByTestId("first-ten-chapter-title")).toHaveCount(0);
  await expect(page.getByTestId("first-ten-crossing")).not.toContainText("UNAVAILABLE");
  await page.getByTestId("first-ten-turn-to-today").click();
  await expect(revelation).toHaveAttribute("data-phase", "now", { timeout: 20_000 });
  await expect(page.getByTestId("first-ten-turn-page")).toHaveCount(0);
  await page.getByRole("button", { name: /onto today's map/ }).click();
  await page.getByTestId("first-ten-pick-up").click({ timeout: 20_000 });

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

  await page.getByRole("button", { name: "Give Hazel the quill" }).click();
  await expect(say).toContainText("Is that a quill? Inked? Then sit. Write. I'm listening.");
  await expect(page.getByTestId("first-ten-hazel-reply")).toContainText("Dear Hazel");
  await expect(say).toContainText("Complaint withdrawn.", { timeout: 15_000 });
  await expect(say).toContainText("I'm keeping the stamp.", { timeout: 10_000 });
  await expect(say).toContainText("Now. Yours.", { timeout: 10_000 });

  // the same table: nothing new is offered, because there's no record of anything new
  await expect(page.getByTestId("first-ten-draft")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("first-ten-now")).toHaveCount(0);
  await expect(page.getByTestId("first-ten-message-body")).toHaveText(
    "Hi Elena — you asked earlier this year about Friday flowers, and I never got back to you. Is that still something you're looking for at the hotel?"
  );
  await page.getByTestId("first-ten-draft").getByRole("button", { name: "Try another way" }).click();
  await expect(page.getByTestId("first-ten-message-body")).toHaveText("Hi Elena — still looking for Friday flowers?");
});
