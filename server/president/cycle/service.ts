import type { RowDataPacket } from "mysql2/promise";
import { createHash } from "node:crypto";
import {
  presidentCandidateListSchema,
  presidentClaudeCritiqueSchema,
  presidentApprovalReceiptSchema,
  type PresidentCandidateList,
  type PresidentCycle,
} from "../../../shared/presidentCycle";
import type { CompanyEvidence } from "../../../shared/presidentIntelligence";
import { MysqlPresidentIntelligenceStore } from "../intelligenceStore";
import { MysqlPresidentCycleStore } from "./store";
import {
  ClaudePresidentCycleProvider,
  OpenAIPresidentCycleProvider,
  parseModelJson,
  type PresidentCycleModelProvider,
} from "./providers";

const canonical = (value: unknown) => JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertEvidenceReferences(
  candidates: PresidentCandidateList,
  evidence: CompanyEvidence[]
): void {
  const allowed = new Set(evidence.map(item => item.id));
  for (const candidate of candidates.candidates) {
    if (candidate.evidenceIds.some(id => !allowed.has(id)))
      throw new Error(
        `President candidate ${candidate.id} cites evidence outside the cycle snapshot`
      );
  }
}

function sorted(candidateList: PresidentCandidateList): PresidentCandidateList {
  return {
    ...candidateList,
    candidates: [...candidateList.candidates].sort((a, b) => a.rank - b.rank),
  };
}

function evidencePayload(evidence: CompanyEvidence[]) {
  return evidence.map(item => ({
    id: item.id,
    source: item.source,
    capturedAt: item.capturedAt,
    sourceAt: item.sourceAt,
    kind: item.kind,
    statement: item.statement,
    confidence: item.confidence,
    availability: item.availability,
  }));
}

const proposalSystem = `You are ChatGPT advising JOYSTICK's President seat.
Use only the supplied company evidence. Do not invent customers, incidents, metrics, architecture defects, security findings, or product behavior.
Return exactly 10 ranked concrete improvements across product, customer experience, security, reliability, architecture, internal tooling, growth, and business performance.
Every candidate must cite supplied evidence IDs.
Prefer bounded executable changes over generic strategy.
Do not route work to Mitch. Mitch is a separate seat reporting directly to Adam.
Return JSON only with this shape:
{
  "summary": "...",
  "candidates": [{
    "id": "stable-short-id",
    "rank": 1,
    "title": "...",
    "problem": "...",
    "evidenceIds": ["..."],
    "proposedChange": "...",
    "expectedOutcome": "...",
    "risk": "...",
    "dependencies": ["..."],
    "executionDomain": "ENGINEERING|RESEARCH|ANALYSIS|DOCUMENTATION|OTHER",
    "roughScope": "...",
    "whyNow": "...",
    "successCriteria": ["..."],
    "responseToCritique": "",
    "changedAfterCritique": false
  }]
}`;

const critiqueSystem = `You are Claude acting as an adversarial reviewer of ChatGPT's JOYSTICK improvement list.
Use the supplied evidence and candidate list. Challenge weak assumptions, duplicate ideas, low-leverage work, architecture/security risk, unsupported customer claims, and missing opportunities.
Do not agree merely for consensus. Do not route work to Mitch.
Return JSON only:
{
  "summary": "...",
  "critiques": [{
    "candidateId": "...",
    "verdict": "KEEP|LOWER|RAISE|REPLACE|REJECT",
    "reasoning": "...",
    "risks": ["..."],
    "suggestedAlternative": null
  }],
  "missingOpportunities": ["..."]
}`;

const synthesisSystem = `You are ChatGPT making the final synthesis for JOYSTICK's President seat.
You receive the original ranked 10, Claude's adversarial critique, and the same evidence.
Return the final ranked 10. Incorporate valid criticism but do not change recommendations merely to create agreement.
Retain original candidate IDs for ideas that remain materially the same. Use a new unique ID only for a materially new replacement.
Every candidate must cite supplied evidence IDs. Do not route work to Mitch.
Return the exact same candidate-list JSON shape as the first round.
For each candidate set responseToCritique and changedAfterCritique truthfully.`;

