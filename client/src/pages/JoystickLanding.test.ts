/* LEGACY DAYFORGE COMPATIBILITY: route literal retained for the existing tenant-provisioning endpoint; customer-facing product is JOYSTICK. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(import.meta.dirname, "JoystickLanding.tsx"),
  "utf8"
);

describe("JOYSTICK public start", () => {
  it("routes a fresh customer through tenant provisioning, not tenant-bound Goldline onboarding", () => {
    expect(source).toContain('const START_PATH = "/dayforge-onboarding";');
    expect(source).not.toContain('const START_PATH = "/onboarding";');
  });
});
