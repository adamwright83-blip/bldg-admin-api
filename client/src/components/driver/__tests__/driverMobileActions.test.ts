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
const goldlineSource = readFileSync(
  new URL("../../../pages/goldline/GoldlineHome.tsx", import.meta.url),
  "utf8"
);
const fieldHomeSource = readFileSync(
  new URL("../../../product/FieldHome.tsx", import.meta.url),
  "utf8"
);
const walkInSource = readFileSync(
  new URL("../../dayforge/WalkInCapture.tsx", import.meta.url),
  "utf8"
);
const globalCss = readFileSync(
  new URL("../../../index.css", import.meta.url),
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
    expect(commandCenterSource.match(/driver-action-tile/g)).toHaveLength(4);
    expect(commandCenterSource).toContain("window.innerWidth / physicalWidth");
    expect(commandCenterSource).toContain(
      '"--driver-action-height": `${96 * deviceScale}px`'
    );
    expect(globalCss).toContain(
      "min-height: var(--driver-action-height, 96px) !important"
    );
    expect(globalCss).toContain(
      "padding-bottom: var(--driver-main-dock-space, 236px)"
    );
    expect(commandCenterSource).toContain('<Building2 className="shrink-0"');
    expect(commandCenterSource).toContain('<Plus className="shrink-0"');
    expect(commandCenterSource).toContain('<MapPin className="shrink-0"');
    expect(commandCenterSource).toContain('<Mic className="shrink-0"');
  });

  it("routes the active driver through Goldline without an admin mission redirect", () => {
    expect(driverSource).toMatch(
      // The law is that Driver's default render IS the Goldline controller, with
      // no admin ProductShell redirect. The literal spelling was incidental: it
      // broke when Vehicle Cargo began riding alongside the controller, which is
      // a source-formatting signal rather than a truth signal.
      /return <>?<GoldlineDriverController \/>/
    );
    expect(driverSource).not.toContain("ProductShell");
    expect(goldlineSource).toContain("Goldline daily adventure map");
    expect(fieldHomeSource).toContain('href="/product/hunt"');
    expect(fieldHomeSource).toContain('href="/product/unload"');
    expect(fieldHomeSource).toContain('href="/new-order"');
    expect(fieldHomeSource).not.toContain("/commercial-missions");
    expect(walkInSource).toContain("props.onSaved?.(result)");
    expect(walkInSource).toContain(
      "if (!props.onSaved) window.location.assign"
    );
  });
});
