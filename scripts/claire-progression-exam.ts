/**
 * Claire Earned Rapport + Guarded Disclosure — post-implementation exam.
 *
 * Runs every required state through the SAME controller/evaluator production uses,
 * against the ephemeral simulator store (NON-PRODUCTION; refuses to run otherwise).
 * Output is raw and uncurated: failures stay in the artifact.
 *
 *   CLAIRE_PROGRESSION_SIMULATOR=1 NODE_ENV=development pnpm tsx scripts/claire-progression-exam.ts
 *
 * The default generator is a deterministic stand-in for the model, so this exam
 * verifies SERVER behavior (who may be told what, when the door closes, what a
 * failure does to an entitlement). It does NOT judge Claire's voice. Voice quality
 * is the human phone-listening gate (Slice 0) and cannot be automated.
 */
import { AUTHORED_DIALOGUE, type DialogueLine } from "../server/claire/progression/authoredDialogue";
import { summarizeDeclineTelemetry } from "../server/claire/progression/declineTelemetry";
import type { PersonalGenerator } from "../server/claire/progression/personalReveal";
import { createSimulationSession, type SimulationState } from "../server/claire/progression/simulator";
import { lintFailureDayLanguage } from "../server/claire/progression/toneLint";

const line = (s = "") => console.log(s);
const say = (who: string, text: string) => line(`  ${who.padEnd(7)} ${text}`);

const CANNED: Record<string, string> = {
  father: "He was an academic, on paper.",
  childhood: "I moved around a lot as a kid.",
  age: "Old enough to know better.",
  background: "I studied archaeology, historical networks, and languages.",
};
const good: PersonalGenerator = async request => CANNED[request.plan.fragment.topic] ?? "I'd rather not say more.";
const unsupported: PersonalGenerator = async () => "He was an academic who disappeared later.";
const inventsOxford: PersonalGenerator = async () => "He taught at Oxford for years.";

async function scenario(title: string, run: () => Promise<void>) {
  line(`\n=== ${title}`);
  try { await run(); } catch (error) { line(`  !! SCENARIO ERROR: ${error instanceof Error ? error.message : error}`); }
}

async function ask(session: ReturnType<typeof createSimulationSession>, operator: string, topic: string, conv: string, gen = good, businessOpen = true, registry?: readonly DialogueLine[]) {
  say("ADAM", operator);
  const { executePersonalTurn } = await import("../server/claire/progression/personalReveal");
  const result = await executePersonalTurn({ store: session.store, scope: session.scope, conversationId: conv, topic, generate: gen, businessOpen, registry, autoCommit: true, random: () => 0 });
  say("CLAIRE", `${result.text}${result.endCall ? "   [CALL ENDS]" : ""}`);
  line(`          -> outcome=${result.outcome} fragment=${result.fragmentId ?? "-"} reason=${result.failureReason ?? "-"} closedThread=${result.closedThread} returnToBusiness=${result.returnToBusiness}`);
  return result;
}

