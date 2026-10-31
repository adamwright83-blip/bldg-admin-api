import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BUSINESS_KNOWLEDGE_RULE, businessKnowledgeForBriefing, type BusinessUnderstanding } from "../../shared/businessKnowledge";
import type { FindingView } from "../../shared/firstTenMinutesFindings";
import type { ClaireDriveContext } from "../claire/contextAssembler";
import { answerClairePreDriveFollowUp } from "../claire/preDriveConversation";
import { buildClaireVerifiedFactInventory } from "../claire/verifiedFactInventoryFromContext";
import { settlePortrait, type PortraitKnowledge } from "../firstTenMinutes/portrait/write";
import { portraitKnowledgeOf, quietOpportunity, quietTerms } from "./onboarding";

const understanding: BusinessUnderstanding = {
  journeyId: "j1",
  understoodAt: "2026-10-31T16:00:00.000Z",
  owner: { name: "Alex Morgan", email: "alex@laundryfarm.example" },
  current: [
    { id: "farm", kind: "company", name: "Laundry Farm", status: "active", statusBasis: "inferred", statusWhy: "recent pickups", lastActivityAt: "2026-10-20T12:00:00.000Z", role: null, sources: [] },
    { id: "butler", kind: "brand", name: "Laundry Butler", status: "active", statusBasis: "inferred", statusWhy: "recent mail", lastActivityAt: "2026-10-12T12:00:00.000Z", role: null, sources: [] },
  ],
  prelaunch: [{ id: "joystick", kind: "product", name: "JOYSTICK", status: "prelaunch", statusBasis: "observed", statusWhy: "roadmap", lastActivityAt: "2026-10-28T12:00:00.000Z", role: null, sources: [] }],
  dormant: [],
  historical: [{ id: "web", kind: "project", name: "Website proposals", status: "historical", statusBasis: "user_corrected", statusWhy: "You said so.", lastActivityAt: "2026-04-19T12:00:00.000Z", role: null, sources: [] }],
  unknown: [],
  people: [{ id: "russell", kind: "person", name: "Russell Hale", status: null, statusBasis: "observed", statusWhy: null, lastActivityAt: null, role: "Operations lead", sources: [] }],
  relationships: [
    { id: "rel1", subject: "Laundry Butler", type: "related_operation", object: "Laundry Farm", basis: "user_confirmed", detail: "Yes, but it's complicated. — Same crew, separate contracts.", confidence: 100, authorizesFinancialMerge: false },
    { id: "rel2", subject: "Goldline", type: "part_of", object: "JOYSTICK", basis: "observed", detail: null, confidence: 70, authorizesFinancialMerge: false },
  ],
  conflicts: [],
  openQuestions: [],
  resolvedQuestions: [{ id: "q1", kind: "relationship", question: "Are Laundry Farm and Laundry Butler separate businesses?", followUp: null, status: "resolved", answer: "Yes, but it's complicated.", explanation: "I'll keep them related but distinct." }],
  coverageGaps: [{ source: "sheets", state: "partial", reasons: ["sheets_api 403 SERVICE_DISABLED; first tab only via Drive export"] }],
};

const finding = (id: string, payload: FindingView["payload"]): FindingView => ({ id, companion: null, status: "proposed", payload, sources: [{ provider: "gmail", ref: id, at: "2026-04-19T12:00:00.000Z", who: "you", label: "You, to Bella Hair Studio", excerpt: "a five-page website", url: null }], correction: null });

describe("the portrait consumes the reconciled understanding", () => {
  const knowledge = portraitKnowledgeOf(understanding) as PortraitKnowledge;
  const service = finding("svc", { kind: "service", name: "Website design", quote: "I build websites for salons", at: "2026-04-19T12:00:00.000Z" });
  const draft = (text: string, ids: string[]) => ({ paragraphs: [{ sentences: [{ text, findingIds: ids }, { text: "You run Laundry Farm and Laundry Butler, related but not one company.", findingIds: ["k:rel1", "k:farm"] }] }] });

  it("never presents past work as current: a present-tense line resting only on it is struck", () => {
    expect(quietTerms(understanding)).toContain("website");
    const present = settlePortrait(draft("You build websites for salons.", ["svc"]), [service], knowledge);
    const past = settlePortrait(draft("You used to build websites for salons.", ["svc"]), [service], knowledge);
    expect(present).toBeNull();
    expect(past?.paragraphs[0].map(line => line.text)).toEqual(["You used to build websites for salons.", "You run Laundry Farm and Laundry Butler, related but not one company."]);
  });

  it("the person's own product may be named, even when it is called JOYSTICK, but only when cited", () => {
    const cited = settlePortrait(draft("You're preparing JOYSTICK for launch.", ["k:joystick"]), [], knowledge);
    expect(cited?.paragraphs[0][0].text).toBe("You're preparing JOYSTICK for launch.");
    const uncited = settlePortrait(draft("You're preparing JOYSTICK for launch.", ["k:farm"]), [], knowledge);
    expect(uncited).toBeNull();
  });

  it("without knowledge, nothing about the existing portrait changes", () => {
    expect(settlePortrait(draft("You build websites for salons.", ["svc"]), [service])).toBeNull(); // second line cites unknown ids
    const plain = { paragraphs: [{ sentences: [{ text: "You build websites for salons.", findingIds: ["svc"] }, { text: "You build websites for salons too.", findingIds: ["svc"] }] }] };
    expect(settlePortrait(plain, [service])?.paragraphs[0]).toHaveLength(2);
  });

  it("the chapter never leads to work that has gone quiet", () => {
    const request = finding("req", { kind: "request", from: { name: "Bella", address: "b@bella.example" }, quote: "Can you redo our website?", wants: "a new website", recurring: false, at: "2026-04-01T00:00:00.000Z", subject: "Website" });
    const opportunity = finding("opp", { kind: "opportunity", type: "unanswered", person: { name: "Bella", address: "b@bella.example" }, requestId: "req", replyId: null, serviceId: null, summary: "Bella asked for a website" } as any);
    expect(quietOpportunity(opportunity, [request, opportunity], ["website"])).toBe(true);
    expect(quietOpportunity(opportunity, [request, opportunity], [])).toBe(false);
  });
});

