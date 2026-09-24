import { MemoryCandyBarStore, type CandyBarStore } from "./store";
import { CandyBarOrchestrator } from "./orchestrator";
import {
  createAnthropicArchitectAdapter,
  createCreativeAdapter,
  createCursorEngineerAdapter,
  createGrokReviewerAdapter,
  createOpenAiEngineerAdapter,
  createOpenAiReviewerAdapter,
} from "./providers/adapters";
import { createGithubApiObserver } from "./providers/github";
import type { CandyBarWorkflowRecord, CandyBarRunRecord } from "../../shared/candyBar";

let storeSingleton: CandyBarStore | null = null;
let orchSingleton: CandyBarOrchestrator | null = null;

/**
 * Production default wiring:
 * - Architect: Anthropic seat (invoke not injected until dogfood — returns unavailable unless fallback)
 * - Reviewer: Grok adapter (typed unavailable; no browser automation)
 * - Engineer: Cursor unavailable; OpenAI hosted sessions when fallback allows
 * - Creative: seam only
 * - GitHub: read-only API observer
 *
 * For deterministic tests, construct CandyBarOrchestrator directly with fakes.
 */
export function getCandyBarStore(): CandyBarStore {
  if (!storeSingleton) storeSingleton = new MemoryCandyBarStore();
  return storeSingleton;
}

export function getCandyBarOrchestrator(): CandyBarOrchestrator & {
  storeGetWorkflow: (input: {
    tenantId: string;
    operatorUserId: string;
  }) => Promise<CandyBarWorkflowRecord | null>;
  storeListRuns: (input: {
    tenantId: string;
    operatorUserId: string;
    limit?: number;
  }) => Promise<CandyBarRunRecord[]>;
} {
  if (!orchSingleton) {
    const store = getCandyBarStore();
    const engineerFallback = createOpenAiEngineerAdapter();
    orchSingleton = new CandyBarOrchestrator({
      store,
      providers: {
        architect: createAnthropicArchitectAdapter(),
        reviewer: createGrokReviewerAdapter(),
        // Prefer OpenAI engineer adapter as the concrete worker when Cursor is unavailable.
        // Identity remains openai. resolveEngineer still requires fallback policy.
        engineer: engineerFallback,
        creative: createCreativeAdapter(),
        github: createGithubApiObserver(),
      },
      silentEvents: true,
    });
  }
  const orch = orchSingleton;
  return Object.assign(orch, {
    storeGetWorkflow: (input: { tenantId: string; operatorUserId: string }) =>
      storeSingleton!.getWorkflow(input),
    storeListRuns: (input: {
      tenantId: string;
      operatorUserId: string;
      limit?: number;
    }) => storeSingleton!.listRuns(input),
  });
}

/** Test helper — reset singletons. */
export function resetCandyBarRuntimeForTests() {
  storeSingleton = null;
  orchSingleton = null;
}

// Keep Cursor adapter import reachable for seat inventory / tests.
void createCursorEngineerAdapter;
void createOpenAiReviewerAdapter;
