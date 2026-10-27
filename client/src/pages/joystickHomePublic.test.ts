/**
 * Regression for the static page gojoystick.com/ actually serves.
 * Does not describe the entry funnel. Signup handoff and world choice belong
 * to docs/goldline/FIRST_TEN_MINUTES.md (#715) and Slice A.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const homeDir = path.join(repoRoot, "client/public/joystick-home");

function read(name: string): string {
  return fs.readFileSync(path.join(homeDir, name), "utf8");
}

function localAssetPaths(source: string): string[] {
  return [...source.matchAll(/\/joystick-home\/[^"'()\s]+\.[a-z0-9]+/gi)].map(match =>
    match[0].replace(/[.,;]+$/, "")
  );
}

describe("static JOYSTICK homepage shell", () => {
  const html = read("index.html");
  const script = read("app.js");
  const css = read("styles.css");
  const combined = `${html}\n${script}\n${css}`;

  it("parses the homepage script", () => {
    const result = spawnSync(process.execPath, ["--check", path.join(homeDir, "app.js")], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });

  it("keeps every referenced homepage file on disk", () => {
    const paths = [...new Set(localAssetPaths(combined))].sort();
    expect(paths.length).toBeGreaterThan(10);
    const missing = paths.filter(asset => !fs.existsSync(path.join(repoRoot, "client/public", asset)));
    expect(missing).toEqual([]);
    for (const name of ["mara", "rook", "sable", "luma"]) {
      expect(fs.existsSync(path.join(homeDir, "assets/acting", `${name}.webp`))).toBe(true);
      expect(fs.existsSync(path.join(homeDir, "assets/acting", `prop-${name}.webp`))).toBe(true);
    }
  });

  it("keeps the sample shell the public page opens in place", () => {
    for (const id of [
      "sample-dialog",
      "sample-title",
      "sample-story",
      "sample-actions",
      "sample-image",
      "about-dialog",
      "nav-menu",
      "mobile-menu",
      "tab-cozy",
      "tab-road",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("data-play");
    expect(html).toContain('data-world="cozy"');
    expect(html).toContain('data-world="road"');
    expect(script).toContain("function startSample");
    expect(combined).not.toContain("checkout.stripe.com");
    expect(combined).not.toContain("checkout_live: true");
  });

  it("rewrites only the apex root to that static page", () => {
    const middleware = fs.readFileSync(path.join(repoRoot, "middleware.js"), "utf8");
    expect(middleware).toContain('matcher: "/"');
    expect(middleware).toContain('host === "gojoystick.com"');
    expect(middleware).toContain('"/joystick-home/index.html"');
    expect(middleware).toContain('"x-middleware-next": "1"');
    expect(middleware.match(/matcher:/g)).toHaveLength(1);
  });
});
