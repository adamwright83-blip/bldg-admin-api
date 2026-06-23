import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("FirstRealProposalBootstrapPage source contract", () => {
  it("uses the admin bootstrap API and preserves dry-run copy", () => {
    const source = readFileSync(new URL("./FirstRealProposalBootstrapPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("firstRealProposalBootstrap.runbook.useQuery");
    expect(source).toContain("assemblyChecklist.useQuery");
    expect(source).toContain("Dry-run first");
  });

  it("does not expose execution CTAs for sending, booking, payment, dispatch, consent, or LLM", () => {
    const source = readFileSync(new URL("./FirstRealProposalBootstrapPage.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/onClick=\{[^}]*(send|book|charge|capture|dispatch|consent|llm)/i);
    expect(source).not.toMatch(/book now|charge now|capture payment|dispatch now/i);
    expect(source).toContain("does not send outreach, book, charge, dispatch, accept providers, create consents, or run LLMs");
  });
});
