import { describe, expect, it } from "vitest";
import { ADMIN_ALLOWED_HEADERS, isAllowedAdminOrigin } from "./corsConfig";

describe("admin CORS config", () => {
  it("allows the laundrybutler browser client to preflight the intake shared-secret header", () => {
    expect(isAllowedAdminOrigin("https://laundrybutler.bldg.chat")).toBe(true);
    expect(ADMIN_ALLOWED_HEADERS.map((header) => header.toLowerCase())).toContain(
      "x-app-shared-secret"
    );
  });
});
