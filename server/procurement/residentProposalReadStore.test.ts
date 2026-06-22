import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("resident proposal read store boundaries", () => {
  const source = readFileSync("server/procurement/residentProposalReadStore.ts", "utf8");
  it("checks source-record resident ownership and tenant before detail reads", () => {
    expect(source).toContain("sr.bldgUserId = ?");
    expect(source).toContain("rcr.bldgUserId = ? AND rcr.tenantId = ?");
    expect(source).toContain("rap.bldgUserId = ? AND rap.tenantId = ?");
    expect(source.indexOf("if (!owned[0]) return null")).toBeLessThan(source.indexOf("reviewStore.getVersion"));
  });
  it("never treats manual proposals as resident-owned and exposes only ready resident cards", () => {
    expect(source).not.toMatch(/job_card_source_type = 'manual'/);
    expect(source).toContain('card.readiness === "ready_for_resident" ? card : null');
  });
  it("is read-only and has no external, LLM, payment, booking, or dispatch execution", () => {
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(source).not.toMatch(/fetch\(|openai|anthropic|stripe|chargeCard|dispatch|provider_acceptance/i);
  });
});
