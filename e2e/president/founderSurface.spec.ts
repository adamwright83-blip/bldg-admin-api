import { expect, test } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import superjson from "superjson";

// Fixture is regenerated from the real MySQL executive-cycle test, never a
// production provider or a production route bypass.
const surface = JSON.parse(
  readFileSync(
    "artifacts/president-intelligence/founder-surface-fixture.json",
    "utf8"
  )
);
const founder = {
  openId: "fixture-founder",
  name: "Fixture founder",
  role: "admin",
  email: null,
};
test("durable executive cycle renders clearly at desktop width", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/trpc/**", async route => {
    const paths = new URL(route.request().url()).pathname
      .split("/api/trpc/")[1]
      .split(",");
    const response = paths.map(path => ({
      result: {
        data: superjson.serialize(
          path === "auth.me"
            ? founder
            : path === "president.founderSurface"
              ? surface
              : null
        ),
      },
    }));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
  await page.goto("/president");
  await expect(
    page.getByRole("heading", { name: "President", exact: true })
  ).toBeVisible();
  for (const heading of [
    "What needs Adam now",
    "What we are trying to accomplish",
    "What happened & what changed",
    "Evidence",
    "What President recommends",
  ])
    await expect(
      page.getByRole("heading", { name: heading, exact: true })
    ).toBeVisible();
  await expect(page.getByText("ACHIEVED", { exact: true })).toBeVisible();
  await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible();
  await page.getByText("Recent execution and recovery evidence").click();
  await expect(page.getByText(/STEP RETRY SCHEDULED/)).toBeVisible();
  await expect(page.getByText(/STEP INDEPENDENTLY VERIFIED/)).toBeVisible();
  await expect(page.getByText(/TEST FIXTURE/).first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
  ).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
  mkdirSync("artifacts/president-browser", { recursive: true });
  await page.screenshot({
    path: "artifacts/president-browser/desktop.png",
    fullPage: true,
  });
});
test("bounded founder question records the selected decision", async ({
  page,
}) => {
  let submitted: unknown;
  const decision = {
    id: "10000000-0000-4000-8000-000000000001",
    programId: null,
    stepId: null,
    questionKey: "objective:10000000-0000-4000-8000-000000000002:selection",
    question: "Authorize the isolated fixture drill?",
    options: ["Authorize this program", "Not now", "Stop objective"],
    recommendedOption: "Authorize this program",
    reason: "Founder must set the bounded budget",
    status: "OPEN",
    answer: null,
    askedAt: new Date().toISOString(),
    answeredAt: null,
  };
  await page.route("**/api/trpc/**", async route => {
    const paths = new URL(route.request().url()).pathname
      .split("/api/trpc/")[1]
      .split(",");
    if (paths.includes("president.answerObjectiveSelection"))
      submitted = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        paths.map(path => ({
          result: {
            data: superjson.serialize(
              path === "auth.me"
                ? founder
                : path === "president.founderSurface"
                  ? {
                      ...surface,
                      brief: { ...surface.brief, questions: [decision] },
                    }
                  : path === "president.answerObjectiveSelection"
                    ? {}
                    : null
            ),
          },
        }))
      ),
    });
  });
  await page.goto("/president");
  await expect(
    page.getByRole("heading", { name: decision.question })
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Decision", exact: true }).selectOption("Not now");
  await page.getByRole("button", { name: "Confirm decision" }).click();
  await expect.poll(() => JSON.stringify(submitted)).toContain("Not now");
});
test("authorization errors stay visible without fabricated state", async ({
  page,
}) => {
  await page.route("**/api/trpc/**", async route => {
    const paths = new URL(route.request().url()).pathname
      .split("/api/trpc/")[1]
      .split(",");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        paths.map(path =>
          path === "auth.me"
            ? { result: { data: superjson.serialize(founder) } }
            : {
                error: superjson.serialize({
                  message:
                    "President is available only to the configured JOYSTICK founder",
                  code: -32003,
                  data: { code: "FORBIDDEN", httpStatus: 403 },
                }),
              }
        )
      ),
    });
  });
  await page.goto("/president");
  await expect(page.getByRole("alert")).toContainText(
    "configured JOYSTICK founder"
  );
  await expect(page.getByText("ACHIEVED", { exact: true })).toHaveCount(0);
});
