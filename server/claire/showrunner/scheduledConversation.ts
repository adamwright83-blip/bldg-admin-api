import { conversationHistoryForModel, defaultClaireTurnDeps, runClaireTurn, type ClaireTurnDeps, type ClaireTurnInput, type ClaireTurnResult, type ClaireTurnState } from "../turn/claireTurn";
import { safeClaireBrainV3Fallback } from "../turn/brainV3";
import { runShowrunnerTurn, type ShowrunnerCallState } from "./showrunnerTurn";
import { runWorkLedgerTurn, workLedgerPromptSection } from "../workLedger/workLedgerTurn";
import { isClaireWorkLedgerEnabled } from "../workLedger/workLedgerPlanner";

type ScheduledState = ClaireTurnState & { showrunner?: ShowrunnerCallState | null };
type ShowrunnerOverrides = Pick<Parameters<typeof runShowrunnerTurn>[0], "invoke" | "record" | "approve" | "replan" | "deskReplan" | "business" | "now">;

/** Scheduled calls share accepted instructions and pending work with ordinary calls.
 * Showrunner retains ownership of reports and approval of its exact plan revision.
 */
export async function runScheduledClaireTurn(
  input: ClaireTurnInput & { state: ScheduledState },
  overrides: { turn?: Partial<ClaireTurnDeps>; showrunner?: ShowrunnerOverrides } = {},
): Promise<ClaireTurnResult> {
  const state = input.state;
  if (!state.showrunner) return runClaireTurn(input, overrides.turn);
  const deps = { ...defaultClaireTurnDeps(), ...overrides.turn };
  // Scheduled calls have one work owner too: the ledger runs first (unless the
  // caller already ran it), and neither Showrunner nor V1 writes work after it.
  if (deps.workLedger !== null && isClaireWorkLedgerEnabled()) {
    state.workLedgerOwnsDayLine = true;
    if (!input.workLedgerHandledUpstream && !state.strategicProposalId && input.utterance.trim()) {
      const ledger = await runWorkLedgerTurn(
        {
          tenantId: input.tenantId,
          operatorUserId: input.operatorUserId,
          dayDirectorActorId: input.dayDirectorActorId,
          conversationKey: input.conversationKey,
          surface: input.surface,
          utterance: input.utterance.trim(),
          state,
          timeZone: deps.timeZone(),
          sessionKind: state.showrunner.purpose,
          callFacts: state.workLedgerCallFacts ?? [],
          sourceEventId: input.sourceEventId,
        },
        { now: deps.now, ...(deps.workLedger ?? {}) }
      );
      if (ledger.handled) {
        // Keeps Showrunner's "yes to the immediately prior proposal" shortcut honest.
        state.showrunner.turns += 1;
        return ledger.result;
      }
    }
  }
  const upstream = { ...input, workLedgerHandledUpstream: true };
  const history = state.history ?? [];
  const pending = { briefing: Boolean(state.pendingBriefing), accountFollowUp: Boolean(state.pendingAccountFollowUp),
    action: Boolean(state.pendingProposal || state.pendingUpdate), weeklyPlanning: Boolean(state.weeklyPlanningWeekStart) };
  const semanticInput = { tenantId: input.tenantId, operatorId: input.operatorUserId, utterance: input.utterance,
    recentTurns: conversationHistoryForModel(history), pending, dayLineSuppressed: Boolean(state.dayLineSuppressed) };
  const brain = await deps.brainV3?.(semanticInput).catch(() => null)
    ?? safeClaireBrainV3Fallback(input.utterance, { pending, dayLineSuppressed: Boolean(state.dayLineSuppressed) });
  const workTurn = brain.workDisposition === "propose" || brain.workDisposition === "commit"
    || (brain.target === "pending_briefing" && pending.briefing)
    || (brain.target === "pending_action" && pending.action);
  if (workTurn) {
    // This intervening turn invalidates Showrunner's "yes to the immediately prior proposal" shortcut.
    state.showrunner.turns += 1;
    return runClaireTurn(upstream, { ...overrides.turn, brainV3: async () => brain });
  }

  // Store accepted input even if inference or the business recorder fails.
  const at = deps.now().getTime();
  state.history = [...history, { speaker: "operator" as const, text: input.utterance, at }].slice(-32);
  let turn: Awaited<ReturnType<typeof runShowrunnerTurn>>;
  try {
    turn = await runShowrunnerTurn({ state: state.showrunner, history: conversationHistoryForModel(history), utterance: input.utterance,
      sourceEventId: input.sourceEventId ?? `${input.conversationKey}:${at}`, conversationKey: input.conversationKey,
      ...(state.workLedgerOwnsDayLine
        ? { workLedger: { section: workLedgerPromptSection(state, state.showrunner.businessDate) } }
        : {}),
      ...overrides.showrunner });
  } catch (error) {
    console.error("[Claire] scheduled conversation failed", { errorName: error instanceof Error ? error.name : "UnknownError" });
    turn = { state: state.showrunner, end: false, speak: "I have your last message, but I couldn't finish that response. Nothing new is confirmed saved." };
  }
  state.showrunner = turn.state;
  state.history = [...(state.history ?? []), { speaker: "claire" as const, text: turn.speak, at: deps.now().getTime(), delivery: "generated" as const }].slice(-32);
  const holding = Boolean(state.pendingBriefing || state.pendingProposal || state.pendingAccountFollowUp);
  return { speak: turn.speak, kind: "answered", assembledUtterance: input.utterance, thoughtCompleteness: "complete",
    ...(turn.end && !holding ? { endCall: true, endCallReason: `${state.showrunner.purpose}_complete` } : {}) };
}
