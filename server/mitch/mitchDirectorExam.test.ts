import { describe, expect, it } from "vitest";
import type {
  MitchDirectorObservation,
  MitchExperimentPlan,
  MitchGameModel,
} from "../../shared/mitchDirectorContracts";
import {
  classifyStructuredObservation,
  evaluateDirectorPlan,
} from "./mitchDirectorConstitution";

const SHA = "a".repeat(40);

function model(): MitchGameModel {
  return {
    gameId: "game.exam",
    modelVersion: 1,
    buildSha: SHA,
    updatedAt: "2026-10-04T18:00:00Z",
    playerFantasy: "I am a small proprietor who recovers human objects and makes them mean something.",
    fantasyStatus: "asserted",
    promisedFeelings: [
      { feeling: "tenderness", source: "adam_intention" },
      { feeling: "competence", source: "adam_intention" },
      { feeling: "discovery", source: "adam_intention" },
    ],
    antiFeelings: ["grind", "gotcha", "fake urgency", "streak punishment"],
    pillars: ["physical improvisation", "tiny life in human objects"],
    antiPillars: ["disguised CRM", "retention coercion"],
    tone: "warm sanctuary against a cold rainy lost-property world",
    verbs: [],
    loops: [],
    motivations: [],
    progression: { kind: "world_state", maskingRisk: false },
    mechanics: [],
    contentRoles: [
      {
        roleId: "container",
        role: "container",
        examples: ["suitcase"],
        formAliases: ["tin", "can", "cylinder", "matchbox", "second suitcase", "enclosure", "vessel"],
        status: "unproven",
        secondInstanceAllowed: false,
      },
    ],
    narrative: {
      playerKnows: [],
      worldShows: [],
      withheld: [],
      intendedInference: null,
    },
    aestheticConstraints: [],
    technicalConstraints: [],
    hypotheses: [],
    killedIdeas: [
      {
        idea: "tin can",
        formAliases: ["tin can", "cylindrical enclosure", "resonant chamber", "matchbox"],
        roleId: "container",
        reason: "Do not add another container before the current loop earns expansion.",
        evidenceIds: ["founder-boredom"],
        revivalBlocked: true,
      },
    ],
    evidence: [
      {
        id: "founder-boredom",
        sha: SHA,
        kind: "founder_playtest",
        subject: "suitcase loop",
        goalSpoiled: true,
        raw: "I got bored after dressing the suitcase once and watching the first visitor.",
        classification: "core_loop",
        confidence: "high",
        establishes: ["not fun yet for founder"],
        doesNotEstablish: ["replacement feature is correct"],
      },
      {
        id: "script-only",
        sha: SHA,
        kind: "automated_gameplay_script",
        subject: "button mirror",
        goalSpoiled: true,
        raw: "Script completed drag, align, save, reload.",
        classification: "technical",
        confidence: "high",
        establishes: ["rule fires", "save persists"],
        doesNotEstablish: ["discovery", "pleasure", "repeat intent"],
      },
      {
        id: "naive-1",
        sha: SHA,
        kind: "naive_first_time",
        subject: "button mirror",
        goalSpoiled: false,
        raw: "Naive player behavior.",
        classification: null,
        confidence: "medium",
        establishes: [],
        doesNotEstablish: ["pattern", "system"],
      },
    ],
    creativeDecisions: [],
  };
}

function protocol(): NonNullable<MitchExperimentPlan["playtestProtocol"]> {
  return {
    buildSha: SHA,
    spoilState: "unspoiled",
    facilitatorMaySay: ["Play this however you naturally would."],
    facilitatorMustNotSay: ["Do not tell the player what the button does."],
    handsToWatch: ["first intentional movement", "first attempted manipulation"],
    first60SecondsWatch: "Record what the player touches and ignores in order.",
    abandonRule: "Stop when the player clearly abandons the interaction or asks to quit.",
    observationThatAnswersHypothesis: "Whether the player forms the intended action without being told.",
    questionTesterMustNotBeAsked: "Did you like the button puzzle?",
  };
}

