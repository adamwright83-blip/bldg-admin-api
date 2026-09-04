import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, "Admin.tsx"),
  "utf8"
);

const newOrderSource = source.slice(
  source.indexOf("function NewOrderTab("),
  source.indexOf("/* ===== DRY CLEAN RECEIPT INTAKE =====")
);

describe("New Order mobile checkout flow", () => {
  it("uses customer, order, and payment as the only mobile steps", () => {
    expect(newOrderSource).toMatch(/"customer" \| "order" \| "payment"/);
    expect(newOrderSource).toContain(
      'useState<\n    "customer" | "order" | "payment"\n  >("customer")'
    );
  });

  it("keeps the existing desktop three-column POS visible at xl", () => {
    expect(newOrderSource).toContain(
      "xl:grid-cols-[270px_minmax(0,1fr)_360px]"
    );
    expect(newOrderSource).toMatch(/xl:order-none xl:block/g);
    expect(newOrderSource).toContain("xl:order-none xl:flex");
  });

  it("adds mobile-only continue and review controls without replacing checkout", () => {
    expect(newOrderSource).toContain('setMobileStep("order")');
    expect(newOrderSource).toContain('setMobileStep("payment")');
    expect(newOrderSource).toContain("Continue");
    expect(newOrderSource).toContain("Review order");
    expect(newOrderSource).toContain("Create & Charge");
  });

  it("does not add garment artwork to the text-only dry-clean catalog", () => {
    const dryCleanSource = source.slice(
      source.indexOf("function DryCleanIntake("),
      source.indexOf("/* ===== PROCESSING TAB =====")
    );

    expect(dryCleanSource).not.toMatch(/ShirtIcon|Package|img|svg/);
    expect(dryCleanSource).toContain("item.name");
    expect(dryCleanSource).toContain("item.customerPriceCents");
  });

  it("prints each cleaner's name exactly as the business writes it", () => {
    const dryCleanSource = source.slice(
      source.indexOf("function DryCleanIntake("),
      source.indexOf("/* ===== PROCESSING TAB =====")
    );

    /* `uppercase` would render "COAST 1hr CLEANERS" as "COAST 1HR CLEANERS".
     * Wherever a partner's name is shown, it must not be CSS-transformed. */
    const nameRenders = [
      ...dryCleanSource.matchAll(/[^\n]*cleaner\.displayName[^\n]*/g),
    ].map(m => m[0]);
    expect(nameRenders.length).toBeGreaterThan(0);
    for (const line of nameRenders) {
      if (/uppercase/.test(line)) {
        expect(line).toMatch(/normal-case/);
      }
    }

    /* The enclosing element must not uppercase the name either. */
    expect(dryCleanSource).not.toMatch(
      /uppercase[^\n]*\n\s*\{(?:menu|active|cleaner)[^\n]*\.displayName\}/
    );
  });

  it("assigns each garment to the cleaner whose tab is open", () => {
    const dryCleanSource = source.slice(
      source.indexOf("function DryCleanIntake("),
      source.indexOf("/* ===== PROCESSING TAB =====")
    );

    /* The tab is the assignment: tapping a garment writes its cleaner-scoped
     * line key, so the operator never picks a cleaner a second time. */
    expect(dryCleanSource).toContain("setActiveCleanerSlug");
    expect(dryCleanSource).toContain("[item.lineKey]: qty + 1");
    expect(dryCleanSource).toContain("menu.cleaner.displayName");
  });

  it("returns to customer selection when an order is reset", () => {
    expect(newOrderSource).toMatch(
      /const resetOrderForm = useCallback[\s\S]*?setMobileStep\("customer"\)/
    );
  });
});
