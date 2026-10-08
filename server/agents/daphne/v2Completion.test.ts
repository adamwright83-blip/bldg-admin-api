import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT=resolve(process.cwd());
const required=[
 "server/agents/daphne/observationStore.ts",
 "server/agents/daphne/epistemicStore.ts",
 "server/agents/daphne/stateModel.ts",
 "server/agents/daphne/contextModel.ts",
 "server/agents/daphne/personModel.ts",
 "server/agents/daphne/goalsPreferences.ts",
 "server/agents/daphne/relationshipModel.ts",
 "server/agents/daphne/hypothesisSet.ts",
 "server/agents/daphne/operatorCard.ts",
 "server/agents/daphne/interventionLedger.ts",
 "server/agents/daphne/outcomeLedger.ts",
 "server/agents/daphne/responseModel.ts",
 "server/agents/daphne/causalEstimator.ts",
 "server/agents/daphne/activeLearning.ts",
 "server/agents/daphne/policyEngine.ts",
 "server/agents/daphne/agentChangeAttribution.ts",
 "server/agents/daphne/consolidation.ts",
 "server/agents/daphne/engine.ts",
 "server/agents/daphne/router.ts",
 "server/agents/daphne/claireAdapter.ts",
 "server/narratorOs/daphneRelationshipContext.ts",
 "server/agents/daphne/repairEngine.ts",
 "server/agents/daphne/userControls.ts",
 "server/agents/daphne/privacy.ts",
 "server/agents/daphne/scientificEvaluation.ts",
 "server/agents/daphne/causalCanary.ts",
 "server/agents/daphne/hierarchicalPrior.ts",
 "server/agents/daphne/productBoundary.ts",
 "server/agents/daphne/metrics.ts",
];
describe("Daphne V2 full-slice architecture",()=>{
 it("has implementation surfaces for every Slice 1-28 capability",()=>{
  for(const p of required) expect(existsSync(resolve(ROOT,p)),p).toBe(true);
 });
 it("is mounted as an authenticated product API",()=>{
  const routers=readFileSync(resolve(ROOT,"server/routers.ts"),"utf8");
  expect(routers).toContain('import { daphneRouter } from "./agents/daphne/router"');
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
  const p=readFileSync(resolve(ROOT,"server/agents/daphne/productBoundary.ts"),"utf8");
  for(const forbidden of ["../../claire/","../../mitch/","../../president/","../../orders/","../../commercial"]) expect(p).not.toContain(forbidden);
 });
});
