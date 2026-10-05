import {
  critiqueOutputSchema,
  proposalOutputSchema,
  synthesisOutputSchema,
  type Candidate,
  type Cycle,
  type DeliberationRound,
} from "../../../shared/presidentCycle";
import { parseProviderJson } from "../providerJson";
import type { CycleStore } from "./cycleStore";
import { pickPresidentThree, setStatus } from "./cycleService";
import { redactSecrets, type ModelProvider, type ModelRoster } from "./models";

const SYSTEM_BASE =
  "You are advising the founder of JOYSTICK. Respond with a single JSON object only. " +
  "Use only the evidence provided; cite evidence ids in evidenceRefs. If a claim is your own judgment " +
  "rather than evidence, leave evidenceRefs empty for it. Never invent metrics.";

const CANDIDATE_FIELDS =
  `title, problem, evidenceRefs (evidence ids), proposedChange, expectedUpside, risk, effort, dependencies[], ` +
  `whyNow, successLooksLike, executionDomain (one of ENGINEERING|RESEARCH|ANALYSIS|DOCUMENTATION|PRODUCT_DESIGN|BROWSER_WEB|OPERATIONS|GROWTH|SECURITY|OTHER), ` +
  `scope (bounded), acceptanceCriteria[], validationCommands[] (shell checks, may be empty), browserCheck ({url, expectText?} or null)`;

function evidenceBlock(c: Cycle) {
  return JSON.stringify(c.evidence, null, 1);
}

export function proposalPrompt(c: Cycle) {
  return `Given the current state of JOYSTICK and the evidence provided, identify the ten highest-leverage improvements we should consider across product features, customer experience, security, reliability, system architecture, internal tooling, growth, and business performance.

Rank them (rank 1 = best). Each must be concrete and grounded in this evidence, not generic startup advice.
Return {"candidates":[10 items]} where each item has: rank (integer), ${CANDIDATE_FIELDS}.

EVIDENCE:
${evidenceBlock(c)}`;
}

export function critiquePrompt(c: Cycle) {
  return `Critique ChatGPT's recommendations. Identify: weak assumptions; duplicated ideas; low-leverage ideas; unsafe changes; architecture risks; missing customer evidence; missing security concerns; things that should be higher/lower; better alternatives ChatGPT omitted. Do not agree merely for consensus.
Return {"overall": string, "perCandidate":[{rank, verdict: KEEP|DEMOTE|PROMOTE|DROP|MERGE, weakAssumptions[], risks[], note}], "omittedAlternatives":[string]}.

EVIDENCE:
${evidenceBlock(c)}

CHATGPT RECOMMENDATIONS (ranked):
${JSON.stringify(c.firstRoundCandidates, null, 1)}`;
}

export function synthesisPrompt(c: Cycle) {
  const critique = c.rounds.find(r => r.round === "CRITIQUE")!.parsed;
  return `You previously proposed ten improvements. An independent reviewer (Claude) critiqued them. Produce the FINAL ranked list of exactly 10.
For each item: rank, continuesCandidateId (the candidateId it continues from your first round, or "NEW" for a new item), ${CANDIDATE_FIELDS}, responseToClaude (how you answered the criticism), changedFromFirstRound (boolean), recommendedPriority (HIGH|MEDIUM|LOW).
Each first-round candidateId may be continued at most once. Return {"candidates":[10 items]}.

EVIDENCE:
${evidenceBlock(c)}

YOUR FIRST-ROUND RECOMMENDATIONS (with candidateIds):
${JSON.stringify(c.firstRoundCandidates, null, 1)}

CLAUDE'S CRITIQUE:
${JSON.stringify(critique, null, 1)}`;
}

export type DeliberationOptions = {
  attempts?: number;
  timeoutMs?: number;
};

