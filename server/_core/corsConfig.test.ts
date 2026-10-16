import { describe, expect, it } from "vitest";
import { ADMIN_ALLOWED_HEADERS, isAllowedAdminOrigin } from "./corsConfig";

describe("admin CORS config", () => {
  it("allows the laundrybutler browser client to preflight the intake shared-secret header", () => {
    expect(isAllowedAdminOrigin("https://laundrybutler.bldg.chat")).toBe(true);
    expect(ADMIN_ALLOWED_HEADERS.map((header) => header.toLowerCase())).toContain(
      "x-app-shared-secret"
    );
  });

  it("allows exact JOYSTICK origins and rejects a wildcard gojoystick origin", () => {
    for (const origin of [
      "https://gojoystick.com",
      "https://www.gojoystick.com",
      "https://app.gojoystick.com",
      "https://admin.gojoystick.com",
      "https://driver.gojoystick.com",
      "https://api.gojoystick.com",
      "https://admin.bldg.chat",
      "https://driver.bldg.chat",
    ]) {
      expect(isAllowedAdminOrigin(origin)).toBe(true);
    }
    for (const origin of [
      "https://evil.gojoystick.com",
      "https://gojoystick.com.evil.test",
      "https://admin.gojoystick.com.attacker.test",
      "https://foo.app.gojoystick.com",
      "http://gojoystick.com",
      "https://gojoystick.com/",
      "https://notgojoystick.com",
    ]) {
      expect(isAllowedAdminOrigin(origin)).toBe(false);
    }
  });
});
