import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessPresidentStage1,
  extractGateStates,
} from "./assessment";
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

function markGate(content: string, heading: string, status: "UNMET" | "COMPLETE") {
  return content.replace(
    `## ${heading}`,
    `## ${heading}\n\nStatus: ${status}`
  );
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

  it("classifies the canonical gates without turning requirements into unmet state", () => {
    const states = extractGateStates(canonical);
    expect(states.get("recovery")?.state).toBe("UNMET");
    expect(states.get("retention")?.state).toBe("UNMET");
    expect(states.get("billing")?.state).toBe("UNKNOWN");
    expect(states.get("isolation")?.state).toBe("UNKNOWN");
    expect(states.get("logs")?.state).toBe("UNKNOWN");
  });

  it("admits exactly the two affirmatively unmet gates from the canonical blob", async () => {
    const a = await assess(canonical);
    expect(a.candidates.map(c => c.title)).toEqual([
      "Prove production database recovery",
      "Activate and verify retention safely",
    ]);
    expect(a.candidates.map(c => c.rank)).toEqual([1, 2]);
    expect(a.candidates.every(c => c.currentGap.includes("states that"))).toBe(
      true
    );
  });

  it("procedure text and the Launch definition checklist do not admit UNKNOWN gates", async () => {
    const a = await assess(canonical);
    const titles = a.candidates.map(c => c.title);
    expect(titles).not.toContain("Prove live billing with a controlled canary");
    expect(titles).not.toContain("Run the two-customer isolation launch canary");
    expect(titles).not.toContain("Establish production log clearance");
    expect(a.evidenceSourcesUnavailable).toContain("production_runtime");
  });

  it.each([
    ["2. Live Stripe activation", "Prove live billing with a controlled canary"],
    ["4. Customer launch canary", "Run the two-customer isolation launch canary"],
    ["5. Production log gate", "Establish production log clearance"],
  ])("admits %s only after explicit affirmative unmet evidence is added", async (heading, title) => {
    const a = await assess(markGate(canonical, heading, "UNMET"));
    expect(a.candidates.map(c => c.title)).toContain(title);
    expect(a.candidates).toHaveLength(3);
  });

  it("does not make President a pricing authority when billing becomes unmet", async () => {
    const a = await assess(
      markGate(canonical, "2. Live Stripe activation", "UNMET")
    );
    const billing = a.candidates.find(
      c => c.title === "Prove live billing with a controlled canary"
    )!;
    expect(billing.proposedBuild).toContain("currently authorized plan");
    expect(billing.proposedBuild).toContain(
      "President does not choose or alter pricing or trial terms."
    );
    expect(billing.proposedBuild).not.toMatch(
      /\$49|\$468|seven-day|7-day|card required/i
    );
  });

  it("COMPLETE suppresses an otherwise affirmatively unmet gate", async () => {
    const complete = markGate(
      canonical,
      "3. Retention activation",
      "COMPLETE"
    );
    const states = extractGateStates(complete);
    expect(states.get("retention")?.state).toBe("COMPLETE");
    expect((await assess(complete)).candidates.map(c => c.title)).toEqual([
      "Prove production database recovery",
    ]);
  });

  it("removing an admitted section removes its candidate and ranking closes up", async () => {
    const reduced = removeSection(canonical, "1. Production MySQL recovery gate");
    const a = await assess(reduced);
    expect(a.candidates).toHaveLength(1);
    expect(a.candidates[0].title).toBe("Activate and verify retention safely");
    expect(a.candidates[0].rank).toBe(1);
    expect(a.candidates[0].rankReason).toContain(
      "Rank 1 of the supported menu."
    );
  });

  it("does not invent projects for an empty or unsupported document", async () => {
    expect(
      (await assess("# No documented launch gaps")).candidates
    ).toHaveLength(0);
  });

  it("removing affirmative recovery gap wording suppresses admission even if the section survives", async () => {
    const complete = canonical
      .replace(
        "Scheduled volume backups are not configured.",
        "Scheduled volume backups are configured."
      )
      .replace(
        "No restore drill has been proven.",
        "A restore drill has been proven."
      );
    const states = extractGateStates(complete);
    expect(states.get("recovery")?.state).toBe("UNKNOWN");
    expect((await assess(complete)).candidates.map(c => c.title)).not.toContain(
      "Prove production database recovery"
    );
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
      markGate(canonical, "2. Live Stripe activation", "UNMET")
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
    expect(result.assessment.candidates).toHaveLength(1);

    snapshot.sourceContents[LAUNCH_OPS_SOURCE] = canonical;
    await expect(
      assessPresidentStage1({
        snapshot,
        store: new MemoryPresidentAssessmentStore(),
      })
    ).rejects.toThrow("differs from fingerprinted");
  });
});
