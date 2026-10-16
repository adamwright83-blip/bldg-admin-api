import { afterEach, describe, expect, it, vi } from "vitest";
import { extractBriefingWithModel, validateModelBriefing } from "./llmBriefing";
import { briefingClock } from "./briefingTiming";

const input = { tenantId: "repair", utterance: "Create the landing page and Instagram ad today.", vocabulary: [],
  clock: briefingClock(new Date("2026-10-16T00:30:00Z"), "America/Los_Angeles") };
const response = { choices: [{ message: { content: JSON.stringify({ items: [], context: [], questions: [] }) } }] };

afterEach(() => vi.useRealTimers());
describe("briefing extraction latency and cancellation", () => {
  it("accepts a model response arriving after the former seven-second cutoff", async () => {
    vi.useFakeTimers();
    const invoke = vi.fn(() => new Promise(resolve => setTimeout(() => resolve(response), 8_000)));
    const pending = extractBriefingWithModel(input, { invoke: invoke as never });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await pending).not.toBeNull();
  });
  it("aborts the provider request when the deadline expires and returns no proposed work", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const invoke = vi.fn((request: { signal: AbortSignal }) => {
      signal = request.signal;
      return new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new Error("Aborted"))));
    });
    const pending = extractBriefingWithModel(input, { invoke: invoke as never, timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBeNull();
    expect(signal?.aborted).toBe(true);
  });
});

// Actual-model replay resolved the referent correctly, but local validation
// stripped its action and dropped the next-day time of day.
it("retains a resolved delivery referent and tomorrow afternoon in structured timing", () => {
  const result = validateModelBriefing({ items: [{ kind: "new_work", title: "Deliver 1 dry cleaning order",
    quote: "And 1 of them tomorrow afternoon.", day: "tomorrow", date: "", timingWords: "tomorrow afternoon",
    quantity: 1, people: [], place: "", needs: "", intent: "commitment", executionType: null }], context: [], questions: [] },
    { ...input, utterance: "And 1 of them tomorrow afternoon.", recentTurns: [{ speaker: "operator", text: "I need to deliver 2 dry cleaning orders tonight." }] });
  expect(result.items[0]?.title).toBe("Deliver 1 dry cleaning order");
  expect(result.items[0]?.businessDate).toBe("2026-10-16");
  expect(result.items[0]?.timing).toEqual({ kind: "daypart", label: "tomorrow afternoon" });
});

it("validates the model's selected timing instead of substituting the first time in a multi-task quote", () => {
  const quote = "Deliver one order tomorrow afternoon and deliver two orders tonight.";
  const result = validateModelBriefing({ items: [{ kind: "new_work", title: "Deliver two orders",
    quote, day: "today", date: "", timingWords: "tonight", quantity: 2, people: [], place: "", needs: "", intent: "commitment", executionType: null }], context: [], questions: [] },
    { ...input, utterance: quote });
  expect(result.items[0]?.timing).toEqual({ kind: "daypart", label: "tonight" });
});
