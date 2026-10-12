import { test, expect } from "@playwright/test";
const id = "10000000-0000-4000-8000-000000000001",
  revision = "10000000-0000-4000-8000-000000000002";
const prepared = {
  fingerprint: "a".repeat(64),
  totalCents: 3600,
  tableText: "4 Dress Shirts · 2 Pants",
};
const catalog = [
  { id: "202", label: "Dress Shirt", unit: "piece", section: "Dry Cleaning" },
  { id: "203", label: "Pants", unit: "piece", section: "Dry Cleaning" },
];
test("phone intake requires inspection approval and uncertain outcome only offers read-only check", async ({
  page,
}) => {
  let state = "detail",
    submitted = false;
  const calls: any[] = [];
  await page.route("**/api/trpc/**", async route => {
    const request = route.request(),
      operation = new URL(request.url()).pathname.split(".").pop();
    const input =
      request.method() === "POST" ? request.postDataJSON()?.json : null;
    calls.push({ operation, input });
    if (operation === "prepare") state = "review";
    if (operation === "approve") {
      submitted = true;
      state = "attention";
    }
    if (operation === "verify") state = "saved";
    const data =
      operation === "list"
        ? {
            enabled: true,
            catalog,
            capturedAt: new Date().toISOString(),
            orders: [
              {
                id,
                revision,
                externalOrderId: "101",
                sourceJson: {
                  customerName: "Avery Example",
                  readyBy: "Tomorrow",
                },
                state,
                submittedAt: submitted ? new Date().toISOString() : null,
                preparedJson: state === "detail" ? null : prepared,
                planJson: null,
                lastError:
                  "Submission outcome unknown. Check saved result; do not submit again.",
              },
            ],
          }
        : { queued: true };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ result: { data: { json: data } } }),
    });
  });
  await page.goto("/e2e/cleancloud-intake/fixture.html");
  await page.getByRole("button", { name: /#101/ }).click();
  await page.getByLabel("Dress Shirt quantity").fill("4");
  await page.getByLabel("Pants quantity").fill("2");
  await page.getByRole("button", { name: "Prepare in CleanCloud" }).click();
  expect(calls.find(x => x.operation === "prepare").input.plan.lines).toEqual([
    { productId: "202", quantity: 4 },
    { productId: "203", quantity: 2 },
  ]);
  const approve = page.getByRole("button", {
    name: "Approve and submit — $36.00",
  });
  await expect(approve).toBeDisabled();
  await page
    .getByRole("button", { name: "Show prepared CleanCloud order on computer" })
    .click();
  await expect(approve).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(approve).toBeEnabled();
  await page.screenshot({
    path: "/private/tmp/cleancloud-intake-phone-review.png",
    fullPage: true,
  });
  await approve.click();
  await expect(
    page.getByRole("button", { name: "Check saved result — no resubmission" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Prepare in CleanCloud" })
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Check saved result — no resubmission" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Payment status has not been verified"
  );
  expect(calls.filter(x => x.operation === "approve")).toHaveLength(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
});
