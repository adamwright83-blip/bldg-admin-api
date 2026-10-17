/**
 * Runs Brain V3's interpretation concurrently with the work-ledger planner.
 *
 * When the ledger hands a turn back to the conversational pipeline, that
 * pipeline's first step is Brain V3. Starting it at the same moment as the
 * planner keeps the ledger from adding a model round-trip to ordinary turns.
 * The prefetched result is used only if the pipeline asks for exactly the
 * same interpretation input; otherwise it makes its own call, so nothing
 * about V1's semantics changes.
 */
import { interpretClaireBrainV3, type ClaireBrainV3Input } from "../turn/brainV3";

function sameInput(a: ClaireBrainV3Input, b: ClaireBrainV3Input): boolean {
  return (
    a.tenantId === b.tenantId &&
    a.operatorId === b.operatorId &&
    a.utterance === b.utterance &&
    Boolean(a.preparedStrategicProposal) === Boolean(b.preparedStrategicProposal) &&
    a.dayLineSuppressed === b.dayLineSuppressed &&
    JSON.stringify(a.pending) === JSON.stringify(b.pending) &&
    JSON.stringify(a.recentTurns) === JSON.stringify(b.recentTurns)
  );
}

export function prefetchBrainV3(
  predicted: ClaireBrainV3Input,
  interpret: typeof interpretClaireBrainV3 = interpretClaireBrainV3
): { override: typeof interpretClaireBrainV3; used: () => boolean } {
  const pending = interpret(predicted).catch(() => null);
  let used = false;
  return {
    override: async input => {
      if (!used && sameInput(input, predicted)) {
        used = true;
        return pending;
      }
      return interpret(input);
    },
    used: () => used,
  };
}
