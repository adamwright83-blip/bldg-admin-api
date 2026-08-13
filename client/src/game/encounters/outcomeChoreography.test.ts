import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const home = readFileSync(
  new URL("../GoldlineGameHome.tsx", import.meta.url),
  "utf8"
);
const runtime = readFileSync(
  new URL("../runtime/GoldlineGame.ts", import.meta.url),
  "utf8"
);

describe("authoritative outcome choreography", () => {
  it("returns directly to the mounted world without completion navigation", () => {
    expect(home).not.toContain("VictoryCeremony");
    expect(home).not.toContain("MISSION COMPLETE");
    expect(home).not.toContain("NEXT LEVEL");
    expect(home).not.toContain("CONTINUE TO DASHBOARD");
    expect(home).toContain('setView("explore")');
    expect(home).toContain('data-testid="goldline-joystick"');
  });

  it("does not promote resolved history into a fake next active mission", () => {
    expect(home).not.toMatch(
      /history\.find\(mission => mission\.state === "captured"\)/
    );
    expect(home).toContain('runtimeRef.current?.setWorldSignal("none")');
  });

  it("renders a recovery route only for authoritative recovery states", () => {
    const recoveryBlock = runtime.slice(
      runtime.indexOf("this.recoveryPath.clear()")
    );
    expect(recoveryBlock).toContain('this.worldState === "recovery_active"');
    expect(recoveryBlock).toContain('this.worldState === "recovery_available"');
    expect(
      recoveryBlock.slice(0, recoveryBlock.indexOf("private applyQualityTier"))
    ).not.toContain('this.worldState === "contested"');
  });
});
