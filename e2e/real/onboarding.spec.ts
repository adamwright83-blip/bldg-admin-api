import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";

const credentialKey = "joystick_acquisition_credentials";
const answers = {
  daily_work: "I run plumbing calls and quote jobs",
  service_area: "Pasadena",
  avoidance: "following up on estimates",
};
function json(value: unknown): any {
  return typeof value === "string" ? JSON.parse(value) : value;
}

test("real onboarding persists answers, resumes the same draft and labels proposed evidence", async ({ page, browser }, testInfo) => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for real acceptance");
  const db: Connection = await mysql.createConnection(process.env.DATABASE_URL);
  let sessionId = "";
  try {
    const [database] = await db.query<RowDataPacket[]>("SELECT DATABASE() AS name");
    if (!String(database[0].name).includes("real_acceptance")) {
      throw new Error("Refusing browser fixtures outside disposable real_acceptance database");
    }
    const [initial] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM dayforge_saas_tenants");
    const [drafts] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM dayforge_saas_onboarding_sessions");
    const responses: Array<{ procedure: string; status: number }> = [];
    page.on("response", response => {
      if (response.url().includes("/api/trpc/system.saas.")) {
        responses.push({ procedure: new URL(response.url()).pathname, status: response.status() });
      }
    });
    await page.goto("/joystick-start");
    await expect(page.getByText("1 OF 3", { exact: true })).toBeVisible();
    const credentials = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), credentialKey);
    sessionId = credentials.sessionId;
    expect(credentials.resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    for (const [index, answer] of Object.values(answers).entries()) {
      await page.locator("textarea").fill(answer);
      await page.getByRole("button", { name: "CONTINUE", exact: true }).click();
      if (index < 2) await expect(page.getByText(`${index + 2} OF 3`, { exact: true })).toBeVisible();
    }
    const readDraft = async () => {
      const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM dayforge_saas_onboarding_sessions WHERE id = ?", [sessionId]);
      expect(rows).toHaveLength(1);
      return rows[0];
    };
    await expect.poll(async () => json((await readDraft()).draftAnswersJson)).toEqual(answers);
    const persisted = await readDraft();
    expect(persisted.tenantId).toBeNull();
    expect(persisted.resumeTokenHash).toBe(createHash("sha256").update(credentials.resumeToken).digest("hex"));
    expect(persisted.resumeTokenHash).not.toBe(credentials.resumeToken);
    expect(new Date(persisted.expiresAt).getTime()).toBeGreaterThan(Date.now());
    await page.reload();
    await expect(page.getByRole("button", { name: "BUILD MY FIRST DAY LINE", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "BUILD MY FIRST DAY LINE", exact: true }).click();
    await expect(page.getByTestId("draft-preview-briefing")).toContainText(answers.daily_work);
    await expect(page.getByTestId("draft-preview-briefing")).toContainText(answers.avoidance);
    await expect(page.getByTestId("draft-preview-label")).toContainText("Draft preview · based only on your answers");
    const savedPreview = json((await readDraft()).draftPreviewJson);
    expect(savedPreview).toMatchObject({
      kind: "joystick_draft_preview",
      work: { value: answers.daily_work, provenance: "operator_declared" },
      area: { declared: answers.service_area },
      avoidance: { value: answers.avoidance, provenance: "operator_declared" },
      briefing: { provenance: "generated_recommendation" },
      recommendedAction: { provenance: "generated_recommendation" },
    });
    // Only the legitimately issued persisted resume credential is carried into
    // a new browser. No auth response, business route or database state is mocked.
    const context = await browser.newContext();
    try {
      await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
        key: credentialKey, value: JSON.stringify(credentials),
      });
      const recovered = await context.newPage();
      await recovered.goto(new URL("/joystick-start", page.url()).href);
      await expect(recovered.getByTestId("draft-preview-briefing")).toHaveText(savedPreview.briefing.text);
      expect(await recovered.evaluate(key => JSON.parse(localStorage.getItem(key)!).sessionId, credentialKey)).toBe(sessionId);
      const [afterDrafts] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM dayforge_saas_onboarding_sessions");
      expect(Number(afterDrafts[0].count)).toBe(Number(drafts[0].count) + 1);
      // A wrong bearer credential must not recover the persisted draft.
      const invalid = await context.request.get(new URL(`/api/trpc/system.saas.resume?input=${encodeURIComponent(JSON.stringify({ json: { sessionId, resumeToken: "x".repeat(43) } }))}`, page.url()).href);
      expect(invalid.ok()).toBe(false);
      expect(await invalid.text()).toContain("invalid or expired");
    } finally {
      await context.close();
    }
    const [afterTenants] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS count FROM dayforge_saas_tenants");
    expect(Number(afterTenants[0].count)).toBe(Number(initial[0].count));
    expect((await readDraft()).tenantId).toBeNull();
    for (const procedure of ["startJoystickDraft", "saveJoystickDraftAnswer", "resume", "generateJoystickDraftPreview"]) {
      expect(responses.some(response => response.procedure.includes(procedure) && response.status === 200)).toBe(true);
    }
    await testInfo.attach("onboarding-database-and-http-evidence", {
      body: JSON.stringify({ sessionId, answers, preview: savedPreview, tenantId: null, responses }, null, 2), contentType: "application/json",
    });
    await testInfo.attach("onboarding-preview", { body: await page.screenshot(), contentType: "image/png" });
  } finally {
    if (sessionId) {
      await db.execute("DELETE FROM dayforge_product_events WHERE anonymousSessionId = ?", [sessionId]);
      await db.execute("DELETE FROM dayforge_audit_events WHERE entityType = 'saas_onboarding_session' AND entityId = ?", [sessionId]);
      await db.execute("DELETE FROM dayforge_saas_onboarding_sessions WHERE id = ?", [sessionId]);
    }
    await db.end();
  }
});
