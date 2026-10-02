import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { assessPresidentStage1 } from "../server/president/assessment";
import { inspectPresidentEvidence } from "../server/president/evidence";
import { FilePresidentAssessmentStore } from "../server/president/store";
const root = resolve(import.meta.dirname, "..");
// The branch base is the main tree this isolated stream was authorized to inspect.
// Later parallel merges into main are deliberately not consumed by this branch.
const sha = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: root, encoding: "utf8" }).trim();
let githubAvailable = false; try { execFileSync("gh", ["pr", "view", "355", "--json", "number"], { cwd: root, stdio: "ignore" }); githubAvailable = true; } catch {}
const snapshot = await inspectPresidentEvidence({
  repositoryRoot: root,
  repositorySha: sha,
  githubAvailable,
  readSource: async path => execFileSync("git", ["show", `${sha}:${path}`], { cwd: root }),
});
const path = process.env.PRESIDENT_WITNESS_STORE || resolve(root, "artifacts/president-stage1/witness-store.json");
const store = new FilePresidentAssessmentStore(path); const first = await assessPresidentStage1({ snapshot, store }); const second = await assessPresidentStage1({ snapshot, store });
console.log(`Inspected main SHA: ${sha}\nEvidence snapshot: ${snapshot.id}\nAvailable evidence: ${snapshot.availableSources.join(", ")}\nUnavailable evidence: ${snapshot.unavailableSources.join(", ")}\nAssessment ID: ${first.assessment.id}\nCandidate IDs: ${first.assessment.candidates.map(x => x.id).join(", ")}`);
for (const c of first.assessment.candidates) { console.log(`\n#${c.rank} ${c.title}\n${c.missingCapability} ${c.currentGap} ${c.proposedBuild} Afterward, ${c.resultingCapability} ${c.rankReason}`); for (const e of c.evidence) console.log(`  ${e.kind}: ${e.statement} [${e.sourceId} ${e.sourceLocation}]`); }
console.log(`\nFinal state: ${first.assessment.resultState}\nExecution count: ${first.assessment.executionCount}\nSame-evidence rerun reused: ${second.reused}\nSame assessment ID: ${second.assessment.id === first.assessment.id}\nStored assessment count: ${await store.count()}\nWitness store: ${path}`);
