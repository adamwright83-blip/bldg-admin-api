import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { presidentCycleCandidateSchema, presidentCycleSchema, type PresidentCycle, type PresidentCycleCandidate } from "../../../shared/presidentCycle";
import type { CompanyEvidence } from "../../../shared/presidentIntelligence";
import { PresidentCycleStore } from "./store";

const candidateListSchema = z.object({ candidates: z.array(presidentCycleCandidateSchema).length(10) }).strict();
const critiqueSchema = z.object({ critique: z.string().min(1).max(20000) }).strict();

export interface PresidentDeliberationProvider {
  readonly actorId: string;
  generate(input: { system: string; prompt: string; schema: z.ZodTypeAny }): Promise<unknown>;
}

function stableCandidateId(title: string, proposedChange: string) {
  return createHash("sha256").update(`${title.trim().toLowerCase()}|${proposedChange.trim().toLowerCase()}`).digest("hex").slice(0, 24);
}
function normalize(candidates: PresidentCycleCandidate[]): PresidentCycleCandidate[] {
  return candidates.map((c, i) => ({ ...c, id: c.id || stableCandidateId(c.title,c.proposedChange), rank:i+1 }));
}

export class PresidentDeliberationOrchestrator {
  constructor(
    private readonly store: PresidentCycleStore,
    private readonly chatgpt: PresidentDeliberationProvider,
    private readonly claude: PresidentDeliberationProvider,
  ) {
    if (!chatgpt.actorId.toLowerCase().includes("openai") && !chatgpt.actorId.toLowerCase().includes("chatgpt"))
      throw new Error("ChatGPT stages require an OpenAI/ChatGPT provider");
    if (!claude.actorId.toLowerCase().includes("claude") && !claude.actorId.toLowerCase().includes("anthropic"))
      throw new Error("Critique stage requires a Claude/Anthropic provider");
  }

  async start(evidence: CompanyEvidence[]): Promise<PresidentCycle> {
    if (!evidence.length) throw new Error("President cycle requires company evidence");
    const now = new Date().toISOString();
    const cycle: PresidentCycle = presidentCycleSchema.parse({
      id: randomUUID(), state:"GATHERING_TRUTH", evidenceIds:evidence.map(e=>e.id),
      chatgptProposal:[], claudeCritique:null, finalCandidates:[], presidentRecommendedIds:[],
      approval:null, blockedReason:null, createdAt:now, updatedAt:now,
    });
    await this.store.put(cycle);
    return this.run(cycle.id, evidence);
  }

  async run(cycleId: string, evidence: CompanyEvidence[]): Promise<PresidentCycle> {
    return this.store.exclusive(cycleId, async () => {
      let cycle = await this.store.get(cycleId);
      if (!cycle) throw new Error("President cycle not found");
      const truth = evidence.map(e => ({id:e.id,kind:e.kind,confidence:e.confidence,statement:e.statement,source:e.source,sourceAt:e.sourceAt}));

      cycle = await this.store.put({...cycle,state:"CHATGPT_PROPOSAL",updatedAt:new Date().toISOString()});
      const proposalRaw = await this.chatgpt.generate({
        system:"You are President's first strategic analyst. Produce exactly ten concrete, evidence-backed JOYSTICK improvements. Do not invent evidence.",
        prompt: JSON.stringify({truth, task:"Rank ten improvements across product, customer experience, security, reliability, architecture, growth, and business performance."}),
        schema:candidateListSchema,
      });
      const proposalParsed = candidateListSchema.parse(proposalRaw);
      const proposal = normalize(proposalParsed.candidates);
      cycle = await this.store.put({...cycle,chatgptProposal:proposal,state:"CLAUDE_CRITIQUE",updatedAt:new Date().toISOString()});

      const critiqueRaw = await this.claude.generate({
        system:"You are the adversarial second opinion. Challenge weak assumptions, duplication, low leverage, unsafe changes, missing evidence and missing alternatives. Do not agree for consensus.",
        prompt: JSON.stringify({truth,chatgptCandidates:proposal}),
        schema:critiqueSchema,
      });
      const critique = critiqueSchema.parse(critiqueRaw).critique;
      cycle = await this.store.put({...cycle,claudeCritique:critique,state:"CHATGPT_SYNTHESIS",updatedAt:new Date().toISOString()});

      const finalRaw = await this.chatgpt.generate({
        system:"You are the final synthesizer. Return exactly ten ranked recommendations after considering Claude's critique. Preserve evidence references. Explain responses to critique in each candidate.",
        prompt: JSON.stringify({truth,original:proposal,claudeCritique:critique}),
        schema:candidateListSchema,
      });
      const finalCandidates = normalize(candidateListSchema.parse(finalRaw).candidates);
      const recommended = finalCandidates.slice(0,3).map(c=>c.id);
      cycle = await this.store.put({...cycle,finalCandidates,presidentRecommendedIds:recommended,state:"AWAITING_ADAM_REVIEW",updatedAt:new Date().toISOString()});
      return cycle;
    });
  }
}
