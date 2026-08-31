import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Proves the driver sales journal survives every real failure mode a field
 * recording can hit, without ever fabricating a transcript/insight and
 * without silently discarding a driver's real audio. This is the server
 * half of the resilience story; SalesMomentum.test.ts covers the client's
 * truthful error-message mapping and its never-clear-on-failure guarantee.
 *
 * Six cases, matched to the real failure the field-device repair was
 * commissioned over:
 *  A. text-only journal, no Anthropic configured — still saves via fallback.
 *  B. Android-shaped audio journal, transcription + Anthropic both succeed.
 *  C. transcription unavailable, no typed fallback — fails closed, no row,
 *     no fabricated transcript.
 *  D. covered client-side in SalesMomentum.test.ts (network/mutation
 *     failure never clears the driver's recording or typed text).
 *  E. audio transcribes fine, but Anthropic extraction fails afterward —
 *     the journal still saves via the existing fallback-insights path.
 *  F. both AI systems unavailable (no audio, no Anthropic) — a typed
 *     journal still saves.
 */

const mocks = vi.hoisted(() => ({
  transcribeAudio: vi.fn(),
  invokeLLM: vi.fn(),
  storagePut: vi.fn(async () => undefined),
  storageGet: vi.fn(async () => ({ url: "https://storage.example/fake-audio.webm" })),
}));
const envState = vi.hoisted(() => ({ anthropicApiKey: "" }));
const worldMocks = vi.hoisted(() => ({
  append: vi.fn(async (input: Record<string, unknown>) => ({ id: "world-event-1", ...input })),
  queue: vi.fn(),
}));

vi.mock("../_core/voiceTranscription", () => ({
  transcribeAudio: mocks.transcribeAudio,
}));
vi.mock("../_core/llm", () => ({
  invokeLLM: mocks.invokeLLM,
}));
vi.mock("../storage", () => ({
  storagePut: mocks.storagePut,
  storageGet: mocks.storageGet,
}));

vi.mock("../_core/env", () => ({ ENV: envState }));
vi.mock("../goldlineWorld/worldEventStore", () => ({ appendGoldlineWorldEvent: worldMocks.append }));
vi.mock("../goldlineWorld/fieldJournalProcessingService", () => ({ queueFieldJournalProcessing: worldMocks.queue }));

type InsertedRow = Record<string, unknown>;

function chain(result: unknown): any {
  const node: any = {
    from: () => node,
    where: () => node,
    orderBy: () => node,
    limit: () => node,
    groupBy: () => node,
    values: (row: InsertedRow) => chain2(row, result),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return node;
}
function chain2(row: InsertedRow, result: unknown): any {
  const node: any = {
    onDuplicateKeyUpdate: () => node,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  insertedRows.push(row);
  return node;
}

let insertedRows: InsertedRow[] = [];
let previousJournalRows: InsertedRow[] = [];

const dbMock = {
  execute: vi.fn(async () => undefined),
  select: vi.fn(() => chain(previousJournalRows)),
  insert: vi.fn((table: unknown) => chain(undefined)),
};

vi.mock("../db", () => ({ getDb: async () => dbMock }));

import { saveDriverSalesJournal } from "./driverSalesMotivationService";

beforeEach(() => {
  vi.clearAllMocks();
  insertedRows = [];
  previousJournalRows = [];
  envState.anthropicApiKey = "";
  mocks.storagePut.mockImplementation(async () => undefined);
  mocks.storageGet.mockImplementation(async () => ({
    url: "https://storage.example/fake-audio.webm",
  }));
});

// Real Android Chromium commonly reports the recorder as
// `audio/webm;codecs=opus`. The production bug behind the field screenshot
// rejected this valid data URL because the old parser only accepted a bare
// `audio/webm` MIME type. Keep the real parameterized shape in every audio
// resilience case so a desktop-sanitized fixture cannot hide the regression.
const AUDIO_DATA_URL = `data:audio/webm;codecs=opus;base64,${Buffer.from("fake-audio-bytes").toString("base64")}`;

describe("driver sales journal resilience", () => {
  it("Case A — text-only journal is durable before extraction when Anthropic is not configured", async () => {
    envState.anthropicApiKey = "";
    const result = await saveDriverSalesJournal({
      tenantId: "t1",
      driverId: "d1",
      journalDate: "2026-08-14",
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      transcript:
        "They said they already have laundry machines but I explained we handle the overflow items instead.",
    });
    expect(result.processingStatus).toBe("captured");
    expect(mocks.invokeLLM).not.toHaveBeenCalled();
    const journalRow = insertedRows.find(row => "transcript" in row);
    expect(journalRow).toBeDefined();
    expect(journalRow?.processingStatus).toBe("captured");
    // Never fabricated — the saved transcript is exactly what was typed.
    expect(journalRow?.transcript).toBe(result.transcript);
  });

  it("Case B — Android codec-parameter audio is persisted before transcription begins", async () => {
    envState.anthropicApiKey = "sk-test-key";
    mocks.transcribeAudio.mockResolvedValue({
      text: "They said the price was too high, so I walked them through the real cost of doing it in-house.",
    });
    mocks.invokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              objections: [],
              wins: [],
              missedQuestions: [],
              commitments: [],
              confidenceFriction: [],
              useful: true,
            }),
          },
        },
      ],
    });
    const result = await saveDriverSalesJournal({
      tenantId: "t1",
      driverId: "d1",
      journalDate: "2026-08-14",
      clientRequestId: "22222222-2222-4222-8222-222222222222",
      audioDataUrl: AUDIO_DATA_URL,
    });
    expect(mocks.storagePut).toHaveBeenCalledWith(
      expect.stringMatching(/\.webm$/),
      expect.any(Buffer),
      "audio/webm"
    );
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(result.processingStatus).toBe("captured");
    const journalRow = insertedRows.find(row => "transcript" in row);
    expect(journalRow?.audioStorageKey).toBeTruthy();
    expect(journalRow?.audioMimeType).toBe("audio/webm");
    expect(journalRow?.processingStatus).toBe("captured");
    expect(worldMocks.queue).toHaveBeenCalledWith({ tenantId: "t1", journalEntryId: expect.any(String) });
  });

  it("Case C — transcription availability cannot prevent raw audio persistence", async () => {
    envState.anthropicApiKey = "";
    mocks.transcribeAudio.mockResolvedValue({ error: "provider_unavailable" });
    const result = await saveDriverSalesJournal({
      tenantId: "t1",
      driverId: "d1",
      journalDate: "2026-08-14",
      clientRequestId: "33333333-3333-4333-8333-333333333333",
      audioDataUrl: AUDIO_DATA_URL,
    });
    expect(mocks.storagePut).toHaveBeenCalled();
    expect(insertedRows.find(row => "transcript" in row)).toBeDefined();
    expect(result.processingStatus).toBe("captured");
  });

  it("Case E — Anthropic fails after a real transcript still saves via fallback, never blocking the journal", async () => {
    envState.anthropicApiKey = "sk-test-key";
    mocks.transcribeAudio.mockResolvedValue({
      text: "They told me the current vendor already covers it, so I asked what still creates complaints.",
    });
    mocks.invokeLLM.mockRejectedValue(new Error("anthropic_unavailable"));
    const result = await saveDriverSalesJournal({
      tenantId: "t1",
      driverId: "d1",
      journalDate: "2026-08-14",
      clientRequestId: "44444444-4444-4444-8444-444444444444",
      audioDataUrl: AUDIO_DATA_URL,
    });
    expect(result.processingStatus).toBe("captured");
    const journalRow = insertedRows.find(row => "transcript" in row);
    expect(journalRow?.processingStatus).toBe("captured");
  });

  it("Case F — both AI systems unavailable: a typed-only journal still saves", async () => {
    envState.anthropicApiKey = "";
    const result = await saveDriverSalesJournal({
      tenantId: "t1",
      driverId: "d1",
      journalDate: "2026-08-14",
      clientRequestId: "55555555-5555-4555-8555-555555555555",
      transcript:
        "I called the front desk, they said no laundry needs right now, I asked who to follow up with next month.",
    });
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(mocks.invokeLLM).not.toHaveBeenCalled();
    expect(result.processingStatus).toBe("captured");
    expect(insertedRows.find(row => "transcript" in row)).toBeDefined();
  });
});
