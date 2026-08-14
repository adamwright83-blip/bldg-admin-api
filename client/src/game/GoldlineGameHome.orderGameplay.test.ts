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
});
