import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import superjson from "superjson";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { compileLocalWorld } from "../../shared/goldlineLocalWorld";
import type { GoldlineOnboardingSession } from "../../shared/goldlineOnboarding";

export async function database() {
  const url = new URL(process.env.DATABASE_URL ?? "mysql://invalid/invalid");
  if (url.pathname !== "/joystick_real_acceptance" || !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Real acceptance fixtures require disposable localhost joystick_real_acceptance database");
  }
  return mysql.createConnection(url.toString());
}
export class RpcError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
export async function rpc(request: APIRequestContext, procedure: string, input?: unknown, mutation = false): Promise<any> {
  const serialized = superjson.serialize(input);
  const path = `/api/trpc/${procedure}`;
  const response = mutation
    ? await request.post(path, { data: serialized })
    : await request.get(path, { params: { input: JSON.stringify(serialized) } });
  const body = await response.json();
  if (body.error) {
    const error = body.error.json ?? body.error;
    throw new RpcError(error.data?.code ?? "UNKNOWN", response.status(), error.message);
  }
  expect(response.ok(), `${procedure}: ${JSON.stringify(body)}`).toBeTruthy();
  return superjson.deserialize(body.result.data);
}
export type TestOwner = { tenantId: string; email: string; password: string; openId: string; userId: number; missionId: string; session: GoldlineOnboardingSession };
export async function provisionOwner(label: string): Promise<TestOwner> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const tenantId = `real-${suffix}`;
  const email = `${tenantId}@example.invalid`;
  const password = `Acceptance-${suffix}-Only!`;
  const openId = `dayforge:${tenantId}`;
  const db = await database();
  try {
    await db.execute(`INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status) VALUES (?,?,?,?,?,?,?,'America/Los_Angeles','active')`, [tenantId,tenantId,label,label,"#111111",label,email]);
    const [user] = await db.execute<mysql.ResultSetHeader>(`INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','dayforge_password')`, [tenantId,openId,label,email]);
    await db.execute(`INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)`, [tenantId,openId]);
    await db.execute(`INSERT INTO dayforge_saas_user_credentials (tenantId,userOpenId,emailNormalized,passwordHash) VALUES (?,?,?,?)`, [tenantId,openId,email,await bcrypt.hash(password,12)]);
    for (const entitlement of ["dayforge_core","dayforge_field","boreslay","commercial_pipeline","churn_radar"]) await db.execute(`INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,?,'manual',true)`, [tenantId,entitlement]);
    const now = new Date().toISOString();
    const id = randomUUID();
    // Persisted setup fixtures bypass external geocoding/AI, never authentication or mission mutation.
    const checkpoint = { id:`area-${id}`,label:`${label} Pasadena commercial corridor`,latitude:34.145,longitude:-118.125,provenance:"geocoded_declaration" as const,evidenceId:null };
    const topology = compileLocalWorld({tenantId,label:checkpoint.label,anchors:[checkpoint],extentKm:2});
    const missionId = `first-${id}`;
    const session: GoldlineOnboardingSession = {id,tenantId,status:"COMPLETE",currentQuestion:5,answers:[`${label} commercial carpet care`,"Pasadena","Customer referrals","Following up on quotes","Find a concrete carpet care opportunity"],interpretation:null,optionalUploadReference:null,startedAt:now,completedAt:now,version:1,world:{mode:"LOCAL_PHYSICAL",skinId:"WATER_LAND",topologyId:topology.id,topologyRevision:topology.revision,compositionRevision:1,topology},mission:{id:missionId,archetype:"TERRITORY_SCOUT",title:`Scout ${checkpoint.label}`,objective:`Visit ${checkpoint.label} and record one concrete opportunity.`,avoidance:"Following up on quotes",guardianId:"thunder_king",territoryId:topology.territories[0].id,checkpoint,status:"active",outcome:null,traversalCompletedAt:null,gameplayCompletedAt:null}};
    await db.execute(`INSERT INTO goldline_onboarding_sessions (tenantId,id,version,payload) VALUES (?,?,?,?)`, [tenantId,id,session.version,JSON.stringify(session)]);
    return {tenantId,email,password,openId,userId:user.insertId,missionId,session};
  } finally { await db.end(); }
}
export async function cleanupOwner(owner: TestOwner) {
  const db = await database();
  try {
    const [tables] = await db.query<mysql.RowDataPacket[]>(`SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME IN ('tenantId','tenant_id')`);
    for (const row of tables) {
      if (!/^[a-zA-Z0-9_]+$/.test(row.TABLE_NAME)) throw new Error("Unsafe table name");
      await db.execute(`DELETE FROM \`${row.TABLE_NAME}\` WHERE \`${row.COLUMN_NAME}\`=?`, [owner.tenantId]);
    }
  } finally { await db.end(); }
}
export async function login(page: Page, owner: TestOwner) {
  await page.goto("/driver");
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await page.locator('input[type="email"]').fill(owner.email);
  await page.locator('input[type="password"]').fill(owner.password);
  const response = page.waitForResponse(r => r.url().endsWith("/api/dayforge/auth/login") && r.request().method() === "POST");
  await page.getByRole("button", {name:"Sign in",exact:true}).click();
  const result = await response;
  expect(result.status()).toBe(200);
  const me = await rpc(page.context().request, "auth.me");
  expect(me.openId).toBe(owner.openId);
  expect((await page.context().cookies()).some(cookie=>cookie.httpOnly)).toBe(true);
}