describe("Claire knows it, everywhere she speaks, under the truth rules", () => {
  const base: ClaireDriveContext = {
    phase: "pre_drive",
    generatedAt: "2026-10-31T16:00:00.000Z",
    businessDate: "2026-10-31",
    actorId: "operator-1",
    truthLaw: "game_projection_never_creates_business_truth",
    nextFixedCommitment: null,
    blockers: [],
    relevantTimeline: [],
    mission: null,
  };
  const briefing = businessKnowledgeForBriefing(understanding)!;

  it("the briefing keeps basis, dates, the person's words and the gaps; no money or merge anywhere", () => {
    expect(briefing.current.map(item => item.name)).toEqual(["Laundry Farm", "Laundry Butler"]);
    expect(briefing.past[0]).toMatchObject({ name: "Website proposals", basis: "operator" });
    expect(briefing.relationships[0]).toMatchObject({ a: "Laundry Butler", relation: "related_operation", basis: "operator", operatorWords: expect.stringContaining("separate contracts") });
    expect(briefing.relationships[1]).toMatchObject({ basis: "evidence", operatorWords: null });
    expect(briefing.incompleteSources[0].source).toBe("sheets");
    expect(JSON.stringify(briefing)).not.toMatch(/revenue|merge|\$/i);
    expect(businessKnowledgeForBriefing(null)).toBeNull();
  });

  it("the operator's answers are verified facts; JOYSTICK's readings are only pending", () => {
    const inventory = buildClaireVerifiedFactInventory({ ...base, businessKnowledge: briefing }).toPromptSection();
    expect(inventory).toContain("[VERIFIED] (business-relationship:rel1)");
    expect(inventory).toContain("[PENDING] (business-relationship:rel2)");
    expect(inventory).toContain("[PENDING] (business-status:farm)");
    expect(inventory).toContain("[VERIFIED] (business-status:web) Website proposals is past work (the operator said so)");
  });

  async function prompt(context: ClaireDriveContext, extra: Partial<Parameters<typeof answerClairePreDriveFollowUp>[0]> = {}) {
    const invokeText = vi.fn().mockResolvedValue("Laundry Butler is your building service.");
    await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "Are Laundry Farm and Laundry Butler the same business?", brief: null, context, ...extra },
      { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const messages = invokeText.mock.calls[0]![0].messages as Array<{ role: string; content: string }>;
    return { system: messages[0]!.content, current: JSON.parse(messages[messages.length - 1]!.content).currentContext };
  }

  it("carries the understanding and its rule on the phone and text line and in Brain V2; nothing when absent", async () => {
    for (const extra of [{}, { semanticAuthority: "brain_v2" as const, surface: "desktop" as const }]) {
      const { system, current } = await prompt({ ...base, businessKnowledge: briefing }, extra);
      expect(system).toContain(BUSINESS_KNOWLEDGE_RULE);
      expect(current.businessKnowledge).toEqual(briefing);
      expect(current.factInventory).toContain("(business-relationship:rel1)");
    }
    const { system, current } = await prompt(base);
    expect(system).not.toContain("businessKnowledge");
    expect(current).not.toHaveProperty("businessKnowledge");
  });

  it("the rule says what the brief requires", () => {
    expect(BUSINESS_KNOWLEDGE_RULE).toContain("never mean one legal company");
    expect(BUSINESS_KNOWLEDGE_RULE).toContain("Never ask an answered question again");
    expect(BUSINESS_KNOWLEDGE_RULE).toContain("never that they stopped");
    expect(BUSINESS_KNOWLEDGE_RULE).toContain("never invent them");
  });
});

describe("Daphne's boundary: business knowledge is not Daphne's, and Daphne is not a business database", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap(name => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
    });
  const root = join(__dirname, "..");

  it("business knowledge never imports or writes Daphne's stores", () => {
    for (const file of files(join(root, "businessKnowledge"))) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from ["'][^"']*agents\/daphne/);
      expect(text, file).not.toMatch(/daphne_(observations|epistemic_claims|goals|meta_preferences)/);
    }
  });

  it("Daphne never imports business knowledge", () => {
    for (const file of files(join(root, "agents", "daphne"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/businessKnowledge/);
    }
  });
});