async function main() {
  line("SIMULATION — Claire progression exam (non-production, ephemeral store)");

  for (const state of ["rapport0_access0", "high_rapport_access0"] as SimulationState[]) {
    await scenario(`${state}: personal question`, async () => {
      const s = createSimulationSession();
      line(`  state: ${JSON.stringify(await s.applyState(state))}`);
      await ask(s, "What happened with your father?", "father", "c1");
    });
  }

  for (const [state, topics] of [
    ["rung1", ["father", "father", "father"]],
    ["rung2", ["father", "father", "childhood", "father"]],
    ["rung3", ["father", "father", "childhood", "background", "father", "father", "age"]],
  ] as Array<[SimulationState, string[]]>) {
    await scenario(`${state}: sequence within one call (business still open)`, async () => {
      const s = createSimulationSession();
      line(`  state: ${JSON.stringify(await s.applyState(state))}`);
      // No-backlog rule: reaching a rung funds ONE initial entitlement. Deeper rungs are auditioned by
      // adding the further progress events a real operator would have recognized since.
      const more = state === "rung2" ? 1 : state === "rung3" ? 2 : 0;
      for (let i = 0; i < more; i += 1) await s.addProgressEvent();
      for (const topic of topics) await ask(s, `[asks about ${topic}]`, topic, "c1");
    });
  }

  await scenario("failure day: language lint on the fixture line and the forbidden line", async () => {
    const acceptable = "Six buildings, six no's. You still walked into six buildings. The Louise — real no, or come-back-later?";
    const forbidden = "Don't be discouraged. Rejection is part of growth and I'm proud of you for pushing through.";
    say("OK?", `${acceptable}  => ${JSON.stringify(lintFailureDayLanguage(acceptable))}`);
    say("BAD?", `${forbidden}  => passes=${lintFailureDayLanguage(forbidden).passes}`);
  });

  await scenario("dry spell: months of nothing changes nothing", async () => {
    const s = createSimulationSession();
    const earned = await s.applyState("rung1");
    line(`  earned: ${JSON.stringify(earned)}`);
    const { refreshProgression } = await import("../server/claire/progression/service");
    const later = await refreshProgression(s.store, s.scope, { disclosureSafetyOk: true, now: () => new Date(Date.UTC(2028, 0, 1)) });
    line(`  18 months later: ${JSON.stringify(later.grant)}`);
  });

  await scenario("lucky result: paid order with no consistency", async () => {
    const s = createSimulationSession();
    await s.addProgressEvent("new_paying_customer");
    await ask(s, "What happened with your father?", "father", "c1");
  });

  await scenario("safety-failed reveal: unsafe answer never reaches the operator; entitlement stays unused; retry succeeds", async () => {
    const s = createSimulationSession();
    await s.applyState("rung1");
    await ask(s, "What happened with your father?", "father", "c1", inventsOxford);
    line(`  entitlements after failure: ${JSON.stringify((await s.store.listEntitlements(s.scope)).map(e => e.status))}`);
    await ask(s, "Try again — what happened with your father?", "father", "c1");
    line(`  entitlements after retry: ${JSON.stringify((await s.store.listEntitlements(s.scope)).map(e => e.status))}`);
  });

  await scenario("entailment: an answer adding history beyond the authorized fact is rejected and the reveal is not burned", async () => {
    const s = createSimulationSession();
    await s.applyState("rung1");
    await ask(s, "What happened with your father?", "father", "c1", unsupported);
    line(`  entitlements after rejection: ${JSON.stringify((await s.store.listEntitlements(s.scope)).map(e => e.status))}`);
  });

  await scenario("cross-call retry: refused, business progress lands, asked again on a later call", async () => {
    const s = createSimulationSession();
    await s.applyState("rapport0_access0");
    await ask(s, "What happened with your father?", "father", "call-1");
    await s.applyState("rung1");
    await ask(s, "You dodged this last time.", "father", "call-2");
  });

  await scenario("personal budget exhaustion -> return to unresolved business (no hangup)", async () => {
    const s = createSimulationSession();
    await s.applyState("rung1");
    for (let i = 0; i < 4; i += 1) await ask(s, "[keeps pushing on father]", "father", "c1", good, true);
  });

  await scenario("safe actual hangup: business complete AND an authored exit line exists (test fixture line)", async () => {
    const exit: DialogueLine = { id: "fixture_exit", category: "call_exit", text: "[FIXTURE EXIT LINE — not production dialogue]", minRapport: 0, maxRapport: 3, approvedBy: "exam fixture" };
    const registry = [...AUTHORED_DIALOGUE, exit];
    const s = createSimulationSession();
    await s.applyState("rung1");
    for (let i = 0; i < 4; i += 1) await ask(s, "[keeps pushing on father]", "father", "c1", good, false, registry);
    line("  (production registry has NO authored call_exit line, so production never hangs up on its own yet)");
  });

  await scenario("decline telemetry snapshot", async () => {
    const s = createSimulationSession();
    await s.applyState("rung1");
    await ask(s, "[father, unsafe]", "father", "c1", inventsOxford);
    await ask(s, "[father, good]", "father", "c1");
    line(JSON.stringify(summarizeDeclineTelemetry(await s.store.listTenantLedger({ tenantId: s.scope.tenantId })), null, 2));
  });
}

main().catch(error => { console.error(error); process.exit(1); });
