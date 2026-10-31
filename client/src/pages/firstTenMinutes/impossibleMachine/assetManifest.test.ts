import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IMPOSSIBLE_MACHINE_ASSET_MANIFEST } from "./assetManifest";

const ASSETS_ROOT = path.resolve(
  __dirname,
  "../../../../public/assets/first-ten/impossible-machine"
);

/**
 * Programmatic verification of all required Impossible Machine visual assets,
 * including PNG IHDR dimensions and genuine RGBA alpha channel (colorType === 6) verification.
 */
function readPngHeader(filePath: string): { width: number; height: number; colorType: number } {
  const buf = fs.readFileSync(filePath);
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  expect(buf[0]).toBe(0x89);
  expect(buf[1]).toBe(0x50);
  expect(buf[2]).toBe(0x4e);
  expect(buf[3]).toBe(0x47);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf[25]; // 6 = RGBA with genuine alpha channel
  return { width, height, colorType };
}

describe("THE IMPOSSIBLE MACHINE — Asset Manifest & Alpha Channel Verification", () => {
  it("contains all required layered assets on disk with non-zero size", () => {
    expect(IMPOSSIBLE_MACHINE_ASSET_MANIFEST.length).toBeGreaterThanOrEqual(12);
    for (const entry of IMPOSSIBLE_MACHINE_ASSET_MANIFEST) {
      const fullPath = path.join(ASSETS_ROOT, entry.filename);
      expect(fs.existsSync(fullPath), `Missing asset: ${entry.filename}`).toBe(true);
      const stat = fs.statSync(fullPath);
      expect(stat.size).toBeGreaterThan(500);
    }
  });

  it("verifies genuine RGBA alpha channels and exact dimensions on all transparent PNG sprites", () => {
    for (const entry of IMPOSSIBLE_MACHINE_ASSET_MANIFEST) {
      if (!entry.filename.endsWith(".png")) continue;
      const fullPath = path.join(ASSETS_ROOT, entry.filename);
      const header = readPngHeader(fullPath);
      expect(header.width).toBe(entry.dimensions.width);
      expect(header.height).toBe(entry.dimensions.height);
      if (entry.hasAlphaChannel) {
        // PNG colorType 6 is Truecolor with Alpha (RGBA)
        expect(header.colorType, `${entry.filename} must have an RGBA alpha channel`).toBe(6);
      }
    }
  });
});