async function callWithRetry<T>(
  provider: ModelProvider,
  prompt: string,
  validate: (parsed: unknown) => T,
  opts: DeliberationOptions
): Promise<{ text: string; value: T; attempts: number }> {
  const max = opts.attempts ?? 3;
  let last: unknown;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      const text = await provider.complete({
        system: SYSTEM_BASE,
        prompt:
          attempt === 1
            ? prompt
            : `${prompt}\n\nYour previous reply was rejected: ${String((last as Error)?.message ?? last).slice(0, 500)}. Return valid JSON matching the schema.`,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 300_000),
      });
      return { text, value: validate(parseProviderJson(text)), attempts: attempt };
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`${provider.id}/${provider.model} failed after ${max} attempts: ${(last as Error)?.message}`);
}

function cycleIdShort(cycleId: string) {
  return cycleId.replace(/^cyc_/, "").slice(0, 8);
}

function assertRefs(c: Cycle, refs: string[]) {
  const known = new Set(c.evidence.map(e => e.id));
  for (const r of refs)
    if (!known.has(r)) throw new Error(`Cited evidence id ${r} does not exist (no invented signals)`);
}

export function validateProposal(c: Cycle, parsed: unknown): Candidate[] {
  const out = proposalOutputSchema.parse(parsed);
  if (out.candidates.length !== 10) throw new Error("Expected exactly 10 candidates");
  const sorted = [...out.candidates].sort((a, b) => a.rank - b.rank);
  sorted.forEach((x, i) => {
    assertRefs(c, x.evidenceRefs);
  });
  return sorted.map((x, i) => ({
    ...x,
    rank: i + 1,
    // Stable: positional in the first round, independent of evidence content/order.
    candidateId: `${cycleIdShort(c.cycleId)}-C${String(i + 1).padStart(2, "0")}`,
  }));
}

export function validateSynthesis(c: Cycle, parsed: unknown): Candidate[] {
  const out = synthesisOutputSchema.parse(parsed);
  const first = new Map(c.firstRoundCandidates.map(x => [x.candidateId, x]));
  const used = new Set<string>();
  let nextNew = 11;
  const sorted = [...out.candidates].sort((a, b) => a.rank - b.rank);
  return sorted.map((x, i) => {
    assertRefs(c, x.evidenceRefs);
    let id: string;
    if (x.continuesCandidateId === "NEW") {
      id = `${cycleIdShort(c.cycleId)}-C${String(nextNew++).padStart(2, "0")}`;
    } else {
      const prev = first.get(x.continuesCandidateId);
      if (!prev) throw new Error(`continuesCandidateId ${x.continuesCandidateId} is not a first-round id`);
      if (used.has(prev.candidateId)) throw new Error(`${prev.candidateId} continued twice`);
      used.add(prev.candidateId);
      id = prev.candidateId;
    }
    const prev = first.get(id);
    // Deterministic, code-computed change flag; the model's claim is not trusted.
    const changed =
      !prev ||
      prev.rank !== i + 1 ||
      prev.proposedChange !== x.proposedChange ||
      prev.scope !== x.scope;
    return { ...x, rank: i + 1, candidateId: id, changedFromFirstRound: changed };
  });
}

export type Readiness = { chatgpt: boolean; claude: boolean; ready: boolean };
export function deliberationReadiness(r: ModelRoster): Readiness {
  return { chatgpt: !!r.chatgpt, claude: !!r.claude, ready: !!r.chatgpt && !!r.claude };
}

/**
 * ChatGPT -> Claude -> ChatGPT. Resumable: completed rounds are never re-run, and a
 * missing provider yields DELIBERATION_BLOCKED, never a substitute model.
 */
