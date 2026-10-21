import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Hermetic: the release job exports a DATABASE_URL whose schema is not migrated yet.
// These scenarios bring their own canonical harness, so they never use a shared database.
vi.hoisted(() => {
  delete process.env.DATABASE_URL;
});
import { ENV } from "../../_core/env";
import { commitBriefing, type ExistingWork } from "../briefing/briefingCommit";
import { runClaireTurn, type ClaireTurnState } from "../turn/claireTurn";

type StoredRow = {
  id: string;
  tenantId: string;
  actorId: string;
  businessDate: string;
  title: string;
  idempotencyKey: string;
  status: "open" | "completed";
  metadataJson: Record<string, unknown>;
};

function createCanonicalHarness(nowIso = "2026-09-22T15:00:00.000Z") {
  const rows = new Map<string, StoredRow>();
  let seq = 0;

  const accept = vi.fn(async (input: {
    tenantId: string;
    actorId: string;
    businessDate: string;
    proposal: { title: string; promptKey: string; command?: unknown };
  }) => {
    const prior = Array.from(rows.values()).find(
      row =>
        row.tenantId === input.tenantId &&
        row.actorId === input.actorId &&
        row.businessDate === input.businessDate &&
        row.idempotencyKey === input.proposal.promptKey
    );
    if (prior) {
      return { id: prior.id, created: false, stored: prior };
    }
    seq += 1;
    const stored: StoredRow = {
      id: `commit-${seq}`,
      tenantId: input.tenantId,
      actorId: input.actorId,
      businessDate: input.businessDate,
      title: input.proposal.title,
      idempotencyKey: input.proposal.promptKey,
      status: "open",
      metadataJson: {
        ...(input.proposal.command ? { command: input.proposal.command } : {}),
      },
    };
    rows.set(stored.id, stored);
    return { id: stored.id, created: true, stored };
  });

  const readCanonical = vi.fn(async ({ commitmentId }: { commitmentId: string }) => {
    return rows.get(commitmentId) ?? null;
  });

  const complete = vi.fn(async ({ commitmentId }: { commitmentId: string }) => {
    const row = rows.get(commitmentId);
    if (row) row.status = "completed";
    return { ok: true as const, alreadyCompleted: false };
  });

  const update = vi.fn(async ({ commitmentId, patch }: { commitmentId: string; patch: Record<string, unknown> }) => {
    const row = rows.get(commitmentId);
    if (row) {
      row.metadataJson = { ...row.metadataJson, ...patch };
    }
    return { ok: true as const, id: commitmentId };
  });

  const loadExisting = vi.fn(async ({ tenantId, dayDirectorActorId, dates }: {
    tenantId: string;
    dayDirectorActorId: string;
    dates: string[];
  }): Promise<ExistingWork[]> => {
    return Array.from(rows.values())
      .filter(
        row =>
          row.tenantId === tenantId &&
          row.actorId === dayDirectorActorId &&
          dates.includes(row.businessDate)
      )
      .map(row => ({
        id: row.id,
        title: row.title,
        businessDate: row.businessDate,
        status: row.status,
      }));
  });

  return {
    rows,
    deps: {
      // These scenarios verify the legacy V1 route, which is what runs with CLAIRE_WORK_LEDGER=0.
      // The same PR #599 scenarios through the work ledger: server/claire/workLedger/workLedger.live.test.ts.
      workLedger: null,
      now: () => new Date(nowIso),
      timeZone: () => "America/Los_Angeles",
      loadExisting,
      commit: (parsed: Parameters<typeof commitBriefing>[0], scope: Parameters<typeof commitBriefing>[1]) =>
        commitBriefing(parsed, scope, {
          accept: accept as never,
          readCanonical: readCanonical as never,
          complete: complete as never,
          update: update as never,
        }),
      vocabulary: async () => ["OPUS LA", "KITH TREATS", "Coast 1hr Dry Cleaners", "Todd", "Rebecca"],
      accounts: async () => [],
      campaign: async () => null,
      watchBoard: async () => ({ brief: "", recoveryAccounts: [] }),
      doctrineTurn: async () => null,
    },
  };
}

function userTextFrom(body: { system?: unknown; messages?: Array<{ content?: unknown }> }): { userText: string; system: string } {
  const system = typeof body.system === "string" ? body.system : "";
  const messages = body.messages ?? [];
  const last = messages[messages.length - 1];
  const content = last?.content;
  const userText = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map(part => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "")).join("\n")
      : "";
  return { userText, system };
}

