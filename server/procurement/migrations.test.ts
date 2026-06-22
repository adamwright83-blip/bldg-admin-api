import { describe, expect, it } from "vitest";
import { loadProcurementMigrations } from "./migrations";

describe("procurement migration files", () => {
  it("loads ordered procurement migrations with verification queries", async () => {
    const migrations = await loadProcurementMigrations();
    expect(migrations.map(migration => migration.key)).toEqual([
      "0000_held_schema_migrations.sql",
      "0001_procurement_workflow_foundation.sql",
      "0002_authority_grants.sql",
      "0003_guest_readiness_plans.sql",
      "0004_provider_acceptance_foundation.sql",
      "0005_marketplace_payments_foundation.sql",
      "0006_vendor_sourcing_foundation.sql",
      "0007_vendor_sourcing_scoring_gate.sql",
      "0008_legal_template_registry.sql",
      "0009_vendor_outreach_drafting_intake.sql",
      "0010_vendor_agreement_onboarding.sql",
      "0011_dispatch_proof_foundation.sql",
      "0012_vendor_reputation_evidence.sql",
      "0013_vendor_match_evaluation_runs.sql",
      "0014_vendor_response_terms.sql",
      "0015_vendor_proposal_versions.sql",
      "0016_resident_proposal_consents.sql",
      "0017_post_consent_action_plans.sql",
    ]);
    for (const migration of migrations) {
      expect(migration.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(migration.statements.length).toBeGreaterThan(0);
      expect(migration.verificationStatements.length).toBeGreaterThan(0);
    }
  });
});
