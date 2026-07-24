import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../drizzle/0045_dayforge_30_day_foundation.sql", import.meta.url),
  "utf8"
);
const schema = readFileSync(
  new URL("../../drizzle/schema.ts", import.meta.url),
  "utf8"
);

describe("DayForge V3 foundation migration", () => {
  it("extends contact truth without creating a competing contact database", () => {
    expect(migration).toContain("ALTER TABLE `commercial_account_contacts`");
    for (const column of [
      "relationshipType",
      "preferredChannel",
      "source",
      "notes",
    ]) {
      expect(migration).toContain(`\`${column}\``);
    }
    expect(migration).not.toContain("CREATE TABLE `dayforge_contacts`");
  });

  it("keeps commercial mission steps as the IRL root", () => {
    expect(migration).toContain(
      "CREATE TABLE `commercial_mission_irl_step_details`"
    );
    expect(migration).toContain("`missionStepId` int NOT NULL");
    expect(migration).not.toContain("CREATE TABLE `driver_missions`");
    expect(migration).not.toContain("CREATE TABLE `irl_missions`");
    for (const column of [
      "status",
      "revealPolicy",
      "startedAt",
      "deadlineAt",
      "proofRequirement",
      "referenceImageUrl",
      "instructionVideoUrl",
      "pinnedCoachingArtifactId",
      "verificationState",
      "proofAssetId",
      "reviewedBy",
      "reviewedAt",
      "rejectionReason",
      "fulfillmentMode",
      "metadataJson",
    ]) {
      expect(migration).toContain(`\`${column}\``);
    }
  });

  it("adds durable dispatch, evidence, coaching, acquisition, and payment truth", () => {
    for (const table of [
      "commercial_mission_dispatches",
      "dayforge_evidence_uploads",
      "dayforge_evidence_object_deletions",
      "commercial_mission_coaching_artifacts",
      "commercial_campaign_links",
      "commercial_customer_acquisition_sources",
      "commercial_order_acquisition_attributions",
      "commercial_attribution_corrections",
      "order_payment_projections",
      "order_payment_events",
      "dayforge_auth_continuations",
    ]) {
      expect(migration).toContain(`CREATE TABLE \`${table}\``);
      expect(schema).toContain(`\"${table}\"`);
    }
  });

  it("stores hashes and private storage keys rather than bearer tokens or base64 proof", () => {
    expect(migration).toContain("`tokenHash` varchar(64) NOT NULL");
    expect(migration).toContain("`storageKey` varchar(1024) NOT NULL");
    expect(migration).toContain("`storageKeyHash` varchar(64) NOT NULL");
    expect(migration).toContain("`storageKey` varchar(1024) NULL");
    expect(migration).not.toContain("`rawToken`");
    expect(migration).not.toContain("`base64`");
  });

  it("allows honest unknown location and estimated-value inputs", () => {
    expect(migration).toContain("MODIFY COLUMN `latitude` decimal(10,7) NULL");
    expect(migration).toContain(
      "MODIFY COLUMN `estimatedAnnualValueCents` int NULL"
    );
    expect(migration).toContain(
      "MODIFY COLUMN `estimatedContractValueCents` int NULL"
    );
  });

  it("keeps preview continuation IDs compatible with canonical preview sessions", () => {
    expect(migration).toContain("`previewSessionId` varchar(64) NULL");
    expect(schema).toContain(
      'previewSessionId: varchar("previewSessionId", { length: 64 })'
    );
  });
});