function brainFor(userText: string, system: string) {
  const pending = /"briefing"\s*:\s*true/.test(system);
  const base = {
    target: pending ? "pending_briefing" : "open_conversation",
    act: "narration" as const,
    workDisposition: "none" as const,
    dayLineDisposition: "none" as const,
    priorClaim: "none" as const,
    weeklyDisposition: "none" as const,
    identityTopic: "none" as const,
    broadBriefingRequest: false,
    canonicalWork: null as string | null,
    referent: null as string | null,
    rationale: "Transport stub labels the operator's act. Claire's handlers decide what is written.",
  };
  const text = userText.trim();
  if (pending && (/^(?:yes|yeah|yep)\b/i.test(text) || /\bput (?:that|it|the list) on the day line\b/i.test(text))) {
    return { ...base, act: "confirmation" as const, workDisposition: "commit" as const, dayLineDisposition: "accept" as const, rationale: "The operator confirmed the list Claire is holding." };
  }
  if (pending && /\b(?:change|make|move)\b/i.test(text)) {
    return { ...base, act: "correction" as const, canonicalWork: text, rationale: "The operator corrected work Claire is holding." };
  }
  if (/\b(?:add|call|pick up|drop off|remind me|i need to)\b/i.test(text)) {
    const commit = /\bday line\b/i.test(text);
    return {
      ...base,
      target: "open_conversation",
      act: "action_request" as const,
      workDisposition: commit ? "commit" as const : "propose" as const,
      dayLineDisposition: commit ? "reopen" as const : "none" as const,
      canonicalWork: text,
      rationale: "The operator stated work.",
    };
  }
  if (/\?|\bwhat\b|\bdid you\b/i.test(text)) {
    return { ...base, target: "open_conversation", act: "question" as const, rationale: "The operator asked a question." };
  }
  return base;
}

function anthropicMessage(model: string, content: unknown[], stop: string) {
  return {
    id: "msg_verification",
    type: "message",
    role: "assistant",
    model: model || "claude-sonnet-4-6",
    stop_reason: stop,
    stop_sequence: null,
    content,
    usage: { input_tokens: 12, output_tokens: 12 },
  };
}

/** Current-generation models receive the schema as structured output, not a tool. */
function jsonOutputSchemaName(body: { output_config?: { format?: { schema?: { required?: string[] } } } }): string | null {
  const required = body.output_config?.format?.schema?.required ?? null;
  if (!required) return null;
  if (required.includes("dayLineDisposition")) return "claire_brain_v3_turn";
  if (required.includes("questions") && required.includes("items")) return "claire_briefing";
  if (required.includes("assertsFact")) return "claire_claim_challenge";
  return "structured_other";
}

function stubBody(raw: string) {
  const body = JSON.parse(raw) as { model?: string; tools?: Array<{ name?: string }>; output_config?: { format?: { schema?: { required?: string[] } } }; system?: unknown; messages?: Array<{ content?: unknown }> };
  const jsonOutput = jsonOutputSchemaName(body);
  if (jsonOutput) {
    // Same scripted answers, delivered the way structured outputs deliver them: JSON text.
    const asTool = stubBody(JSON.stringify({ ...body, output_config: undefined, tools: [{ name: jsonOutput === "structured_other" ? "other" : jsonOutput }] }));
    const block = (asTool.content as Array<{ type: string; input?: unknown }>)[0]!;
    return anthropicMessage(body.model ?? "", [{ type: "text", text: JSON.stringify(block.input) }], "end_turn");
  }
  const tool = body.tools?.[0]?.name ?? null;
  const { userText, system } = userTextFrom(body);
  if (tool === "claire_brain_v3_turn") {
    return anthropicMessage(body.model ?? "", [{ type: "tool_use", id: "toolu_brain", name: tool, input: brainFor(userText, system) }], "tool_use");
  }
  if (tool === "claire_briefing") {
    return anthropicMessage(body.model ?? "", [{ type: "tool_use", id: "toolu_brief", name: tool, input: { items: [], context: [], questions: [] } }], "tool_use");
  }
  if (tool === "claire_claim_challenge") {
    return anthropicMessage(body.model ?? "", [{ type: "tool_use", id: "toolu_claim", name: tool, input: { act: "other", receiptId: "", ambiguous: false, assertsFact: false } }], "tool_use");
  }
  if (tool) {
    return anthropicMessage(body.model ?? "", [{ type: "tool_use", id: "toolu_other", name: tool, input: { unavailable: true } }], "tool_use");
  }
  return anthropicMessage(body.model ?? "", [{ type: "text", text: "I only have what you said in this conversation. I have not written a task." }], "end_turn");
}

