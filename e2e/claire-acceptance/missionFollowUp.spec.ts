/* LEGACY DAYFORGE COMPATIBILITY: disposable historical SQL names only; current product is JOYSTICK. */
import { test, expect } from "@playwright/test";
import { cleanupOwner, database, login, provisionOwner, rpc } from "../real/helpers";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const proposal = (title: string) => ({
  promptKey: `acceptance-${title}`,
  title,
  kind: "growth" as const,
  quantity: null,
  sourceText: `${title}: contact five eligible dormant customers and record replies.`,
  prerequisites: [],
  question: null,
  intelligence: "manual_fallback" as const,
});

test("Driver: Claire asks about unresolved work, Daphne records the answer, the next matching mission changes", async ({
  browser,
}) => {
  const owner = await provisionOwner("Daphne follow-up acceptance");
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:4187" });
  const db = await database();
  try {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await login(page, owner);
    const today = ymd(new Date());
    // Two days back is overdue in any tenant timezone, whatever the runner's clock.
    const yesterday = ymd(new Date(Date.now() - 2 * 86_400_000));
    // Yesterday's growth work, still open.
    await rpc(context.request, "system.dayDirector.accept", { businessDate: yesterday, proposal: proposal("Recover lapsed customers") }, true);

    await page.goto(`/play?date=${today}`, { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("claire-mission-followup");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("claire-mission-followup-question")).toHaveText("What happened with that growth mission?");
    await expect(card).toContainText("Recover lapsed customers");
    await page.getByTestId("claire-mission-followup-answer").fill("It was too much at once, I didn't know where to start.");
    await card.getByRole("button", { name: "Tell Claire" }).click();
    await expect(page.getByTestId("claire-mission-followup-reply")).toContainText("Start with the first step only");

    const [observations] = await db.execute<any[]>(
      "SELECT observationKind,evidenceChannel,sourceType FROM daphne_observations WHERE tenantId=? AND sourceType IN ('day_director_commitment','day_line_unresolved_explanation','daphne_mission_presentation') ORDER BY occurredAt,createdAt",
      [owner.tenantId]
    );
    expect(observations.map(r => [r.sourceType, r.evidenceChannel])).toEqual([
      ["day_director_commitment", "system_record"],
      ["day_line_unresolved_explanation", "stated"],
      ["daphne_mission_presentation", "stated"],
    ]);
    const [original] = await db.execute<any[]>(
      "SELECT status,title FROM day_director_commitments WHERE tenantId=? AND businessDate=?",
      [owner.tenantId, yesterday]
    );
    expect(original[0]).toMatchObject({ status: "open", title: "Recover lapsed customers" });

    // The next matching mission enters today's Day Line and is presented differently.
    const next = await rpc(context.request, "system.dayDirector.accept", { businessDate: today, proposal: proposal("Recover lapsed customers, round two") }, true);
    const nextId: string = next.id;
    await page.reload({ waitUntil: "domcontentloaded" });
    const adjusted = page.getByTestId(`daphne-mission-adjustment-${nextId}`);
    await expect(adjusted).toBeVisible();
    await expect(adjusted).toContainText("Recover lapsed customers, round two");
    await expect(adjusted).toContainText("Start with the first step only; the full objective is unchanged.");
    await expect(page.getByTestId("claire-mission-followup")).toHaveCount(0);
    const state = await rpc(context.request, "system.dayDirector.state", { businessDate: today });
    const row = state.commitments.find((c: { id: string }) => c.id === nextId);
    expect(row.title).toBe("Recover lapsed customers, round two");
    expect(row.presentation.adjustment).toEqual({ kind: "task_size", firstStepOnly: true });
    await page.screenshot({ path: "artifacts/claire-strategy/acceptance/browser/daphne-next-mission.png", fullPage: true });

    // Revocation returns the mission to its default presentation.
    await rpc(context.request, "system.dayDirector.revokeMissionPresentation", { missionType: "growth" }, true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId(`daphne-mission-adjustment-${nextId}`)).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await db.end();
    await context.close();
    await cleanupOwner(owner);
  }
});
