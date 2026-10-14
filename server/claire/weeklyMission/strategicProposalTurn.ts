import { parseStrategicProposalControl } from "../../../shared/strategicProposalControl";
import { addDaysYmd } from "../../../shared/weeklyMissionReadiness";
import type { WeeklyPlanningSession } from "./session";
import { clearWeeklySession, saveWeeklySession } from "./session";
import {
  loadStrategicProposal,
  latestStrategicProposal,
  originalStrategicProposal,
  strategicResponses,
} from "../../strategy/strategicStore";
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
  const current = await latestStrategicProposal(resolved.identity, p.weekStart);
  if (current?.id !== p.id)
    return {
      speak:
        "This proposal was superseded. Refresh the prepared recommendation before deciding. No work was added.",
      act: "REVISE",
      actionIds: [],
    };
  const control = parseStrategicProposalControl(input.utterance);
  const selectedOption = p.diagnosis.options.find(
    o => o.id === p.diagnosis.selectedOptionId
  );
  const alternative = p.diagnosis.options.find(
    o => o.id !== p.diagnosis.selectedOptionId
  );
  // Spoken answers come from the diagnosis content, never from its internal labels.
  const plain = (text: string | undefined) =>
    (text ?? "").replace(/^(Preferred|Not preferred[^:]*):\s*/i, "").trim();
  const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
  const basis = selectedOption?.observedBasis ?? p.diagnosis.currentCondition;
  if (
    control?.kind === "why" ||
    control?.kind === "numbers" ||
    control?.kind === "alternative" ||
    control?.kind === "economics"
  ) {
    const explanation =
      control.kind === "numbers"
        ? `${basis} That rests on: ${p.diagnosis.evidence
            .filter(e => e.value !== null && e.unit !== "prospect_presence")
            .slice(0, 8)
            .map(e => `${e.description} (${typeof e.value === "number" && /cents/.test(e.unit) ? `$${(e.value / 100).toFixed(2)}` : String(e.value)})`)
            .join("; ")}. ${selectedOption?.uncertainty ?? ""}`
        : control.kind === "alternative"
          ? alternative
            ? `The alternative is to ${lower(alternative.approach)}. I'm not leading with it because ${lower(plain(alternative.reason))} ${alternative.expectedBenefit ?? ""}`
            : "I haven't found a supported alternative yet."
          : control.kind === "economics"
            ? `I do not know that this will make money. ${selectedOption?.expectedBenefit ?? ""} ${selectedOption?.economics ?? ""}`
            : `${p.diagnosis.objective ? `${basis} ` : ""}${p.diagnosis.diagnosis} So I'd start with this: ${lower(p.diagnosis.selectedApproach)}, because ${lower(plain(selectedOption?.reason))} ${selectedOption?.expectedBenefit ?? ""}${
                alternative ? ` I didn't lead with ${lower(alternative.approach)} because ${lower(plain(alternative.reason))}` : ""
              } ${selectedOption?.uncertainty ?? ""}`;
    return {
      speak: explanation.replace(/\s+/g, " ").replace(/\.\./g, ".").trim(),
      act: "AWAIT_CONFIRMATION",
      actionIds: [],
    };
  }
  if (control?.kind === "original") {
    const original = await originalStrategicProposal(
      resolved.identity,
      p.weekStart
    );
    return {
      speak: original
        ? `Our original stored proposal was: ${original.items.map(i => `${i.businessDate}: ${i.title}`).join("; ")}. The currently held revision remains pending until explicitly approved.`
        : "I cannot verify an original stored proposal.",
      act: "AWAIT_CONFIRMATION",
      actionIds: [],
    };
  }
  if (control?.kind === "reminder")
    return {
      speak: `I still have the stored proposal and its revisions. ${p.items.map(i => `${i.businessDate}: ${i.title}`).join("; ")}. I cannot infer which earlier statement you mean; name it and I will check the record.`,
      act: "AWAIT_CONFIRMATION",
      actionIds: [],
    };
  if (control?.kind === "title" || control?.kind === "move") {
    const item =
      control.kind === "title" || control.index !== null
        ? p.items[control.index! - 1]
        : (p.items.find(i => i.id === input.session.strategicFocusedItemId) ??
          (p.items.length === 1 ? p.items[0] : undefined));
    if (!item)
      return {
        speak:
          "Which proposal item should I revise? Please name its number. No work was added.",
        act: "REVISE",
        actionIds: [],
      };
    if (
      (await strategicResponses(resolved.identity, p.id)).some(
        r => r.action === "approve"
      )
    )
      return {
        speak:
          "This proposal already has accepted work. Change those commitments through the Day Line; I have not moved or rewritten anything.",
        act: "REVISE",
        actionIds: [],
      };
    const revised = await reviseStrategicProposal({
      identity: resolved.identity,
      proposalId: p.id,
      revision: p.revision,
      itemId: item.id,
      title: control.kind === "title" ? control.title : item.title,
      businessDate:
        control.kind === "move"
          ? addDaysYmd(p.weekStart, control.weekday)
          : undefined,
      now: input.now,
      source: "authenticated_voice",
    });
    input.session.strategicFocusedItemId = item.id;
    input.session.draft.pendingRecommendation = {
      proposalId: revised.id,
      revision: revised.revision,
      opening: revised.opening,
    };
    await saveWeeklySession(input.session);
    return {
      speak: revised.opening,
      act: "REVISE",
      actionIds: [],
      presentedRecommendation: input.session.draft.pendingRecommendation,
    };
  }
  if (control?.kind === "approve") {
    const numbers = control.selection === "all" ? null : control.selection;
    const ids = numbers
      ? numbers
          .map(n => p.items[n - 1]?.id)
          .filter((id): id is string => Boolean(id))
      : p.items.map(i => i.id);
    if (!ids.length || (numbers && ids.length !== numbers.length))
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
    if (ids.length === 1) {
      input.session.strategicFocusedItemId = ids[0];
      await saveWeeklySession(input.session);
    }
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
  if (control?.kind === "reject" || control?.kind === "defer") {
    const result = await respondToStrategicProposal({
      identity: resolved.identity,
      proposalId: p.id,
      revision: p.revision,
      action: control.kind,
      source: "authenticated_voice",
      now: input.now,
    });
    await clearWeeklySession(input.session);
    return { speak: result.speech, act: "CANCEL", actionIds: [] };
  }
  return {
    speak:
      "The stored proposal is still pending. Name the item numbers to approve or revise, explicitly approve the plan, reject, defer, or ask about the evidence. No work was added.",
    act: "AWAIT_CONFIRMATION",
    actionIds: [],
  };
}
