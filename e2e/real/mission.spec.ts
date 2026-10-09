/* LEGACY DAYFORGE COMPATIBILITY: retained historical database, route and environment literals only; canonical product is JOYSTICK. */
import { test, expect } from "@playwright/test";
import mysql from "mysql2/promise";
import { knownTerritoryIds } from "../../shared/goldlineLocalWorld";
import { cleanupOwner, database, login, provisionOwner, rpc } from "./helpers";

const observation = "Visited Pasadena commercial corridor. Observed worn carpet at a public office entrance; next useful action is an owner-approved quote follow-up.";

test("REAL acceptance 4/5: field evidence persists, replays once, and survives an independent second login", async ({ browser }, testInfo) => {
  const owner = await provisionOwner("Acceptance Carpet Care");
  const context = await browser.newContext();
  let second: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await login(page, owner);
    const before = await rpc(context.request, "system.goldlineOnboarding.state");
    expect(before.session.tenantId).toBe(owner.tenantId);
    expect(before.session.mission.id).toBe(owner.missionId);
    expect(before.session.mission.outcome).toBeNull();
    expect(knownTerritoryIds(before.session.world.topology, [])).toEqual([]);
    await page.goto("/play?mission=first");
    await expect(page.getByTestId("first-mission-driver")).toBeVisible();
    await page.getByRole("button", {name:"YOUR FIELD OBJECTIVE",exact:true}).click();
    await expect(page.locator(".gl-field-sheet")).toBeVisible();
    await page.locator("#field-outcome").fill(observation);
    await page.locator('.gl-presence input[type="checkbox"]').check();
    const mutation = page.waitForResponse(r => r.url().includes("system.goldlineOnboarding.fieldOutcome"));
    await page.getByRole("button", {name:"RECORD FIELD OUTCOME",exact:true}).click();
    expect((await mutation).ok()).toBe(true);
    await expect(page.locator(".gl-first-payoff")).toContainText(observation);
    const db = await database();
    try {
      const [sessions] = await db.execute<mysql.RowDataPacket[]>(`SELECT payload FROM goldline_onboarding_sessions WHERE tenantId=?`, [owner.tenantId]);
      const saved = typeof sessions[0].payload === "string" ? JSON.parse(sessions[0].payload) : sessions[0].payload;
      expect(saved.mission.status).toBe("completed");
      expect(knownTerritoryIds(saved.world.topology, [saved.mission.checkpoint.id])).toContain(saved.mission.territoryId);
      expect(saved.mission.gameplayCompletedAt).toBeNull();
      expect(saved.mission.outcome).toMatchObject({text:observation,actorId:owner.openId,provenance:"operator_reported"});
      const [events] = await db.execute<mysql.RowDataPacket[]>(`SELECT * FROM goldline_world_events WHERE tenantId=? AND sourceId=?`, [owner.tenantId,owner.missionId]);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({eventType:"territory_scout_observed",classification:"evidence",verificationClass:"ATTESTED",provenanceClass:"operator_reported"});
      const metadata = typeof events[0].metadataJson === "string" ? JSON.parse(events[0].metadataJson) : events[0].metadataJson;
      expect(metadata.claims).toEqual({sale:false,conversation:false,handoff:false});
      await rpc(context.request,"system.goldlineOnboarding.fieldOutcome",{missionId:owner.missionId,text:observation,confirmedPresence:true,gps:null},true);
      const [replay] = await db.execute<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS count FROM goldline_world_events WHERE tenantId=? AND sourceId=? AND eventType='territory_scout_observed'`,[owner.tenantId,owner.missionId]);
      expect(Number(replay[0].count)).toBe(1);
    } finally { await db.end(); }
    await page.reload();
    await expect(page.locator(".gl-first-payoff")).toContainText(observation);
    const line = await rpc(context.request,"system.currentDayLine.today");
    // The completed field work must be represented by the server-produced Day Line.
    expect(JSON.stringify(line)).toContain(owner.missionId);
    expect(JSON.stringify(line)).toContain("completed");
    expect(pageErrors).toEqual([]);
    await page.screenshot({path:testInfo.outputPath("mission-completed.png"),fullPage:true});
    await expect(page.getByRole("link",{name:"RETURN TO LANTERN CITY →"})).toHaveAttribute("href","/growth/lantern-city");
    await page.goto("/play");
    await expect(page.getByTestId("day-line-first-mission-evidence")).toContainText(observation);
    await page.getByRole("button", {name:"OPEN FIELD JOURNAL",exact:true}).click();
    await expect(page.getByTestId("journal-transcript")).toBeVisible();
    await page.getByRole("button", {name:"Close journal",exact:true}).click();
    await context.close();
    second = await browser.newContext();
    expect(await second.cookies()).toEqual([]);
    const returning = await second.newPage();
    await returning.goto("/play");
    expect(await rpc(second.request,"auth.me")).toBeNull();
    await login(returning,owner);
    const me = await rpc(second.request,"auth.me");
    expect(me.openId).toBe(owner.openId);
    const restored = await rpc(second.request,"system.goldlineOnboarding.state");
    expect(restored.session.tenantId).toBe(owner.tenantId);
    expect(restored.session.answers).toEqual(owner.session.answers);
    expect(restored.session.world).toEqual(owner.session.world);
    expect(restored.session.mission.outcome.text).toBe(observation);
    const secondLine = await rpc(second.request,"system.currentDayLine.today");
    expect(JSON.stringify(secondLine)).toContain(owner.missionId);
    const claire = await rpc(second.request,"system.claire.driveContext",{phase:"pre_drive",timeZone:"America/Los_Angeles"});
    expect(claire.identityTruth.tenant.tenantId).toBe(owner.tenantId);
    expect(claire.identityTruth.tenant.businesses[0].registeredName).toBe("Acceptance Carpet Care");
    await returning.goto("/play?mission=first");
    await expect(returning.locator(".gl-first-payoff")).toContainText(observation);
    await returning.screenshot({path:testInfo.outputPath("second-login.png"),fullPage:true});
    await testInfo.attach("procedures",{body:JSON.stringify({tenantId:owner.tenantId,missionId:owner.missionId,procedures:["POST /api/dayforge/auth/login","auth.me","system.goldlineOnboarding.state","system.goldlineOnboarding.fieldOutcome","system.currentDayLine.today","system.claire.driveContext"],persistence:"MySQL session outcome; one ATTESTED operator_reported territory_scout_observed event after replay"},null,2),contentType:"application/json"});
  } finally {
    await context.close();
    await second?.close();
    await cleanupOwner(owner);
  }
});
