import { ENV } from "../../_core/env";
import { getDashboardTimeZone } from "../../dashboardZoned";
import { answerWithEncyclopedia } from "../knowledge/encyclopediaAgent";
import type { ClaireTurnDeps } from "./claireTurn";

/**
 * Production wiring shared by the phone route and the desk: the grounded
 * record-lookup answer path is only attached when a model key is configured,
 * so a missing key degrades to deterministic answers, never to guesses.
 */
export function claireEncyclopediaFor(input: { dayDirectorActorId: string }): ClaireTurnDeps["encyclopedia"] {
  if (!ENV.anthropicApiKey?.trim()) return null;
  return ({ tenantId, operatorUserId, utterance, surface, history, context }) =>
    answerWithEncyclopedia({
      tenantId,
      operatorUserId,
      dayDirectorActorId: input.dayDirectorActorId,
      utterance,
      surface,
      history: history.map(entry => ({ speaker: entry.speaker, text: entry.text })),
      now: new Date(),
      timeZone: getDashboardTimeZone(),
      context,
    });
}
