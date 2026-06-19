import { describe, expect, it, vi } from "vitest";
import {
  connectorResultCanBecomeCandidateEvidence,
  getSourceConnector,
  listSourceConnectors,
} from "./sourceConnectorRegistry";

describe("disabled source connector registry", () => {
  it("registers only disabled Google, Yelp, and Reddit stubs", () => {
    expect(listSourceConnectors().map(adapter => [adapter.sourceKey, adapter.enabled])).toEqual([
      ["google_business_profiles", false],
      ["yelp_business_directory", false],
      ["reddit", false],
    ]);
    expect(getSourceConnector("unknown_source")).toBeNull();
  });

  it("does not make an external call and returns no candidates", async () => {
    const externalCall = vi.fn();
    vi.stubGlobal("fetch", externalCall);
    const adapter = getSourceConnector("google_business_profiles")!;
    const result = await adapter.run({
      query: "florist",
      configurationPresent: true,
      compliance: { sourceKey: adapter.sourceKey, reviewStatus: "proposed" },
    });
    expect(externalCall).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "blocked", candidates: [], externalCallPerformed: false });
    vi.unstubAllGlobals();
  });

  it("blocks missing configuration before any connector work", async () => {
    const adapter = getSourceConnector("yelp_business_directory")!;
    const result = await adapter.run({
      query: "cleaner",
      configurationPresent: false,
      compliance: { sourceKey: adapter.sourceKey, reviewStatus: "needs_legal_review" },
    });
    expect(result.status).toBe("needs_configuration");
    expect(result.candidates).toEqual([]);
  });

  it("keeps the Reddit stub quarantined even when configuration is claimed", async () => {
    const adapter = getSourceConnector("reddit")!;
    const result = await adapter.run({
      query: "local recommendations",
      configurationPresent: true,
      compliance: { sourceKey: "reddit", reviewStatus: "needs_legal_review" },
    });
    expect(result.status).toBe("needs_legal_review");
    expect(result.candidates).toEqual([]);
    expect(result.externalCallPerformed).toBe(false);
  });

  it("fails closed when connector and compliance source keys differ", async () => {
    const result = await getSourceConnector("google_business_profiles")!.run({
      query: "flowers",
      configurationPresent: true,
      compliance: { sourceKey: "reddit", reviewStatus: "approved" },
    });
    expect(result.status).toBe("blocked");
    expect(result.reasons).toContain("connector_compliance_source_mismatch");
  });

  it("never treats disabled connector output as sourced candidate evidence", async () => {
    const compliance = { sourceKey: "reddit", reviewStatus: "needs_legal_review" } as const;
    const result = await getSourceConnector("reddit")!.run({
      query: "recommendations",
      configurationPresent: true,
      compliance,
    });
    expect(connectorResultCanBecomeCandidateEvidence(result, compliance)).toBe(false);
  });
});
