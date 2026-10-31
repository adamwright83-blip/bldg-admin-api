import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { BRIEF_NAMES, SCENARIO_NOW, onboardingScenario } from "../firstTenMinutes/testSupport/onboardingScenario";

/**
 * The customer journey's knowledge path on real MySQL with a controlled Google: the investigation during the reading,
 * Claire's questions before the portrait, the portrait's knowledge, the workspace binding, and Claire's tenant read
 * afterwards. Told with the brief's own names; nothing here is seeded, it is all read from the controlled accounts.
 */
const url = process.env.DATABASE_URL ?? "";
const allowed = (() => {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.pathname === "/first_ten_test";
  } catch {
    return false;
  }
})();
process.env.JWT_SECRET ||= "first-ten-integration-secret-000000000000";

describe.skipIf(!allowed)("onboarding intelligence through the customer journey (MySQL)", () => {
  const before = process.env.JOYSTICK_ONBOARDING_INTELLIGENCE;
  beforeAll(() => {
    process.env.JOYSTICK_ONBOARDING_INTELLIGENCE = "on";
  });
  afterAll(() => {
    if (before === undefined) delete process.env.JOYSTICK_ONBOARDING_INTELLIGENCE;
    else process.env.JOYSTICK_ONBOARDING_INTELLIGENCE = before;
  });

  const names = BRIEF_NAMES;
  const journey = { id: randomUUID(), kind: "own", tenantId: null as string | null } as any;
  /** the workspace the journey became, once a test provisions it */
  let provisioned: any = null;

  it("is entirely inert when the flag is off, and for Nina's example", async () => {
    const { onboardingQuestionState, onboardingPortraitKnowledge, readTenantBusinessUnderstanding } = await import("./onboarding");
    process.env.JOYSTICK_ONBOARDING_INTELLIGENCE = "off";
    expect(await onboardingQuestionState(journey)).toEqual({ enabled: false, question: null, settled: true, lastExplanation: null });
    expect(await onboardingPortraitKnowledge(journey)).toBeNull();
    expect(await readTenantBusinessUnderstanding("tenant-x", { journeyForTenant: async () => { throw new Error("must not read"); } })).toBeNull();
    process.env.JOYSTICK_ONBOARDING_INTELLIGENCE = "on";
    expect((await onboardingQuestionState({ ...journey, kind: "example" })).enabled).toBe(false);
  });

  it("investigates during the reading, keeping the reading's lease, and says what went quiet", async () => {
    const { fakeAccess, fakeGoogle } = await import("../firstTenMinutes/testSupport/fakeGoogle");
    const { investigateJourney } = await import("./onboarding");
    let beats = 0;
    const outcome = await investigateJourney(journey, fakeAccess(names.owner.email), async () => void (beats += 1), {
      fetch: fakeGoogle(onboardingScenario(names), { now: SCENARIO_NOW }).fetch,
      now: () => SCENARIO_NOW,
      env: {},
    });
    expect(beats).toBeGreaterThan(0);
    expect(outcome.quietTerms).toContain("website");
    expect(outcome.notes.join(" ")).toContain("deterministic investigator ran alone");
  }, 120_000);

  it("Claire asks before the portrait: one at a time, a nuanced answer gets a follow-up, then the portrait may be written", async () => {
    const { onboardingQuestionState, answerOnboardingQuestion, onboardingPortraitKnowledge } = await import("./onboarding");
    const first = await onboardingQuestionState(journey);
    expect(first).toMatchObject({ enabled: true, settled: false });
    expect(first.question!.question).toContain(`${names.business} and ${names.brand}`);
    expect(await onboardingPortraitKnowledge(journey)).toBe("questions_pending");

    const followUp = await answerOnboardingQuestion(journey, first.question!.id, "Yes, but it's complicated.");
    expect(followUp.question?.id).toBe(first.question!.id);
    expect(followUp.question?.followUp).toContain("fit together");
    const settledRelationship = await answerOnboardingQuestion(journey, first.question!.id, `${names.brand} is the building service. Same crew, separate contracts.`);
    expect(settledRelationship.explanation).toContain("won't treat them as one company");

    const website = settledRelationship.question!;
    expect(website.question).toMatch(/website proposals from March 2026 to April 2026, but nothing like it since/);
    const done = await answerOnboardingQuestion(journey, website.id, "No, I stopped doing websites last spring.");
    expect(done.explanation).toContain("in the past");
    expect(done.settled).toBe(true);

    const knowledge = await onboardingPortraitKnowledge(journey);
    expect(knowledge).not.toBe("questions_pending");
    const facts = (knowledge as Exclude<typeof knowledge, null | "questions_pending">)!.facts;
    const fact = (name: string) => facts.find(item => item.fact.startsWith(name))!;
    expect(fact(names.business).fact).toContain("is current");
    expect(fact(names.product).fact).toContain("no launch date, sales or customers are known");
    expect(fact("Website proposals")).toMatchObject({ historical: true });
    expect(fact("Website proposals").fact).toContain("past work (they said so)");
    expect(facts.some(item => item.fact.includes('in their words: "Yes, but it\'s complicated.') && item.fact.includes("not the same company"))).toBe(true);
    expect(facts.some(item => item.fact.startsWith(`${names.collaborator.first} ${names.collaborator.last} works with them: Operations lead`))).toBe(true);
  });

  it("after signup, Claire reads the confirmed understanding for that workspace only, without asking again", async () => {
    const { readTenantBusinessUnderstanding } = await import("./onboarding");
    const { businessKnowledgeForBriefing } = await import("../../shared/businessKnowledge");
    const tenantId = `tenant-${randomUUID().slice(0, 8)}`;
    provisioned = { ...journey, tenantId };
    const understanding = await readTenantBusinessUnderstanding(tenantId, { journeyForTenant: async () => provisioned, accessFor: async () => null });
    const briefing = businessKnowledgeForBriefing(understanding)!;
    const relationship = briefing.relationships.find(item => item.basis === "operator")!;
    expect(relationship.relation).toBe("related_operation");
    expect(relationship.operatorWords).toContain("separate contracts");
    expect(briefing.openQuestions.some(question => question.includes(names.brand))).toBe(false);
    expect(briefing.answered.length).toBe(2);
    expect(briefing.past.map(item => item.name)).toContain("Website proposals");
    expect(briefing.current.map(item => item.name)).not.toContain("Website proposals");
    expect(briefing.people[0]).toMatchObject({ name: `${names.collaborator.first} ${names.collaborator.last}`, role: "Operations lead" });
    // another workspace that somehow resolved the same journey reads nothing: the rows are stamped with this tenant
    expect(await readTenantBusinessUnderstanding("tenant-other", { journeyForTenant: async () => ({ ...journey, tenantId: "tenant-other" }), accessFor: async () => null })).toBeNull();
  });

  it("the chapter sets aside an opportunity about past work, and offers it again once the person says it is current", async () => {
    const { chapterFindings } = await import("./onboarding");
    const { entities, assertClaim } = await import("./store");
    const source = { provider: "gmail" as const, ref: "x", at: "2026-04-01T00:00:00.000Z", who: null, label: "x", excerpt: "x", url: null };
    const request = { id: "req", companion: null, status: "proposed" as const, payload: { kind: "request" as const, from: { name: "Bella", address: "b@bella.example" }, quote: "Can you redo our website?", wants: "a new website", recurring: false, at: "2026-04-01T00:00:00.000Z", subject: "Website" }, sources: [source], correction: null };
    const opportunity = { ...request, id: "opp", payload: { kind: "opportunity", type: "unanswered", person: { name: "Bella", address: "b@bella.example" }, requestId: "req", replyId: null, serviceId: null, summary: "Bella asked for a website" } } as any;
    const findings = [request, opportunity] as any[];
    // the person said website work is in the past: the chapter doesn't lead there
    expect((await chapterFindings(provisioned, findings, false)).map(item => item.id)).toEqual(["req"]);
    // once a draft exists, nothing changes under it
    expect((await chapterFindings(provisioned, findings, true)).map(item => item.id)).toEqual(["req", "opp"]);
    // they change their mind: it is current again, and the opportunity is offered
    const scope = { journeyId: journey.id, tenantId: provisioned.tenantId };
    const web = (await entities(scope)).find(entity => /website/i.test(entity.name))!;
    await assertClaim(scope, { subjectEntityId: web.id, predicate: "status", value: "active", basis: "user_confirmed", detail: "Actually yes, a few a year", confidence: 100, rationale: "You said so.", evidenceIds: [], createdBy: "user" });
    expect((await chapterFindings(provisioned, findings, false)).map(item => item.id)).toEqual(["req", "opp"]);
  });
});
