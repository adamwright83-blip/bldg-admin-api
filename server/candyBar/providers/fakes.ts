import type {
  ArchitectPlan,
  ProviderDispatchResult,
  ReconciledBrief,
  ReviewCritique,
} from "../../../shared/candyBar";
import type { EngineeringTerminalResult } from "../../goldline/engineering/agentsClient";
import type { ArchitectAdapter, CreativeAdapter, EngineerAdapter, ReviewerAdapter } from "./types";
import { unavailableResult } from "./types";

export type FakeProviderScript = {
  architectPlans?: Array<ArchitectPlan | "MALFORMED" | "TIMEOUT" | "AUTH_FAILURE" | "UNAVAILABLE">;
  reviews?: Array<ReviewCritique | "MALFORMED" | "AUTH_FAILURE" | "UNAVAILABLE">;
  reconciles?: Array<ReconciledBrief | "MALFORMED">;
  engineerResults?: Array<
    | (EngineeringTerminalResult & { sessionId?: string })
    | "AUTH_FAILURE"
    | "NEEDS_HUMAN"
    | "BLOCKED"
    | "UNAVAILABLE"
    | "TIMEOUT"
  >;
};

function ok(content: Record<string, unknown>, sessionId: string | null = null): ProviderDispatchResult {
  return {
    ok: true,
    provider: "fake",
    sessionId,
    content,
    inputTokens: null,
    outputTokens: null,
    estimatedCostCents: null,
    costKnown: false,
  };
}

export function createFakeArchitectAdapter(script: FakeProviderScript): ArchitectAdapter & {
  calls: number;
} {
  const adapter = {
    providerId: "fake" as const,
    calls: 0,
    async plan(): Promise<ProviderDispatchResult> {
      adapter.calls += 1;
      const next = script.architectPlans?.shift();
      if (next === "MALFORMED") {
        return ok({ objective: "" });
      }
      if (next === "TIMEOUT") {
        return {
          ok: false,
          provider: "fake",
          code: "TIMEOUT",
          message: "timeout",
          retryable: true,
          browserAutomationUsed: false,
        };
      }
      if (next === "AUTH_FAILURE") {
        return {
          ok: false,
          provider: "fake",
          code: "AUTH_FAILURE",
          message: "auth failed",
          retryable: false,
          browserAutomationUsed: false,
        };
      }
      if (next === "UNAVAILABLE") {
        return unavailableResult("fake", "architect unavailable");
      }
      if (!next) {
        return unavailableResult("fake", "no architect script left");
      }
      return ok(next as unknown as Record<string, unknown>);
    },
  };
  return adapter;
}

export function createFakeReviewerAdapter(script: FakeProviderScript): ReviewerAdapter & {
  calls: number;
} {
  const adapter = {
    providerId: "fake" as const,
    calls: 0,
    async review(): Promise<ProviderDispatchResult> {
      adapter.calls += 1;
      const next = script.reviews?.shift();
      if (next === "MALFORMED") {
        return ok({ verdict: "NOPE" });
      }
      if (next === "AUTH_FAILURE") {
        return {
          ok: false,
          provider: "fake",
          code: "AUTH_FAILURE",
          message: "auth failed",
          retryable: false,
          browserAutomationUsed: false,
        };
      }
      if (next === "UNAVAILABLE") {
        return unavailableResult("fake", "reviewer unavailable");
      }
      if (!next) {
        return unavailableResult("fake", "no reviewer script left");
      }
      return ok(next as unknown as Record<string, unknown>);
    },
  };
  return adapter;
}

export function createFakeReconcileInvoker(script: FakeProviderScript) {
  return async function reconcile(): Promise<Record<string, unknown>> {
    const next = script.reconciles?.shift();
    if (next === "MALFORMED") return { decision: "WHATEVER" };
    if (!next) throw new Error("no reconcile script");
    return next as unknown as Record<string, unknown>;
  };
}

export function createFakeEngineerAdapter(script: FakeProviderScript): EngineerAdapter & {
  calls: number;
  sessions: string[];
} {
  const adapter = {
    providerId: "fake" as const,
    calls: 0,
    sessions: [] as string[],
    async implement(input: {
      prompt: string;
      sessionId?: string | null;
    }): Promise<ProviderDispatchResult> {
      adapter.calls += 1;
      const next = script.engineerResults?.shift();
      if (next === "AUTH_FAILURE") {
        return {
          ok: false,
          provider: "fake",
          code: "AUTH_FAILURE",
          message: "auth failed",
          retryable: false,
          browserAutomationUsed: false,
        };
      }
      if (next === "TIMEOUT") {
        return {
          ok: false,
          provider: "fake",
          code: "TIMEOUT",
          message: "timeout",
          retryable: true,
          browserAutomationUsed: false,
        };
      }
      if (next === "UNAVAILABLE") {
        return unavailableResult("fake", "engineer unavailable");
      }
      if (next === "NEEDS_HUMAN") {
        return ok({
          status: "NEEDS_HUMAN",
          capability: null,
          summary: "needs human",
          tests: null,
          branch: null,
          pr_url: null,
          blocker: "migration required",
          requires_human_approval: true,
        });
      }
      if (next === "BLOCKED") {
        return ok({
          status: "BLOCKED",
          capability: null,
          summary: "blocked",
          tests: null,
          branch: null,
          pr_url: null,
          blocker: "security decision",
          requires_human_approval: true,
        });
      }
      if (!next) {
        return unavailableResult("fake", "no engineer script left");
      }
      const sessionId = input.sessionId ?? next.sessionId ?? `fake-sess-${adapter.calls}`;
      adapter.sessions.push(sessionId);
      return ok(next as unknown as Record<string, unknown>, sessionId);
    },
  };
  return adapter;
}

export function createFakeCreativeAdapter(): CreativeAdapter {
  return {
    providerId: "fake",
    async treat() {
      return unavailableResult("fake", "CreativeAdapter V0 seam — no execution");
    },
  };
}