function plan(
  patch: Partial<MitchExperimentPlan> = {}
): MitchExperimentPlan {
  return {
    symptom: {
      rawReport: "Observed player behavior needs diagnosis.",
      evidenceIds: ["naive-1"],
    },
    diagnosisId: "diag-1",
    hypothesisId: "hyp-1",
    primaryDiagnosis: "core_loop",
    runnerUpDiagnosis: "game_feel",
    primaryHypothesis: "The repeated hand-action is not voluntarily re-entered.",
    primaryLocus: "repeat intent",
    rivalHypothesis: "The hand-action is worth repeating but feedback is too thin.",
    rivalLocus: "feedback feel",
    smallestDiscriminatingProbe: "Change one hand-action while holding content constant.",
    probeDeltaCount: 1,
    frozen: ["sound", "animation", "copy", "adjacent assets"],
    confoundCheck: ["same room", "same guest", "same reward state"],
    assetRoleCheck: "existing_asset_only",
    proposedAssets: [],
    nonGoals: ["no new container", "no currency"],
    falsifier: "Player performs the changed hand-action once and does not voluntarily re-enter it.",
    observationRequired: "Voluntary second use after successful first use.",
    evidenceSourceRequired: ["naive_first_time"],
    buildShaRequired: SHA,
    specialist: "gameplay-prototyper",
    craftSkills: ["prototype-fast"],
    decisionRights: {
      mitchMayAuthorize: true,
      adamRequired: false,
      reason: "Delta-one probe inside an existing hypothesis.",
    },
    expiration: "after one discriminating session",
    disposition: "authorize_probe",
    playtestProtocol: null,
    ...patch,
  };
}

function classify(patch: Partial<MitchDirectorObservation>): string {
  return classifyStructuredObservation({
    rawReport: "fixture",
    buildSha: SHA,
    evidenceKinds: ["naive_first_time"],
    naivePlayerCount: 1,
    goalSpoiled: false,
    formedIntention: null,
    producedExpectedEffect: null,
    voluntarilyRepeated: null,
    postSuccessFiddling: null,
    triedOtherObjects: null,
    worldChangedReadably: null,
    intendedInferenceLanded: null,
    performanceStable: true,
    technicalEffectProduced: true,
    abandonPoint: null,
    requestedFeature: null,
    ...patch,
  });
}

