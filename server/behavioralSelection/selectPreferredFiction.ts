import type { ActionGrammar } from "../../shared/actionGrammar";
import type { OperatorDeclaredBarrier } from "../../shared/behavioralEvidence";
import {
  selectPreferredFictionPresentation,
  type FictionSelectionDecision,
} from "../../shared/behavioralFictionSelection";
import type { FictionTemplate } from "../../shared/fictionTemplate";
import {
  listBehavioralLedgerEventsForOperatorSource,
  type BehavioralLedgerStore,
} from "../behavioralLedger/behavioralLedger";

/**
 * Server entry: load tenant-scoped ledger rows, then run the shared selector.
 * Does not write ledger rows (completed history stays immutable).
 * Registry is passed in so this module never imports the client fiction pack.
 */
export async function selectPreferredFictionForTask(input: {
  tenantId: string;
  operatorUserId: string;
  sourceEntityId: string;
  grammar: ActionGrammar;
  registry: readonly FictionTemplate[];
  declaredBarriers?: readonly OperatorDeclaredBarrier[];
  decisionPointId?: string;
  store?: BehavioralLedgerStore;
}): Promise<FictionSelectionDecision> {
  const rows = await listBehavioralLedgerEventsForOperatorSource(
    input.tenantId,
    input.operatorUserId,
    input.sourceEntityId,
    input.store
  );
  return selectPreferredFictionPresentation({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    sourceEntityId: input.sourceEntityId,
    grammar: input.grammar,
    registry: input.registry,
    declaredBarriers: input.declaredBarriers,
    decisionPointId: input.decisionPointId,
    events: rows.map(row => ({
      tenantId: row.tenantId,
      operatorUserId: row.operatorUserId,
      eventType: row.eventType,
      sourceEntityId: row.sourceEntityId,
      correlationId: row.correlationId,
    })),
  });
}
