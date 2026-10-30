import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { StandingInstructionStore } from "../../agents/daphne/standingInstructions";
import { buildSystemPromptWithRules, runClaireToolTurn, scheduledCallKickoff } from "./claireToolLoop";
import type { ToolContext } from "./tools";

const noRules = { listActive: async () => [], append: async () => { throw new Error("no writes in this test"); } } as unknown as StandingInstructionStore;

function ctx(operatorTurns: string[]): ToolContext {
  return {
    tenantId: "t",
    operatorUserId: "op",
    dayDirectorActorId: "1",
    canonicalOperatorId: "c",
    timeZone: "America/Los_Angeles",
    now: () => new Date("2026-10-29T00:30:00Z"),
    conversationId: "conv",
    nextTurnId: () => "t1",
    operatorTurns: () => operatorTurns,
    lastClaireText: () => null,
    callRowIds: new Set(),
    standingInstructionStore: noRules,
    goalProgressReaders: {
      readMacroGoal: async () => ({ id: "g", objective: "Get to 50 active customers", metricKey: "active_customers", unit: "customers", targetValue: 50, targetDate: null }),
      readRunBaseline: async () => 23,
      readCurrentValue: async () => ({ value: null, note: "active-customer count is partial" }),
    },
  };
}

function scripted(responses: Anthropic.ContentBlock[][]) {
  const requests: Array<{ messages: Anthropic.MessageParam[] }> = [];
  const client = {
    messages: {
      create: vi.fn(async (request: { messages: Anthropic.MessageParam[] }) => {
        requests.push({ messages: JSON.parse(JSON.stringify(request.messages)) });
        const content = responses.shift();
        if (!content) throw new Error("no scripted response left");
        const usesTool = content.some(block => block.type === "tool_use");
        return { content, stop_reason: usesTool ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 5 } };
      }),
    },
  } as unknown as Anthropic;
  return { client, requests };
}

describe("scheduled calls on the native-tool engine", () => {
  it("tells the model why it placed the evening call and how to open it; an inbound call has no such section", async () => {
    const evening = await buildSystemPromptWithRules(ctx([]), { operatorName: "Adam", businessName: "Laundry Farm", callKind: "evening_debrief" });
    expect(evening.prompt).toContain("scheduled evening wrap");
    expect(evening.prompt).toContain("read_goal_progress");
    expect(evening.prompt).toContain("Do not walk through the Day Line in the opening");
    const inbound = await buildSystemPromptWithRules(ctx([]), { operatorName: "Adam", businessName: "Laundry Farm" });
    expect(inbound.prompt).not.toContain("you placed");
    expect(inbound.prompt).toContain("They should talk at least as much as you do");
  });

  it("treats feedback about how Claire talks as a rule about her, not a request for the plan", async () => {
    const { prompt } = await buildSystemPromptWithRules(ctx([]), { operatorName: "Adam", businessName: "Laundry Farm", callKind: "evening_debrief" });
    expect(prompt).toContain("that is a rule about you, not a request for the plan again");
  });

  it("opens with a goal read, and the call-start notice never counts as the operator's words", async () => {
    const operatorTurns: string[] = [];
    const messages: Anthropic.MessageParam[] = [];
    const { client, requests } = scripted([
      [{ type: "tool_use", id: "toolu_goal", name: "read_goal_progress", input: {} } as Anthropic.ToolUseBlock],
      [{ type: "text", text: "Evening, Adam. You're aiming for 50 active customers; I don't have a verified count yet. How did today go?", citations: null } as Anthropic.TextBlock],
    ]);
    const lastClaireText = { value: null as string | null };
    const result = await runClaireToolTurn(
      { client, model: "claude-sonnet-5-5", systemPrompt: "s", heldTopics: [], ctx: ctx(operatorTurns), messages, operatorTurns, lastClaireText },
      scheduledCallKickoff("evening_debrief", "Adam"),
      { operatorSpoke: false }
    );
    expect(result.speak).toBe("Evening, Adam. You're aiming for 50 active customers; I don't have a verified count yet. How did today go?");
    expect(operatorTurns).toEqual([]);
    expect(lastClaireText.value).toBe(result.speak);
    // The goal tool's result went back to the model before it spoke.
    const sent = requests[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(JSON.parse(String(sent[0]!.content))).toMatchObject({ status: "ok", target: 50, started_at: 23, current: null, current_note: "active-customer count is partial" });
    // The thread starts with the notice, then Claire's opening: the operator's first answer continues it.
    expect(messages[0]).toMatchObject({ role: "user" });
    expect(String(messages[0]!.content)).toContain("not from Adam");
    expect(messages.at(-1)).toMatchObject({ role: "assistant" });
  });
});
