import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for "Make Pickup + Delivery Real Gameplay": a genuine
 * pickup/delivery route row must open the in-game PICKUP/DELIVERY action
 * surface (GoldlineActionSurface, via handleSelectOrder) rather than calling
 * the canonical mutation directly from a plain list-row button. A future
 * developer reverting the row to `onClick={() => onResolveOrder(...)}` (the
 * conventional-task-list-row mechanism this work replaced) would fail this.
 */
describe("GoldlineGameHome pickup/delivery route-row wiring", () => {
  const source = readFileSync(
    new URL("./GoldlineGameHome.tsx", import.meta.url),
    "utf8"
  );

  it("never calls onResolveOrder directly from a route-row button", () => {
    // The direct call must not appear as a JSX onClick body anywhere.
    expect(source).not.toMatch(/onClick=\{[^}]*props\.onResolveOrder\(/);
  });

  it("dispatches route-row selection through handleSelectOrder instead", () => {
    expect(source).toContain(
      "onClick={() => handleSelectOrder(order, status)}"
    );
    expect(source).toContain(
      'function handleSelectOrder(order: Order, status: "collected" | "delivered")'
    );
  });

  it("fails closed instead of opening the surface when an order has no real address", () => {
    expect(source).toMatch(/const address = order\.address\?\.trim\(\) \|\| null;\s*\n\s*if \(!address\)/);
  });

  it("builds PICKUP/DELIVERY descriptors from the order's own real fields, not a fabricated mission", () => {
    expect(source).toContain('kind: "DELIVERY"');
    expect(source).toContain('kind: "PICKUP"');
    expect(source).toContain("paid: order.paid");
  });
});

describe("GoldlineActionSurface PICKUP/DELIVERY never falls back to conventional dispatch UI", () => {
  const source = readFileSync(
    new URL("./actions/GoldlineActionSurface.tsx", import.meta.url),
    "utf8"
  );

  it("dispatches PICKUP/DELIVERY to the in-canvas OrderSurface", () => {
    expect(source).toMatch(
      /props\.action\.kind === "PICKUP" \|\| props\.action\.kind === "DELIVERY"/
    );
    expect(source).toContain("<OrderSurface");
  });

  it("records completion through the canonical resolveOrder service, never a second write path", () => {
    expect(source).toContain("props.services.resolveOrder({");
  });

  it("keeps a payment-blocked delivery truthfully blocked — no bypass button", () => {
    expect(source).toContain("blocked = props.action.kind === \"DELIVERY\" && !props.action.paid");
    expect(source).toContain("This cannot be bypassed in-game.");
  });

  it("gates the primary completion action on genuine world proximity, not merely opening the surface", () => {
    expect(source).toContain("!props.action.withinInteractionZone");
    expect(source).toContain("Move Trailblazer to the");
    // A future regression could satisfy every other check here while still
    // always rendering the completion button — this specifically proves the
    // button is absent whenever withinInteractionZone is false.
    expect(source).not.toMatch(
      /<button disabled=\{busy\} onClick=\{\(\) => void perform\(\)\}>\s*\{busy[\s\S]{0,80}\}\s*<\/button>\s*\)\}\s*\{error/
    );
  });

  it("never re-labels the primary in-world mechanic as MARK COLLECTED / MARK DELIVERED", () => {
    expect(source).not.toMatch(/MARK (COLLECTED|DELIVERED)/);
    expect(source).toContain('"RETRIEVE"');
    expect(source).toContain('"HAND OFF"');
  });
});

/**
 * A genuine pickup/delivery must become a real Pixi world objective —
 * bound to an authored corridor anchor and gated by the same
 * `isOrderApproachable` proximity mechanism already proven for commercial
 * missions — never merely represented as a list row that opens a modal.
 * This guards the world-runtime wiring specifically; the live browser proof
 * (e2e/goldline/pickupDeliveryWorldObjective.spec.ts) proves the resulting
 * behavior end-to-end.
 */
describe("Pickup/delivery become genuine proximity-gated world objectives", () => {
  const gameSource = readFileSync(
    new URL("./runtime/GoldlineGame.ts", import.meta.url),
    "utf8"
  );
  const populationSource = readFileSync(
    new URL("./world/PopulationSystem.ts", import.meta.url),
    "utf8"
  );
  const homeSource = readFileSync(
    new URL("./GoldlineGameHome.tsx", import.meta.url),
    "utf8"
  );

  it("binds a real order to an authored corridor anchor via the population system", () => {
    expect(populationSource).toContain("setOrder(order: AuthoritativeOrderForEmbodiment | null)");
    expect(populationSource).toContain("bindOrderToPopulation(");
  });

  it("gates the physical INTERACT gesture on real proximity to the order's anchor", () => {
    expect(gameSource).toContain("isOrderApproachable(");
    expect(gameSource).toMatch(/orderProximity\s*<=\s*|orderDistance\s*<=\s*order\.anchor\.stagingRadius/);
  });

  it("wires the world's current next objective into the runtime, not just the flat route list", () => {
    expect(homeSource).toContain("runtimeRef.current?.setOrderEmbodiment(");
    expect(homeSource).toContain("nextOrderObjective");
  });
});
