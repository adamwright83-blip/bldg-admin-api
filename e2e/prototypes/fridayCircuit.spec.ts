import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

/**
 * "The Friday That Didn't Exist" as a clockwork prototype, played as the hosted page is played. These check that the
 * machine works as specified. Whether it's enjoyable is not something a test can say.
 */
const PAGE = `file://${resolve("tmp/friday-circuit/friday-circuit.local.html")}`;

async function open(page: Page, variant: "letters" | "neutral" = "letters") {
  await page.goto(`${PAGE}#${variant}`);
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`${PAGE}#${variant}`);
  await expect(page.getByTestId("friday-circuit")).toHaveAttribute(
    "data-variant",
    variant
  );
}

const courier = (page: Page) => page.getByTestId("courier");

/** Turn the junction until it joins the sides named. */
async function setJunction(
  page: Page,
  to: "west-north" | "west-east" | "north-east"
) {
  const junction = page.getByTestId("junction");
  for (
    let i = 0;
    i < 3 && (await junction.getAttribute("data-junction")) !== to;
    i += 1
  ) {
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
  await expect(courier(page)).toHaveAttribute("data-at", pad, {
    timeout: 15_000,
  });
  await expect(courier(page)).toHaveAttribute("data-moment", "idle", {
    timeout: 15_000,
  });
}

async function slideTo(page: Page, layer: "then" | "now") {
  await page.getByTestId(`layer-${layer}`).click();
  await expect(page.getByTestId("circuit-board")).toHaveAttribute(
    "data-layer",
    layer
  );
}

test("both circuits complete: clockwise, and counterclockwise", async ({
  page,
}) => {
  await open(page);
  // clockwise: S → J → P, slide to NOW, P → H → Q (delivered), slide to THEN, turn J, Q → J → S
  await setJunction(page, "west-north");
  await wind(page);
  await docksAt(page, "P");
  await slideTo(page, "now");
  await wind(page);
  await docksAt(page, "Q");
  await expect(courier(page)).toHaveAttribute("data-envelope", "delivered");
  await expect(page.getByTestId("hotel-envelope")).toHaveCount(1);
  await slideTo(page, "then");
  await setJunction(page, "west-east");
  await wind(page);
  await docksAt(page, "S");
  await expect(page.getByTestId("completion")).toBeVisible();
  await expect(page.getByTestId("rook-line")).toHaveText(
    /There and back\. Suspiciously competent\./
  );

  // counterclockwise, from a reset: S → J → Q, NOW, Q → H → P (delivered), THEN, turn J, P → J → S
  await page.getByTestId("reset").click();
  await expect(courier(page)).toHaveAttribute("data-at", "S");
  await expect(page.getByTestId("completion")).toHaveCount(0);
  await setJunction(page, "west-east");
  await wind(page);
  await docksAt(page, "Q");
  await slideTo(page, "now");
  await wind(page);
  await docksAt(page, "P");
  await expect(courier(page)).toHaveAttribute("data-envelope", "delivered");
  await slideTo(page, "then");
  await setJunction(page, "west-north");
  await wind(page);
  await docksAt(page, "S");
  await expect(page.getByTestId("completion")).toBeVisible();
});

test("neither layer alone completes it: NOW can't leave the studio, THEN never reaches the hotel", async ({
  page,
}) => {
  await open(page);
  // NOW alone: the wheels turn over a withdrawn track, and the courier settles back on its pad
  await slideTo(page, "now");
  await wind(page);
  await expect(courier(page)).toHaveAttribute("data-moment", "spin", {
    timeout: 5_000,
  });
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
  await expect(page.getByTestId("completion")).toHaveCount(0);
  await expect(page.getByTestId("hotel-envelope")).toHaveCount(0);
});

test("the wrong junction is a quick, recoverable failure; delivering alone isn't coming home", async ({
  page,
}) => {
  await open(page);
  // the starting junction doesn't admit the courier from the studio: it bumps its nose, the envelope flips upright
  await wind(page);
  await expect(courier(page)).toHaveAttribute("data-moment", "bump", {
    timeout: 10_000,
  });
  await expect(courier(page)).toHaveAttribute("data-envelope", "upright");
  await expect(page.getByTestId("rook-line")).toHaveText(
    /A bold interpretation of ‘connected\.’/
  );
  await expect(page.getByTestId("wind")).toBeDisabled();
  await expect(page.getByTestId("layer-now")).toBeDisabled();
  // the junction can still be turned while it's stopped; a retry puts it back on its pad, configuration kept
  await setJunction(page, "west-north");
  await page.getByTestId("retry").click();
  await docksAt(page, "S");
  await expect(courier(page)).toHaveAttribute("data-envelope", "carried");
  await expect(page.getByTestId("junction")).toHaveAttribute(
    "data-junction",
    "west-north"
  );

  await wind(page);
  await docksAt(page, "P");
  await slideTo(page, "now");
  await wind(page);
  await docksAt(page, "Q");
  // delivered, but not home: no win
  await expect(page.getByTestId("hotel-envelope")).toHaveCount(1);
  await expect(page.getByTestId("completion")).toHaveCount(0);
  // forgetting to turn the junction back: it reaches the junction from the unjoined side, and the bell rings once
  await slideTo(page, "then");
  await wind(page);
  await expect(courier(page)).toHaveAttribute("data-moment", "bell", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("bell")).toHaveCount(1);
  // Rook doesn't react after every attempt
  await expect(page.getByTestId("rook-line")).toHaveCount(0);
  await page.getByTestId("retry").click();
  await docksAt(page, "Q");
  await expect(courier(page)).toHaveAttribute("data-envelope", "delivered");
  await setJunction(page, "west-east");
  await wind(page);
  await docksAt(page, "S");
  await expect(page.getByTestId("completion")).toBeVisible();
});

test("declining the sample action keeps the victory, and a reload keeps the model and the choice, separately", async ({
  page,
}) => {
  await open(page);
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
  const completion = page.getByTestId("completion");
  await expect(completion.getByTestId("invitation")).toContainText(
    "Could you do fresh arrangements every Friday?"
  );
  await completion.getByTestId("choice-not_for_me").click();
  await expect(completion.getByTestId("choice-note")).toHaveText("Set aside.");
  await expect(completion).toBeVisible();
  await expect(page.getByTestId("hotel-envelope")).toHaveCount(1);

  await page.reload();
  await expect(page.getByTestId("completion")).toBeVisible();
  await expect(courier(page)).toHaveAttribute("data-at", "S");
  await expect(page.getByTestId("hotel-envelope")).toHaveCount(1);
  await expect(page.getByTestId("junction")).toHaveAttribute(
    "data-junction",
    "west-east"
  );
  await expect(page.getByTestId("choice-not_for_me")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  const stored = await page.evaluate(() => ({
    puzzle: JSON.parse(
      window.localStorage.getItem(
        "joystick.prototype.fridayCircuit.letters.puzzle.v1"
      ) ?? "null"
    ),
    choice: JSON.parse(
      window.localStorage.getItem(
        "joystick.prototype.fridayCircuit.sampleChoice.v1"
      ) ?? "null"
    ),
  }));
  expect(stored.puzzle.state).toMatchObject({
    complete: true,
    delivered: true,
    at: "S",
  });
  expect(stored.puzzle).not.toHaveProperty("choice");
  expect(stored.choice).toMatchObject({ choice: "not_for_me" });

  // preparing a reply only produces a labelled sample draft
  await page.getByTestId("choice-reply").click();
  await expect(page.getByTestId("sample-draft")).toContainText("Sample draft");
  await expect(page.getByTestId("sample-draft")).toContainText(
    "We now have a weekly Friday delivery."
  );
});

test("the correspondence is open from the start, without the puzzle", async ({
  page,
}) => {
  await open(page);
  await page.getByTestId("go-correspondence").click();
  const correspondence = page.getByTestId("correspondence");
  await expect(correspondence.getByTestId("paper-then")).toContainText(
    "Ask me again once we have a Friday delivery."
  );
  await expect(correspondence.getByTestId("paper-now")).toContainText(
    "Wildroot has a weekly Friday delivery"
  );
  await correspondence.getByTestId("choice-later").click();
  await expect(correspondence.getByTestId("choice-note")).toHaveText(
    "Kept for later."
  );
  await expect(page.getByTestId("completion")).toHaveCount(0);
});

test("the neutral version: the same machine, plain labels, no letters", async ({
  page,
}) => {
  await open(page, "neutral");
  await expect(page.getByTestId("sample-label")).toHaveCount(0);
  await expect(page.getByTestId("go-correspondence")).toHaveCount(0);
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
  await expect(page.getByTestId("completion")).toContainText(
    "Delivered, and home."
  );
});