export async function runDeliberation(
  store: CycleStore,
  cycleId: string,
  roster: ModelRoster,
  opts: DeliberationOptions = {}
): Promise<Cycle> {
  const block = async (reason: string) => {
    await store.update(cycleId, c => {
      c.blockedReason = reason;
      if (c.status !== "DELIBERATION_BLOCKED") setStatus(c, "DELIBERATION_BLOCKED", reason);
    });
    return (await store.get(cycleId))!;
  };
  const resume = async (to: "DELIBERATING_PROPOSAL" | "DELIBERATING_CRITIQUE" | "DELIBERATING_SYNTHESIS") =>
    store.update(cycleId, c => {
      if (c.status !== to) setStatus(c, to, "round started");
      c.blockedReason = null;
    });
  const record = async (
    round: DeliberationRound["round"],
    p: ModelProvider,
    prompt: string,
    started: string,
    r: { text: string; value: unknown; attempts: number },
    after: (c: Cycle) => void
  ) =>
    store.update(cycleId, c => {
      c.rounds.push({
        round,
        provider: p.id,
        model: p.model,
        startedAt: started,
        completedAt: new Date().toISOString(),
        attempts: r.attempts,
        prompt: redactSecrets(prompt),
        responseText: redactSecrets(r.text),
        parsed: r.value,
        evidenceIds: c.evidence.map(e => e.id),
      });
      after(c);
    });

  let c = (await store.get(cycleId))!;
  if (c.deliberationIsFixture) throw new Error("Fixture cycles cannot run live deliberation");

  // Round 1: ChatGPT
  if (!c.rounds.some(r => r.round === "PROPOSAL")) {
    if (!roster.chatgpt) return block("ChatGPT (OpenAI) provider not configured");
    if (roster.chatgpt.family !== "openai") return block("PROPOSAL slot requires an OpenAI provider");
    await resume("DELIBERATING_PROPOSAL");
    c = (await store.get(cycleId))!;
    const prompt = proposalPrompt(c);
    const started = new Date().toISOString();
    try {
      const r = await callWithRetry(roster.chatgpt, prompt, p => validateProposal(c, p), opts);
      await record("PROPOSAL", roster.chatgpt, prompt, started, r, cc => {
        cc.firstRoundCandidates = r.value;
      });
    } catch (e) {
      return block(`PROPOSAL failed: ${(e as Error).message}`);
    }
  }

  // Round 2: Claude critique
  c = (await store.get(cycleId))!;
  if (!c.rounds.some(r => r.round === "CRITIQUE")) {
    if (!roster.claude) return block("Claude (Anthropic) provider not configured");
    if (roster.claude.family !== "anthropic") return block("CRITIQUE slot requires an Anthropic provider");
    await resume("DELIBERATING_CRITIQUE");
    c = (await store.get(cycleId))!;
    const prompt = critiquePrompt(c);
    const started = new Date().toISOString();
    try {
      const r = await callWithRetry(roster.claude, prompt, p => critiqueOutputSchema.parse(p), opts);
      await record("CRITIQUE", roster.claude, prompt, started, r, () => {});
    } catch (e) {
      return block(`CRITIQUE failed: ${(e as Error).message}`);
    }
  }

  // Round 3: ChatGPT synthesis
  c = (await store.get(cycleId))!;
  if (!c.rounds.some(r => r.round === "SYNTHESIS")) {
    const proposer = c.rounds.find(r => r.round === "PROPOSAL")!;
    if (!roster.chatgpt) return block("ChatGPT (OpenAI) provider not configured for synthesis");
    if (roster.chatgpt.id !== proposer.provider)
      return block(`Synthesis must use the same provider as proposal (${proposer.provider})`);
    await resume("DELIBERATING_SYNTHESIS");
    c = (await store.get(cycleId))!;
    const prompt = synthesisPrompt(c);
    const started = new Date().toISOString();
    try {
      const r = await callWithRetry(roster.chatgpt, prompt, p => validateSynthesis(c, p), opts);
      const three = await pickPresidentThree(r.value);
      await record("SYNTHESIS", roster.chatgpt, prompt, started, r, cc => {
        cc.finalCandidates = r.value;
        cc.presidentProposedIds = three.ids;
        cc.presidentRationale = three.rationale;
        setStatus(cc, "PRESIDENT_RECOMMENDED", "final ranked 10 recorded; President selected 3");
      });
    } catch (e) {
      return block(`SYNTHESIS failed: ${(e as Error).message}`);
    }
  }
  return (await store.get(cycleId))!;
}
