import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { firstChapterPagePrompt, openClaireFirstChapterSession } from "./claireToolLoop";

/** Claire on the person's first-chapter page: the same tool loop, one read, nothing else. */
function scripted(responses: Anthropic.ContentBlock[][]) {
  const requests: Array<{ tools: Anthropic.Tool[]; messages: Anthropic.MessageParam[] }> = [];
  const client = {
    messages: {
      create: vi.fn(async (request: { tools: Anthropic.Tool[]; messages: Anthropic.MessageParam[] }) => {
        requests.push({ tools: request.tools, messages: JSON.parse(JSON.stringify(request.messages)) });
        const content = responses.shift();
        if (!content) throw new Error("no scripted response left");
        return { content, stop_reason: content.some(block => block.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 5 } };
      }),
    },
  } as unknown as Anthropic;
  return { client, requests };
}

const page = { personName: "Nina Vale", businessName: "Wildroot Flowers", question: "Where did we leave things with Elena?", timeZone: "America/Los_Angeles" };

describe("Claire on the first-chapter page", () => {
  it("writes from the one read the page offers, under the record's truth rules", () => {
    const prompt = firstChapterPagePrompt(page);
    expect(prompt).toContain("chief of staff to Nina Vale, who runs Wildroot Flowers");
    expect(prompt).toContain('"Where did we leave things with Elena?"');
    expect(prompt).toContain("Call read_first_chapter first");
    expect(prompt).toContain("If they said they sent it, say they told you so");
    expect(prompt).toContain("Give a time only as the record gives it");
    expect(prompt).not.toContain("Day Line");
  });

  it("offers only read_first_chapter, answers from what it returns, and refuses anything else without running it", async () => {
    const facts = { message: { state: "ready_not_sent", words: "Hi Elena" } };
    const readFirstChapter = vi.fn(async () => facts);
    const { client, requests } = scripted([
      [{ type: "tool_use", id: "toolu_day", name: "apply_day_line_changes", input: { changes: [{ op: "add", title: "Call Elena", day: "today" }], operator_words: "yes" } } as Anthropic.ToolUseBlock],
      [{ type: "tool_use", id: "toolu_read", name: "read_first_chapter", input: {} } as Anthropic.ToolUseBlock],
      [{ type: "text", text: "Your reply to Elena is ready, and it hasn't been sent.", citations: null } as Anthropic.TextBlock],
    ]);
    const session = await openClaireFirstChapterSession({ ...page, readFirstChapter, client, model: "claude-sonnet-5-5" });
    expect(session.open).toBeNull();
    const result = await session.turn(page.question);
    expect(requests[0]!.tools.map(tool => tool.name)).toEqual(["read_first_chapter"]);
    expect(result.toolEvents.map(event => [event.name, (event.output as { status?: string }).status ?? "read", event.wrote])).toEqual([
      ["apply_day_line_changes", "refused", false],
      ["read_first_chapter", "read", false],
    ]);
    expect(readFirstChapter).toHaveBeenCalledTimes(1);
    const sent = requests[2]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(JSON.parse(String(sent[0]!.content))).toEqual(facts);
    expect(result.speak).toBe("Your reply to Elena is ready, and it hasn't been sent.");
  });
});
