import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync(new URL("./driverSalesMotivationService.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("./commercialMissionRouter.ts", import.meta.url), "utf8");
const builder = readFileSync(new URL("./commercialMissionBuilderService.ts", import.meta.url), "utf8");
const call = readFileSync(new URL("./commercialMissionCallService.ts", import.meta.url), "utf8");
const field = readFileSync(new URL("./commercialMissionFieldService.ts", import.meta.url), "utf8");
const command = readFileSync(new URL("../../client/src/components/driver/CommandCenter.tsx", import.meta.url), "utf8");
const momentum = readFileSync(new URL("../../client/src/components/driver/SalesMomentum.tsx", import.meta.url), "utf8");
const missionPage = readFileSync(new URL("../../client/src/pages/CommercialSalesMission.tsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../../client/src/pages/CommercialMissionAdmin.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../drizzle/0047_driver_sales_motivation.sql", import.meta.url), "utf8");
const livingWorldMigration = readFileSync(new URL("../../drizzle/0061_goldline_living_business_world.sql", import.meta.url), "utf8");
const processing = readFileSync(new URL("../goldlineWorld/fieldJournalProcessingService.ts", import.meta.url), "utf8");

describe("driver sales motivation contract", () => {
  it("persists an idempotent rolling 30-day score and prevents repeated calls from farming full credit", () => {
    expect(migration).toContain("uq_driver_sales_score_tenant_dedupe");
    expect(service).toContain("SALES_SCORE_WINDOW_DAYS = 30");
    expect(service).toContain("SALES_SCORE_MAX = 600");
    expect(call).toContain("attempts.length <= 1 ? 4 : attempts.length === 2 ? 2 : 1");
    expect(field).toContain('input.outcome === "won" ? 100');
    expect(field).toContain('input.decisionMakerStatus === "met" ? 10');
    expect(processing).toContain('eventType: "objection_comeback"');
    expect(processing).toContain("points: 15");
  });

  it("captures verbal journals, extracts structured memory, and exposes them to tenant admins", () => {
    expect(momentum).toContain("MediaRecorder");
    expect(momentum).toContain("Capture what happened");
    expect(processing).toContain("transcribeAudio");
    expect(processing).toContain("extractFieldJournal");
    expect(livingWorldMigration).toContain("DROP INDEX `uq_driver_sales_journal_tenant_driver_date`");
    expect(service).toContain('processingStatus: "captured"');
    expect(router).toContain("saveSalesJournal");
    expect(router).toContain("salesJournalsAdmin: dayforgeTenantAdminProcedure");
    expect(admin).toContain("Driver journals");
    expect(admin).toContain("<audio controls");
    expect(router).toContain("salesMomentumAdmin");
    expect(admin).toContain("30-day Sucker → Hustler progress");
  });

  it("loads one provenance-bearing coaching diamond into each built mission", () => {
    expect(builder).toContain("selectMissionDiamond");
    expect(builder).toContain('source: "driver_sales_diamond"');
    expect(service).toContain('provenance: "personal_journal"');
    expect(service).toContain('provenance: "curated_source"');
    expect(service).toContain('provenance: "foundation"');
    expect(missionPage).toContain("Your diamond");
    expect(command).toContain("Diamond loaded");
  });

  it("renders the five-stop Sucker-to-Hustler meter and keeps creator playbooks extensible", () => {
    expect(momentum).toContain("Sucker");
    expect(momentum).toContain("Hustler");
    expect(momentum).toContain("[0, 25, 50, 75, 100]");
    expect(migration).toContain("driver_sales_playbook_sources");
    expect(migration).toContain("'instagram'");
  });
});
