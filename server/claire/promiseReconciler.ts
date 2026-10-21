/**
 * Keeps or removes the promises in a line Claire is about to speak.
 *
 * (a) A promise the server can back is backed first, then spoken: "I'll have the open property visits
 *     ready" prepares a claire_prepared_items row the next call's opening reads.
 * (b) Everything else is stripped by promiseGuard and never spoken.
 */
import { formatInTimeZone } from "date-fns-tz";
import { addDaysYmd } from "../analytics/businessPeriods";
import { resolveCanonicalOperatorIdentity } from "../agents/persistentOperator/identity";
import {
  drizzlePreparedItemStore,
  PREPARED_PROPERTY_VISIT_CHOICE,
  type PreparedItemRecord,
  type PreparedItemStore,
} from "../agents/persistentOperator/preparedItems";
import { getClaireCampaignSummary, type ClaireCampaignSummary } from "./campaignAwareness";
import { findPromiseSentences, lintAndStripUnbackedPromises, type PromiseBacking } from "./promiseGuard";

export type PromiseScope = {
  tenantId: string;
  canonicalOperatorId: string;
  dayDirectorActorId: string;
  dayDirectorActorIds: string[];
};

export type PromiseReconcileDeps = {
  store?: PreparedItemStore;
  loadCampaign?: (scope: PromiseScope) => Promise<ClaireCampaignSummary | null>;
};

export type ReconciledSpeech = {
  text: string;
  prepared: PreparedItemRecord[];
  removed: string[];
  emptied: boolean;
};

const PROPERTY_VISIT_SENTENCE = /\b(?:propert(?:y|ies)|visits?|greystar|buildings?)\b/i;

export function businessDateForPreparedItem(now: Date, timeZone: string): string {
  const today = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const hour = Number(formatInTimeZone(now, timeZone, "H"));
  // A promise made in the afternoon or evening is for tomorrow morning; a morning promise is for today.
  return hour >= 12 ? addDaysYmd(today, 1) : today;
}

/** Prepares tomorrow's property-visit choice from the live campaign. Null when there is nothing real to prepare. */
export async function preparePropertyVisitChoice(
  input: { scope: PromiseScope; conversationKey: string; promiseText: string; now: Date; timeZone: string },
  deps: PromiseReconcileDeps = {}
): Promise<PreparedItemRecord | null> {
  const loadCampaign =
    deps.loadCampaign ??
    ((scope: PromiseScope) =>
      getClaireCampaignSummary({ tenantId: scope.tenantId, actorId: scope.dayDirectorActorId, actorIds: scope.dayDirectorActorIds }));
  const campaign = await loadCampaign(input.scope).catch(() => null);
  if (!campaign || !campaign.active || campaign.remainingTargets.length === 0) return null;
  return (deps.store ?? drizzlePreparedItemStore()).upsert({
    tenantId: input.scope.tenantId,
    canonicalOperatorId: input.scope.canonicalOperatorId,
    kind: PREPARED_PROPERTY_VISIT_CHOICE,
    forBusinessDate: businessDateForPreparedItem(input.now, input.timeZone),
    promiseText: input.promiseText,
    payload: {
      targets: campaign.remainingTargets,
      remainingCount: campaign.remainingCount,
      totalCount: campaign.totalCount,
    },
    sourceConversationKey: input.conversationKey,
  });
}

export async function reconcileSpokenPromises(
  speech: string,
  input: { scope: PromiseScope; conversationKey: string; now: Date; timeZone: string },
  deps: PromiseReconcileDeps = {}
): Promise<ReconciledSpeech> {
  const promises = findPromiseSentences(speech);
  if (!promises.length) return { text: speech, prepared: [], removed: [], emptied: false };
  const prepared: PreparedItemRecord[] = [];
  const backed: PromiseBacking[] = [];
  const visitPromise = promises.find(item => PROPERTY_VISIT_SENTENCE.test(item.text));
  if (visitPromise) {
    const item = await preparePropertyVisitChoice(
      { scope: input.scope, conversationKey: input.conversationKey, promiseText: visitPromise.text, now: input.now, timeZone: input.timeZone },
      deps
    ).catch(error => {
      console.warn("[Claire] could not prepare property visits for a promise", error instanceof Error ? error.message : error);
      return null;
    });
    if (item) {
      prepared.push(item);
      backed.push({ id: PREPARED_PROPERTY_VISIT_CHOICE, matches: PROPERTY_VISIT_SENTENCE });
    }
  }
  const guarded = lintAndStripUnbackedPromises(speech, { backed });
  return { text: guarded.text, prepared, removed: guarded.removed, emptied: guarded.emptied };
}

/** Resolves the identity fields a promise needs from the operator id the conversation carries. */
export async function resolvePromiseScope(input: { tenantId: string; operatorUserId: string }): Promise<PromiseScope | null> {
  const raw = input.operatorUserId.trim();
  if (!raw) return null;
  const source = /^\d+$/.test(raw) ? { type: "user_id" as const, value: Number(raw) } : { type: "open_id" as const, value: raw };
  const resolution = await resolveCanonicalOperatorIdentity({
    tenantId: input.tenantId,
    source,
    subsystem: "claire_promise_ledger",
  }).catch(() => null);
  if (!resolution?.ok) return null;
  return {
    tenantId: input.tenantId,
    canonicalOperatorId: resolution.identity.canonicalOperatorId,
    dayDirectorActorId: resolution.identity.dayDirectorActorId,
    dayDirectorActorIds: resolution.identity.dayDirectorActorIds,
  };
}
