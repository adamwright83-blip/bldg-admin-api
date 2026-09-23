import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const manifest = JSON.parse(
  readFileSync(path.join(root, "client/public/goldline.webmanifest"), "utf8")
) as {
  name: string;
  short_name: string;
  icons: Array<{ src: string; sizes: string }>;
};
const installHead = readFileSync(
  path.join(root, "client/src/game/pwa/installPwaHead.ts"),
  "utf8"
);

describe("JOYSTICK web manifest", () => {
  it("names the installed product JOYSTICK and points at existing icons", () => {
    expect(manifest.name).toBe("JOYSTICK");
    expect(manifest.short_name).toBe("JOYSTICK");
    expect(manifest.icons.map(icon => icon.sizes).sort()).toEqual(["192x192", "512x512"]);
    for (const icon of manifest.icons) {
      expect(existsSync(path.join(root, "client/public", icon.src.replace(/^\//, "")))).toBe(true);
    }
    expect(installHead).toContain('href = "/goldline.webmanifest"');
    expect(installHead).toContain('"/assets/goldline/pwa/icon-192.png"');
  });
});
