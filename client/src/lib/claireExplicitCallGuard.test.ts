import { describe, expect, it } from "vitest";
import {
  CLAIRE_EXPLICIT_TAP_TTL_MS,
  consumeClaireExplicitTap,
  isClaireCallBeforeDriveRequest,
  recordClaireExplicitTap,
} from "./claireExplicitCallGuard";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe("Claire explicit outbound-call guard", () => {
  it("recognizes only the pre-drive POST mutation", () => {
    expect(
      isClaireCallBeforeDriveRequest(
        "https://admin.bldg.chat/api/trpc/system.claire.callBeforeDrive",
        { method: "POST" }
      )
    ).toBe(true);
    expect(
      isClaireCallBeforeDriveRequest(
        "https://admin.bldg.chat/api/trpc/system.claire.callBeforeDrive",
        { method: "GET" }
      )
    ).toBe(false);
    expect(
      isClaireCallBeforeDriveRequest(
        "https://admin.bldg.chat/api/trpc/system.field.today",
        { method: "POST" }
      )
    ).toBe(false);
  });

  it("allows exactly one request for one fresh explicit tap", () => {
    const storage = memoryStorage();
    recordClaireExplicitTap(storage, 1_000);

    expect(consumeClaireExplicitTap(storage, 1_500)).toBe(true);
    expect(consumeClaireExplicitTap(storage, 1_501)).toBe(false);
  });

  it("rejects stale intent so a delayed replay cannot dial", () => {
    const storage = memoryStorage();
    recordClaireExplicitTap(storage, 1_000);

    expect(
      consumeClaireExplicitTap(storage, 1_000 + CLAIRE_EXPLICIT_TAP_TTL_MS + 1)
    ).toBe(false);
  });
});
