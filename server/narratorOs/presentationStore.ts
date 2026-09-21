import { randomUUID } from "node:crypto";
import type { OperatorScope } from "./store";
import type { NarratorSnapshot } from "./store";
import {
  deriveNarrativePresentationPlan,
  type NarrativePresentationPlan,
} from "./presentationPlan";
import {
  playerPresentationPayload,
  type PlayerPresentationPayload,
} from "./playerPresentation";

/**
 * Presentation receipts are not occurrence-ledger rows.
 * `prepared` means a structured payload was materialized for a surface.
 * `rendered_to_surface` means that payload was returned to a surface caller.
 * Neither state is human perception.
 */
export const PRESENTATION_RECEIPT_STATUSES = [
  "prepared",
  "rendered_to_surface",
] as const;

export type PresentationReceiptStatus =
  (typeof PRESENTATION_RECEIPT_STATUSES)[number];

export type PlayerPresentationReceipt = {
  readonly id: string;
  readonly tenantId: string;
  readonly operatorUserId: string;
  readonly occurrenceLedgerEntryId: string;
  readonly beatId: string;
  readonly presentationId: string;
  readonly status: PresentationReceiptStatus;
  readonly preparedAt: string;
  readonly renderedAt: string | null;
  readonly idempotencyKey: string;
};

export type NarratorPresentationStore = {
  loadForOperator(
    scope: OperatorScope
  ): Promise<readonly PlayerPresentationReceipt[]>;
  findByOccurrence(
    scope: OperatorScope,
    occurrenceLedgerEntryId: string
  ): Promise<PlayerPresentationReceipt | null>;
  insertPrepared(
    receipt: PlayerPresentationReceipt
  ): Promise<PlayerPresentationReceipt>;
  markRendered(input: {
    scope: OperatorScope;
    occurrenceLedgerEntryId: string;
    renderedAt: string;
  }): Promise<PlayerPresentationReceipt | null>;
};

export function presentationIdempotencyKey(
  occurrenceLedgerEntryId: string
): string {
  return `presentation:${occurrenceLedgerEntryId}`;
}

export function createInMemoryNarratorPresentationStore(): NarratorPresentationStore {
  const rows: PlayerPresentationReceipt[] = [];
  return {
    async loadForOperator(scope) {
      return rows.filter(
        row =>
          row.tenantId === scope.tenantId &&
          row.operatorUserId === scope.operatorUserId
      );
    },
    async findByOccurrence(scope, occurrenceLedgerEntryId) {
      return (
        rows.find(
          row =>
            row.tenantId === scope.tenantId &&
            row.operatorUserId === scope.operatorUserId &&
            row.occurrenceLedgerEntryId === occurrenceLedgerEntryId
        ) ?? null
      );
    },
    async insertPrepared(receipt) {
      const existing = rows.find(
        row =>
          row.tenantId === receipt.tenantId &&
          row.idempotencyKey === receipt.idempotencyKey
      );
      if (existing) return existing;
      rows.push(receipt);
      return receipt;
    },
    async markRendered(input) {
      const index = rows.findIndex(
        row =>
          row.tenantId === input.scope.tenantId &&
          row.operatorUserId === input.scope.operatorUserId &&
          row.occurrenceLedgerEntryId === input.occurrenceLedgerEntryId
      );
      if (index < 0) return null;
      const current = rows[index]!;
      if (current.status === "rendered_to_surface") return current;
      const next: PlayerPresentationReceipt = {
        ...current,
        status: "rendered_to_surface",
        renderedAt: input.renderedAt,
      };
      rows[index] = next;
      return next;
    },
  };
}

export type PreparedPlayerPresentation = {
  readonly plan: NarrativePresentationPlan;
  readonly payload: PlayerPresentationPayload;
  readonly receipt: PlayerPresentationReceipt;
};

/**
 * Presentation boundary: materialize a payload and record `prepared`.
 * Refuses when the occurrence cannot legally surface. Does not write the
 * occurrence ledger, knowledge, or business truth.
 */
export async function preparePlayerPresentation(input: {
  presentationStore: NarratorPresentationStore;
  snapshot: NarratorSnapshot;
  nowIso: string;
}): Promise<PreparedPlayerPresentation | null> {
  const fired = [...input.snapshot.ledger]
    .reverse()
    .find(entry => entry.kind === "FIRED_AUTHORED_BEAT");
  return prepareOccurrence(input, fired?.id);
}

export async function preparePlayerPresentationForOccurrence(input: {
  presentationStore: NarratorPresentationStore;
  snapshot: NarratorSnapshot;
  occurrenceLedgerEntryId: string;
  nowIso: string;
}): Promise<PreparedPlayerPresentation | null> {
  return prepareOccurrence(input, input.occurrenceLedgerEntryId);
}

async function prepareOccurrence(
  input: {
    presentationStore: NarratorPresentationStore;
    snapshot: NarratorSnapshot;
    nowIso: string;
  },
  occurrenceLedgerEntryId: string | undefined
): Promise<PreparedPlayerPresentation | null> {
  if (!occurrenceLedgerEntryId) return null;
  const plan = deriveNarrativePresentationPlan(
    input.snapshot,
    occurrenceLedgerEntryId
  );
  const payload = playerPresentationPayload(plan);
  if (!plan || !payload) return null;
  const existing = await input.presentationStore.findByOccurrence(
    input.snapshot,
    plan.occurrenceLedgerEntryId
  );
  if (existing) {
    return Object.freeze({ plan, payload, receipt: existing });
  }
  const receipt = await input.presentationStore.insertPrepared({
    id: randomUUID(),
    tenantId: input.snapshot.tenantId,
    operatorUserId: input.snapshot.operatorUserId,
    occurrenceLedgerEntryId: plan.occurrenceLedgerEntryId,
    beatId: plan.beatId,
    presentationId: plan.presentationId,
    status: "prepared",
    preparedAt: input.nowIso,
    renderedAt: null,
    idempotencyKey: presentationIdempotencyKey(plan.occurrenceLedgerEntryId),
  });
  return Object.freeze({ plan, payload, receipt });
}

export type RenderedPlayerPresentation = {
  readonly payload: PlayerPresentationPayload;
  readonly receipt: PlayerPresentationReceipt;
};

/**
 * Returns the structured payload to a surface and records
 * `rendered_to_surface` only when a prepared receipt already exists.
 * The return is evidence the payload was handed to a caller. It is not
 * evidence a person perceived it.
 */
export async function renderPlayerPresentationToSurface(input: {
  presentationStore: NarratorPresentationStore;
  snapshot: NarratorSnapshot;
  occurrenceLedgerEntryId: string;
  nowIso: string;
}): Promise<RenderedPlayerPresentation | null> {
  const prepared = await input.presentationStore.findByOccurrence(
    input.snapshot,
    input.occurrenceLedgerEntryId
  );
  if (!prepared) return null;
  const plan = deriveNarrativePresentationPlan(
    input.snapshot,
    input.occurrenceLedgerEntryId
  );
  const payload = playerPresentationPayload(plan);
  if (!plan || !payload || plan.presentationId !== prepared.presentationId) {
    return null;
  }
  const receipt = await input.presentationStore.markRendered({
    scope: input.snapshot,
    occurrenceLedgerEntryId: input.occurrenceLedgerEntryId,
    renderedAt: input.nowIso,
  });
  if (!receipt || receipt.status !== "rendered_to_surface") return null;
  return Object.freeze({ payload, receipt });
}
