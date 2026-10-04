import { describe, it, expect } from "vitest";
import {
  routeExecutiveSkills,
  cabinetRoles,
  activateExecutiveSkills,
  executiveSkillCatalog,
} from "./skillRouter";
import {
  companyEvidenceSchema,
  metricSchema,
  executiveRecommendationSchema,
} from "../../shared/presidentIntelligence";
import { validateJudgment } from "./reasoning";
import { canonicalJson } from "./canonicalJson";
import { parseProviderJson } from "./providerJson";
describe("executive skill routing", () => {
  const cases = [
    [
      "Should we change pricing?",
      [
        "pricing-and-packaging",
        "finance-and-unit-economics",
        "market-research",
      ],
    ],
    [
      "A security incident occurred",
      ["privacy-and-security", "operational-risk", "legal-risk-triage"],
    ],
    [
      "Recruit a CMO",
      ["executive-recruiting", "marketing-strategy", "hiring-and-org-design"],
    ],
    ["Evaluate hiring", ["hiring-and-org-design", "executive-recruiting"]],
    [
      "Landing-page conversion fell",
      ["growth-strategy", "product-strategy", "analytics"],
    ],
  ] as const;
  it.each(cases)("%s", (question, skills) =>
    expect(routeExecutiveSkills(question).skills).toEqual(skills)
  );
  it("keeps game mechanics with Mitch", () =>
    expect(routeExecutiveSkills("Kingdom mechanic").domain).toBe("GAMES"));
  it("does not market a security incident", () =>
    expect(routeExecutiveSkills("security incident").skills).not.toContain(
      "marketing-strategy"
    ));
  it("loads only selected expertise and rejects traversal/unreviewed skills", async () => {
    expect(executiveSkillCatalog).toHaveLength(30);
    const active = await activateExecutiveSkills(["capital-allocation"]);
    expect(active).toHaveLength(1);
    expect(active[0].instructions).toContain("forgone alternative");
    await expect(activateExecutiveSkills(["../../.env"])).rejects.toThrow();
    await expect(
      activateExecutiveSkills(Array(7).fill("company-strategy"))
    ).rejects.toThrow();
  });
  it("every executive discipline has a complete progressive-disclosure contract", async () => {
    for (const skill of executiveSkillCatalog) {
      const [active] = await activateExecutiveSkills([skill.name]);
      expect(active.instructions.startsWith(`---\nname: ${skill.name}\n`)).toBe(
        true
      );
      for (const section of [
        "Use When",
        "Don't Use When",
        "Inputs Required",
        "Workflow",
        "Decision Frameworks",
        "Output Contract",
        "Truth Rules",
        "Escalation Conditions",
        "Examples",
        "Edge Cases",
        "References",
        "Evals",
      ])
        expect(active.instructions).toContain(`## ${section}`);
      expect(active.instructions).not.toMatch(/TODO|PLACEHOLDER/);
    }
  });
  it("includes a critic only for consequential decisions", () => {
    expect(cabinetRoles("pricing", true).members).toContainEqual({
      skill: "pre-mortem-red-team",
      role: "CRITIC",
    });
    expect(cabinetRoles("pricing", false).members).toHaveLength(3);
  });
});
describe("intelligence truth", () => {
  const evidence = companyEvidenceSchema.parse({
    id: "source",
    source: "git:main:launch.md",
    capturedAt: "2026-10-04T00:00:00Z",
    sourceAt: null,
    sha256: "a".repeat(64),
    kind: "FACT",
    statement: "Scheduled backups are not configured.",
    confidence: 1,
    availability: "AVAILABLE",
    origin: "TEST_FIXTURE",
    expiresAt: null,
  });
  const judgment = {
    summary: "Review the documented gate",
    evidenceIds: ["source"],
    facts: [],
    inferences: [],
    unknowns: [],
    preferredOption: "Verify recovery",
    bestAlternative: "Verify retention",
    opportunityCost: "Limited engineering time",
    falsification: "A newer restore record",
    nextAction: "Read the evidence",
    founderDecision: null,
    skills: ["company-strategy"],
    thesisUpdates: [],
    objectives: [],
  };
  it("requires literal quotations, not attributed paraphrases, as facts", () => {
    expect(
      validateJudgment(
        {
          ...judgment,
          facts: [{ statement: evidence.statement, evidenceIds: ["source"] }],
        },
        [evidence]
      ).facts
    ).toHaveLength(1);
    expect(() =>
      validateJudgment(
        {
          ...judgment,
          facts: [
            {
              statement: "The document says backups are missing",
              evidenceIds: ["source"],
            },
          ],
        },
        [evidence]
      )
    ).toThrow("exact source excerpt");
  });
  it("model synthesis cannot create a FACT thesis or adopted DECISION", () => {
    for (const kind of ["FACT", "DECISION"])
      expect(() =>
        validateJudgment(
          {
            ...judgment,
            thesisUpdates: [
              {
                topic: "RISK",
                claim: "Recovery is important",
                kind,
                evidenceIds: ["source"],
                confidence: 1,
                reviewedAt: "2026-10-04T00:00:00Z",
                falsification: "New evidence",
                status: "CURRENT",
              },
            ],
          },
          [evidence]
        )
      ).toThrow();
  });
  it("database object-key ordering does not create competing opinions", () =>
    expect(canonicalJson({ b: { d: 2, c: 1 }, a: 0 })).toBe(
      canonicalJson({ a: 0, b: { c: 1, d: 2 } })
    ));
  it("transport JSON metadata is not mistaken for business data", () => {
    expect(
      parseProviderJson(
        '```json\n{"$schema":"https://json-schema.org/draft/2020-12/schema","x":1}\n```'
      )
    ).toEqual({ x: 1 });
    expect(() =>
      parseProviderJson('{"$schema":"https://untrusted.invalid/schema","x":1}')
    ).toThrow();
  });
  it("rejects unavailable fact evidence", () =>
    expect(() =>
      companyEvidenceSchema.parse({
        id: "x",
        source: "PostHog",
        capturedAt: new Date().toISOString(),
        sourceAt: null,
        sha256: "a".repeat(64),
        kind: "FACT",
        statement: "No users",
        confidence: 1,
        availability: "UNAVAILABLE",
        origin: "REAL",
        expiresAt: null,
      })
    ).toThrow());
  it("does not manufacture unknown metrics", () =>
    expect(() =>
      metricSchema.parse({
        name: "MRR",
        parent: null,
        causalHypothesis: "value",
        source: "unavailable",
        asOf: null,
        confidence: 0,
        availability: "UNKNOWN",
        value: 0,
        unit: "USD",
      })
    ).toThrow());
  it("requires alternatives and opportunity cost", () =>
    expect(() =>
      executiveRecommendationSchema.parse({ summary: "do something" })
    ).toThrow());
  it("cannot cite invented evidence", () => {
    const value = {
      summary: "x",
      evidenceIds: ["invented"],
      facts: [],
      inferences: [],
      unknowns: [],
      preferredOption: "x",
      bestAlternative: "wait",
      opportunityCost: "time",
      falsification: "test",
      nextAction: "read",
      founderDecision: null,
      skills: ["company-strategy"],
      thesisUpdates: [],
      objectives: [],
    };
    expect(() => validateJudgment(value, [])).toThrow("missing evidence");
  });
});
