import { describe, expect, it, vi } from "vitest";

// previewSalesIntelSourceImport checks each candidate against the real
// registry (findSalesIntelSourceByCanonicalUrl) to classify "already
// registered" — mocked here so this file can run in the standard suite
// without a database. DB-backed "already_exists" classification against
// real data is covered by the salesIntel DB integration suite.
vi.mock("./salesIntelSourceRegistryStore", () => ({
  findSalesIntelSourceByCanonicalUrl: vi.fn(async () => null),
}));

const { previewSalesIntelSourceImport } = await import("./salesIntelSourceImportService");

const validChannelId = "UC" + "a".repeat(22);

function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    creatorName: "Test Sales Trainer",
    platform: "youtube",
    canonicalSourceUrl: `https://www.youtube.com/channel/${validChannelId}`,
    sourceType: "youtube_channel",
    acquisitionMode: "AUTO_YOUTUBE",
    verifiedAt: "2026-08-11T00:00:00.000Z",
    verificationMethod: "manual URL check",
    ...overrides,
  };
}

describe("previewSalesIntelSourceImport", () => {
  it("classifies a structurally valid, canonicalizable entry as new", async () => {
    const [result] = await previewSalesIntelSourceImport([validEntry()]);
    expect(result.classification).toBe("new");
    expect(result.canonicalUrl).toBe(`https://www.youtube.com/channel/${validChannelId}`);
  });

  it("rejects an entry missing verification fields", async () => {
    const entry = validEntry();
    delete (entry as Record<string, unknown>).verificationMethod;
    const [result] = await previewSalesIntelSourceImport([entry]);
    expect(result.classification).toBe("invalid");
  });

  it("rejects an unsupported acquisition-mode/type pairing", async () => {
    const [result] = await previewSalesIntelSourceImport([
      validEntry({ sourceType: "instagram_profile_reference", acquisitionMode: "AUTO_YOUTUBE" }),
    ]);
    expect(result.classification).toBe("unsupported");
  });

  it("rejects a URL that cannot be canonicalized for its declared type", async () => {
    const [result] = await previewSalesIntelSourceImport([
      validEntry({ canonicalSourceUrl: "https://example.com/not-a-channel" }),
    ]);
    expect(result.classification).toBe("invalid");
  });

  it("flags a second identical entry in the same manifest as a canonical duplicate", async () => {
    const results = await previewSalesIntelSourceImport([validEntry(), validEntry()]);
    expect(results[0].classification).toBe("new");
    expect(results[1].classification).toBe("canonical_duplicate");
  });

  it("flags www/mobile/trailing-slash URL variants as the same canonical duplicate", async () => {
    const results = await previewSalesIntelSourceImport([
      validEntry({ canonicalSourceUrl: `https://www.youtube.com/channel/${validChannelId}/` }),
      validEntry({ canonicalSourceUrl: `https://m.youtube.com/channel/${validChannelId}` }),
    ]);
    expect(results[0].classification).toBe("new");
    expect(results[1].classification).toBe("canonical_duplicate");
  });

  it("processes an empty-safe manifest without throwing", async () => {
    await expect(previewSalesIntelSourceImport([])).resolves.toEqual([]);
  });

  it("never crashes on a completely malformed raw entry", async () => {
    const results = await previewSalesIntelSourceImport([{ garbage: true }, null, "a string"]);
    expect(results).toHaveLength(3);
    expect(results.every(r => r.classification === "invalid")).toBe(true);
  });
});
