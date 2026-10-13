import type { WeeklyPlanningSession } from "./session";
import { clearWeeklySession, saveWeeklySession } from "./session";
import { loadStrategicProposal } from "../../strategy/strategicStore";
import {
  respondToStrategicProposal,
  reviseStrategicProposal,
} from "../../strategy/strategicApproval";
import { resolveCanonicalOperatorIdentity } from "../../agents/persistentOperator/identity";
import type { WeeklyRouteResult, WeeklyTurnIntent } from "./route";

/** Operates only on the revision the weekly session actually presented. */
export async function routeStrategicProposalTurn(input: {
  session: WeeklyPlanningSession;
  utterance: string;
  intent: WeeklyTurnIntent;
  now: Date;
}): Promise<WeeklyRouteResult> {
  const pending = input.session.draft.pendingRecommendation!;
  const resolved = await resolveCanonicalOperatorIdentity({
    tenantId: input.session.tenantId,
    source: { type: "open_id", value: input.session.operatorId },
    subsystem: "weekly.strategic_approval",
  });
  if (!resolved.ok) throw new Error("Canonical approving operator unavailable");
  const p = await loadStrategicProposal(resolved.identity, pending.proposalId);
  if (!p || p.revision !== pending.revision)
    return {
      speak:
        "I cannot verify the prepared proposal revision. No work was added.",
      act: "REVISE",
      actionIds: [],
    };
  if (Date.parse(p.expiresAt) <= input.now.getTime())
    return {
      speak:
        "That proposal is stale. I need to refresh its evidence before approval. No work was added.",
      act: "REVISE",
      actionIds: [],
    };
  const text = input.utterance.trim();
  if (/\b(?:why|explain|evidence|alternatives)\b/i.test(text))
    return {
      speak: `${p.diagnosis.diagnosis} I selected ${p.diagnosis.selectedApproach} because ${p.diagnosis.options[0]?.reason} I also considered ${p.diagnosis.options[1]?.approach}. Evidence: ${p.diagnosis.supportingEvidence.join(", ")}. ${p.uncertainty.join(" ")}`,
      act: "AWAIT_CONFIRMATION",
      actionIds: [],
    };
  const revision = /^change item (\d+) to (.+)$/i.exec(text);
  if (revision) {
    const item = p.items[Number(revision[1]) - 1];
    if (!item)
      return {
        speak: "That item number is outside this proposal.",
        act: "REVISE",
        actionIds: [],
      };
    const revised = await reviseStrategicProposal({
      identity: resolved.identity,
      proposalId: p.id,
      revision: p.revision,
      itemId: item.id,
      title: revision[2]!,
      now: input.now,
      source: "authenticated_voice",
    });
    input.session.draft.pendingRecommendation = {
      proposalId: revised.id,
      revision: revised.revision,
      opening: revised.opening,
    };
    await saveWeeklySession(input.session);
    return { speak: revised.opening, act: "REVISE", actionIds: [] };
  }
  const selected = /^approve (?:only )?items? ([\d,\sand]+)$/i.exec(text);
  const explicitAll =
    /^(?:approve (?:the )?(?:plan|proposal|all items)|accept (?:the )?(?:plan|proposal))\.?$/i.test(
      text
    );
  if (input.intent === "weekly_lock" || explicitAll || selected) {
    const ids = selected
      ? [...new Set(selected[1]!.match(/\d+/g)?.map(n => Number(n)) ?? [])]
          .map(n => p.items[n - 1]?.id)
          .filter((id): id is string => Boolean(id))
      : p.items.map(i => i.id);
    if (
      selected &&
      ids.length !== new Set(selected[1]!.match(/\d+/g) ?? []).size
    )
      return {
        speak:
          "The selected item numbers do not match this proposal. No work was added.",
        act: "REVISE",
        actionIds: [],
      };
    const result = await respondToStrategicProposal({
      identity: resolved.identity,
      proposalId: p.id,
      revision: p.revision,
      action: "approve",
      itemIds: ids,
      source: "authenticated_voice",
      now: input.now,
    });
    if (!result.failedItems.length && ids.length === p.items.length)
      await clearWeeklySession(input.session);
    return {
      speak: result.speech,
      receiptBackedCommit: result.actionIds.length ? result.speech : undefined,
      mutationReceipts: result.actionIds.map(id => ({
        claimedState: "created",
        entityId: id,
        statement: "Approved commitment independently verified",
      })),
      actionIds: result.actionIds,
      act: result.failedItems.length ? "REVISE" : "AWAIT_CONFIRMATION",
    };
  }
  if (
    input.intent === "weekly_cancel" ||
    /^(?:reject (?:the )?(?:plan|proposal)|defer(?: (?:the )?(?:decision|plan|proposal))?)\.?$/i.test(
      text
    )
  ) {
    const action = /^defer/i.test(text) ? "defer" : "reject";
    const result = await respondToStrategicProposal({
      identity: resolved.identity,
      proposalId: p.id,
      revision: p.revision,
      action,
      source: "authenticated_voice",
      now: input.now,
    });
    await clearWeeklySession(input.session);
    return { speak: result.speech, act: "CANCEL", actionIds: [] };
  }
  return {
    speak:
      "The stored proposal is still pending. Approve the plan, approve item numbers, say change item number to a revised title, reject, defer, or ask why.",
    act: "AWAIT_CONFIRMATION",
    actionIds: [],
  };
}
