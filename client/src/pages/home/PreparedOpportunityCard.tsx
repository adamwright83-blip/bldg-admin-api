import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  presentPreparedOpportunity,
  type PreparedOpportunity,
} from "@shared/preparedOpportunity";

export function usePreparedOpportunity(): PreparedOpportunity | null {
  const mission = trpc.system.weeklyMission.deskMission.useQuery(undefined, {
    retry: false,
    staleTime: 15_000,
  });
  return presentPreparedOpportunity(mission.data);
}

/**
 * One prepared recommendation, still waiting. Approval calls the existing
 * strategic-proposal mutation, which is what writes the Day Director commitment.
 */
export function PreparedOpportunityCard({ className = "" }: { className?: string }) {
  const utils = trpc.useUtils();
  const opportunity = usePreparedOpportunity();
  const respond = trpc.system.weeklyMission.respondToPreparedProposal.useMutation();
  const [state, setState] = useState<{ kind: "idle" | "saving" | "done" | "error"; text?: string }>({
    kind: "idle",
  });

  if (!opportunity) {
    if (state.kind === "done" && state.text) {
      return (
        <section className={className} data-testid="prepared-opportunity-result">
          <p>{state.text}</p>
        </section>
      );
    }
    return null;
  }

  async function approve() {
    if (!opportunity) return;
    setState({ kind: "saving" });
    try {
      const fresh = await utils.system.weeklyMission.deskMission.fetch();
      const scope = fresh.pendingApproval;
      if (!scope || !scope.itemIds.includes(opportunity.itemId)) {
        throw new Error("This recommendation changed. Review it again before approving.");
      }
      const result = await respond.mutateAsync({
        proposalId: scope.proposalId,
        revision: scope.revision,
        action: "approve",
        itemIds: [opportunity.itemId],
      });
      if (result.failedItems.length) throw new Error(result.speech);
      setState({ kind: "done", text: result.speech });
    } catch (error) {
      setState({
        kind: "error",
        text: error instanceof Error ? error.message : "Approval was not saved. Nothing changed.",
      });
    } finally {
      await Promise.all([
        utils.system.weeklyMission.deskMission.invalidate(),
        utils.system.weeklyMission.preparedProposal.invalidate(),
        utils.system.dayDirector.state.invalidate(),
      ]);
    }
  }

  return (
    <section className={className} data-testid="prepared-opportunity" data-proposal-id={opportunity.proposalId}>
      <p data-testid="prepared-opportunity-status">Not on the Day Line until you approve it.</p>
      <h2>{opportunity.title}</h2>
      <p data-testid="prepared-opportunity-reason">{opportunity.reason}</p>
      {opportunity.approach ? <p>{opportunity.approach}</p> : null}
      {opportunity.objective ? <p>{opportunity.objective}</p> : null}
      <button type="button" onClick={() => void approve()} disabled={state.kind === "saving" || state.kind === "done"}>
        {state.kind === "saving" ? "Saving…" : "Approve"}
      </button>
      {state.text ? <p data-testid="prepared-opportunity-result">{state.text}</p> : null}
    </section>
  );
}
