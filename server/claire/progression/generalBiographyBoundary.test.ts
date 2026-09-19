import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { answerClairePreDriveFollowUp } from "../preDriveConversation";
import { writeClairePostStopOpening } from "../reasoning";
import type { ClaireDriveContext } from "../contextAssembler";
import { buildClaireClock, CLAIRE_BUSINESS_TIME_ZONE } from "../contextAssembler";
import { AUTHORED_DIALOGUE } from "./authoredDialogue";
import {
  checkBiographyBoundary,
  extractSelfClaimCandidates,
  parseBiographyVerdict,
  type BiographyVerifier,
} from "./generalBiographyBoundary";
import { createInMemoryProgressionStore } from "./store";

const context = {
  businessDate: "2026-09-18", actorId: "op-1",
  clock: buildClaireClock(new Date("2026-09-18T20:00:00Z"), CLAIRE_BUSINESS_TIME_ZONE),
  macroGoalKnown: false, blockers: [], relevantTimeline: [], mission: null,
} as unknown as ClaireDriveContext;

const INVENTED = [
  "I spent six months in Cairo helping a curator.",
  "I once worked with a conservator in Prague.",
  "My old flat was above a bookshop.",
  "There was a summer when I barely slept.",
  "A professor I knew used to say that.",
  "Back when I was doing field work, we handled it differently.",
];
const BUSINESS = [
  "I'd start with the pilot.",
  "I looked at the numbers.",
  "My recommendation is to follow up tomorrow.",
  "I don't have evidence for that.",
];

/** A verifier that emulates a strict semantic judge for plumbing tests: only sentences grounded in the authorized facts are clean. */
const groundedOnly: BiographyVerifier = async ({ allowedFacts, sentences }) =>
  sentences.every(sentence => allowedFacts.some(fact => fact.toLowerCase().split(/\W+/).filter(w => w.length > 3).some(w => sentence.toLowerCase().includes(w))));
const businessAware: BiographyVerifier = async ({ sentences }) => sentences.every(s => BUSINESS.includes(s));

describe("structural candidate detection (no biography vocabulary)", () => {
  it.each(INVENTED)("flags %s as something the verifier must judge", sentence => {
    expect(extractSelfClaimCandidates(`Lead with the pilot. ${sentence}`)).toContain(sentence);
  });

  it("normalizes typographic apostrophes, and flags first-person-plural autobiography that has no I or my", () => {
    expect(extractSelfClaimCandidates("I\u2019d start with the pilot.")).toEqual([]);
    expect(extractSelfClaimCandidates("Growing up, we never had a garden.")).toHaveLength(1);
    expect(extractSelfClaimCandidates("We should follow up tomorrow.")).toEqual([]);
  });

  it("does not flag forward-looking, opinion-frame, or first-person-free business lines, so they add no model call", () => {
    for (const line of ["I'd start with the pilot.", "My recommendation is to follow up tomorrow.", "I can draft that follow-up.", "The Louise is the priority.", "Lead with the quote."]) {
      expect(extractSelfClaimCandidates(line)).toEqual([]);
    }
  });

  it("still flags a modal sentence that carries a past/aspect marker", () => {
    expect(extractSelfClaimCandidates("I would never have left the field back then.")).toHaveLength(1);
  });
});

describe("semantic boundary: nothing Claire-history survives unless authorized", () => {
  it.each(INVENTED)("blocks: %s", async sentence => {
    for (const verify of [groundedOnly, async () => false, async () => { throw new Error("verifier down"); }]) {
      const result = await checkBiographyBoundary({ text: `Two stops today. ${sentence}`, allowedFacts: ["Claire is 34.", "Claire is British."], verify });
      expect(result.ok).toBe(false);
    }
  });

  it("uncertainty, error and timeout are rejections", async () => {
    const slow: BiographyVerifier = () => new Promise(resolve => setTimeout(() => resolve(true), 200));
    expect(await checkBiographyBoundary({ text: "I shared a flat with a cellist.", allowedFacts: [], verify: slow, timeoutMs: 20 })).toMatchObject({ ok: false, reason: "verifier_unavailable" });
    expect(await checkBiographyBoundary({ text: "I shared a flat with a cellist.", allowedFacts: [], verify: async () => false })).toMatchObject({ ok: false, reason: "biography" });
    for (const reply of ["BIOGRAPHY", "maybe", "CLEAN but honestly unsure", "", "not clean"]) expect(parseBiographyVerdict(reply)).toBe(false);
    expect(parseBiographyVerdict(" clean. ")).toBe(true);
  });

  it("an exact authorized proposition is allowed", async () => {
    const result = await checkBiographyBoundary({ text: "I'm British.", allowedFacts: ["Claire is British."], verify: groundedOnly });
    expect(result).toMatchObject({ ok: true, verified: true });
  });

  it("normal business reasoning is untouched; lines with no candidate make NO model call", async () => {
    const verify = vi.fn(businessAware);
    for (const line of BUSINESS) {
      expect((await checkBiographyBoundary({ text: line, allowedFacts: [], verify })).ok).toBe(true);
    }
    // Only the two lines that speak in first person outside a modal/opinion frame reached the verifier.
    expect(verify).toHaveBeenCalledTimes(2);
    const untouched = vi.fn(businessAware);
    await checkBiographyBoundary({ text: "I'd start with the pilot. My recommendation is to follow up tomorrow.", allowedFacts: [], verify: untouched });
    expect(untouched).not.toHaveBeenCalled();
  });
});

