import { afterEach, describe, expect, it } from "vitest";
import { resolvePublicPreviewProvider } from "./publicPreviewProvider";

const original = {
  nodeEnv: process.env.NODE_ENV,
  testMode: process.env.DAYFORGE_RELEASE_TEST_MODE,
  mapsKey: process.env.GOOGLE_MAPS_API_KEY,
  placesKey: process.env.GOOGLE_PLACES_API_KEY,
};

afterEach(() => {
  process.env.NODE_ENV = original.nodeEnv;
  process.env.DAYFORGE_RELEASE_TEST_MODE = original.testMode;
  process.env.GOOGLE_MAPS_API_KEY = original.mapsKey;
  process.env.GOOGLE_PLACES_API_KEY = original.placesKey;
});

describe("public preview provider selection", () => {
  it("allows deterministic discovery only in an explicit test environment", async () => {
    process.env.NODE_ENV = "test";
    process.env.DAYFORGE_RELEASE_TEST_MODE = "1";
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    const provider = resolvePublicPreviewProvider();
    expect(provider.name).toBe("dayforge-release-fixture");
    await expect(
      provider.geocode("123 Main St, Los Angeles, CA")
    ).resolves.toMatchObject({
      formattedAddress: "100 Release Gate Way, Los Angeles, CA 90012",
    });
  });

  it("never enables fixture data in production", () => {
    process.env.NODE_ENV = "production";
    process.env.DAYFORGE_RELEASE_TEST_MODE = "1";
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect(() => resolvePublicPreviewProvider()).toThrow(
      "Territory provider is not configured"
    );
  });
});
