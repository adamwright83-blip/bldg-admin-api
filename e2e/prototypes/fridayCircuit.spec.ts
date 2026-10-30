import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

/**
 * "The Friday That Didn't Exist" as a clockwork prototype, played as the hosted page is played. These check that the
 * machine and its ending work as specified. Whether it's enjoyable, and whether a player sees the missed Friday
 * without being told, is not something a test can say.
 */
const PAGE = `file://${resolve("tmp/friday-circuit/friday-circuit.local.html")}`;
const PROMISE = "Ask me again once we have a Friday delivery.";
const FACT = "weekly Friday delivery";

async function open(page: Page, variant: "letters" | "neutral" = "letters") {
  await page.goto(`${PAGE}#${variant}`);
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`${PAGE}#${variant}`);
  await expect(page.getByTestId("friday-circuit")).toHaveAttribute("data-variant", variant);
}

const courier = (page: Page) => page.getByTestId("courier");
const main = (page: Page) => page.getByTestId("friday-circuit");

/** Turn the junction until it joins the sides named. */
async function setJunction(page: Page, to: "west-north" | "west-east" | "north-east") {
  const junction = page.getByTestId("junction");
  for (let i = 0; i < 3 && (await junction.getAttribute("data-junction")) !== to; i += 1) {
    await junction.click();
    await page.waitForTimeout(150);
  }
  await expect(junction).toHaveAttribute("data-junction", to);
}

async function wind(page: Page) {
  await page.getByTestId("wind").click();
}

/** Wait for the courier to dock at a pad, at rest. */
async function docksAt(page: Page, pad: "S" | "P" | "Q") {
  await expect(courier(page)).toHaveAttribute("data-at", pad, { timeout: 15_000 });
  await expect(courier(page)).toHaveAttribute("data-moment", "idle", { timeout: 15_000 });
}

async function slideTo(page: Page, layer: "then" | "now") {
  await page.getByTestId(`layer-${layer}`).click();
  await expect(page.getByTestId("circuit-board")).toHaveAttribute("data-layer", layer);
}

/** Clockwise: S → J → P, slide to NOW, P → H → Q (delivered), slide to THEN, turn J, Q → J → S. */
async function solveClockwise(page: Page) {
  await setJunction(page, "west-north");
  await wind(page);
  await docksAt(page, "P");
  await slideTo(page, "now");
  await wind(page);
  await docksAt(page, "Q");
  await slideTo(page, "then");
  await setJunction(page, "west-east");
  await wind(page);
  await docksAt(page, "S");
}

/** Counterclockwise: S → J → Q, NOW, Q → H → P (delivered), THEN, turn J, P → J → S. */
async function solveCounterclockwise(page: Page) {
  await setJunction(page, "west-east");
  await wind(page);
  await docksAt(page, "Q");
  await slideTo(page, "now");
  await wind(page);
  await docksAt(page, "P");
  await slideTo(page, "then");
  await setJunction(page, "west-north");
  await wind(page);
  await docksAt(page, "S");
}

/** The desk, settled: every paper down and inked, and the choice (or what was chosen) in view. */
async function deskSettled(page: Page) {
  const desk = page.getByTestId("desk");
  await expect(desk).toBeVisible({ timeout: 15_000 });
  await expect(desk).toHaveAttribute("data-stage", "4", { timeout: 10_000 });
  return desk;
}

