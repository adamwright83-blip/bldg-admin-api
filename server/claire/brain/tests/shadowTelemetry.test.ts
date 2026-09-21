import { describe, expect, it, vi } from "vitest";
import { observeShadowTurn, type ShadowObservation } from "../shadow/observeShadowTurn";
import { createInMemoryShadowMemoryStore } from "../shadow/shadowMemory";
import {
  persistShadowObservation,
  shadowObservationInspectorRecord,
  shadowObservationLogInput,
} from "../telemetry/shadowRecorder";

const ON = { CLAIRE_BRAIN_V2_SHADOW: "1" } as unknown as NodeJS.ProcessEnv;

describe("durable safe shadow telemetry", () => {
  it("persists cognition classes without transcript, candidate prose, phones or tokens", async () => {
    let observation: ShadowObservation | null = null;
    const result = await observeShadowTurn(
      {
        rawText: "Dana's token is secret and her phone is +1 310 555 0100",
        tenantId: "default",
        operatorUserId: "adam-admin",
        surface: "text",
        conversationKey: "claire-desk:safe-telemetry",
      },
      {
        env: ON,
        memory: createInMemoryShadowMemoryStore(),
        sink: value => {
          observation = value;
        },
      }
    );
    expect(result.observed).toBe(true);
    expect(observation).not.toBeNull();

    const payload = shadowObservationLogInput(observation!);
    expect(payload.answerPath).toBe("brain_v2_shadow");
    expect(payload.spokenText).toBe("");
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("310");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("Dana");

    const inspector = shadowObservationInspectorRecord(observation!);
    const inspectorSerialized = JSON.stringify(inspector);
    expect(inspector.event).toBe("claire_brain_v2_shadow");
    expect(inspectorSerialized).not.toContain("310");
    expect(inspectorSerialized).not.toContain("secret");
    expect(inspectorSerialized).not.toContain("Dana");
    expect(inspectorSerialized).not.toContain("evidenceIds");

    const writer = vi.fn(async () => undefined);
    const logger = vi.fn();
    await persistShadowObservation(observation!, writer, logger);
    expect(writer).toHaveBeenCalledOnce();
    expect(logger).toHaveBeenCalledOnce();
    const line = String(logger.mock.calls[0]?.[0] ?? "");
    expect(line.startsWith("[ClaireBrainV2] ")).toBe(true);
    expect(line.split("\n")).toHaveLength(1);
    expect(line).toContain('"event":"claire_brain_v2_shadow"');
    expect(line).not.toContain("310");
    expect(line).not.toContain("secret");
    expect(line).not.toContain("Dana");
  });

  it("emits the inspector line even when durable persistence fails", async () => {
    let observation: ShadowObservation | null = null;
    await observeShadowTurn(
      {
        rawText: "What do I have today?",
        tenantId: "default",
        operatorUserId: "adam-admin",
        surface: "text",
        conversationKey: "claire-desk:inspector-fail-open",
      },
      {
        env: ON,
        memory: createInMemoryShadowMemoryStore(),
        sink: value => {
          observation = value;
        },
      }
    );
    expect(observation).not.toBeNull();

    const writer = vi.fn(async () => {
      throw new Error("db unavailable");
    });
    const logger = vi.fn();

    await expect(persistShadowObservation(observation!, writer, logger)).rejects.toThrow("db unavailable");
    expect(logger).toHaveBeenCalledOnce();
    expect(String(logger.mock.calls[0]?.[0] ?? "")).toContain('"event":"claire_brain_v2_shadow"');
  });
});