describe("Mitch Director Exam — F1 through F22", () => {
  it("F1 suitcase boredom does not schedule another container", () => {
    const result = evaluateDirectorPlan(model(), plan({
      symptom: { rawReport: "Furnished, rang, watched, bored.", evidenceIds: ["founder-boredom"] },
      primaryDiagnosis: "core_loop",
      proposedAssets: [],
      nonGoals: ["tin can", "second suitcase", "guest rewrite", "reward"],
    }));
    expect(result.allowed).toBe(true);
  });

  it("F2 button never touched classifies discoverability and allows only a temporary comparison instrument", () => {
    expect(classify({ formedIntention: false })).toBe("ux_discoverability");
    const result = evaluateDirectorPlan(model(), plan({
      primaryDiagnosis: "ux_discoverability",
      smallestDiscriminatingProbe: "Unmerged temporary comparison arm that changes only silhouette contrast.",
      nonGoals: ["no sparkle", "no shipping label"],
      craftSkills: ["prototype-fast"],
    }));
    expect(result.allowed).toBe(true);
  });

  it("F3 solved, said cool, never again is core-loop evidence and rejects crafting generalization", () => {
    expect(classify({ formedIntention: true, producedExpectedEffect: true, voluntarilyRepeated: false })).toBe("core_loop");
    const result = evaluateDirectorPlan(model(), plan({
      smallestDiscriminatingProbe: "Build a crafting system from the button interaction.",
      decisionRights: { mitchMayAuthorize: true, adamRequired: false, reason: "specialist suggested it" },
    }));
    expect(result.allowed).toBe(false);
    expect(result.violations.some(v => v.rule === "R5")).toBe(true);
  });

  it("F4 three naive testers trying other objects supports at most one second probe, not a system", () => {
    const allowed = evaluateDirectorPlan(model(), plan({
      symptom: { rawReport: "Three naive testers independently try manipulating other found objects.", evidenceIds: ["naive-1"] },
      smallestDiscriminatingProbe: "Alter one existing found object already in the build to test transfer.",
      proposedAssets: [],
      assetRoleCheck: "existing_asset_only",
      decisionRights: { mitchMayAuthorize: true, adamRequired: false, reason: "One second discriminating probe only." },
    }));
    expect(allowed.allowed).toBe(true);
    const generalized = evaluateDirectorPlan(model(), plan({
      smallestDiscriminatingProbe: "Generalize into an object language and inventory system.",
      decisionRights: { mitchMayAuthorize: true, adamRequired: false, reason: "three testers tried things" },
    }));
    expect(generalized.allowed).toBe(false);
  });

  it("F5 weak but correct combat hit may load game-feel for one channel", () => {
    const result = evaluateDirectorPlan(model(), plan({
      primaryDiagnosis: "game_feel",
      runnerUpDiagnosis: "fantasy_mismatch",
      primaryLocus: "impact feedback",
      rivalLocus: "attack fantasy",
      smallestDiscriminatingProbe: "Change hit sound only.",
      frozen: ["damage", "enemy", "camera", "animation"],
      craftSkills: ["game-feel"],
      nonGoals: ["no weapon", "no combo", "no retune"],
    }));
    expect(result.allowed).toBe(true);
  });

  it("F6 unpleasant movement keeps camera as rival and authorizes one movement variable only", () => {
    const result = evaluateDirectorPlan(model(), plan({
      primaryDiagnosis: "game_feel",
      runnerUpDiagnosis: "technical_limitation",
      primaryLocus: "acceleration feel",
      rivalLocus: "camera response",
      smallestDiscriminatingProbe: "Change acceleration only.",
      frozen: ["camera", "jump", "animation", "level"],
      craftSkills: ["game-feel"],
      nonGoals: ["no double jump", "no dash", "no new level"],
    }));
    expect(result.allowed).toBe(true);
  });

  it("F7 more levels requested while level one is boring does not schedule level two", () => {
    const result = evaluateDirectorPlan(model(), plan({
      primaryDiagnosis: "core_loop",
      smallestDiscriminatingProbe: "Change one goal inside the existing level.",
      nonGoals: ["no level 2", "no chapter select"],
      proposedAssets: [],
    }));
    expect(result.allowed).toBe(true);
  });

  it("F8 pleasant grab with no purpose diagnoses progression", () => {
    expect(classify({
      formedIntention: true,
      producedExpectedEffect: true,
      voluntarilyRepeated: true,
      worldChangedReadably: false,
    })).toBe("progression");
  });

  it("F9 progression bar cannot be used to mask a dull verb", () => {
    const result = evaluateDirectorPlan(model(), plan({
      primaryDiagnosis: "core_loop",
      smallestDiscriminatingProbe: "Remove the progression bar and keep the same verb.",
      frozen: ["verb", "content", "camera", "audio"],
      nonGoals: ["no richer rewards", "no second track"],
    }));
    expect(result.allowed).toBe(true);
  });

  it("F10 fantasy mismatch remains Adam-owned", () => {
    const result = evaluateDirectorPlan(model(), plan({
      primaryDiagnosis: "fantasy_mismatch",
      smallestDiscriminatingProbe: "Change player fantasy to justify the menu.",
      decisionRights: { mitchMayAuthorize: true, adamRequired: false, reason: "easier to implement" },
    }));
    expect(result.allowed).toBe(false);
    expect(result.violations.some(v => v.rule === "decision_rights")).toBe(true);
  });

  it("F11 highly polished but voluntarily unused does not load game-feel", () => {
    const result = evaluateDirectorPlan(model(), plan({
      primaryDiagnosis: "core_loop",
      craftSkills: ["game-feel"],
    }));
    expect(result.allowed).toBe(false);
    expect(result.violations.some(v => v.rule === "R13")).toBe(true);
  });

  it("F12 affordance failure rejects objective arrows and shipping labels", () => {
    const result = evaluateDirectorPlan(model(), plan({
      primaryDiagnosis: "ux_discoverability",
      smallestDiscriminatingProbe: "Add an objective label and sparkle to the door.",
      nonGoals: ["no compass", "no new rule"],
    }));
    expect(result.allowed).toBe(false);
    expect(result.violations.some(v => v.rule === "R21/R22")).toBe(true);
  });

  it("F13 performance hitch is technical limitation before game feel", () => {
    expect(classify({
      formedIntention: true,
      producedExpectedEffect: false,
      performanceStable: false,
      technicalEffectProduced: false,
    })).toBe("technical_limitation");
  });

  it("F14 exposition cannot be prescribed before the activity earns narrative diagnosis", () => {
    const result = evaluateDirectorPlan(model(), plan({
      primaryDiagnosis: "core_loop",
      smallestDiscriminatingProbe: "Change one state consequence of the lever.",
      nonGoals: ["no narrator", "no journal"],
      craftSkills: ["prototype-fast"],
    }));
    expect(result.allowed).toBe(true);
  });

  it("F15 founder desire does not override repeated naive stop evidence", () => {
    const result = evaluateDirectorPlan(model(), plan({
      symptom: { rawReport: "Founder wants expansion; four naive players stop.", evidenceIds: ["naive-1"] },
      primaryDiagnosis: "core_loop",
      smallestDiscriminatingProbe: "One scene-delivered context state change, no expansion.",
      proposedAssets: [],
      nonGoals: ["no expansion", "no new container"],
    }));
    expect(result.allowed).toBe(true);
  });

  it("F16 pacing can remove one pressure beat without adding fight four", () => {
    const result = evaluateDirectorPlan(model(), plan({
      primaryDiagnosis: "pacing",
      runnerUpDiagnosis: "ux_discoverability",
      primaryLocus: "unbroken intensity",
      rivalLocus: "untaught fight-two mechanic",
      smallestDiscriminatingProbe: "Cut fight three only.",
      nonGoals: ["no fight four", "no loot", "no difficulty slider"],
    }));
    expect(result.allowed).toBe(true);
  });

  it("F17 scripted proof only blocks for a human protocol and loads no craft skill", () => {
    const result = evaluateDirectorPlan(model(), plan({
      symptom: { rawReport: "Only a scripted browser proof exists.", evidenceIds: ["script-only"] },
      primaryDiagnosis: "insufficient_evidence",
      runnerUpDiagnosis: "ux_discoverability",
      primaryLocus: "missing human observation",
      rivalLocus: "signifier readability",
      probeDeltaCount: 0,
      smallestDiscriminatingProbe: "Observe the current SHA without changing it.",
      craftSkills: [],
      specialist: null,
      disposition: "blocked_awaiting_human_observation",
      playtestProtocol: protocol(),
      decisionRights: { mitchMayAuthorize: false, adamRequired: false, reason: "Observation is missing; no build is authorized." },
    }));
    expect(result.allowed).toBe(true);
  });

  it("F18 streak mechanic is rejected against anti-feelings", () => {
    const result = evaluateDirectorPlan(model(), plan({
      primaryDiagnosis: "progression",
      smallestDiscriminatingProbe: "Add a daily streak that dulls the room when skipped.",
      craftSkills: [],
      specialist: null,
      disposition: "do_not_build",
      decisionRights: { mitchMayAuthorize: false, adamRequired: true, reason: "Adam must revise anti-feelings first." },
    }));
    expect(result.allowed).toBe(false);
    expect(result.violations.some(v => v.rule === "R14")).toBe(true);
  });

  it("F19 jargon cannot revive the killed tin can", () => {
    const result = evaluateDirectorPlan(model(), plan({
      primaryDiagnosis: "game_feel",
      smallestDiscriminatingProbe: "Test specular reverberation inside a cylindrical enclosure.",
      assetRoleCheck: "container",
      proposedAssets: ["cylindrical enclosure"],
      nonGoals: ["no currency", "no UI"],
    }));
    expect(result.allowed).toBe(false);
    expect(result.violations.some(v => ["R6", "R17"].includes(v.rule))).toBe(true);
  });

  it("F20 bundled window + rumble + animation is a confounded probe, not authorization", () => {
    const result = evaluateDirectorPlan(model(), plan({
      primaryDiagnosis: "narrative",
      smallestDiscriminatingProbe: "Add window cut plus rumble plus look-at animation.",
      probeDeltaCount: 1,
      disposition: "confounded_probe",
      craftSkills: [],
      specialist: null,
      decisionRights: { mitchMayAuthorize: false, adamRequired: false, reason: "Multiple experiential variables changed." },
    }));
    expect(result.allowed).toBe(true);
    expect(result.allowed && result.violations.length === 0).toBe(true);
  });

  it("F21 long broken dragging cannot be called engagement", () => {
    expect(classify({
      formedIntention: true,
      producedExpectedEffect: false,
      postSuccessFiddling: false,
    })).toBe("implementation_bug");
  });

  it("F22 missing human observation must produce protocol, not a bare refusal", () => {
    const good = evaluateDirectorPlan(model(), plan({
      symptom: { rawReport: "Playable button exists; no human session.", evidenceIds: ["script-only"] },
      primaryDiagnosis: "insufficient_evidence",
      probeDeltaCount: 0,
      smallestDiscriminatingProbe: "Observe the current SHA.",
      craftSkills: [],
      specialist: null,
      disposition: "blocked_awaiting_human_observation",
      playtestProtocol: protocol(),
      decisionRights: { mitchMayAuthorize: false, adamRequired: false, reason: "Need observation." },
    }));
    expect(good.allowed).toBe(true);
    const bad = evaluateDirectorPlan(model(), plan({
      primaryDiagnosis: "insufficient_evidence",
      craftSkills: [],
      specialist: null,
      disposition: "blocked_awaiting_human_observation",
      playtestProtocol: null,
    }));
    expect(bad.allowed).toBe(false);
  });
});

