import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FirstChapterFacts } from "../../../shared/firstTenMinutesFirstChapter";

/**
 * "Your first chapter" on real MySQL: the person returns to their portrait, a new entry from what they actually did is
 * there, and Claire answers through her engine from what she reads, and remembers what she said. The model is
 * scripted: it reads the first chapter, then writes what `write` makes of it. Local disposable database only.
 */
const url = process.env.DATABASE_URL ?? "";
const allowed = (() => {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.pathname === "/first_ten_test";
  } catch {
    return false;
  }
})();
process.env.JWT_SECRET ||= "first-ten-integration-secret-000000000000";

const ASTRA = "Hi Elena — you asked earlier this year about Friday flowers. We now have a weekly Friday delivery. Is that still something you're looking for at the hotel?";

/** A model that always reads first, then writes from the read; every time it is asked again it reads again. */
function claire(write: (facts: FirstChapterFacts, round: number) => string) {
  let round = 0;
  return {
    messages: {
      create: async (request: { messages: Anthropic.MessageParam[] }) => {
        const last = request.messages.at(-1)!;
        const results = Array.isArray(last.content) ? (last.content as Anthropic.ToolResultBlockParam[]).filter(block => block.type === "tool_result") : [];
        const usage = { input_tokens: 120, output_tokens: 30 };
        if (!results.length) return { content: [{ type: "tool_use", id: `toolu_${round}`, name: "read_first_chapter", input: {} }], stop_reason: "tool_use", usage };
        round += 1;
        const text = write(JSON.parse(String(results[0]!.content)) as FirstChapterFacts, round);
        return { content: [{ type: "text", text, citations: null }], stop_reason: "end_turn", usage };
      },
    },
  } as unknown as Anthropic;
}

/** What a faithful answer says: the request, the message as it stands, and where it is. */
function faithful(facts: FirstChapterFacts): string {
  const how = facts.message.version === "their_own_words" ? "You put the reply in your own words" : "You kept the reply as it was drafted";
  const where = facts.message.state === "kept_for_later" ? "You decided it could wait, and it hasn't been sent." : "It's ready, and it hasn't been sent.";
  return `You picked up ${facts.request.label}${facts.request.askedIn ? ` from ${facts.request.askedIn}` : ""}. ${how}: “${facts.message.words}” ${where}`;
}

