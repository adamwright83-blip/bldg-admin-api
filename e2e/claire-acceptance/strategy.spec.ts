/* LEGACY DAYFORGE COMPATIBILITY: disposable historical SQL names only; current product is JOYSTICK. */
import { test, expect } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  cleanupOwner,
  database,
  login,
  provisionOwner,
  rpc,
} from "../real/helpers";
import { setActiveMacroGoal } from "../../server/claire/macroGoalService";
import { resolveCanonicalOperatorIdentity } from "../../server/agents/persistentOperator/identity";
import { activateMacroGoalAndQueue } from "../../server/agents/persistentOperator/goalCycleService";
import { defaultVerticalRegistry } from "../../server/strategy/verticalTemplates/defaultRegistry";
import { persistStrategicProposal } from "../../server/strategy/strategicStore";
import type { StrategicPlanningProposal } from "../../shared/strategicIntelligence";

test("real authenticated Claire Desk decisions, consent reload, stale browser fences, and actual Day Line", async ({
  browser,
}, testInfo) => {
  const owner = await provisionOwner("Claire acceptance business");
  const foreign = await provisionOwner("Foreign acceptance business");
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4187",
  });
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:4187" });
  const db = await database();
  const evidence: unknown[] = [];
  try {
    await db.execute(
      "INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,'persistent_operator','manual',true)",
      [owner.tenantId]
    );
    await db.execute(
      "UPDATE dayforge_saas_tenants SET strategyVerticalKey='laundry_fluff_fold' WHERE id=?",
      [owner.tenantId]
    );
    await setActiveMacroGoal({
      tenantId: owner.tenantId,
      operatorUserId: owner.openId,
      objective: "Validate growth economics using a bounded investigation",
      metricKey: "paid_orders_per_period",
      targetValue: 100,
      unit: "orders",
      source: "operator_attested",
      sourceNote: "Synthetic browser acceptance fixture",
    });
    const resolved = await resolveCanonicalOperatorIdentity({
      tenantId: owner.tenantId,
      source: { type: "open_id", value: owner.openId },
      subsystem: "acceptance.fixture",
    });
    if (!resolved.ok) throw new Error("Fixture owner unavailable");
    await activateMacroGoalAndQueue({
      tenantId: owner.tenantId,
      identity: resolved.identity,
      verticalKey: "laundry_fluff_fold",
      policyVersion: "v1",
      registry: defaultVerticalRegistry,
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await login(page, owner);
    await page.goto("/claire",{waitUntil:"domcontentloaded"});
    const panel = page.getByTestId("claire-strategic-proposal");
    await expect(panel).toBeVisible();
    await panel
      .getByRole("button", {
        name: "Refresh evidence and recommendation",
        exact: true,
      })
      .click();
    await expect(panel).toContainText(
      "Pending items require operator approval"
    );
    const actual = await rpc(
      context.request,
      "system.weeklyMission.preparedProposal"
    );
    const base = actual.proposal as StrategicPlanningProposal;
    expect(base.tenantId).toBe(owner.tenantId);
    expect(base.items.length).toBeGreaterThan(0);
    await panel
      .getByText("Why, evidence, and uncertainty", { exact: true })
      .click();
    await expect(panel).toContainText("Financial impact is unproven");
    await expect(panel).toContainText(base.diagnosis.evidence[0]!.description);
    await mkdir("artifacts/claire-strategy/acceptance/browser", {
      recursive: true,
    });
    await page.screenshot({
      path: "artifacts/claire-strategy/acceptance/browser/prepared-evidence.png",
      fullPage: true,
    });
    evidence.push({
      boundary: "actual preparation",
      proposalId: base.id,
      diagnosisId: base.diagnosis.id,
      itemCount: base.items.length,
      quality: base.diagnosis.quality,
    });
    async function fixture(label: string, expired = false) {
      const revision = createHash("sha256")
        .update(base.revision + label + randomUUID())
        .digest("hex");
      // Explicitly labelled UI-control fixtures derive from actual preparation; no API response is mocked.
      console.log("Browser fixture:",label);
      const p = await persistStrategicProposal({
        ...base,
        id: `proposal_${revision.slice(0, 40)}`,
        revision,
        expiresAt: new Date(
          Date.now() + (expired ? -1000 : 3600000)
        ).toISOString(),
        items: [1, 2].map(n => ({
          ...base.items[0]!,
          id: `browser-${n}-${revision.slice(0, 12)}`,
          title: `Browser fixture ${label} item ${n}`,
          objective: `Bounded test fixture ${n}`,
        })),
      });
      await page.reload({waitUntil:"domcontentloaded"});
      await expect(panel).toContainText(p.items[0]!.title);
      return p;
    }
    const selected = await fixture("selected");
    await panel.getByRole("checkbox").nth(1).check();
    await panel
      .getByRole("button", { name: "Approve selected", exact: true })
      .click();
    await expect(panel).toContainText("1 approved item(s) added and verified");
    let state = await rpc(
      context.request,
      "system.weeklyMission.preparedProposal"
    );
    expect(state.approvedItemIds).toEqual([selected.items[1]!.id]);
    const [saved]: any = await db.execute(
      "SELECT * FROM day_director_commitments WHERE tenantId=? AND title=?",
      [owner.tenantId, selected.items[1]!.title]
    );
    expect(saved).toHaveLength(1);
    expect(saved[0].actorId).toBe(String(owner.userId));
    await rpc(context.request,"system.goldlineOnboarding.fieldOutcome",{missionId:owner.missionId,text:"Synthetic acceptance field observation; no sale or revenue verified.",confirmedPresence:true,gps:null},true);
    console.log("Browser boundary: actual Day Line");
    // Open the item's business date; the runner's clock may already be on the next UTC day.
    await page.goto(`/play?date=${saved[0].businessDate}`,{waitUntil:"domcontentloaded"});
    await expect(page.getByText("DAY LINE DETAILS", { exact: true })).toBeVisible();
    await page.getByText("DAY LINE DETAILS", { exact: true }).click();
    await expect(page.getByTestId("current-day-line")).toContainText(
      selected.items[1]!.title
    );
    const line = await rpc(context.request, "system.currentDayLine.today");
    expect(JSON.stringify(line)).toContain(saved[0].id);
    await page.screenshot({
      path: "artifacts/claire-strategy/acceptance/browser/day-line.png",
      fullPage: true,
    });
    evidence.push({
      boundary: "selected approval -> actual Day Line",
      proposalId: selected.id,
      canonicalId: saved[0].id,
      approvedItemIds: state.approvedItemIds,
    });
    await page.goto("/claire",{waitUntil:"domcontentloaded"});
    const full = await fixture("full");
    await panel
      .getByRole("button", { name: "Approve plan", exact: true })
      .click();
    await expect(panel).toContainText("Accepted and verified in the Day Line");
    expect(
      (
        await rpc(context.request, "system.weeklyMission.preparedProposal")
      ).approvedItemIds.sort()
    ).toEqual(full.items.map(i => i.id).sort());
    evidence.push({ boundary: "full approval", proposalId: full.id });
    const edit = await fixture("edit");
    await panel
      .getByRole("textbox", { name: "Revise this item" })
      .nth(1)
      .fill("Edited browser fixture");
    await panel
      .getByRole("button", { name: "Save revision", exact: true })
      .nth(1)
      .click();
    await expect(panel).toContainText("Edited browser fixture");
    state = await rpc(context.request, "system.weeklyMission.preparedProposal");
    expect(state.proposal.id).not.toBe(edit.id);
    expect(state.proposal.items[0]).toEqual(edit.items[0]);
    expect(state.approvedItemIds).toEqual([]);
    evidence.push({
      boundary: "single item revision",
      originalId: edit.id,
      revisedId: state.proposal.id,
    });
    for (const action of ["Reject", "Defer"]) {
      const p = await fixture(action);
      await panel.getByRole("button", { name: action, exact: true }).click();
      await expect(
        panel.getByRole("button", { name: "Approve plan", exact: true })
      ).toBeDisabled();
      state = await rpc(
        context.request,
        "system.weeklyMission.preparedProposal"
      );
      expect(state.responses.map((r: any) => r.action)).toEqual([
        action.toLowerCase(),
      ]);
      expect(state.approvedItemIds).toEqual([]);
      evidence.push({ boundary: action, proposalId: p.id });
    }
    const expired = await fixture("expired", true);
    await expect(panel).toContainText(
      "Evidence needs refreshing before approval"
    );
    await expect(
      panel.getByRole("button", { name: "Approve plan", exact: true })
    ).toBeDisabled();
    await expect(
      rpc(
        context.request,
        "system.weeklyMission.respondToPreparedProposal",
        {
          proposalId: expired.id,
          revision: expired.revision,
          action: "approve",
          itemIds: [expired.items[0]!.id],
        },
        true
      )
    ).rejects.toThrow("stale");
    await panel
      .getByRole("button", {
        name: "Refresh evidence and recommendation",
        exact: true,
      })
      .click();
    await expect(panel).toContainText(
      "Pending items require operator approval"
    );
    evidence.push({
      boundary: "expired client/server and refresh",
      expiredId: expired.id,
      newId: (
        await rpc(context.request, "system.weeklyMission.preparedProposal")
      ).proposal.id,
    });
    const stale = await fixture("stale");
    await panel.getByRole("checkbox").nth(1).check();
    const staleState = await context.storageState();
    const tabContext = await browser.newContext({
      baseURL: "http://127.0.0.1:4187",
      storageState: staleState,
    });
    const second = await tabContext.newPage();
    await second.goto("/claire");
    await expect(second.getByTestId("claire-strategic-proposal")).toContainText(
      stale.items[0]!.title
    );
    const nextRevision = createHash("sha256")
      .update("supersede" + randomUUID())
      .digest("hex");
    await persistStrategicProposal({
      ...stale,
      id: `proposal_${nextRevision.slice(0, 40)}`,
      revision: nextRevision,
      items: stale.items.map(i => ({
        ...i,
        title: i.title + " superseded replacement",
      })),
    });
    // Page remains visibly on its old proposal. Its real mutation must fail on the server.
    await panel
      .getByRole("button", { name: "Approve selected", exact: true })
      .click();
    await expect(panel).toContainText("superseded");
    const [staleRows]: any = await db.execute(
      "SELECT * FROM day_director_commitments WHERE tenantId=? AND title=?",
      [owner.tenantId, stale.items[1]!.title]
    );
    expect(staleRows).toHaveLength(0);
    evidence.push({
      boundary: "stale browser mutation denied",
      oldId: stale.id,
      newId: `proposal_${nextRevision.slice(0, 40)}`,
      canonicalWrites: 0,
    });
    await tabContext.close();
    await page.reload({waitUntil:"domcontentloaded"});
    await page
      .getByText("Optional weekday strategy calls", { exact: true })
      .click();
    const consent = page
      .locator("details")
      .filter({
        has: page.getByText("Optional weekday strategy calls", { exact: true }),
      });
    await expect(consent).toContainText("No weekday call permission is active");
    await consent
      .getByRole("checkbox", { name: "Tuesday", exact: true })
      .check();
    await consent.getByLabel("Local start").fill("10:00");
    await consent.getByLabel("Local end").fill("11:00");
    await consent
      .getByRole("button", { name: "Allow calls in this window", exact: true })
      .click();
    await expect(consent).toContainText("saved and verified");
    await page.reload({waitUntil:"domcontentloaded"});
    await page
      .getByText("Optional weekday strategy calls", { exact: true })
      .click();
    await expect(page.getByTestId("saved-strategic-consent")).toContainText(
      "Tuesday, 10:00–11:00"
    );
    await page.screenshot({
      path: "artifacts/claire-strategy/acceptance/browser/saved-consent.png",
      fullPage: true,
    });
    await consent
      .getByRole("button", { name: "Revoke weekday calls", exact: true })
      .click();
    await expect(consent).toContainText("No weekday call permission is active");
    expect(
      (await rpc(context.request, "system.weeklyMission.strategicCallConsent"))
        .authorization
    ).toBeNull();
    evidence.push({
      boundary: "saved consent after reload and revoke",
      days: [2],
      start: "10:00",
      end: "11:00",
      zone: "America/Los_Angeles",
      revoked: true,
    });
    const foreignPage = await other.newPage();
    await login(foreignPage, foreign);
    await expect(
      rpc(
        other.request,
        "system.weeklyMission.respondToPreparedProposal",
        {
          proposalId: full.id,
          revision: full.revision,
          action: "approve",
          itemIds: [full.items[0]!.id],
        },
        true
      )
    ).rejects.toThrow("Exact proposal revision");
    evidence.push({
      boundary:
        "foreign authenticated owner cannot approve another tenant proposal",
      denied: true,
    });
    expect(pageErrors).toEqual([]);
    await writeFile(
      "artifacts/claire-strategy/acceptance/browser-evidence.json",
      JSON.stringify(
        {
          testOnly: true,
          authentication:
            "real password endpoint + HTTP-only cookie + persisted membership; no API mocks",
          providerCalls: 0,
          evidence,
        },
        null,
        2
      )
    );
  } finally {
    await db.end();
    await context.close();
    await other.close();
    await cleanupOwner(owner);
    await cleanupOwner(foreign);
  }
});