function installTransportModelStub() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const raw = typeof init?.body === "string" ? init.body : "{}";
    return new Response(JSON.stringify(stubBody(raw)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("Claire reliability verification (PR #599 scenarios)", () => {
  const originalKey = ENV.anthropicApiKey;

  beforeEach(() => {
    ENV.anthropicApiKey = "test-transport-key-no-network";
  });

  afterEach(() => {
    ENV.anthropicApiKey = originalKey;
    vi.restoreAllMocks();
  });

  it("Scenario 1: multi-item single-turn Day Line request persists all 3 distinct items without collapsing", async () => {
    installTransportModelStub();
    const harness = createCanonicalHarness();
    const state: ClaireTurnState = {};

    const result = await runClaireTurn(
      {
        tenantId: "tenant-verify",
        operatorUserId: "operator-verify",
        dayDirectorActorId: "1",
        surface: "text",
        utterance: "Add call Todd, pick up Rebecca, and drop off the OPUS towels to the day line.",
        state,
        conversationKey: "verify:multi-item",
      },
      harness.deps
    );

    expect(result.kind).toBe("briefing_saved");
    expect(result.receiptBackedCommit ?? result.speak).toMatch(/Done\./);
    expect(result.receiptBackedCommit ?? result.speak).toMatch(/That's 3 new items in all/);

    const storedTitles = Array.from(harness.rows.values()).map(row => row.title);
    expect(storedTitles).toHaveLength(3);
    expect(storedTitles.some(title => /Todd/i.test(title) && !/Rebecca/i.test(title))).toBe(true);
    expect(storedTitles.some(title => /Rebecca/i.test(title) && !/OPUS/i.test(title))).toBe(true);
    expect(storedTitles.some(title => /OPUS/i.test(title) && !/Todd/i.test(title))).toBe(true);
  });

  it("Scenario 2: content replacement revision replaces the target item in pendingBriefing and commits only the revised items", async () => {
    installTransportModelStub();
    const harness = createCanonicalHarness();
    const state: ClaireTurnState = {};

    const turn1 = await runClaireTurn(
      {
        tenantId: "tenant-verify",
        operatorUserId: "operator-verify",
        dayDirectorActorId: "1",
        surface: "text",
        utterance: "I need to pick up a Coast order and call Todd today.",
        state,
        conversationKey: "verify:revision",
      },
      harness.deps
    );
    expect(turn1.kind).toBe("briefing_proposed");
    expect(harness.rows.size).toBe(0);
    expect(state.pendingBriefing?.parsed.items).toHaveLength(2);

    const turn2 = await runClaireTurn(
      {
        tenantId: "tenant-verify",
        operatorUserId: "operator-verify",
        dayDirectorActorId: "1",
        surface: "text",
        utterance: "Change that Coast pickup to pick up KITH TREATS aprons on Rodeo Drive.",
        state,
        conversationKey: "verify:revision",
      },
      harness.deps
    );
    expect(turn2.kind).toBe("briefing_proposed");
    expect(harness.rows.size).toBe(0);
    const pendingTitles = state.pendingBriefing?.parsed.items.map(item => item.title) ?? [];
    expect(pendingTitles.some(title => /KITH TREATS/i.test(title))).toBe(true);
    expect(pendingTitles.some(title => /Coast/i.test(title))).toBe(false);
    expect(pendingTitles.some(title => /Todd/i.test(title))).toBe(true);

    const turn3 = await runClaireTurn(
      {
        tenantId: "tenant-verify",
        operatorUserId: "operator-verify",
        dayDirectorActorId: "1",
        surface: "text",
        utterance: "Yes, put that on the day line.",
        state,
        conversationKey: "verify:revision",
      },
      harness.deps
    );
    expect(turn3.kind).toBe("briefing_saved");
    const committedTitles = Array.from(harness.rows.values()).map(row => row.title);
    expect(committedTitles).toHaveLength(2);
    expect(committedTitles.some(title => /KITH TREATS/i.test(title))).toBe(true);
    expect(committedTitles.some(title => /Todd/i.test(title))).toBe(true);
    expect(committedTitles.some(title => /Coast/i.test(title))).toBe(false);
  });
});
