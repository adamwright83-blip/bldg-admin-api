import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hudLayout } from "./composeLanternCityScene";

const read = (name: string) =>
  fs.readFileSync(path.resolve(import.meta.dirname, name), "utf8");

describe("hudLayout — mobile breakpoint", () => {
  it("only branches on width <= 767; desktop tiers are untouched", () => {
    // These are the exact desktop-tier numbers this task must never change
    // (one non-compact width, one compact-tier width, matching the widths
    // already exercised in composeLanternCityScene.test.ts).
    expect(hudLayout(1920, 1080)).toEqual({
      identity: { x: 16, y: 10, width: 330, height: 72 },
      topBar: { x: 360, y: 10, width: 1544, height: 72 },
      leftOperation: { x: 14, y: 92, width: 330, height: 882 },
      rightDossier: { x: 1576, y: 92, width: 330, height: 882 },
      deck: { x: 14, y: 984, width: 1892, height: 84 },
    });
    expect(hudLayout(1280, 900)).toEqual({
      identity: { x: 16, y: 10, width: 250, height: 72 },
      topBar: { x: 278, y: 10, width: 986, height: 72 },
      leftOperation: { x: 14, y: 92, width: 258, height: 702 },
      rightDossier: { x: 1002, y: 92, width: 264, height: 702 },
      deck: { x: 14, y: 804, width: 1252, height: 84 },
    });
  });

  it("gives the identity zone enough height to fit the compact single-row mobile title without overlapping topBar", () => {
    const hud = hudLayout(390, 844);
    // Regression for the mobile double-render/overlap bug: the identity box
    // must end (y + height) at or before topBar begins.
    expect(hud.identity.y + hud.identity.height).toBeLessThanOrEqual(
      hud.topBar.y
    );
    expect(hud.identity.height).toBeGreaterThanOrEqual(48);
  });

  it("never lets the identity title collide with the City Intelligence pill sharing its row, at any supported width", () => {
    for (const [width, height] of [
      [390, 844],
      [412, 915],
      [430, 932],
      [360, 640], // cramped Android-ish viewport
    ] as const) {
      const hud = hudLayout(width, height);
      expect(hud.identity.x + hud.identity.width).toBeLessThanOrEqual(
        hud.rightDossier.x
      );
    }
  });

  it("shrinks the left/right panels to a small floating card and button instead of full-height columns", () => {
    for (const [width, height] of [
      [390, 844],
      [412, 915],
      [430, 932],
      [360, 640], // cramped Android-ish viewport
    ] as const) {
      const hud = hudLayout(width, height);
      // A real permanent sidebar in the old desktop shape spans nearly the
      // full viewport height; the mobile replacement must be compact.
      expect(hud.leftOperation.height).toBeLessThan(height * 0.5);
      expect(hud.rightDossier.height).toBeLessThan(100);
      // The world must get the width back: the compact quest card and the
      // intelligence button are floating elements, not full-height columns
      // splitting the screen — the intelligence button in particular stays
      // small, and the quest card never spans the full width.
      expect(hud.leftOperation.width).toBeLessThan(width);
      expect(hud.rightDossier.width).toBeLessThan(width * 0.6);
    }
  });

  it("keeps every mobile HUD rect within the viewport bounds, even on a cramped Android-ish screen", () => {
    const hud = hudLayout(360, 640);
    for (const rect of Object.values(hud)) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(360);
      expect(rect.y + rect.height).toBeLessThanOrEqual(640);
    }
  });
});

describe("LanternCityHUD — fast New Order entry reuses the real flow", () => {
  const hud = read("./LanternCityHUD.tsx");

  it("threads a dedicated onNewOrder prop instead of the no-op command switch", () => {
    expect(hud).toContain("onNewOrder: () => void");
    expect(hud).toContain("onClick={onNewOrder}");
    // The old placeholder must be gone from the FAB specifically.
    expect(hud).not.toContain('onClick={() => onCommand("map")}');
  });

  it("labels the button for New Order per the spec (ARIA + FAB class)", () => {
    expect(hud).toContain('aria-label="New Order"');
    expect(hud).toContain("styles.newOrderFab");
  });

  it("reuses the existing campaign/dossier content in on-demand mobile sheets, not a second UI", () => {
    // Same aside elements the desktop uses, just toggled with a class.
    expect(hud).toContain("styles.operation} ${campaignOpen");
    expect(hud).toContain("styles.dossier} ${intelligenceOpen");
    expect(hud).toContain("Escape");
  });
});

describe("LanternCityScene — New Order FAB navigates to the real /new-order route", () => {
  const scene = read("./LanternCityScene.tsx");

  it("wires onNewOrder to the existing onNavigate('/new-order') mechanism", () => {
    expect(scene).toContain('onNewOrder={() => onNavigate("/new-order")}');
  });
});

describe("lantern-city-v6.module.css — mobile-only styling is scoped to the phone breakpoint", () => {
  const css = read("./lantern-city-v6.module.css");

  it("hides every new mobile-only element by default so desktop cannot render them", () => {
    const defaultHidden = css.slice(
      0,
      css.indexOf("@media (max-width: 767px)")
    );
    expect(defaultHidden).toMatch(
      /\.mobileQuest,\s*\n\.mobileIntelligenceButton,\s*\n\.mobileSheetBackdrop,\s*\n\.mobileSheetClose,\s*\n\.newOrderFab\s*\{\s*\n\s*display: none;/
    );
  });

  it("adds exactly one new phone breakpoint at 767px, after the existing 1399px compact-desktop tier", () => {
    const first1399 = css.indexOf("@media (max-width: 1399px)");
    const mobile = css.indexOf("@media (max-width: 767px)");
    expect(first1399).toBeGreaterThan(-1);
    expect(mobile).toBeGreaterThan(first1399);
    // Only one mobile breakpoint block was added.
    expect(css.match(/@media \(max-width: 767px\)/g)?.length).toBe(1);
  });

  it("leaves the 1399px compact-desktop tier's rules untouched", () => {
    expect(css).toContain(".identity h1 {\n    font-size: 24px;\n  }");
    expect(css).toContain(".operationHero {\n    height: 105px;\n  }");
  });

  it("hides the permanent side panels on mobile and only reveals them via the sheet-open class", () => {
    const mobileBlock = css.slice(css.indexOf("@media (max-width: 767px)"));
    expect(mobileBlock).toContain(".operation,\n  .dossier {\n    display: none;\n  }");
    expect(mobileBlock).toContain(".operation.mobileSheetOpen,");
    expect(mobileBlock).toContain(".dossier.mobileSheetOpen");
  });

  it("respects safe-area insets for the bottom deck and the FAB", () => {
    const mobileBlock = css.slice(css.indexOf("@media (max-width: 767px)"));
    expect(mobileBlock).toContain("env(safe-area-inset-bottom");
    expect(mobileBlock.match(/env\(safe-area-inset-bottom/g)?.length).toBeGreaterThanOrEqual(
      2
    );
  });
});