export class PresidentCycleService {
  constructor(
    private readonly store: MysqlPresidentCycleStore,
    private readonly intelligence: MysqlPresidentIntelligenceStore,
    private readonly openai: PresidentCycleModelProvider = new OpenAIPresidentCycleProvider(),
    private readonly claude: PresidentCycleModelProvider = new ClaudePresidentCycleProvider()
  ) {}

  async gatherCurrentCompanyTruth(limit = 50): Promise<string[]> {
    const bounded = Math.max(1, Math.min(50, Math.trunc(limit)));
    const [rows] = await this.intelligence.pool.query<RowDataPacket[]>(
      `SELECT id FROM president_evidence
       WHERE origin=? AND availability='AVAILABLE'
         AND (expiresAt IS NULL OR expiresAt>NOW(3))
       ORDER BY capturedAt DESC,id DESC LIMIT ?`,
      [this.intelligence.origin, bounded]
    );
    return rows.map(row => row.id);
  }

  async startFromCurrentCompanyTruth(): Promise<PresidentCycle> {
    const evidenceIds = await this.gatherCurrentCompanyTruth(50);
    if (!evidenceIds.length)
      throw new Error("President has no current company evidence to deliberate on");
    return this.createAndDeliberate(evidenceIds);
  }

  async maybeStartScheduledCycle(now = new Date()): Promise<PresidentCycle | null> {
    const latest = await this.store.latestCycle();
    if (
      latest &&
      !["COMPLETED", "BLOCKED", "READY_FOR_HUMAN"].includes(latest.state)
    )
      return null;
    const intervalHours = Math.max(
      1,
      Number(process.env.PRESIDENT_CYCLE_INTERVAL_HOURS?.trim() || 24)
    );
    if (
      latest &&
      now.getTime() - new Date(latest.createdAt).getTime() <
        intervalHours * 60 * 60 * 1000
    )
      return null;
    const readiness = await this.readiness();
    if (!readiness.chatgpt || !readiness.claude) return null;
    const evidenceIds = await this.gatherCurrentCompanyTruth(50);
    if (!evidenceIds.length) return null;
    return this.createAndDeliberate(evidenceIds);
  }

  async createAndDeliberate(evidenceIds: string[]): Promise<PresidentCycle> {
    const uniqueIds = [...new Set(evidenceIds)];
    if (!uniqueIds.length || uniqueIds.length > 50)
      throw new Error("President cycle requires 1-50 evidence IDs");
    const evidence = await this.intelligence.evidence(uniqueIds);
    if (evidence.length !== uniqueIds.length)
      throw new Error("President cycle evidence snapshot is incomplete");
    if (evidence.some(item => item.origin !== this.intelligence.origin))
      throw new Error("President cycle cannot mix evidence origins");

    const cycle = await this.store.createCycle(uniqueIds);
    try {
      const proposalInput = {
        evidence: evidencePayload(evidence),
        instruction:
          "Produce ten ranked improvements grounded only in the supplied evidence.",
      };
      const proposalResult = await this.openai.generate({
        system: proposalSystem,
        prompt: JSON.stringify(proposalInput),
      });
      const initial = sorted(
        presidentCandidateListSchema.parse(parseModelJson(proposalResult.text))
      );
      assertEvidenceReferences(initial, evidence);
      await this.store.recordRound({
        cycleId: cycle.id,
        stage: "CHATGPT_PROPOSAL",
        provider: proposalResult.provider,
        model: proposalResult.model,
        providerRunId: proposalResult.providerRunId,
        inputHash: hash(proposalInput),
        output: initial,
      });
      await this.store.updateCycle(cycle.id, { initialCandidates: initial });

      const critiqueInput = {
        evidence: evidencePayload(evidence),
        candidates: initial,
      };
      const critiqueResult = await this.claude.generate({
        system: critiqueSystem,
        prompt: JSON.stringify(critiqueInput),
      });
      const critique = presidentClaudeCritiqueSchema.parse(
        parseModelJson(critiqueResult.text)
      );
      const initialIds = new Set(initial.candidates.map(item => item.id));
      if (critique.critiques.some(item => !initialIds.has(item.candidateId)))
        throw new Error("Claude critique references a candidate outside ChatGPT's ten");
      await this.store.recordRound({
        cycleId: cycle.id,
        stage: "CLAUDE_CRITIQUE",
        provider: critiqueResult.provider,
        model: critiqueResult.model,
        providerRunId: critiqueResult.providerRunId,
        inputHash: hash(critiqueInput),
        output: critique,
      });
      await this.store.updateCycle(cycle.id, { claudeCritique: critique });

      const synthesisInput = {
        evidence: evidencePayload(evidence),
        originalCandidates: initial,
        claudeCritique: critique,
      };
      const synthesisResult = await this.openai.generate({
        system: synthesisSystem,
        prompt: JSON.stringify(synthesisInput),
      });
      const finalCandidates = sorted(
        presidentCandidateListSchema.parse(parseModelJson(synthesisResult.text))
      );
      assertEvidenceReferences(finalCandidates, evidence);
      await this.store.recordRound({
        cycleId: cycle.id,
        stage: "CHATGPT_SYNTHESIS",
        provider: synthesisResult.provider,
        model: synthesisResult.model,
        providerRunId: synthesisResult.providerRunId,
        inputHash: hash(synthesisInput),
        output: finalCandidates,
      });

      const proposedCandidateIds = finalCandidates.candidates
        .slice(0, 3)
        .map(candidate => candidate.id);
      return this.store.updateCycle(cycle.id, {
        state: "AWAITING_ADAM_REVIEW",
        finalCandidates,
        proposedCandidateIds,
        blockReason: null,
      });
    } catch (error) {
      await this.store.updateCycle(cycle.id, {
        state: "BLOCKED",
        blockReason:
          error instanceof Error ? error.message : "President deliberation failed",
      });
      throw error;
    }
  }

