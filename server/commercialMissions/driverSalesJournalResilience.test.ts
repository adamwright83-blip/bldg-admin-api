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
 *  B. audio journal, transcription + Anthropic both succeed.
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

const AUDIO_DATA_URL = `data:audio/webm;base64,${Buffer.from("fake-audio-bytes").toString("base64")}`;

describe("driver sales journal resilience", () => {
  it("Case A — text-only journal saves via fallback when Anthropic is not configured", async () => {
    envState.anthropicApiKey = "";
    const result = await saveDriverSalesJournal({
      tenantId: "t1",
      driverId: "d1",
      journalDate: "2026-08-14",
      transcript:
        "They said they already have laundry machines but I explained we handle the overflow items instead.",
    });
    expect(result.processingStatus).toBe("fallback");
    expect(mocks.invokeLLM).not.toHaveBeenCalled();
    const journalRow = insertedRows.find(row => "transcript" in row);
    expect(journalRow).toBeDefined();
    expect(journalRow?.processingStatus).toBe("fallback");
    // Never fabricated — the saved transcript is exactly what was typed.
    expect(journalRow?.transcript).toBe(result.transcript);
  });

  it("Case B — audio journal succeeds when both transcription and Anthropic succeed", async () => {
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
      audioDataUrl: AUDIO_DATA_URL,
    });
    expect(mocks.storagePut).toHaveBeenCalled();
    expect(mocks.transcribeAudio).toHaveBeenCalled();
    expect(result.processingStatus).toBe("processed");
    const journalRow = insertedRows.find(row => "transcript" in row);
    expect(journalRow?.audioStorageKey).toBeTruthy();
    expect(journalRow?.processingStatus).toBe("processed");
  });

  it("Case C — transcription unavailable with no typed fallback fails closed: no row, no fabricated transcript", async () => {
    envState.anthropicApiKey = "";
    mocks.transcribeAudio.mockResolvedValue({ error: "provider_unavailable" });
    await expect(
      saveDriverSalesJournal({
        tenantId: "t1",
        driverId: "d1",
        journalDate: "2026-08-14",
        audioDataUrl: AUDIO_DATA_URL,
      })
    ).rejects.toThrow(/could not transcribe/i);
    // The audio bytes were durably stored before transcription was
    // attempted (storagePut happens first) — the driver's recording is
    // not destroyed even though this call fails.
    expect(mocks.storagePut).toHaveBeenCalled();
    // But no journal row was ever written — no fabricated transcript, no
    // fabricated insights, no partial/pending row (the schema has no
    // pending state; see the audio-durability trace in the PR).
    expect(insertedRows.find(row => "transcript" in row)).toBeUndefined();
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
      audioDataUrl: AUDIO_DATA_URL,
    });
    expect(result.processingStatus).toBe("fallback");
    const journalRow = insertedRows.find(row => "transcript" in row);
    expect(journalRow?.processingStatus).toBe("fallback");
    // The real transcribed text is preserved even though extraction failed.
    expect(journalRow?.transcript).toMatch(/current vendor already covers it/i);
  });

  it("Case F — both AI systems unavailable: a typed-only journal still saves", async () => {
    envState.anthropicApiKey = "";
    const result = await saveDriverSalesJournal({
      tenantId: "t1",
      driverId: "d1",
      journalDate: "2026-08-14",
      transcript:
        "I called the front desk, they said no laundry needs right now, I asked who to follow up with next month.",
    });
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(mocks.invokeLLM).not.toHaveBeenCalled();
    expect(result.processingStatus).toBe("fallback");
    expect(insertedRows.find(row => "transcript" in row)).toBeDefined();
  });
});
