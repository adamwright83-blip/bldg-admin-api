import { describe, expect, it } from "vitest";
import {
  isDaphneConversationIngestionEnabled,
  isDaphneConsolidationWorkerConfigured,
  isDaphneConsolidationWorkerEnabled,
} from "./releaseSafety";
import { runDaphneConsolidationBatch, startDaphneConsolidationWorker } from "./consolidationWorker";
import { ingestDaphneConversation } from "./conversationIngestion";

const env = (values: Record<string, string> = {}) => values as NodeJS.ProcessEnv;

describe("Daphne V2 release activation is independently default off", () => {
  it("never reuses the existing Claire Daphne flag as a new ingestion or worker switch", () => {
    const existing = env({ DAPHNE_V2_CLAIRE_ENABLED: "true" });
    expect(isDaphneConversationIngestionEnabled("tenant-a", existing)).toBe(false);
    expect(isDaphneConsolidationWorkerConfigured(existing)).toBe(false);
    expect(isDaphneConsolidationWorkerEnabled("tenant-a", existing)).toBe(false);
  });

  it("requires explicit on for each capability and scopes a configured tenant allowlist", () => {
    const flags = env({
      DAPHNE_V2_CONVERSATION_INGESTION_ENABLED: "true",
      DAPHNE_V2_CONVERSATION_INGESTION_TENANTS: "tenant-a, tenant-b",
      DAPHNE_V2_CONSOLIDATION_WORKER_ENABLED: "true",
      DAPHNE_V2_CONSOLIDATION_WORKER_TENANTS: "tenant-b",
    });
    expect(isDaphneConversationIngestionEnabled("tenant-a", flags)).toBe(true);
    expect(isDaphneConversationIngestionEnabled("tenant-b", flags)).toBe(true);
    expect(isDaphneConversationIngestionEnabled("tenant-c", flags)).toBe(false);
    expect(isDaphneConsolidationWorkerEnabled("tenant-a", flags)).toBe(false);
    expect(isDaphneConsolidationWorkerEnabled("tenant-b", flags)).toBe(true);
    expect(isDaphneConsolidationWorkerEnabled("tenant-c", flags)).toBe(false);
    expect(isDaphneConsolidationWorkerConfigured(flags)).toBe(true);
  });

  it("allows explicit global enablement, rejects false strings, and rejects an empty tenant against an allowlist", () => {
    expect(isDaphneConversationIngestionEnabled("tenant-x",env({DAPHNE_V2_CONVERSATION_INGESTION_ENABLED:"true"}))).toBe(true);
    expect(isDaphneConsolidationWorkerEnabled("tenant-x",env({DAPHNE_V2_CONSOLIDATION_WORKER_ENABLED:"1"}))).toBe(true);
    expect(isDaphneConversationIngestionEnabled("tenant-x",env({DAPHNE_V2_CONVERSATION_INGESTION_ENABLED:"false"}))).toBe(false);
    expect(isDaphneConsolidationWorkerEnabled("",env({DAPHNE_V2_CONSOLIDATION_WORKER_ENABLED:"true",DAPHNE_V2_CONSOLIDATION_WORKER_TENANTS:"tenant-x"}))).toBe(false);
  });

  it("captures no conversation evidence with the ingestion switch missing, even if old Daphne is enabled", async () => {
    const priorIngestion = process.env.DAPHNE_V2_CONVERSATION_INGESTION_ENABLED;
    const priorClaire = process.env.DAPHNE_V2_CLAIRE_ENABLED;
    try {
      delete process.env.DAPHNE_V2_CONVERSATION_INGESTION_ENABLED;
      process.env.DAPHNE_V2_CLAIRE_ENABLED = "true";
      expect(await ingestDaphneConversation({
        tenantId: "tenant-not-in-database",
        operatorUserId: "owner-not-in-database",
        conversationId: "test-call",
        turnId: "test-turn",
        utterance: "I own a laundromat.",
        completed: true,
      })).toEqual({status: "ineligible"});
    } finally {
      if (priorIngestion === undefined) delete process.env.DAPHNE_V2_CONVERSATION_INGESTION_ENABLED;
      else process.env.DAPHNE_V2_CONVERSATION_INGESTION_ENABLED = priorIngestion;
      if (priorClaire === undefined) delete process.env.DAPHNE_V2_CLAIRE_ENABLED;
      else process.env.DAPHNE_V2_CLAIRE_ENABLED = priorClaire;
    }
  });

  it("does not fetch the database, start a timer or process pending work with worker flag absent", async () => {
    const prior = process.env.DAPHNE_V2_CONSOLIDATION_WORKER_ENABLED;
    try {
      delete process.env.DAPHNE_V2_CONSOLIDATION_WORKER_ENABLED;
      expect(await runDaphneConsolidationBatch()).toEqual({processed: 0});
      const stop = startDaphneConsolidationWorker();
      await stop();
    } finally {
      if (prior === undefined) delete process.env.DAPHNE_V2_CONSOLIDATION_WORKER_ENABLED;
      else process.env.DAPHNE_V2_CONSOLIDATION_WORKER_ENABLED = prior;
    }
  });
});
