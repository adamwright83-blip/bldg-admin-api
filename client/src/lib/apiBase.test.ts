import { describe, expect, it } from "vitest";
import { resolveApiBase } from "./apiBase";

describe("resolveApiBase", () => {
  it("keeps admin login and API traffic first-party", () => {
    expect(
      resolveApiBase(
        "admin.bldg.chat",
        "https://bldg-admin-api-production.up.railway.app"
      )
    ).toBe("");
  });

  it("matches the admin host case-insensitively", () => {
    expect(resolveApiBase("ADMIN.BLDG.CHAT", "https://api.example.com")).toBe("");
  });

  it("keeps the new JOYSTICK front doors on the same-origin main API proxy", () => {
    for (const host of [
      "app.gojoystick.com",
      "admin.gojoystick.com",
      "driver.gojoystick.com",
      "gojoystick.com",
    ]) {
      expect(
        resolveApiBase(host, "https://bldg-admin-api-production.up.railway.app")
      ).toBe("");
    }
  });

  it("does not follow a resident API URL from the JOYSTICK API host", () => {
    expect(resolveApiBase("api.gojoystick.com", "https://api.bldg.chat")).toBe("");
    expect(resolveApiBase("www.gojoystick.com", "https://api.bldg.chat")).toBe("");
  });

  it("uses the main first-party booking API on Laundry Butler without changing the resident API host", () => {
    expect(resolveApiBase("laundrybutler.bldg.chat", "https://api.bldg.chat")).toBe("");
    expect(resolveApiBase("laundryfarm.bldg.chat", "https://api.bldg.chat")).toBe("https://api.bldg.chat");
  });

  it("does not send the resident API host through the main same-origin proxy", () => {
    expect(
      resolveApiBase(
        "api.bldg.chat",
        "https://bldg-admin-api-production.up.railway.app"
      )
    ).toBe("https://bldg-admin-api-production.up.railway.app");
  });

  it("uses the configured API for other deployments and trims one trailing slash", () => {
    expect(resolveApiBase("preview.example.com", "https://api.example.com/")).toBe(
      "https://api.example.com"
    );
  });

  it("defaults to same-origin when no API URL is configured", () => {
    expect(resolveApiBase("localhost", undefined)).toBe("");
  });
});