describe.skipIf(!allowed)("your first chapter on MySQL", () => {
  let db: mysql.Connection;
  beforeAll(async () => {
    db = await mysql.createConnection(url);
    await import("../journeys");
  }, 60_000);
  afterAll(async () => {
    await db?.end();
  });

  async function atTheTable() {
    const { startJourney } = await import("../journeys");
    const { runReading } = await import("../understanding/run");
    const { readingDepsFor } = await import("../understanding/deps");
    const { claimReading } = await import("../understanding/store");
    const { journeyById, setJourneyStage } = await import("../store");
    const { recordChapterStep, prepareDraft } = await import("../chapter/chapter");
    const started = (await startJourney({ requestId: randomUUID(), kind: "example" })).journey;
    const runId = randomUUID();
    await claimReading(started.id, runId, { again: false });
    await runReading(started.id, runId, await readingDepsFor(started));
    await setJourneyStage(started.id, "chapter");
    const journey = (await journeyById(started.id))!;
    await recordChapterStep(journey, "revealed");
    for (const step of ["glove", "shake", "quill", "dip", "letter_written"] as const) await recordChapterStep(journey, step);
    await prepareDraft(journey, new Date("2026-10-29T17:00:00Z"));
    return (await journeyById(started.id))!;
  }

  it("puts the new entry on the portrait, and Claire answers from what she read and remembers", async () => {
    const journey = await atTheTable();
    const { askClaire, firstChapterView, openFirstChapter } = await import("./firstChapter");
    const { openClaireFirstChapterSession } = await import("../../claire/prototype/claireToolLoop");
    const { changeDraft, declineDraft } = await import("../chapter/chapter");
    const { journeyById } = await import("../store");
    const engine = (write: (facts: FirstChapterFacts, round: number) => string) => ({
      open: (input: Parameters<typeof openClaireFirstChapterSession>[0]) => openClaireFirstChapterSession({ ...input, client: claire(write), model: "claude-sonnet-5-5" }),
    });

    expect(await firstChapterView(journey)).toEqual({
      entry: "You revisited Elena's Friday request and prepared a reply using the weekly service you now offer.",
      question: "Where did we leave things with Elena?",
      answer: null,
    });
    await openFirstChapter(journey);
    await openFirstChapter((await journeyById(journey.id))!);
    expect((await journeyById(journey.id))!.stage).toBe("first_chapter");

    const asked = await askClaire((await journeyById(journey.id))!, "America/Los_Angeles", engine(faithful));
    expect(asked?.answer?.text).toBe(`You picked up Elena's Friday request from April 2026. You kept the reply as it was drafted: “${ASTRA}” It's ready, and it hasn't been sent.`);
    // she remembers what she said
    expect((await firstChapterView(journey))?.answer).toEqual(asked?.answer);

    // Nina puts it in her own words and decides it can wait; asked again, Claire reads it afresh
    const now = new Date("2026-10-29T17:10:00Z");
    await changeDraft(journey, { body: "Hi Elena — Friday delivery exists now. Shall I bring a sample this Friday?" }, now);
    await declineDraft(journey, now);
    // the first try says it went; told what didn't hold, she writes it again from the read
    const again = await askClaire(journey, "America/Los_Angeles", engine((facts, round) => (round === 1 ? "You sent it to Elena this morning." : faithful(facts))));
    expect(again?.entry).toBe("You revisited Elena's Friday request and decided the reply could wait.");
    expect(again?.answer?.text).toBe(
      "You picked up Elena's Friday request from April 2026. You put the reply in your own words: “Hi Elena — Friday delivery exists now. Shall I bring a sample this Friday?” You decided it could wait, and it hasn't been sent."
    );

    // an answer that still doesn't hold is not shown, and what she said before stands
    await expect(askClaire(journey, "America/Los_Angeles", engine(() => "It went out yesterday, and Elena replied."))).rejects.toThrow("Claire can't answer that properly right now.");
    expect((await firstChapterView(journey))?.answer).toEqual(again?.answer);

    const [events] = await db.query<mysql.RowDataPacket[]>(
      "SELECT kind, payload_json FROM first_ten_events WHERE journey_id = ? AND kind IN ('first_chapter_opened', 'claire_answered', 'claire_unanswered') ORDER BY created_at",
      [journey.id]
    );
    expect(events.map(event => event.kind)).toEqual(["first_chapter_opened", "claire_answered", "claire_answered", "claire_unanswered"]);
    const payload = (raw: unknown) => (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
    expect(payload(events[1].payload_json)).toMatchObject({
      question: "Where did we leave things with Elena?",
      facts: { message: { state: "ready_not_sent", version: "as_drafted" }, sentFolder: "not_relevant", recipientWroteBack: { answer: "not_known" } },
      model: "claude-sonnet-5-5",
    });
    expect(payload(events[2].payload_json)).toMatchObject({ facts: { message: { state: "kept_for_later", version: "their_own_words" } } });
    expect(payload(events[3].payload_json)).toMatchObject({ reason: "the answer didn't hold", problems: [{ kind: "sent" }, { kind: "wrote_back" }] });
    // the model's tokens are attributed to this journey, never to a workspace
    const { listTenantProviderUsage } = await import("../../db");
    const spend = await listTenantProviderUsage(`first_ten:${journey.id}`);
    expect(spend.find(row => row.category === "llm:first_ten_claire")?.usageQuantity).toBeGreaterThan(0);
  });
});
