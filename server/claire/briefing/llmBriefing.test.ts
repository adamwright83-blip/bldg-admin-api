import { afterEach, describe, expect, it, vi } from "vitest";
import { extractBriefingWithModel } from "./llmBriefing";
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
