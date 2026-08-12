import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source-level regression guard for the Sales Intel readability hotfix.
 * These assertions read the component/CSS source directly so the fix
 * (WCAG AA text, explicit import format, unmistakable single-vs-bulk
 * distinction) can't quietly regress without a test failing — matching the
 * pattern already used by salesIntelAuthorization.test.ts.
 */
const componentSource = readFileSync(
  resolve(import.meta.dirname, "SalesIntelAdmin.tsx"),
  "utf8"
);
const stylesheetSource = readFileSync(
  resolve(import.meta.dirname, "sales-intel-admin.css"),
  "utf8"
);

describe("Sales Intel admin page readability", () => {
  it("imports its own scoped stylesheet rather than relying on undefined classNames", () => {
    expect(componentSource).toMatch(/import\s+["']\.\/sales-intel-admin\.css["']/);
  });

  it("never uses the site's default muted-foreground token, which falls below 4.5:1 on this page's background", () => {
    // text-muted-foreground on this page's cream/card background measures ~4.00:1,
    // below WCAG AA. The page defines its own --si-muted (verified >=4.5:1) instead.
    expect(componentSource).not.toMatch(/text-muted-foreground/);
  });

  it("every si-hint / si-code / si-badge rule in the stylesheet is scoped under .sales-intel-admin", () => {
    const ruleStarts = [...stylesheetSource.matchAll(/^\.([\w-]+)[^{]*\{/gm)]
      .map(m => m[0]);
    for (const rule of ruleStarts) {
      expect(rule).toMatch(/^\.sales-intel-admin/);
    }
  });
});

describe("Import Verified Sources panel is unmistakable", () => {
  it("explicitly names the bulk workflow and the accepted format", () => {
    expect(componentSource).toMatch(/IMPORT VERIFIED SOURCES/);
    expect(componentSource).toMatch(/Bulk import approved creator\/source records from a verified JSON manifest/);
    expect(componentSource).toMatch(/FORMAT: JSON MANIFEST/);
    expect(componentSource).toMatch(/Not comma-separated links, not a transcript/);
  });

  it("shows the real manifest schema fields, not invented ones", () => {
    for (const field of [
      "creatorName",
      "platform",
      "canonicalSourceUrl",
      "sourceType",
      "acquisitionMode",
      "verifiedAt",
      "verificationMethod",
    ]) {
      expect(componentSource).toContain(field);
    }
  });

  it("labels the four-step preview-then-apply workflow in order", () => {
    const stepPositions = ["STEP 1", "STEP 2", "STEP 3", "STEP 4"].map(step =>
      componentSource.indexOf(step)
    );
    expect(stepPositions.every(pos => pos !== -1)).toBe(true);
    expect(stepPositions).toEqual([...stepPositions].sort((a, b) => a - b));
  });

  it("apply is gated on a successful preview existing (preview.length check) rather than always enabled", () => {
    expect(componentSource).toMatch(/disabled=\{!newCount \|\| applyMutation\.isPending\}/);
  });
});

describe("Add Single Source composer explains itself", () => {
  it("is no longer labeled with the ambiguous 'ADD SALES INTEL' text", () => {
    expect(componentSource).not.toMatch(/>\s*ADD SALES INTEL\s*</);
  });
  it("states one-source-per-submission explicitly, not implicitly via placeholder alone", () => {
    expect(componentSource).toMatch(/One source per submission/);
    expect(componentSource).toMatch(/Not a comma-separated list/);
  });
});

describe("empty states instruct rather than sit blank", () => {
  it("source registry empty state names the import panel as the next action", () => {
    expect(componentSource).toMatch(/NO SOURCES YET/);
    expect(componentSource).toMatch(/Import your approved creator list to begin/);
  });
  it("review queue and coverage empty states are present", () => {
    expect(componentSource).toMatch(/NO FRAMEWORKS AWAITING REVIEW/);
    expect(componentSource).toMatch(/CORPUS EMPTY/);
  });
});
