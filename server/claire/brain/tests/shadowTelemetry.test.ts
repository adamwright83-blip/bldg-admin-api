import { describe, expect, it, vi } from "vitest";
import { observeShadowTurn, type ShadowObservation } from "../shadow/observeShadowTurn";
import { createInMemoryShadowMemoryStore } from "../shadow/shadowMemory";
import {
  persistShadowObservation,
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

    const writer = vi.fn(async () => undefined);
    await persistShadowObservation(observation!, writer);
    expect(writer).toHaveBeenCalledOnce();
  });
});
