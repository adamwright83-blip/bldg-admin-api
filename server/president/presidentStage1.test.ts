import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assessPresidentStage1 } from "./assessment";
import { inspectPresidentEvidence } from "./evidence";
import {
  FilePresidentAssessmentStore,
  MemoryPresidentAssessmentStore,
} from "./store";

const root = resolve(import.meta.dirname, "../..");
const sha = "38b20810be8575ef85fed60ba25e6c229bc10170";
const cleanup: string[] = [];

afterEach(async () =>
  Promise.all(
    cleanup.splice(0).map(path => rm(path, { recursive: true, force: true }))
  )
);

const snapshot = () =>
  inspectPresidentEvidence({
    repositoryRoot: root,
    repositorySha: sha,
  });

describe("seat.president Stage 1", () => {
  it("retains exact SHA, fingerprint, supported candidates, provenance, and unavailable sources", async () => {
    const evidence = await snapshot();
    const { assessment } = await assessPresidentStage1({
      snapshot: evidence,
      store: new MemoryPresidentAssessmentStore(),
      now: () => new Date("2026-10-02T12:00:00Z"),
    });
    expect(assessment.inspectedRepositorySha).toBe(sha);
    expect(assessment.evidenceSnapshotId).toBe(evidence.id);
    expect(assessment.candidates).toHaveLength(2);
    expect(assessment.candidates.map(x => x.rank)).toEqual([1, 2]);
    expect(assessment.candidates.every(x => x.evidence.length >= 2)).toBe(true);
    expect(
      new Set(assessment.candidates.flatMap(x => x.evidence.map(e => e.kind)))
    ).toEqual(new Set(["FACT", "INFERENCE"]));
    expect(assessment.evidenceSourcesUnavailable).toEqual(
      expect.arrayContaining([
        "posthog_live_product_data",
        "production_runtime",
        "railway_production",
        "stripe_live",
      ])
    );
  });

  it("stops at human selection with no execution or later-stage state", async () => {
    const { assessment } = await assessPresidentStage1({
      snapshot: await snapshot(),
      store: new MemoryPresidentAssessmentStore(),
    });
    expect(assessment.resultState).toBe("WAITING_FOR_HUMAN_SELECTION");
    expect(assessment.executionCount).toBe(0);
    expect(
      assessment.candidates.every(
        x => x.status === "PROPOSED_AWAITING_HUMAN_SELECTION"
      )
    ).toBe(true);
    for (const key of [
      "workOrders",
      "preflight",
      "reviews",
      "internalCandidates",
      "dispatches",
    ])
      expect(assessment).not.toHaveProperty(key);
  });

  it("reuses identical SHA and evidence durably across retries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "president-stage1-"));
    cleanup.push(dir);
    const store = new FilePresidentAssessmentStore(join(dir, "store.json"));
    const evidence = await snapshot();
    const first = await assessPresidentStage1({ snapshot: evidence, store });
    const retry = await assessPresidentStage1({ snapshot: evidence, store });
    expect(first.reused).toBe(false);
    expect(retry.reused).toBe(true);
    expect(retry.assessment.id).toBe(first.assessment.id);
    expect(await store.count()).toBe(1);
  });

  it("does not derive a backlog from open, stale, or red unmerged PRs", async () => {
    const { assessment } = await assessPresidentStage1({
      snapshot: await snapshot(),
      store: new MemoryPresidentAssessmentStore(),
    });
    expect(assessment.evidenceSourcesAvailable).not.toContain(
      "github_pull_request_metadata"
    );
    expect(JSON.stringify(assessment.candidates)).not.toMatch(
      /#354|#355|#358|stale PR|branch CI/i
    );
  });

  it("has no customer, Claire, Day Line, growth, Goldline, Kingdom, or Mitch mutation dependency", async () => {
    const sources = await Promise.all(
      ["assessment.ts", "evidence.ts", "store.ts"].map(x =>
        readFile(resolve(root, "server/president", x), "utf8")
      )
    );
    const code = sources.join("\n");
    for (const forbidden of [
      "goldlineKingdoms",
      "growthCandidates",
      "claire_conversation",
      "plan.day_line",
      "mitchStore",
      "tenantId",
      "dispatchWork",
      "executionRuns",
    ])
      expect(code, forbidden).not.toContain(forbidden);
  });

  it("never marks UNKNOWN evidence as verified if one is later retained", async () => {
    const { assessment } = await assessPresidentStage1({
      snapshot: await snapshot(),
      store: new MemoryPresidentAssessmentStore(),
    });
    for (const e of assessment.candidates.flatMap(x => x.evidence))
      if (e.kind === "UNKNOWN") expect(e.verified).toBe(false);
  });

  it("adds only Stage-1 persistence tables", async () => {
    const sql = await readFile(
      resolve(root, "drizzle/0109_president_stage1.sql"),
      "utf8"
    );
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(2);
    expect(sql).not.toMatch(
      /president_(?:preflight|work_orders|executions|reviews|revisions|internal_candidates|releases)/
    );
  });
});
