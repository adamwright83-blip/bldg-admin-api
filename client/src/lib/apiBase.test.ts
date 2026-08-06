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

  it("uses the configured API for other deployments and trims one trailing slash", () => {
    expect(resolveApiBase("preview.example.com", "https://api.example.com/")).toBe(
      "https://api.example.com"
    );
  });

  it("defaults to same-origin when no API URL is configured", () => {
    expect(resolveApiBase("localhost", undefined)).toBe("");
  });
});
