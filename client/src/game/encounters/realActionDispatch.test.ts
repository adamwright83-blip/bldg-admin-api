import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const home = readFileSync(
  new URL("../GoldlineGameHome.tsx", import.meta.url),
  "utf8"
);
const bridge = readFileSync(
  new URL("./RealActionBridge.tsx", import.meta.url),
  "utf8"
);

describe("real action dispatch contract", () => {
  it("uses the lifecycle request id for authoritative persistence", () => {
    expect(home).toContain("requestId={encounterRuntime.actionRequestId}");
    expect(bridge).toContain("requestId: props.requestId");
    expect(bridge).not.toContain("const requestId = crypto.randomUUID()");
  });

  it("opens the call bridge only for an authoritative CALL with a phone", () => {
    expect(home).toContain('affordance === "CALL" && activeMission.phoneUrl');
    expect(home).toContain("window.location.assign(utilityMissionPath)");
    expect(home).toContain('encounterRuntime?.phase === "ACTION_IN_PROGRESS"');
  });

  it("routes cancellation through the lifecycle reducer", () => {
    expect(home).toContain(
      'sendEncounterEvent({ type: "REAL_ACTION_CANCELLED" })'
    );
    expect(home).not.toMatch(/phase:\s*"ACTION_READY"/);
  });
});
