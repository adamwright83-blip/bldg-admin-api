import { vi } from "vitest";
import { defaultBusinessQuery, type BusinessQueryResult } from "../../analytics/businessQuery";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState, type ClaireTurnTraceForTest } from "../turn/claireTurn";

export const NOW = new Date("2026-09-17T18:00:00Z");
const period = { label: "all time", start: "2020-01-01", end: "2026-09-18" } as never;
export const order = (key: string, number: string, name: string, cents: number, at: string) => ({
  eventKey: key, orderNumber: number, date: at.slice(0, 10), occurredAt: at, cents, source: "cleancloud",
  businessLine: null, processor: null, building: null, serviceType: null, summary: "Fluff & Fold", customerName: name, address: null, ingestedAt: null,
});
export const latest = (orders: ReturnType<typeof order>[], completeness = "complete", failedSources: string[] = []): BusinessQueryResult => ({
  status: "ok", query: defaultBusinessQuery("latest_sales"), period, comparisonPeriod: null,
  coverage: { completeness, loadedSources: ["cleancloud"], failedSources, unverifiedNativeCount: 0, unverifiedNativeCents: 0, overlap: null, serviceFilterUnclassified: null, lineage: null, union: null } as never,
  data: { kind: "orders", ordering: "latest", orders: orders as never },
});
export const THOMAS = order("cc:584", "584", "Thomas", 7040, "2026-09-17T09:34:00.000Z");

export type Reading = { probe: boolean; receiptId: string | null; ambiguous: boolean; assertsFact: boolean | null };
export type Summary = { id: string; claireTurn: number; grounding: string; text: string };

export function harness(current: { result: BusinessQueryResult } = { result: latest([THOMAS]) }, accounts: Array<{ id: number; name: string; accountType: string }> = []) {
  const base = (over: Partial<ClaireTurnDeps>): ClaireTurnDeps => ({
    now: () => NOW, timeZone: () => "America/Los_Angeles",
    business: { now: () => NOW, timeZone: () => "America/Los_Angeles", plan: async () => null, runQuery: async () => current.result },
    commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
    followUp: vi.fn(async () => "Noted.") as never,
    extractModel: null, loadExisting: async () => [], commit: vi.fn() as never, campaign: async () => null, vocabulary: async () => [],
    accounts: async () => accounts, accountHistory: vi.fn() as never, commitFollowUp: vi.fn() as never, dayWork: vi.fn() as never, unpaid: vi.fn() as never,
    searchMemory: vi.fn(async () => []) as never, memoryBetween: vi.fn(async () => []) as never, encyclopedia: null, watchBoard: undefined, doctrineTurn: undefined,
    classifyPriorClaim: (async () => false) as never, rerunBusinessQuery: async () => current.result, classifierBudgetMs: 50, ...over,
  });
  const state: ClaireTurnState = {};
  async function say(utterance: string, over: Partial<ClaireTurnDeps> = {}) {
    let trace: ClaireTurnTraceForTest | null = null;
    const result = await runClaireTurn(
      { tenantId: "default", operatorUserId: "adam", dayDirectorActorId: "1", surface: "voice", utterance, state, conversationKey: "call:adv", allowFragmentWait: false,
        brief: "Two stops today.", context: { businessDate: "2026-09-17", actorId: "adam", macroGoalKnown: false, blockers: [], relevantTimeline: [] } as never },
      base({ ...over, onTurnTrace: t => { trace = t; } })
    );
    return { result, trace: trace as ClaireTurnTraceForTest | null };
  }
  return { state, say, current };
}
export const model = (text: string) => ({ followUp: vi.fn(async () => text) as never });
export const reading = (r: Partial<Reading>): never => (async () => ({ probe: true, receiptId: null, ambiguous: false, assertsFact: true, ...r })) as never;
