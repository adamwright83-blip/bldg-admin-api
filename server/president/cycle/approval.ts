import { randomUUID } from "node:crypto";
import { presidentApprovalReceiptSchema } from "../../../shared/presidentCycle";
import { PresidentCycleStore } from "./store";

export class PresidentApprovalService {
  constructor(private readonly store: PresidentCycleStore) {}

  async approve(input: { cycleId:string; candidateIds:string[]; founderId:string }) {
    return this.store.exclusive(input.cycleId, async () => {
      const cycle = await this.store.get(input.cycleId);
      if (!cycle) throw new Error("President cycle not found");
      if (cycle.state !== "AWAITING_ADAM_REVIEW") throw new Error("Cycle is not awaiting Adam review");
      if (input.candidateIds.length < 1 || input.candidateIds.length > 3) throw new Error("Adam may approve one to three missions");
      const unique = [...new Set(input.candidateIds)];
      if (unique.length !== input.candidateIds.length) throw new Error("Duplicate approved candidate");
      const finalIds = new Set(cycle.finalCandidates.map(c=>c.id));
      if (unique.some(id=>!finalIds.has(id))) throw new Error("Adam approval contains a candidate outside the final ten");
      const now = new Date().toISOString();
      const approval = presidentApprovalReceiptSchema.parse({
        cycleId:cycle.id, approvedCandidateIds:unique, approvedBy:input.founderId,
        approvedAt:now, receiptId:randomUUID(),
      });
      return this.store.put({...cycle,approval,state:"ADAM_APPROVED",updatedAt:now});
    });
  }

  async otherSeven(cycleId:string) {
    const cycle = await this.store.get(cycleId);
    if (!cycle) throw new Error("President cycle not found");
    const recommended = new Set(cycle.presidentRecommendedIds);
    return cycle.finalCandidates.filter(c=>!recommended.has(c.id));
  }
}
