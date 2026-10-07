import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT=resolve(process.cwd());
const required=[
 "server/daphne/observationStore.ts",
 "server/daphne/epistemicStore.ts",
 "server/daphne/stateModel.ts",
 "server/daphne/contextModel.ts",
 "server/daphne/personModel.ts",
 "server/daphne/goalsPreferences.ts",
 "server/daphne/relationshipModel.ts",
 "server/daphne/hypothesisSet.ts",
 "server/daphne/operatorCard.ts",
 "server/daphne/interventionLedger.ts",
 "server/daphne/outcomeLedger.ts",
 "server/daphne/responseModel.ts",
 "server/daphne/causalEstimator.ts",
 "server/daphne/activeLearning.ts",
 "server/daphne/policyEngine.ts",
 "server/daphne/agentChangeAttribution.ts",
 "server/daphne/consolidation.ts",
 "server/daphne/engine.ts",
 "server/daphne/router.ts",
 "server/daphne/claireAdapter.ts",
 "server/narratorOs/daphneRelationshipContext.ts",
 "server/daphne/repairEngine.ts",
 "server/daphne/userControls.ts",
 "server/daphne/privacy.ts",
 "server/daphne/scientificEvaluation.ts",
 "server/daphne/causalCanary.ts",
 "server/daphne/hierarchicalPrior.ts",
 "server/daphne/productBoundary.ts",
 "server/daphne/metrics.ts",
];
describe("Daphne V2 full-slice architecture",()=>{
 it("has implementation surfaces for every Slice 1-28 capability",()=>{
  for(const p of required) expect(existsSync(resolve(ROOT,p)),p).toBe(true);
 });
 it("is mounted as an authenticated product API",()=>{
  const routers=readFileSync(resolve(ROOT,"server/routers.ts"),"utf8");
  expect(routers).toContain('import { daphneRouter } from "./daphne/router"');
  expect(routers).toContain("daphne: daphneRouter");
 });
 it("wires V2 guidance into Claire without replacing the Stage 3B canary",()=>{
  const turn=readFileSync(resolve(ROOT,"server/claire/turn/claireTurn.ts"),"utf8");
  const follow=readFileSync(resolve(ROOT,"server/claire/preDriveConversation.ts"),"utf8");
  expect(turn).toContain("loadDaphneClaireGuidance");
  expect(turn).toContain("loadOperatorAdaptationDecisionForUser");
  expect(follow).toContain("daphne_v2_user_adaptation");
  expect(follow).toContain("authored_narrative");
 });
 it("keeps portable product boundary free of JOYSTICK seat/domain dependencies",()=>{
  const p=readFileSync(resolve(ROOT,"server/daphne/productBoundary.ts"),"utf8");
  for(const forbidden of ["../claire/","../mitch/","../president/","../orders/","../commercial"]) expect(p).not.toContain(forbidden);
 });
});