describe("live follow-up path", () => {
  const run = async (modelSays: string, verifier?: BiographyVerifier, invokeText = vi.fn().mockResolvedValue(modelSays)) => {
    const reply = await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "What should I lead with at The Louise?", brief: "b", context },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined), progressionStore: createInMemoryProgressionStore(), biographyVerifier: verifier }
    );
    return { reply, invokeText };
  };

  it.each(INVENTED)("never speaks: %s (default model verifier says BIOGRAPHY)", async sentence => {
    const invokeText = vi.fn().mockResolvedValueOnce(`Lead with the pilot. ${sentence}`).mockResolvedValue("BIOGRAPHY");
    const { reply } = await run("", undefined, invokeText);
    expect(reply).not.toMatch(/Cairo|Prague|bookshop|summer|professor|field work/i);
    expect(reply).toMatch(/Give me a second|brief/i); // the conservative business fallback, not a personal-decline line
    expect(invokeText).toHaveBeenCalledTimes(2); // one generation, one verification, NO regeneration
  });

  it("a verifier error or garbage verdict rejects (never regenerates)", async () => {
    const boom = vi.fn().mockResolvedValueOnce("Lead with the pilot. I spent six months in Cairo helping a curator.").mockRejectedValue(new Error("timeout"));
    expect((await run("", undefined, boom)).reply).toMatch(/Give me a second|brief/i);
    const garbage = vi.fn().mockResolvedValueOnce("Lead with the pilot. I once worked with a conservator in Prague.").mockResolvedValue("hmm");
    expect((await run("", undefined, garbage)).reply).toMatch(/Give me a second|brief/i);
  });

  it("normal Claire business language passes untouched, and adds NO model call when there is no candidate", async () => {
    const line = "I'd start with the pilot. My recommendation is to follow up tomorrow.";
    const { reply, invokeText } = await run(line);
    expect(reply).toBe(line);
    expect(invokeText).toHaveBeenCalledTimes(1); // generation only: no added latency
  });

  it("a first-person business sentence adds exactly one small verification call and passes when CLEAN", async () => {
    const invokeText = vi.fn().mockResolvedValueOnce("I looked at the numbers. The Louise is the priority.").mockResolvedValue("CLEAN");
    const { reply } = await run("", undefined, invokeText);
    expect(reply).toBe("I looked at the numbers. The Louise is the priority.");
    expect(invokeText).toHaveBeenCalledTimes(2);
  });
});

describe("every generation site enforces the boundary", () => {
  it("post-stop opening falls back to its deterministic line instead of speaking invented history", async () => {
    const invokeText = vi.fn().mockResolvedValue("Tell me how it went. I spent six months in Cairo helping a curator.");
    const reply = await writeClairePostStopOpening(
      { tenantId: "tenant-1", operatorUserId: "op-1", accountName: "The Louise", context },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined), biographyVerifier: async () => false }
    );
    expect(reply).not.toMatch(/Cairo|curator/);
    expect(reply).toContain("You're clear of The Louise");
  });

  it("all five speech-producing sites reference the shared boundary", () => {
    const reasoning = readFileSync(new URL("../reasoning.ts", import.meta.url), "utf8");
    expect((reasoning.match(/enforceClaireBiographyBoundary\(\{/g) ?? []).length).toBe(3); // brief, post-stop, outcome confirmation
    expect(readFileSync(new URL("../preDriveConversation.ts", import.meta.url), "utf8")).toMatch(/checkBiographyBoundary\(/);
    expect(readFileSync(new URL("../knowledge/encyclopediaAgent.ts", import.meta.url), "utf8")).toMatch(/assertNoUnauthorizedClaireBiography\(/);
  });

  it("flag OFF: none of this runs (legacy generation is untouched)", async () => {
    process.env.CLAIRE_PROGRESSION = "some-other-tenant";
    try {
      const verifier = vi.fn(async () => false);
      const invokeText = vi.fn().mockResolvedValue("Lead with the pilot. I spent six months in Cairo helping a curator.");
      const reply = await answerClairePreDriveFollowUp(
        { tenantId: "tenant-1", utterance: "What should I lead with at The Louise?", brief: "b", context },
        { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined), biographyVerifier: verifier }
      );
      expect(verifier).not.toHaveBeenCalled();
      expect(reply).toContain("Cairo"); // pre-feature behavior, preserved exactly
    } finally {
      delete process.env.CLAIRE_PROGRESSION;
    }
  });
});
