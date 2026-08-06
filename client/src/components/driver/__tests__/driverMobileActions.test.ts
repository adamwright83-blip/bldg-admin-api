import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const commandCenterSource = readFileSync(
  new URL("../CommandCenter.tsx", import.meta.url),
  "utf8"
);
const driverSource = readFileSync(
  new URL("../../../pages/Driver.tsx", import.meta.url),
  "utf8"
);
const walkInSource = readFileSync(
  new URL("../../dayforge/WalkInCapture.tsx", import.meta.url),
  "utf8"
);

describe("driver mobile actions", () => {
  it("keeps walk-in and new-order actions separate and fully labeled", () => {
    expect(commandCenterSource).toContain("Log a walk-in");
    expect(commandCenterSource).toContain('aria-label="Create new order"');
    expect(commandCenterSource).toContain("onClick={onLogWalkIn}");
    expect(driverSource).not.toContain('href="/dayforge-today?walkIn=1"');
  });

  it("renders four equally large, icon-labeled driver action tiles", () => {
    expect(commandCenterSource).toContain('aria-label="Driver actions"');
    expect(
      commandCenterSource.match(/min-h-\[clamp\(78px,10vw,104px\)\]/g)
    ).toHaveLength(4);
    expect(commandCenterSource).toContain('<Building2 className="h-[clamp(25px,3.2vw,32px)]');
    expect(commandCenterSource).toContain('<Plus className="h-[clamp(25px,3.2vw,32px)]');
    expect(commandCenterSource).toContain('<MapPin className="h-[clamp(25px,3.2vw,32px)]');
    expect(commandCenterSource).toContain('<Mic className="h-[clamp(25px,3.2vw,32px)]');
  });

  it("does not redirect the driver into the admin mission route after save", () => {
    expect(driverSource).toContain("onSaved={result =>");
    expect(driverSource).toContain("Follow-up scheduled.");
    expect(walkInSource).toContain("if (props.onSaved)");
    expect(walkInSource).toContain("props.onSaved(result)");
  });
});
