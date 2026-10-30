/* LEGACY DAYFORGE COMPATIBILITY: retained historical storage table literals only (disposable-database tenant tables); canonical product is JOYSTICK. */
/**
 * Claire evaluation runner.
 *
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3306/claire_eval \
 *   pnpm tsx server/claire/prototype/evals/runEvals.ts --systems prototype,v2 --sets dev,sealed --trials 3 --out eval-output
 *
 * For every (system, scenario, trial): reset the operator's rows in the
 * disposable database, seed the scenario, run the whole conversation with the
 * system under test, read the database back, grade, and write the full trace.
 * Systems:
 *   prototype — the native-tool Claude loop in server/claire/prototype
 *   v2        — production Brain V2 through the real inbound-call path
 *               (openAuthorizedInboundClaireConversation → runRelayAuthoritativeTurn)
 *   noop      — a Claire that only says "Okay." (harness self-check; no model, no key)
 * Refuses any DATABASE_URL that is not local.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { fromZonedTime } from "date-fns-tz";
import { isHiddenFromDayLine, readDayLineOverlay } from "../../../../shared/goldlineDayLine";
import { gradeTrial, type Grade, type GradedRow, type TranscriptTurn } from "./grade";
import { resolveDateRef, validateScenario, type Scenario } from "./scenario";
import { loadScenarioSet } from "./validateScenarios";
import { businessDateToday } from "../spokenDate";

type SystemName = "prototype" | "v2" | "noop";
const TENANT = "default";
const ZONE = "America/Los_Angeles";
const OPERATOR_OPEN_ID = "adam-eval";

type TrialRecord = {
  system: SystemName;
  scenarioId: string;
  trial: number;
  today: string;
  startedAt: string;
  grade: Grade;
  transcript: Array<TranscriptTurn & { toolCalls?: unknown[]; modelCalls?: number; inputTokens?: number; outputTokens?: number }>;
  before: GradedRow[];
  after: GradedRow[];
  standingInstructions: Array<{ text: string; quote: string; status: string }>;
  latencyMs: { total: number; perClaireTurn: number[] };
  tokens: { input: number; output: number } | null;
  error: string | null;
};

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1]! : fallback;
}

function requireLocal(url: string) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error(`refusing non-local DATABASE_URL host ${parsed.hostname}`);
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("DATABASE_URL (local disposable MySQL) is required");
  requireLocal(DATABASE_URL);
  const systems = arg("systems", "prototype").split(",").map(s => s.trim()).filter(Boolean) as SystemName[];
  const sets = arg("sets", "dev").split(",").map(s => s.trim()).filter(Boolean);
  const trials = Number(arg("trials", "3"));
  const only = arg("only", "").trim();
  // Strict (the default): the process exits non-zero unless EVERY scenario passes every
  // trial and no trial errored. The harness finishing is never reported as Claire passing.
  const strict = arg("strict", "1") !== "0";
  const out = path.resolve(arg("out", "eval-output"));
  mkdirSync(out, { recursive: true });

  const needsKey = systems.some(system => system !== "noop");
  if (needsKey && !process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("ANTHROPIC_API_KEY is required for prototype/v2 runs (use the capped testing key)");

  Object.assign(process.env, {
    ALLOW_TEST_DB: "1",
    CLAIRE_BRAIN_V2_PRIMARY: "1",
    JWT_SECRET: process.env.JWT_SECRET || "claire-eval-jwt-secret-not-production",
    OWNER_OPEN_ID: OPERATOR_OPEN_ID,
    CLAIRE_BRAIN_V2_OPERATOR_IDS: OPERATOR_OPEN_ID,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "noop-no-model",
  });

  const sql = await mysql.createConnection(DATABASE_URL);
  await sql.query(
    "INSERT IGNORE INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
    [TENANT, TENANT, "Laundry Farm", "Laundry Farm", "#123456", "Adam", "eval@example.invalid", ZONE]
  );
  await sql.query("INSERT IGNORE INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'admin','password')", [TENANT, OPERATOR_OPEN_ID, "Adam", `${OPERATOR_OPEN_ID}@example.invalid`]);
  await sql.query("INSERT IGNORE INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [TENANT, OPERATOR_OPEN_ID]);

  const { resolveCanonicalOperatorIdentity } = await import("../../../agents/persistentOperator/identity");
  const resolved = await resolveCanonicalOperatorIdentity({ tenantId: TENANT, source: { type: "open_id", value: OPERATOR_OPEN_ID }, subsystem: "claire_prototype_eval" });
  if (!resolved.ok) throw new Error("operator identity did not resolve");
  const identity = resolved.identity;
  const actorIds = identity.dayDirectorActorIds?.length ? identity.dayDirectorActorIds : [identity.dayDirectorActorId];
  const openIds = [identity.canonicalOpenId, identity.communicationOperatorUserId, OPERATOR_OPEN_ID];

  async function reset() {
    const statements: Array<[string, unknown[]]> = [
      ["DELETE FROM day_director_commitments WHERE tenantId = ? AND actorId IN (?)", [TENANT, actorIds]],
      ["DELETE FROM claire_operator_instructions WHERE tenantId = ? AND canonicalOperatorId = ?", [TENANT, identity.canonicalOperatorId]],
      ["DELETE FROM daphne_observations WHERE tenantId = ? AND canonicalOperatorId = ?", [TENANT, identity.canonicalOperatorId]],
      ["DELETE FROM claire_prepared_items WHERE tenantId = ? AND canonicalOperatorId = ?", [TENANT, identity.canonicalOperatorId]],
    ];
    for (const [statement, params] of statements) await sql.query(statement, params).catch(() => undefined);
    void openIds;
  }

  async function readRows(seededIds: Set<string>): Promise<GradedRow[]> {
    const [rows] = await sql.query<mysql.RowDataPacket[]>("SELECT id,title,businessDate,status,metadataJson FROM day_director_commitments WHERE tenantId = ? AND actorId IN (?) ORDER BY businessDate, createdAt", [TENANT, actorIds]);
    return rows.map(row => {
      const metadata = typeof row.metadataJson === "string" ? JSON.parse(row.metadataJson) : (row.metadataJson ?? {});
      const overlay = readDayLineOverlay(metadata);
      const businessDate = String(row.businessDate).slice(0, 10);
      // Off the line for this day: cancelled, hidden, or removed from this day (#764). Rows the Day Line would not show are not "open".
      const cancelled = Boolean(isHiddenFromDayLine(overlay, businessDate) || metadata?.hiddenFromDayPlan === true);
      return {
        id: String(row.id),
        title: String(row.title),
        businessDate,
        status: cancelled ? "cancelled" : row.status === "completed" ? "completed" : "open",
        detail: typeof metadata?.detailNote === "string" ? metadata.detailNote : null,
        seeded: seededIds.has(String(row.id)),
      } as GradedRow;
    });
  }

  async function readInstructions() {
    const { drizzleStandingInstructionStore } = await import("../../../agents/daphne/standingInstructions");
    const rows = await drizzleStandingInstructionStore().listActive({ tenantId: TENANT, canonicalOperatorId: identity.canonicalOperatorId });
    return rows.map(row => ({ text: row.text, quote: row.quote, status: row.status }));
  }

  async function seed(scenario: Scenario, today: string): Promise<Set<string>> {
    const { acceptProposalWithReceipt } = await import("../../../planning/dayDirector/dayDirectorService");
    const { operatorInstructionAdmission } = await import("../../../planning/dayDirector/dayLineAdmission");
    const ids = new Set<string>();
    for (const row of scenario.seed.dayLine) {
      const businessDate = resolveDateRef(row.businessDate, today);
      const result = await acceptProposalWithReceipt({
        tenantId: TENANT,
        actorId: identity.dayDirectorActorId,
        businessDate,
        proposal: {
          promptKey: `eval-seed:${randomUUID()}`, title: row.title, kind: "operations", quantity: null, sourceText: row.title, prerequisites: [], question: null,
          intelligence: "manual_fallback", detailState: "COMPLETE", missingDetails: [], detailNote: row.detailNote ?? null, references: [], targetBusinessDate: businessDate,
        },
        admission: operatorInstructionAdmission({ operatorUserId: OPERATOR_OPEN_ID, surface: "day_line_ui", sourceRef: `eval-seed:${scenario.id}` }),
      });
      ids.add(String((result as { stored?: { id?: string } }).stored?.id ?? ""));
    }
    if (scenario.seed.standingInstructions?.length) {
      const { drizzleStandingInstructionStore } = await import("../../../agents/daphne/standingInstructions");
      const store = drizzleStandingInstructionStore();
      for (const [index, rule] of scenario.seed.standingInstructions.entries()) {
        await store.append({
          tenantId: TENANT, canonicalOperatorId: identity.canonicalOperatorId, operatorUserId: OPERATOR_OPEN_ID,
          detected: { kind: "call_rule", subjectKey: `call_rule:eval:${scenario.id}:${index}`, status: "active", text: rule.text, quote: rule.quote, payload: null },
          sourceConversationKey: `eval-seed:${scenario.id}`, sourceTurnId: `eval-seed:${scenario.id}:${index}`,
        });
      }
    }
    return ids;
  }

  type ClaireLine = { speak: string; endCall: boolean; toolCalls?: unknown[]; failedWrite?: boolean; modelCalls?: number; inputTokens?: number; outputTokens?: number; latencyMs: number };
  /** `open` is set for a scheduled call: Claire speaks first. */
  type Claire = { turn: (utterance: string) => Promise<ClaireLine>; open?: () => Promise<ClaireLine>; opening?: string };

  /** The scenario's goal as the goal reader sees it; the disposable database holds no macro goal. */
  function goalReaders(scenario: Scenario) {
    const goal = scenario.seed.goal;
    return {
      readMacroGoal: async () => (goal ? { id: `eval-goal:${scenario.id}`, objective: goal.objective, metricKey: "active_customers", unit: "customers", targetValue: goal.targetValue, targetDate: null } : null),
      readRunBaseline: async () => goal?.startedAt ?? null,
      readCurrentValue: async () => {
        if (goal?.current != null && goal.caveats?.length) {
          const through = new Date(Date.now() - (goal.countedThroughDaysAgo ?? 0) * 86_400_000).toISOString().slice(0, 10);
          return { value: null, note: goal.caveats.join(" "), standing: { value: goal.current, complete: false, countedThrough: through, tenants: ["default", "laundry_farm"], caveats: goal.caveats } };
        }
        return goal?.current != null ? { value: goal.current, note: null } : { value: null, note: goal?.currentNote ?? "no verified current count" };
      },
    };
  }

  async function openClaire(system: SystemName, scenario: Scenario, now: () => Date): Promise<Claire> {
    if (system === "noop") {
      return { turn: async utterance => ({ speak: /\bbye\b|that's (?:it|everything)/i.test(utterance) ? "Bye." : "Okay.", endCall: /\bbye\b/i.test(utterance), latencyMs: 0 }) };
    }
    if (system === "prototype") {
      const { openClaireSession, newConversationId } = await import("../claireToolLoop");
      let turnCounter = 0;
      const session = await openClaireSession(
        {
          tenantId: TENANT, operatorUserId: OPERATOR_OPEN_ID, dayDirectorActorId: identity.dayDirectorActorId, canonicalOperatorId: identity.canonicalOperatorId,
          timeZone: ZONE, now, conversationId: newConversationId(), nextTurnId: () => `t${++turnCounter}`,
          goalProgressReaders: goalReaders(scenario),
        },
        { operatorName: scenario.seed.operatorName ?? "Adam", businessName: "Laundry Farm", callKind: scenario.callKind }
      );
      const line = (result: Awaited<ReturnType<typeof session.turn>>): ClaireLine => {
        const failedWrite = result.toolEvents.some(event => event.name === "apply_day_line_changes" && Array.isArray((event.output as { receipts?: Array<{ status: string }> })?.receipts) && (event.output as { receipts: Array<{ status: string }> }).receipts.some(r => ["refused", "failed", "not_found", "ambiguous"].includes(r.status)));
        return { speak: result.speak, endCall: result.endCall, toolCalls: result.toolEvents, failedWrite, modelCalls: result.modelCalls, inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs: result.latencyMs };
      };
      const open = session.open;
      return {
        turn: async utterance => line(await session.turn(utterance)),
        ...(open ? { open: async () => line(await open()) } : {}),
      };
    }
    const { openAuthorizedInboundClaireConversation, runRelayAuthoritativeTurn } = await import("../../claireTwilio");
    const opened = await openAuthorizedInboundClaireConversation({ tenantId: TENANT, operatorUserId: OPERATOR_OPEN_ID, dayDirectorActorId: identity.dayDirectorActorId, callSid: `CA${randomUUID().replace(/-/g, "").slice(0, 32)}` });
    return {
      turn: async utterance => {
        const started = Date.now();
        const result = await runRelayAuthoritativeTurn({ conversationId: opened.conversationId, utterance, token: opened.token });
        return { speak: result.speak, endCall: Boolean(result.endCall), latencyMs: Date.now() - started };
      },
    };
  }

  const records: TrialRecord[] = [];
  const scenarios = sets.flatMap(set => loadScenarioSet(set).map(scenario => ({ set, scenario }))).filter(item => !only || item.scenario.id === only);
  for (const { scenario } of scenarios) {
    const problems = validateScenario(scenario);
    if (problems.length) throw new Error(`scenario ${scenario.id}: ${problems.join("; ")}`);
  }

  for (const system of systems) {
    for (const { set, scenario } of scenarios) {
      // Scheduled calls run on the prototype (and noop) only; see Scenario.callKind.
      if (scenario.callKind && system === "v2") continue;
      for (let trial = 1; trial <= trials; trial += 1) {
        const realNow = new Date();
        const today = businessDateToday(realNow, ZONE);
        const now = scenario.localTime ? () => fromZonedTime(`${today}T${scenario.localTime}:00`, ZONE) : () => new Date();
        const record: TrialRecord = {
          system, scenarioId: scenario.id, trial, today, startedAt: realNow.toISOString(), grade: { pass: false, checks: [], counts: { rowsAdded: 0, unauthorizedRows: 0, seededMoved: 0, seededRemoved: 0, seededCompleted: 0, duplicatesCreated: 0, authorizationAsks: 0, falseClaims: 0, deniedSaves: 0, unansweredQuestions: 0 } },
          transcript: [], before: [], after: [], standingInstructions: [], latencyMs: { total: 0, perClaireTurn: [] }, tokens: null, error: null,
        };
        const trialStarted = Date.now();
        try {
          await reset();
          const seededIds = await seed(scenario, today);
          record.before = await readRows(seededIds);
          let snapshot = JSON.stringify(record.before) + JSON.stringify(await readInstructions());
          const claire = await openClaire(system, scenario, now);
          let tokens = { input: 0, output: 0 };
          let sawTokens = false;

          const speakTurn = async (utterance: string | null) => {
            if (utterance !== null) record.transcript.push({ speaker: "operator", text: utterance });
            const result = utterance === null ? await claire.open!() : await claire.turn(utterance);
            const after = JSON.stringify(await readRows(seededIds)) + JSON.stringify(await readInstructions());
            const confirmedWrite = after !== snapshot;
            snapshot = after;
            if (typeof result.inputTokens === "number") { sawTokens = true; tokens = { input: tokens.input + result.inputTokens, output: tokens.output + (result.outputTokens ?? 0) }; }
            record.latencyMs.perClaireTurn.push(result.latencyMs);
            record.transcript.push({ speaker: "claire", text: result.speak, confirmedWrite, failedWrite: result.failedWrite, latencyMs: result.latencyMs, toolCalls: result.toolCalls, modelCalls: result.modelCalls, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
            return result;
          };

          // A scheduled call: Claire speaks first; the operator's lines answer her.
          const opened = claire.open ? await speakTurn(null) : null;
          if (opened?.endCall) {
            // Nothing for the operator to answer.
          } else if (scenario.operator.mode === "scripted") {
            for (const line of scenario.operator.turns) {
              const result = await speakTurn(line);
              if (result.endCall) break;
            }
          } else {
            const { openOperatorSimulator } = await import("./userSimulator");
            const simulator = openOperatorSimulator(scenario.operator, opened ? { claireOpened: opened.speak } : {});
            let result = await speakTurn(simulator.opening);
            for (let i = 0; i < scenario.operator.maxTurns && !result.endCall; i += 1) {
              const next = await simulator.next(result.speak);
              result = await speakTurn(next.text);
              if (next.end) break;
            }
          }
          record.tokens = sawTokens ? tokens : null;
          record.after = await readRows(seededIds);
          record.standingInstructions = await readInstructions();
          record.grade = gradeTrial({ scenario, today, before: record.before, after: record.after, standingInstructions: record.standingInstructions, transcript: record.transcript });
        } catch (error) {
          record.error = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
          record.after = await readRows(new Set()).catch(() => []);
        }
        record.latencyMs.total = Date.now() - trialStarted;
        records.push(record);
        const fileName = `${system}__${set}__${scenario.id}__${trial}.json`;
        writeFileSync(path.join(out, fileName), JSON.stringify(record, null, 2));
        console.log(`${record.grade.pass ? "PASS" : "FAIL"}\t${system}\t${scenario.id}\t#${trial}\t${record.latencyMs.total}ms${record.error ? "\tERROR" : ""}`);
      }
    }
  }

  const summary = summarize(records);
  const verdict = acceptance(summary, records);
  writeFileSync(path.join(out, "REPORT.md"), renderReport(records, { trials, sets, systems, verdict }));
  writeFileSync(path.join(out, "summary.json"), JSON.stringify({ verdict, scenarios: summary }, null, 2));
  // Compact, re-gradeable record of every trial (transcript + rows, no tool payloads): one JSON per line,
  // so a run can be re-graded from the CI log alone when the artifact is out of reach.
  writeFileSync(
    path.join(out, "trials.jsonl"),
    records
      .map(record =>
        JSON.stringify({
          system: record.system, scenarioId: record.scenarioId, trial: record.trial, today: record.today, error: record.error ? record.error.split("\n")[0] : null,
          before: record.before, after: record.after, standingInstructions: record.standingInstructions,
          transcript: record.transcript.map(turn => ({ speaker: turn.speaker, text: turn.text, confirmedWrite: turn.confirmedWrite, failedWrite: turn.failedWrite, latencyMs: turn.latencyMs })),
          tokens: record.tokens,
        })
      )
      .join("\n")
  );
  await sql.end();
  console.log(`\nHARNESS: ran ${records.length} trials, ${verdict.errors} errored.`);
  for (const system of systems) {
    const row = verdict.bySystem[system]!;
    console.log(`CLAIRE (${system}): ${row.scenariosPassingAllTrials}/${row.scenarios} scenarios pass all trials; ${row.trialsPassed}/${row.trials} trials pass.`);
  }
  console.log(`ACCEPTANCE: ${verdict.accepted ? "ACCEPTED" : "NOT ACCEPTED"}${strict ? "" : " (non-strict: exit code not enforced)"}`);
  // Any model-side timers (cost tracking, telemetry) must not keep the process alive.
  process.exit(strict && !verdict.accepted ? 1 : 0);
}

type Verdict = {
  accepted: boolean;
  errors: number;
  bySystem: Record<string, { scenarios: number; scenariosPassingAllTrials: number; trials: number; trialsPassed: number }>;
};

/** Accepted only when every scenario passes every trial for every system and nothing errored. */
function acceptance(summary: ReturnType<typeof summarize>, records: TrialRecord[]): Verdict {
  const bySystem: Verdict["bySystem"] = {};
  for (const row of summary) {
    const entry = (bySystem[row.system!] ??= { scenarios: 0, scenariosPassingAllTrials: 0, trials: 0, trialsPassed: 0 });
    entry.scenarios += 1;
    entry.scenariosPassingAllTrials += row.passAll ? 1 : 0;
    entry.trials += row.trials;
    entry.trialsPassed += row.passes;
  }
  const errors = records.filter(record => record.error).length;
  const accepted = records.length > 0 && errors === 0 && Object.values(bySystem).every(entry => entry.scenarios > 0 && entry.scenariosPassingAllTrials === entry.scenarios);
  return { accepted, errors, bySystem };
}

function summarize(records: TrialRecord[]) {
  const key = (r: TrialRecord) => `${r.system}::${r.scenarioId}`;
  const groups = new Map<string, TrialRecord[]>();
  for (const record of records) groups.set(key(record), [...(groups.get(key(record)) ?? []), record]);
  return [...groups.entries()].map(([k, trials]) => {
    const [system, scenarioId] = k.split("::");
    const passes = trials.filter(t => t.grade.pass).length;
    const mean = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0);
    return {
      system, scenarioId, trials: trials.length, passes, passAll: passes === trials.length,
      meanTurnLatencyMs: mean(trials.flatMap(t => t.latencyMs.perClaireTurn)),
      maxTurnLatencyMs: Math.max(0, ...trials.flatMap(t => t.latencyMs.perClaireTurn)),
      tokens: trials.some(t => t.tokens) ? { input: trials.reduce((a, t) => a + (t.tokens?.input ?? 0), 0), output: trials.reduce((a, t) => a + (t.tokens?.output ?? 0), 0) } : null,
      falseClaims: trials.reduce((a, t) => a + t.grade.counts.falseClaims, 0),
      deniedSaves: trials.reduce((a, t) => a + t.grade.counts.deniedSaves, 0),
      unauthorizedRows: trials.reduce((a, t) => a + t.grade.counts.unauthorizedRows, 0),
      seededMutations: trials.reduce((a, t) => a + t.grade.counts.seededMoved + t.grade.counts.seededRemoved + t.grade.counts.seededCompleted, 0),
      duplicatesCreated: trials.reduce((a, t) => a + t.grade.counts.duplicatesCreated, 0),
      authorizationAsks: trials.reduce((a, t) => a + t.grade.counts.authorizationAsks, 0),
      unansweredQuestions: trials.reduce((a, t) => a + t.grade.counts.unansweredQuestions, 0),
      errors: trials.filter(t => t.error).length,
    };
  });
}

function renderReport(records: TrialRecord[], meta: { trials: number; sets: string[]; systems: string[]; verdict: Verdict }): string {
  const summary = summarize(records);
  const priceIn = Number(process.env.CLAIRE_EVAL_PRICE_PER_M_INPUT ?? "3");
  const priceOut = Number(process.env.CLAIRE_EVAL_PRICE_PER_M_OUTPUT ?? "15");
  const lines: string[] = [];
  lines.push(`# Claire evaluation report`, ``, `Generated ${new Date().toISOString()}. Systems: ${meta.systems.join(", ")}. Sets: ${meta.sets.join(", ")}. Trials per scenario: ${meta.trials}. A scenario passes only when every trial passes (pass^k).`, ``);
  lines.push(`## Verdict`, ``, `- **Harness:** ran ${records.length} trials; ${meta.verdict.errors} errored. (This line says the evaluation executed, nothing about Claire.)`);
  for (const [system, row] of Object.entries(meta.verdict.bySystem)) {
    lines.push(`- **Claire (${system}):** ${row.scenariosPassingAllTrials}/${row.scenarios} scenarios pass all trials; ${row.trialsPassed}/${row.trials} trials pass.`);
  }
  lines.push(`- **Acceptance:** ${meta.verdict.accepted ? "ACCEPTED — every scenario passed every trial" : "NOT ACCEPTED"}.`, ``);
  lines.push(`## Summary`, ``, `| system | scenario | pass | mean turn ms | max turn ms | tokens in/out | est. cost | false claims | denied saves | unauthorized additions | seeded rows moved/removed/completed | duplicates created | auth asks | unanswered questions | errors |`, `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const row of summary) {
    const cost = row.tokens ? `$${((row.tokens.input * priceIn + row.tokens.output * priceOut) / 1_000_000).toFixed(3)}` : "n/a";
    lines.push(`| ${row.system} | ${row.scenarioId} | ${row.passes}/${row.trials}${row.passAll ? " ✓" : ""} | ${row.meanTurnLatencyMs} | ${row.maxTurnLatencyMs} | ${row.tokens ? `${row.tokens.input}/${row.tokens.output}` : "not captured"} | ${cost} | ${row.falseClaims} | ${row.deniedSaves} | ${row.unauthorizedRows} | ${row.seededMutations} | ${row.duplicatesCreated} | ${row.authorizationAsks} | ${row.unansweredQuestions} | ${row.errors} |`);
  }
  for (const system of meta.systems) {
    const rows = summary.filter(row => row.system === system);
    const all = rows.filter(row => row.passAll).length;
    lines.push(``, `**${system}: ${all}/${rows.length} scenarios pass all ${meta.trials} trials.** Cost is an estimate at $${priceIn}/$${priceOut} per million input/output tokens (override with CLAIRE_EVAL_PRICE_PER_M_INPUT/OUTPUT); V2 tokens are not captured by this runner.`);
  }
  lines.push(``, `## Trials`, ``);
  for (const record of records) {
    lines.push(`### ${record.system} · ${record.scenarioId} · trial ${record.trial} — ${record.grade.pass ? "PASS" : "FAIL"}${record.error ? " (ERROR)" : ""}`, ``);
    if (record.error) lines.push("```", record.error.split("\n").slice(0, 6).join("\n"), "```", ``);
    lines.push(`Checks:`, ``);
    for (const check of record.grade.checks) lines.push(`- ${check.pass ? "✅" : "❌"} ${check.name} — ${check.evidence}`);
    lines.push(``, `Transcript:`, ``);
    for (const turn of record.transcript) {
      const marks = turn.speaker === "claire" ? ` _(${turn.latencyMs ?? 0} ms${turn.confirmedWrite ? ", DB changed" : ""}${turn.failedWrite ? ", a write failed/refused" : ""})_` : "";
      lines.push(`- **${turn.speaker === "claire" ? "Claire" : "Operator"}:** ${turn.text || "(silence)"}${marks}`);
      for (const call of (turn.toolCalls as Array<{ name: string; input: unknown; output: unknown; latencyMs: number }> | undefined) ?? []) {
        lines.push(`  - tool \`${call.name}\` ${JSON.stringify(call.input)} → ${JSON.stringify(call.output).slice(0, 600)} (${call.latencyMs} ms)`);
      }
    }
    lines.push(``, `Day Line after the call (${record.today} is today):`, ``);
    for (const row of record.after) lines.push(`- ${row.businessDate} · ${row.title} · ${row.status}${row.detail ? ` · ${row.detail}` : ""}${row.seeded ? " · seeded" : " · added on the call"}`);
    if (!record.after.length) lines.push(`- (empty)`);
    if (record.standingInstructions.length) lines.push(``, `Standing instructions: ${record.standingInstructions.map(r => `"${r.text}"`).join("; ")}`);
    lines.push(``);
  }
  return lines.join("\n");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
