import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  fs.readFileSync(path.resolve(import.meta.dirname, name), "utf8");

describe("GarmentBagSprite — tappable, mapped to the real cargo item", () => {
  const sprite = read("./GarmentBagSprite.tsx");

  it("renders as a real button, not a decorative image, and stops the tap from also opening the whole-car dialog", () => {
    expect(sprite).toContain("<button");
    expect(sprite).toContain("event.stopPropagation();");
    expect(sprite).toContain("onSelect?.(item);");
  });

  it("passes the exact item object through onSelect — never an index or a copy — so an edit lands on the right record", () => {
    expect(sprite).toContain("onSelect?: (item: VehicleCargoItem) => void;");
  });
});

describe("VehicleCargo — editing reuses the existing cargo model and mutation path", () => {
  const source = read("./VehicleCargo.tsx");

  it("wires hero kanban bags to openTransfer through the location carousel", () => {
    expect(source).toContain("onSelectItem={openTransfer}");
    expect(source).toContain("CustodyLocationCarousel");
    expect(source).toContain("CustodyTransferSheet");
  });

  it("only offers a text edit for field cargo — the entries that actually have an editable label in the real data model", () => {
    const selectItemBody = source.slice(
      source.indexOf("function selectItem("),
      source.indexOf("function cancelEdit(")
    );
    expect(selectItemBody).toContain('if (item.source === "field")');
  });

  it("scrolls the tapped bag's real list entry into view instead of opening a second, competing UI", () => {
    expect(source).toContain("scrollIntoView({ behavior: \"smooth\", block: \"center\" })");
    expect(source).toContain("articleRefs");
  });

  it("saves through the real update mutation in live mode, and a fixture callback in harness mode — never both, never a fabricated write", () => {
    expect(source).toContain("trpc.system.goldlineCargo.update.useMutation(");
    expect(source).toContain("if (fixtureCargo !== undefined) {");
    expect(source).toContain("onFixtureCargoUpdated?.(item, fields);");
    expect(source).toContain("await update.mutateAsync({");
  });

  it("requires a name and an item before saving, and surfaces a real error rather than failing silently", () => {
    expect(source).toContain('setEditError("Name and item are required.");');
    expect(source).toContain("gl-cargo-edit-error");
  });

  it("does not add a delete/remove action to the edit form", () => {
    const formSection = source.slice(
      source.indexOf("gl-cargo-edit-form"),
      source.indexOf("</form>")
    );
    expect(formSection.toUpperCase()).not.toContain("DELETE");
    expect(formSection.toUpperCase()).not.toContain("REMOVE");
  });
});

describe("DriverVehicleDrawer — fixture edits land on the correct record", () => {
  const source = read("./DriverVehicleDrawer.tsx");

  it("matches the edited entry by id before merging fields, never replacing the whole list", () => {
    expect(source).toContain("onFixtureCargoUpdated={(item, fields) =>");
    expect(source).toContain("existing.id === item.id");
  });
});

describe("vehicle-cargo.css — the car effect is isolated, cheap, and motion-safe", () => {
  const css = read("./vehicle-cargo.css");

  it("only animates opacity/transform, never layout-triggering properties, on the two decorative layers", () => {
    expect(css).toContain("@keyframes gl-cargo-ambient-pulse");
    expect(css).toContain("@keyframes gl-cargo-sheen-sweep");
    const pulseBlock = css.slice(
      css.indexOf("@keyframes gl-cargo-ambient-pulse"),
      css.indexOf("}", css.indexOf("@keyframes gl-cargo-ambient-pulse")) +
        200
    );
    expect(pulseBlock).toMatch(/opacity|transform/);
  });

  it("respects prefers-reduced-motion for both effect layers", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain(".gl-cargo-ambient-glow");
    expect(reduced).toContain(".gl-cargo-sheen::after");
  });

  it("resets default button chrome on the now-interactive garment bag", () => {
    const block = css.slice(
      css.indexOf(".gl-cargo-garment {"),
      css.indexOf(".gl-cargo-garment.is-processed")
    );
    expect(block).toContain("border: 0;");
    expect(block).toContain("background: transparent;");
  });
});

describe("goldline-day-plan.css — the drawer opens to roughly four-fifths of the screen", () => {
  const css = read("../../pages/goldline/goldline-day-plan.css");

  it("sizes the drawer around 80vw, not the old ~90-97vw-capped-at-460px shape", () => {
    const rule = css.slice(css.indexOf(".gdp-garage {"), css.indexOf(".gdp-garage {") + 200);
    expect(rule).toMatch(/width:\s*min\(8\dvw/);
  });
});
