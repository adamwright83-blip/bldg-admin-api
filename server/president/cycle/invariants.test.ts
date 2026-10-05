import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  presidentApprovalReceiptSchema,
  presidentCandidateListSchema,
} from "../../../shared/presidentCycle";
import { isPresidentProtectedPath, PresidentEngineeringExecutor } from "../fabric/engineering";
import { PresidentIndependentReviewer } from "../fabric/review";
import { PresidentResearchExecutor, PresidentResearchReviewer } from "../fabric/research";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("President autonomous-cycle invariants", () => {
  it("keeps President and Mitch source imports separated", () => {
    const root = process.cwd();
    const presidentFiles = walk(path.join(root, "server", "president")).filter(file =>
      /\.[cm]?[jt]sx?$/.test(file)
    );
    const mitchFiles = walk(path.join(root, "server", "mitch")).filter(file =>
      /\.[cm]?[jt]sx?$/.test(file)
    );

    for (const file of presidentFiles) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/(?:from|import\()\s*["'][^"']*\/mitch(?:\/|["'])/);
    }
    for (const file of mitchFiles) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/(?:from|import\()\s*["'][^"']*\/president(?:\/|["'])/);
    }
  });

  it("uses distinct non-Mitch executor and reviewer actors", () => {
    const engineering = new PresidentEngineeringExecutor();
    const engineeringReviewer = new PresidentIndependentReviewer();
    const research = new PresidentResearchExecutor();
    const researchReviewer = new PresidentResearchReviewer();

    expect(engineering.actorId).not.toBe(engineeringReviewer.actorId);
    expect(research.actorId).not.toBe(researchReviewer.actorId);
    for (const actor of [
      engineering.actorId,
      engineeringReviewer.actorId,
      research.actorId,
      researchReviewer.actorId,
    ]) {
      expect(actor.toLowerCase()).not.toContain("mitch");
    }
  });

  it("protects Mitch, authority, commercial and reconciliation paths", () => {
    for (const protectedFile of [
      "server/mitch/producer.ts",
      "shared/mitchContracts.ts",
      "server/commercialPipeline/index.ts",
      "server/commercialCampaigns/run.ts",
      "server/authority/receipt.ts",
      "scripts/reconcileCommercialPipelineRevenue.ts",
      ".github/workflows/release.yml",
      "package.json",
      "pnpm-lock.yaml",
    ]) {
      expect(isPresidentProtectedPath(protectedFile)).toBe(true);
    }
    expect(isPresidentProtectedPath("server/president/newFeature.ts")).toBe(false);
  });

  it("requires exactly ten ranked candidates", () => {
    const candidate = (rank: number) => ({
      id: "candidate-" + rank,
      rank,
      title: "Candidate " + rank,
      problem: "Bounded problem",
      evidenceIds: ["evidence-1"],
      proposedChange: "Bounded change",
      expectedOutcome: "Expected outcome",
      risk: "Known risk",
      dependencies: [],
      executionDomain: "ENGINEERING" as const,
      roughScope: "Small",
      whyNow: "Current evidence supports review",
      successCriteria: ["Criterion"],
      responseToCritique: "",
      changedAfterCritique: false,
    });
    expect(
      presidentCandidateListSchema.parse({
        summary: "Ten improvements",
        candidates: Array.from({ length: 10 }, (_, index) => candidate(index + 1)),
      }).candidates
    ).toHaveLength(10);
    expect(() =>
      presidentCandidateListSchema.parse({
        summary: "Nine improvements",
        candidates: Array.from({ length: 9 }, (_, index) => candidate(index + 1)),
      })
    ).toThrow();
  });

  it("requires a durable Adam approval receipt with at most three candidates", () => {
    const base = {
      cycleId: "00000000-0000-4000-8000-000000000001",
      founderId: "adam",
      approvedAt: "2026-10-05T21:00:00.000Z",
      receiptSha256: "a".repeat(64),
    };
    expect(
      presidentApprovalReceiptSchema.parse({
        ...base,
        approvedCandidateIds: ["a", "b", "c"],
      }).approvedCandidateIds
    ).toEqual(["a", "b", "c"]);
    expect(() =>
      presidentApprovalReceiptSchema.parse({
        ...base,
        approvedCandidateIds: ["a", "b", "c", "d"],
      })
    ).toThrow();
  });
});