/** Everything the reveal and the choice need is in view, and nothing has to be scrolled to. */
async function inViewWithoutScrolling(page: Page) {
  const viewport = page.viewportSize()!;
  const fits = await page.getByTestId("desk").evaluate(element => element.scrollHeight <= element.clientHeight + 1);
  expect(fits, "the desk fits the screen without scrolling").toBe(true);
  for (const id of ["desk-paper-request", "desk-paper-promise", "desk-paper-fact", "choice-reply", "choice-later", "choice-not_for_me"]) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.y, `${id} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `${id} ends on screen`).toBeLessThanOrEqual(viewport.height);
  }
}

test("both circuits complete: clockwise, and counterclockwise", async ({ page }) => {
  await open(page);
  await solveClockwise(page);
  await expect(courier(page)).toHaveAttribute("data-envelope", "delivered");
  await expect(page.getByTestId("hotel-envelope")).toHaveCount(1);
  await expect(page.getByTestId("rook-line")).toHaveText(/There and back\. Suspiciously competent\./);
  await deskSettled(page);
  await page.getByTestId("back-to-board").click();
  await expect(page.getByTestId("desk")).toHaveCount(0);
  await expect(page.getByTestId("completion")).toContainText("Delivered, and home.");

  // counterclockwise, from a reset
  await page.getByTestId("reset").click();
  await expect(courier(page)).toHaveAttribute("data-at", "S");
  await expect(page.getByTestId("completion")).toHaveCount(0);
  await expect(main(page)).toHaveAttribute("data-ending", "none");
  await solveCounterclockwise(page);
  await expect(courier(page)).toHaveAttribute("data-envelope", "delivered");
  await deskSettled(page);
});

test("neither layer alone completes it: NOW can't leave the studio, THEN never reaches the hotel", async ({ page }) => {
  await open(page);
  // NOW alone: the wheels turn over a withdrawn track, and the courier settles back on its pad
  await slideTo(page, "now");
  await wind(page);
  await expect(courier(page)).toHaveAttribute("data-moment", "spin", { timeout: 5_000 });
  await docksAt(page, "S");
  await expect(courier(page)).toHaveAttribute("data-envelope", "carried");
  // THEN alone: every pad is reachable, the invitation never leaves the courier, and home isn't a win
  await slideTo(page, "then");
  for (const [junction, pad] of [
    ["west-north", "P"],
    ["north-east", "Q"],
    ["west-east", "S"],
  ] as const) {
    await setJunction(page, junction);
    await wind(page);
    await docksAt(page, pad);
    await expect(courier(page)).toHaveAttribute("data-envelope", "carried");
  }
  await expect(main(page)).toHaveAttribute("data-ending", "none");
  await expect(page.getByTestId("route-glow")).toHaveCount(0);
  await expect(page.getByTestId("hotel-envelope")).toHaveCount(0);
});

test("the wrong junction is a quick, recoverable failure; delivering alone isn't coming home", async ({ page }) => {
  await open(page);
  // the starting junction doesn't admit the courier from the studio: it bumps its nose, the envelope flips upright
  await wind(page);
  await expect(courier(page)).toHaveAttribute("data-moment", "bump", { timeout: 10_000 });
  await expect(courier(page)).toHaveAttribute("data-envelope", "upright");
  await expect(page.getByTestId("rook-line")).toHaveText(/A bold interpretation of ‘connected\.’/);
  await expect(page.getByTestId("wind")).toBeDisabled();
  await expect(page.getByTestId("layer-now")).toBeDisabled();
  // the junction can still be turned while it's stopped; a retry puts it back on its pad, configuration kept
  await setJunction(page, "west-north");
  await page.getByTestId("retry").click();
  await docksAt(page, "S");
  await expect(courier(page)).toHaveAttribute("data-envelope", "carried");
  await expect(page.getByTestId("junction")).toHaveAttribute("data-junction", "west-north");

  await wind(page);
  await docksAt(page, "P");
  await slideTo(page, "now");
  await wind(page);
  await docksAt(page, "Q");
  // delivered, but not home: no win
  await expect(page.getByTestId("hotel-envelope")).toHaveCount(1);
  await expect(main(page)).toHaveAttribute("data-ending", "none");
  // forgetting to turn the junction back: it reaches the junction from the unjoined side, and the bell rings once
  await slideTo(page, "then");
  await wind(page);
  await expect(courier(page)).toHaveAttribute("data-moment", "bell", { timeout: 10_000 });
  await expect(page.getByTestId("bell")).toHaveCount(1);
  // Rook doesn't react after every attempt
  await expect(page.getByTestId("rook-line")).toHaveCount(0);
  await page.getByTestId("retry").click();
  await docksAt(page, "Q");
  await expect(courier(page)).toHaveAttribute("data-envelope", "delivered");
  await setJunction(page, "west-east");
  await wind(page);
  await docksAt(page, "S");
  await deskSettled(page);
});

test("the ending: home and lit, chapter complete with the title corrected, the envelope opens at the hotel, then the studio's papers, unexplained", async ({ page }) => {
  await open(page);
  await solveClockwise(page);

  // home: the round trip lit, postmarked, and Rook's line; the controls are done
  await expect(main(page)).toHaveAttribute("data-ending", "homecoming");
  await expect(page.getByTestId("route-glow")).toHaveCount(1);
  await expect(page.getByTestId("postmark")).toContainText("DELIVERED");
  await expect(page.getByTestId("rook-line")).toHaveText(/Suspiciously competent/);
  await expect(page.getByTestId("wind")).toBeDisabled();

  // chapter complete, and the title corrects itself
  await expect(page.getByTestId("chapter-card")).toContainText("Chapter complete");
  await expect(page.getByTestId("title-correction")).toContainText("Does");

  // the envelope the courier left at the hotel opens there; the desk hasn't come yet
  await expect(main(page)).toHaveAttribute("data-ending", "hotel", { timeout: 5_000 });
  await expect(page.getByTestId("hotel-opening")).toHaveCount(1);
  await expect(page.getByTestId("hotel-envelope")).toHaveAttribute("data-opened", "yes");
  await expect(page.getByTestId("desk")).toHaveCount(0);

  // the writing desk: the studio's own three dated papers, April's promise and September's fact inked and threaded
  const desk = await deskSettled(page);
  await expect(desk.getByTestId("desk-paper-request")).toContainText("Apr 18");
  await expect(desk.getByTestId("desk-paper-request")).toContainText("Could you do fresh arrangements every Friday?");
  await expect(desk.getByTestId("desk-paper-promise")).toContainText("Apr 19");
  await expect(desk.getByTestId("desk-paper-fact")).toContainText("Sep 3");
  await expect(desk.getByTestId("ink-promise")).toHaveText(PROMISE);
  await expect(desk.getByTestId("ink-fact")).toHaveText(FACT);
  await expect(desk.getByTestId("ink-promise")).toHaveAttribute("data-drawn", "yes");
  await expect(desk.getByTestId("thread")).toHaveCount(1);
  // they are not the envelope: that is still at the hotel, on the board
  await expect(page.getByTestId("hotel-envelope")).toHaveCount(1);
  // nobody explains it
  const words = (await desk.innerText()).toLowerCase();
  for (const explanation of ["nobody told", "you have them now", "said to ask again", "missed"]) expect(words).not.toContain(explanation);

  // the choice, clear, with the first ready to take
  await expect(desk.getByTestId("decision")).toContainText("Elena Ruiz");
  await expect(desk.getByTestId("choice-reply")).toBeFocused();
  await expect(desk.getByTestId("desk-sample-label")).toHaveText("Invented sample · this prototype can't send anything.");
  await inViewWithoutScrolling(page);
});

test("a tap moves the ending along, and settles the desk at once", async ({ page }) => {
  await open(page);
  await solveClockwise(page);
  await expect(main(page)).toHaveAttribute("data-ending", "homecoming");
  await page.getByTestId("advance").click();
  await expect(main(page)).toHaveAttribute("data-ending", "chapter");
  await page.getByTestId("advance").click();
  await expect(main(page)).toHaveAttribute("data-ending", "hotel");
  await page.getByTestId("advance").click();
  await expect(main(page)).toHaveAttribute("data-ending", "desk");
  await page.getByTestId("desk").click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId("desk")).toHaveAttribute("data-stage", "4");
  await expect(page.getByTestId("decision")).toBeVisible();
});

test("preparing a reply writes out the labelled sample, and nothing can send it", async ({ page }) => {
  await open(page);
  await page.getByTestId("go-correspondence").click();
  const desk = await deskSettled(page);
  await desk.getByTestId("choice-reply").click();
  const reply = desk.getByTestId("sample-reply");
  await expect(reply).toContainText("Sample draft · invented");
  await expect(reply).toContainText("Hi Elena — you asked earlier this year about Friday flowers. We now have a weekly Friday delivery.");
  await expect(desk.getByTestId("sample-stamp")).toHaveText(/sample · not sent/i);
  await expect(desk.getByTestId("joystick-note")).toHaveText(
    "In JOYSTICK, this is your real reply to your real customer. It opens in your own Gmail, and you decide whether to send it."
  );
  await expect(desk.getByRole("link")).toHaveCount(0);
  await expect(desk.getByRole("button", { name: /send/i })).toHaveCount(0);
  await expect(desk.getByTestId("decision")).toHaveCount(0);
});

test("keeping it for later leaves the letter waiting", async ({ page }) => {
  await open(page);
  await page.getByTestId("go-correspondence").click();
  const desk = await deskSettled(page);
  await desk.getByTestId("choice-later").click();
  await expect(desk.getByTestId("outcome")).toHaveText("The letter waits on the table, folded.");
  // nothing is prompted again: closing and reopening shows the same
  await desk.getByTestId("back-to-board").click();
  await page.getByTestId("go-correspondence").click();
  await expect(page.getByTestId("outcome")).toHaveText("The letter waits on the table, folded.");
  await expect(page.getByTestId("decision")).toHaveCount(0);
});

test("declining keeps the victory and isn't asked again; a reload keeps the model and the choice, separately", async ({ page }) => {
  await open(page);
  await solveClockwise(page);
  const desk = await deskSettled(page);
  await desk.getByTestId("choice-not_for_me").click();
  await expect(desk.getByTestId("outcome")).toHaveText("The card goes into the drawer.");
  await expect(desk.getByTestId("play-again")).toBeVisible();
  await expect(page.getByTestId("hotel-envelope")).toHaveCount(1);

  // a reload reopens where it ended: the desk, with what was chosen, and no second asking
  await page.reload();
  await expect(main(page)).toHaveAttribute("data-ending", "desk");
  await expect(page.getByTestId("outcome")).toHaveText("The card goes into the drawer.");
  await expect(page.getByTestId("decision")).toHaveCount(0);
  await expect(courier(page)).toHaveAttribute("data-at", "S");
  await expect(page.getByTestId("junction")).toHaveAttribute("data-junction", "west-east");
  const stored = await page.evaluate(() => ({
    puzzle: JSON.parse(window.localStorage.getItem("joystick.prototype.fridayCircuit.letters.puzzle.v1") ?? "null"),
    choice: JSON.parse(window.localStorage.getItem("joystick.prototype.fridayCircuit.sampleChoice.v1") ?? "null"),
  }));
  expect(stored.puzzle.state).toMatchObject({ complete: true, delivered: true, at: "S" });
  expect(stored.puzzle).not.toHaveProperty("choice");
  expect(stored.choice).toMatchObject({ choice: "not_for_me" });

  // playing again starts a new round: the machine as found, and the choice open again
  await page.getByTestId("play-again").click();
  await expect(page.getByTestId("desk")).toHaveCount(0);
  await expect(main(page)).toHaveAttribute("data-ending", "none");
  await expect(page.getByTestId("junction")).toHaveAttribute("data-junction", "north-east");
  await expect(courier(page)).toHaveAttribute("data-envelope", "carried");
  expect(await page.evaluate(() => window.localStorage.getItem("joystick.prototype.fridayCircuit.sampleChoice.v1"))).toBeNull();
});

test("the correspondence is open from the start, without the puzzle", async ({ page }) => {
  await open(page);
  await page.getByTestId("go-correspondence").click();
  const desk = await deskSettled(page);
  await expect(desk.getByTestId("ink-promise")).toHaveText(PROMISE);
  await expect(desk.getByTestId("ink-fact")).toHaveText(FACT);
  await inViewWithoutScrolling(page);
  await desk.getByTestId("back-to-board").click();
  await expect(page.getByTestId("desk")).toHaveCount(0);
  await expect(page.getByTestId("completion")).toHaveCount(0);
  await expect(main(page)).toHaveAttribute("data-ending", "none");
});

test("with motion reduced, the ending still plays through, without the movement", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await solveClockwise(page);
  await expect(page.getByTestId("chapter-card")).toBeVisible();
  const desk = page.getByTestId("desk");
  await expect(desk).toBeVisible({ timeout: 6_000 });
  await expect(desk).toHaveAttribute("data-stage", "4");
  await expect(desk.getByTestId("ink-fact")).toHaveAttribute("data-drawn", "yes");
  await expect(desk.getByTestId("choice-reply")).toBeFocused();
});

test("the neutral version: the same machine and the same win, plain labels, no letters", async ({ page }) => {
  await open(page, "neutral");
  await expect(page.getByTestId("sample-label")).toHaveCount(0);
  await expect(page.getByTestId("go-correspondence")).toHaveCount(0);
  await solveCounterclockwise(page);
  await expect(main(page)).toHaveAttribute("data-ending", "homecoming");
  await expect(page.getByTestId("route-glow")).toHaveCount(1);
  await expect(page.getByTestId("postmark")).toHaveCount(1);
  const card = page.getByTestId("chapter-card");
  await expect(card).toContainText("Chapter complete");
  await expect(card).toContainText("Delivered, and home.");
  await expect(page.getByTestId("title-correction")).toHaveCount(0);
  // and there it ends: no hotel scene, no desk, no letters
  await page.waitForTimeout(2_500);
  await expect(main(page)).toHaveAttribute("data-ending", "chapter");
  await expect(page.getByTestId("desk")).toHaveCount(0);
  await expect(page.getByTestId("hotel-opening")).toHaveCount(0);
  await card.getByTestId("play-again").click();
  await expect(main(page)).toHaveAttribute("data-ending", "none");
  await expect(page.getByTestId("junction")).toHaveAttribute("data-junction", "north-east");
});