  async approve(input: {
    cycleId: string;
    founderId: string;
    approvedCandidateIds: string[];
  }): Promise<PresidentCycle> {
    const unique = [...new Set(input.approvedCandidateIds)];
    if (unique.length < 1 || unique.length > 3)
      throw new Error("Adam approval must contain one to three candidate IDs");

    return this.store.transaction(async store => {
      const cycle = await store.getCycle(input.cycleId, true);
      if (!cycle) throw new Error("President cycle not found");
      if (cycle.state !== "AWAITING_ADAM_REVIEW")
        throw new Error("President cycle must pass through AWAITING_ADAM_REVIEW");
      if (!cycle.finalCandidates)
        throw new Error("President cycle has no final ranked ten");
      const finalIds = new Set(cycle.finalCandidates.candidates.map(item => item.id));
      if (unique.some(id => !finalIds.has(id)))
        throw new Error("Adam approval contains a candidate outside the final ten");

      const approvedAt = new Date().toISOString();
      const receiptBase = {
        cycleId: cycle.id,
        founderId: input.founderId,
        approvedCandidateIds: unique,
        approvedAt,
      };
      const approval = presidentApprovalReceiptSchema.parse({
        ...receiptBase,
        receiptSha256: createHash("sha256")
          .update(JSON.stringify(receiptBase))
          .digest("hex"),
      });

      await store.createMissions(
        cycle.id,
        cycle.finalCandidates.candidates,
        approval
      );
      return store.updateCycle(cycle.id, {
        state: "ADAM_APPROVED",
        approval,
        blockReason: null,
      });
    });
  }

  async otherSeven(cycleId: string) {
    const cycle = await this.store.getCycle(cycleId);
    if (!cycle?.finalCandidates)
      throw new Error("President cycle has no final ranked ten");
    const proposed = new Set(cycle.proposedCandidateIds);
    return cycle.finalCandidates.candidates.filter(item => !proposed.has(item.id));
  }

  async readiness() {
    return {
      chatgpt: await this.openai.available(),
      claude: await this.claude.available(),
      sequence: ["CHATGPT_PROPOSAL", "CLAUDE_CRITIQUE", "CHATGPT_SYNTHESIS"] as const,
    };
  }
}
