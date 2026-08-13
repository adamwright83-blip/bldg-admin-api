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
const surface = readFileSync(
  new URL("../actions/GoldlineActionSurface.tsx", import.meta.url),
  "utf8"
);
const registry = readFileSync(
  new URL("../actions/actionRegistry.ts", import.meta.url),
  "utf8"
);

describe("real action dispatch contract", () => {
  it("uses the lifecycle request id for authoritative persistence", () => {
    expect(home).toContain(
      "encounterRuntime?.actionRequestId ?? standaloneActionRequestId"
    );
    expect(surface).toContain("requestId={props.requestId}");
    expect(bridge).toContain("requestId: props.requestId");
    expect(bridge).not.toContain("const requestId = crypto.randomUUID()");
  });

  it("opens the call bridge only for an authoritative CALL with a phone", () => {
    expect(registry).toMatch(
      /projected\(context\) === "CALL"\s*&&\s*context\.mission\.missionId != null\s*&&\s*context\.mission\.phoneUrl/
    );
    expect(surface).toContain('props.action.kind === "CALL"');
    expect(surface).toContain('props.action.kind === "VISIT"');
  });

  it("routes cancellation through the lifecycle reducer", () => {
    expect(home).toContain(
      'sendEncounterEvent({ type: "REAL_ACTION_CANCELLED" })'
    );
    expect(home).not.toMatch(/phase:\s*"ACTION_READY"/);
  });
});
