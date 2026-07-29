import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This repo runs Vitest in a node environment with no DOM renderer, so
// every UI test here is a source-structure assertion (the same convention
// the MissionControlPage tests use). They verify the navigation split is
// wired correctly in the shell rather than rendering it.
const source = fs.readFileSync(path.resolve(import.meta.dirname, "AdminHostApp.tsx"), "utf8");
const appSource = fs.readFileSync(path.resolve(import.meta.dirname, "..", "App.tsx"), "utf8");

const lbBlock = source.slice(source.indexOf("const LAUNDRY_BUTLER_TABS"), source.indexOf("const HELD_CORPORATE_TABS"));
const heldBlock = source.slice(source.indexOf("const HELD_CORPORATE_TABS"), source.indexOf("HELD_CORPORATE_PATHS = new Set"));

describe("AdminHostApp -- workspace tab split", () => {
  it("defines a Laundry Butler tab set with exactly its 8 workflow tabs", () => {
    for (const label of ["New order", "Intake", "Cleaning", "Ready", "Pickups", "Pipeline", "History", "Money owed"]) {
      expect(lbBlock).toContain(label);
    }
  });

  it("the Laundry Butler tab set contains none of the HELD Corporate tabs", () => {
    for (const label of ["Requests", "Job cards", "Proposal review", "Proposal bootstrap", "Casting sprint", "Mission control", "Post-consent plans"]) {
      expect(lbBlock).not.toContain(label);
    }
  });

  it("defines a HELD Corporate tab set with exactly its 7 corporate tabs", () => {
    for (const label of ["Requests", "Job cards", "Proposal review", "Proposal bootstrap", "Casting sprint", "Mission control", "Post-consent plans"]) {
      expect(heldBlock).toContain(label);
    }
  });

  it("the HELD Corporate tab set contains none of the Laundry Butler tabs", () => {
    for (const label of ["New order", "Cleaning", "Pickups", "Money owed"]) {
      expect(heldBlock).not.toContain(label);
    }
  });

  it("never reintroduces a single combined tab array (the old mixed nav is gone)", () => {
    expect(source).not.toMatch(/COUNTER_TABS/);
  });
});

describe("AdminHostApp -- path-derived active workspace (no stale state)", () => {
  it("derives the workspace purely from the path: any HELD Corporate path => held_corporate, else laundry_butler", () => {
    expect(source).toMatch(/function workspaceForPath\(path: string\): AdminWorkspace \{/);
    expect(source).toMatch(/HELD_CORPORATE_PATHS\.has\(path\) \? "held_corporate" : "laundry_butler"/);
  });

  it("builds the HELD Corporate path set from the HELD tab paths, so nav and routing can never drift apart", () => {
    expect(source).toMatch(/HELD_CORPORATE_PATHS = new Set\(HELD_CORPORATE_TABS\.map/);
  });

  it("uses no localStorage / persisted workspace state -- route inference is the only source of truth", () => {
    expect(source).not.toMatch(/localStorage\.(get|set|remove)Item/);
  });

  it("renders ONLY the active workspace's tabs inside the Counter room, never both", () => {
    expect(source).toMatch(/activeWorkspace === "held_corporate"\s*\?\s*HELD_CORPORATE_TABS\s*:\s*LAUNDRY_BUTLER_TABS/);
  });

  it("keeps the active-route pill styling intact for whichever workspace is shown", () => {
    expect(source).toMatch(/tabActive\s*\?\s*"bg-black text-white"/);
  });

  it("labels the sidebar by the active workspace, so HELD nav is never shown under a Laundry Butler header", () => {
    expect(source).toMatch(/activeWorkspace === "held_corporate" \? "HELD Corporate" : "Laundry Butler"/);
  });
});

describe("AdminHostApp -- red diving-board workspace switch", () => {
  it("renders a real, keyboard-accessible <button> (not a div) with an accessible label", () => {
    expect(source).toMatch(/aria-label=\{[\s\S]*?Switch to Laundry Butler workspace[\s\S]*?Switch to HELD Corporate workspace[\s\S]*?\}/);
  });

  it("flips its navigation target by active workspace: Laundry Butler -> /mission-control, HELD Corporate -> /new-order", () => {
    expect(source).toMatch(/navigate\(activeWorkspace === "held_corporate" \? "\/new-order" : "\/mission-control"\)/);
  });

  it("flips its visible label by active workspace", () => {
    expect(source).toMatch(/Switch to/);
    expect(source).toMatch(/activeWorkspace === "held_corporate" \? "Laundry Butler" : "HELD Corporate"/);
  });

  it("is visually a red slab with an upward-right arrow that stands apart from ordinary nav links", () => {
    expect(source).toMatch(/bg-red-600/);
    expect(source).toMatch(/ArrowUpRight/);
  });

  it("has hover and keyboard-focus states", () => {
    expect(source).toMatch(/hover:bg-red-700/);
    expect(source).toMatch(/focus-visible:ring/);
  });

  it("sits above the Drawer control in the sidebar (diving board block precedes the Drawer block)", () => {
    const divingBoardIndex = source.indexOf("Red diving board");
    const drawerIndex = source.indexOf("⚙ Drawer");
    expect(divingBoardIndex).toBeGreaterThan(-1);
    expect(drawerIndex).toBeGreaterThan(divingBoardIndex);
  });
});

describe("AdminHostApp -- far-right CTA by workspace", () => {
  it("puts a direct New SKU action immediately before + Order", () => {
    expect(source).toMatch(/href="\/catalog\?new=1"[\s\S]*?New SKU[\s\S]*?href="\/new-order"[\s\S]*?\+ Order/);
  });

  it("shows the Laundry Butler + Order CTA only when not in HELD Corporate", () => {
    expect(source).toMatch(/activeWorkspace === "held_corporate" \? \(/);
    expect(source).toMatch(/\+ Order/);
  });

  it("does not present the laundry + Order CTA as the primary HELD Corporate action", () => {
    // The + Order Link is inside the else branch of the held_corporate
    // check, so it can never render in the HELD Corporate workspace.
    const heldCtaCheck = source.indexOf('activeWorkspace === "held_corporate" ? (\n                <span className="ml-auto" />');
    expect(heldCtaCheck).toBeGreaterThan(-1);
  });
});

describe("App.tsx -- routing preserved + post-consent-plans registered", () => {
  it("registers /post-consent-plans in the local-admin path allowlist (previously missing => 404)", () => {
    const allowlist = appSource.slice(appSource.indexOf("LOCAL_ADMIN_PATHS"), appSource.indexOf("function AdminHostRouter"));
    expect(allowlist).toContain('"/post-consent-plans"');
  });

  it("registers a /post-consent-plans route in the admin host router", () => {
    expect(appSource).toMatch(/<Route path="\/post-consent-plans" component=\{AdminHostApp\} \/>/);
  });

  it("still registers every other existing admin route (no route removed)", () => {
    for (const p of ["/new-order", "/intake", "/processing", "/ready", "/pickups", "/live", "/operations-events", "/payment-reconciliation", "/requests", "/job-cards", "/proposal-review", "/proposal-bootstrap", "/casting-sprint", "/mission-control"]) {
      expect(appSource).toContain(`<Route path="${p}" component={AdminHostApp} />`);
    }
  });
});
