import { afterEach, describe, expect, it } from "vitest";
import { isIOS, isStandalone } from "./pwaEnvironment";

describe("pwaEnvironment", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { navigator?: unknown }).navigator;
  });

  it("reports not standalone with no window", () => {
    expect(isStandalone()).toBe(false);
  });

  it("reports standalone via display-mode media query", () => {
    (globalThis as { window?: unknown }).window = {
      matchMedia: (query: string) => ({ matches: query.includes("standalone") }),
      navigator: {},
    };
    expect(isStandalone()).toBe(true);
  });

  it("reports standalone via iOS navigator.standalone", () => {
    (globalThis as { window?: unknown }).window = {
      matchMedia: () => ({ matches: false }),
      navigator: { standalone: true },
    };
    expect(isStandalone()).toBe(true);
  });

  it("reports not iOS with no navigator", () => {
    expect(isIOS()).toBe(false);
  });

  it("detects an iPhone user agent", () => {
    (globalThis as { navigator?: unknown }).navigator = {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    };
    expect(isIOS()).toBe(true);
  });

  it("does not flag an Android user agent as iOS", () => {
    (globalThis as { navigator?: unknown }).navigator = {
      userAgent: "Mozilla/5.0 (Linux; Android 14)",
    };
    expect(isIOS()).toBe(false);
  });
});
