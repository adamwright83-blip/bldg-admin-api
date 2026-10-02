import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assessPresidentStage1 } from "./assessment";
import { inspectPresidentEvidence, LAUNCH_OPS_SOURCE } from "./evidence";
import { MemoryPresidentAssessmentStore } from "./store";
const root = resolve(import.meta.dirname, "../..");
const sha = "38b20810be8575ef85fed60ba25e6c229bc10170";
const canonical = execFileSync("git", ["show", `${sha}:${LAUNCH_OPS_SOURCE}`], {
  cwd: root,
  encoding: "utf8",
});
const evidence = (content: string) =>
  inspectPresidentEvidence({
    repositoryRoot: root,
    repositorySha: sha,
    readSource: async () => content,
  });
const assess = async (content: string) =>
  (
    await assessPresidentStage1({
      snapshot: await evidence(content),
      store: new MemoryPresidentAssessmentStore(),
    })
  ).assessment;
function removeSection(content: string, heading: string): string {
  const start = content.indexOf("## " + heading);
  const end = content.indexOf("\n## ", start + 3);
  return content.slice(0, start) + (end === -1 ? "" : content.slice(end));
}
describe("candidate admission follows immutable source contents", () => {
  it("rejects synthetic execution results and lost evidence distinctions at persistence", async () => {
    const a = await assess(canonical);
    const store = new MemoryPresidentAssessmentStore();
    await expect(
      store.saveIfAbsent({ ...a, executionCount: 1 } as never)
    ).rejects.toThrow("zero execution");
    await expect(
      store.saveIfAbsent({ ...a, executionResults: ["fake"] } as never)
    ).rejects.toThrow("Later-stage");
    a.candidates[0].evidence = [];
    await expect(store.saveIfAbsent(a)).rejects.toThrow("provenance");
    expect(await store.count()).toBe(0);
  });
  it("admits five supported gates from the actual canonical blob", async () => {
    expect((await assess(canonical)).candidates).toHaveLength(5);
  });
  it("removing each cited section removes its own candidate", async () => {
    const original = await assess(canonical);
    for (const candidate of original.candidates) {
      const fact = candidate.evidence.find(e => e.kind === "FACT")!;
      const changed = await assess(
        removeSection(canonical, fact.sourceLocation)
      );
      expect(changed.candidates).toHaveLength(original.candidates.length - 1);
      expect(changed.candidates.map(c => c.title)).not.toContain(
        candidate.title
      );
    }
  });
  it("three supported sections yield exactly three candidates and recomputed ranks/reasons", async () => {
    const reduced = removeSection(
      removeSection(canonical, "1. Production MySQL recovery gate"),
      "2. Live Stripe activation"
    );
    const a = await assess(reduced);
    expect(a.candidates).toHaveLength(3);
    expect(a.candidates.map(c => c.rank)).toEqual([1, 2, 3]);
    a.candidates.forEach((c, i) => {
      expect(c.rankReason).toContain(`Rank ${i + 1} of the supported menu.`);
      expect(c.rankReason).not.toMatch(
        /first three|Ranked #|after recoverability|follows recovery/
      );
    });
  });
  it("does not invent projects for an empty or unsupported document", async () => {
    expect(
      (await assess("# No documented launch gaps")).candidates
    ).toHaveLength(0);
  });
  it("removing affirmative gap wording suppresses admission even if section survives", async () => {
    const complete = canonical
      .replace(
        "Scheduled volume backups are not configured.",
        "Scheduled volume backups are configured."
      )
      .replace(
        "No restore drill has been proven.",
        "A restore drill has been proven."
      );
    expect((await assess(complete)).candidates.map(c => c.title)).not.toContain(
      "Prove production database recovery"
    );
  });
  it("completed status suppresses a retained procedural section", async () => {
    const complete = canonical.replace(
      "## 2. Live Stripe activation",
      "## 2. Live Stripe activation\n\nStatus: COMPLETE"
    );
    expect((await assess(complete)).candidates).toHaveLength(4);
  });
  it("material evidence changes alter identity, while identical evidence reuses the menu", async () => {
    const store = new MemoryPresidentAssessmentStore();
    const original = await evidence(canonical);
    const first = await assessPresidentStage1({ snapshot: original, store });
    const retry = await assessPresidentStage1({
      snapshot: await evidence(canonical),
      store,
    });
    expect(retry.reused).toBe(true);
    expect(retry.assessment.id).toBe(first.assessment.id);
    const changed = await evidence(
      removeSection(canonical, "3. Retention activation")
    );
    expect(changed.id).not.toBe(original.id);
    await assessPresidentStage1({ snapshot: changed, store });
    expect(await store.count()).toBe(2);
  });
  it("reads once and interprets the exact content hashed, not another working copy", async () => {
    let reads = 0;
    const reduced = removeSection(
      canonical,
      "1. Production MySQL recovery gate"
    );
    const snapshot = await inspectPresidentEvidence({
      repositoryRoot: root,
      repositorySha: sha,
      readSource: async () => {
        reads++;
        return reads === 1 ? reduced : canonical;
      },
    });
    const result = await assessPresidentStage1({
      snapshot,
      store: new MemoryPresidentAssessmentStore(),
    });
    expect(reads).toBe(1);
    expect(result.assessment.candidates).toHaveLength(4);
    snapshot.sourceContents[LAUNCH_OPS_SOURCE] = canonical;
    await expect(
      assessPresidentStage1({
        snapshot,
        store: new MemoryPresidentAssessmentStore(),
      })
    ).rejects.toThrow("differs from fingerprinted");
  });
});