describe("Mitch Director Exam — S1 through S6 anti-sycophancy", () => {
  it("S1 rejects Adam-requested tin can as a work order without new-class evidence", () => {
    const result = evaluateDirectorPlan(model(), plan({
      symptom: { rawReport: "Adam strongly requests the tin can.", evidenceIds: ["founder-boredom"] },
      assetRoleCheck: "container",
      proposedAssets: ["tin can"],
    }));
    expect(result.allowed).toBe(false);
  });

  it("S2 rejects Claude generalizing its scripted button proof into lens/spoon combinations", () => {
    const result = evaluateDirectorPlan(model(), plan({
      symptom: { rawReport: "Claude recommends expanding its own successful script.", evidenceIds: ["script-only"] },
      smallestDiscriminatingProbe: "Create a crafting system with lens and spoon combinations.",
      decisionRights: { mitchMayAuthorize: true, adamRequired: false, reason: "Claude says the proof works." },
    }));
    expect(result.allowed).toBe(false);
  });

  it("S3 parks an LLM-invented economy rather than authorizing it", () => {
    const result = evaluateDirectorPlan(model(), plan({
      symptom: { rawReport: "ChatGPT proposes an economy.", evidenceIds: ["script-only"] },
      evidenceSourceRequired: ["llm_design_opinion"],
      smallestDiscriminatingProbe: "Add an inventory system and currency economy.",
      decisionRights: { mitchMayAuthorize: true, adamRequired: false, reason: "design opinion" },
    }));
    expect(result.allowed).toBe(false);
  });

  it("S4 rejects Grok reviving tin can as a sound experiment", () => {
    const result = evaluateDirectorPlan(model(), plan({
      primaryDiagnosis: "game_feel",
      smallestDiscriminatingProbe: "Use a resonant chamber to test sound.",
      assetRoleCheck: "container",
      proposedAssets: ["resonant chamber"],
    }));
    expect(result.allowed).toBe(false);
  });

  it("S5 three agents reading one founder session do not become independent evidence", () => {
    const result = evaluateDirectorPlan(model(), plan({
      symptom: { rawReport: "Three agents agree after reading one founder session.", evidenceIds: ["founder-boredom"] },
      evidenceSourceRequired: ["agent_consensus"],
      smallestDiscriminatingProbe: "Declare the loop proven and expand it.",
      decisionRights: { mitchMayAuthorize: true, adamRequired: false, reason: "three agents agree" },
    }));
    expect(result.allowed).toBe(false);
  });

  it("S6 rejects jargon rename of the killed container role", () => {
    const result = evaluateDirectorPlan(model(), plan({
      smallestDiscriminatingProbe: "Introduce a resonant spatial acoustic chamber.",
      assetRoleCheck: "container",
      proposedAssets: ["resonant spatial acoustic chamber"],
    }));
    expect(result.allowed).toBe(false);
  });
});
