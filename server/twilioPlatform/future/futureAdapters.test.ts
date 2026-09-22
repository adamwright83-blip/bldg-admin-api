import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FUTURE_TWILIO_CAPABILITY_IDS,
  TRANSCRIPT_CANNOT_CREATE,
  VERIFY_GRANT_TTL_MS,
  futureCapabilityIdsAreFoundationSubset,
  type GoldlineCanonicalJob,
  type GoldlineCommEvent,
} from "@shared/twilioFuture";
import { TWILIO_CAPABILITY_STATES } from "@shared/twilioPlatform";
import {
  evaluateTwilioCapability,
  noteTwilioCapabilityFailure,
  resetTwilioCapabilityFailuresForTests,
} from "../capabilities";
import { logContainsTwilioSecret as configLogContainsTwilioSecret } from "../config";
import { activateBrandedCallingRegistration, brandedCallingLogLine, reportBrandedCalling } from "./brandedCalling";
import { commEventCreatesBusinessAuthority, createMemoryCommEventJournal, publishGoldlineCommEvent, syncIsCanonicalCommState } from "./commEvents";
import { attemptCoachPath, requestThirdPartyOnCall } from "./conferenceCoach";
import { authorizationFromLookup, lookupLogLine, observeLookup } from "./lookup";
import { createProductionMaskedSession, planMaskedCommunicationSession } from "./proxySession";
import { applyTaskRouterProjectionToCanonicalJob, projectGoldlineJobToTaskRouter } from "./taskRouterProjection";
import {
  authoritiesCreatedByTranscript,
  businessOutcomesCreatedByTranscript,
  classifyTranscriptCandidate,
  promoteTranscriptCandidate,
} from "./transcriptCandidate";
import {
  conversationVerifyPolicy,
  issueVerifyActionGrant,
  verifyGrantBusinessEffects,
  verifyGrantCovers,
  verifyGrantExecutes,
} from "./verifyGrant";

vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "auth_test_token";
  process.env.CLAIRE_TWILIO_FROM_NUMBER = "+13105550000";
  process.env.CLAIRE_OPERATOR_PHONE = "+13105550001";
});

vi.mock("../../_core/env", () => ({
  ENV: { adminBaseUrl: "https://api.example.test", ownerOpenId: "adam-admin" },
}));

vi.mock("twilio", async importOriginal => {
  const actual = (await importOriginal()) as { default?: Record<string, unknown> } & Record<string, unknown>;
  const real = (actual.default ?? actual) as Record<string, unknown>;
  const factory = Object.assign(() => ({ calls: { create: vi.fn() } }), real, { twiml: real.twiml });
  return { ...actual, default: factory };
});

import { resolveClaireOperatorIdForPhone } from "../../claire/claireTwilio";

const TOKEN = "test-auth-token-value";
const futureDir = path.dirname(fileURLToPath(import.meta.url));

function voiceEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    TWILIO_ACCOUNT_SID: "AC_test_account",
    TWILIO_AUTH_TOKEN: TOKEN,
    CLAIRE_TWILIO_FROM_NUMBER: "+13105550000",
    CLAIRE_OPERATOR_PHONE: "+13105550001",
    ...extra,
  };
}

afterEach(() => {
  resetTwilioCapabilityFailuresForTests();
});

describe("future capability ids stay inside the foundation union", () => {
  it("does not declare a second capability list", () => {
    expect(futureCapabilityIdsAreFoundationSubset()).toBe(true);
    expect(FUTURE_TWILIO_CAPABILITY_IDS).toEqual([
      "lookup",
      "verify",
      "proxy",
      "conference",
      "transcription",
      "conversationIntelligence",
      "brandedCalling",
      "taskRouter",
      "sync",
      "studioFallback",
    ]);
  });

  it("distinguishes disabled, unconfigured, failing, and live", () => {
    expect(TWILIO_CAPABILITY_STATES).toEqual(
      expect.arrayContaining(["DISABLED", "UNCONFIGURED", "CONFIGURED_FAILING", "LIVE"])
    );

    const bare = voiceEnv();
    expect(evaluateTwilioCapability("conference", bare).state).toBe("DISABLED");
    expect(evaluateTwilioCapability("studioFallback", bare).state).toBe("DISABLED");
    expect(evaluateTwilioCapability("lookup", bare).state).toBe("UNCONFIGURED");
    expect(evaluateTwilioCapability("verify", bare).state).toBe("UNCONFIGURED");
    expect(evaluateTwilioCapability("proxy", bare).state).toBe("UNCONFIGURED");
    expect(evaluateTwilioCapability("taskRouter", bare).state).toBe("UNCONFIGURED");
    expect(evaluateTwilioCapability("sync", bare).state).toBe("UNCONFIGURED");
    expect(evaluateTwilioCapability("brandedCalling", bare).state).toBe("UNCONFIGURED");
    expect(evaluateTwilioCapability("transcription", bare).state).toBe("UNCONFIGURED");
    expect(evaluateTwilioCapability("conversationIntelligence", bare).state).toBe("UNCONFIGURED");

    const ready = voiceEnv({
      TWILIO_LOOKUP_ENABLED: "true",
      TWILIO_VERIFY_SERVICE_SID: "VA_future",
      TWILIO_PROXY_SERVICE_SID: "KS_future",
      CLAIRE_TWILIO_CONFERENCE: "true",
      TWILIO_TASKROUTER_WORKSPACE_SID: "WS_future",
      TWILIO_SYNC_SERVICE_SID: "IS_future",
      TWILIO_BRANDED_CALLING_CUSTOMER_PROFILE_SID: "BU_future",
      TWILIO_TRANSCRIPTION_ENABLED: "true",
      TWILIO_INTELLIGENCE_SERVICE_SID: "GA_future",
      CLAIRE_TWILIO_STUDIO_FALLBACK: "true",
      TWILIO_STUDIO_FLOW_SID: "FW_future",
    });
    expect(evaluateTwilioCapability("voiceGather", ready).state).toBe("LIVE");
    for (const id of [
      "lookup",
      "verify",
      "proxy",
      "conference",
      "taskRouter",
      "sync",
      "brandedCalling",
      "transcription",
      "conversationIntelligence",
      "studioFallback",
    ] as const) {
      expect(evaluateTwilioCapability(id, ready).state).toBe("CONFIGURED");
      expect(evaluateTwilioCapability(id, ready).state).not.toBe("LIVE");
    }

    noteTwilioCapabilityFailure("lookup");
    noteTwilioCapabilityFailure("verify");
    noteTwilioCapabilityFailure("proxy");
    noteTwilioCapabilityFailure("conference");
    noteTwilioCapabilityFailure("taskRouter");
    expect(evaluateTwilioCapability("lookup", ready).state).toBe("CONFIGURED_FAILING");
    expect(evaluateTwilioCapability("verify", ready).state).toBe("CONFIGURED_FAILING");
    expect(evaluateTwilioCapability("proxy", ready).state).toBe("CONFIGURED_FAILING");
    expect(evaluateTwilioCapability("conference", ready).state).toBe("CONFIGURED_FAILING");
    expect(evaluateTwilioCapability("taskRouter", ready).state).toBe("CONFIGURED_FAILING");
    expect(evaluateTwilioCapability("voiceGather", ready).state).toBe("LIVE");
  });
});

describe("lookup does not authorize", () => {
  const env = voiceEnv({
    TWILIO_LOOKUP_ENABLED: "true",
    TWILIO_LOOKUP_LINE_TYPE: "true",
    TWILIO_LOOKUP_CALLER_NAME: "true",
    TWILIO_LOOKUP_IDENTITY_MATCH: "true",
  });

  it("keeps premium fields unconfigured or unavailable and never authorizes", () => {
    const missing = observeLookup({ env, snapshot: { phoneNumber: "+13105550100", valid: true, countryCode: "US" } });
    expect(missing.authorizes).toBe(false);
    expect(authorizationFromLookup(missing)).toBeNull();
    expect(missing.normalizedE164).toEqual({ availability: "PRESENT", value: "+13105550100" });
    expect(missing.valid).toEqual({ availability: "PRESENT", value: true });
    expect(missing.country).toEqual({ availability: "PRESENT", value: "US" });
    expect(missing.lineType).toEqual({ availability: "UNAVAILABLE", value: null });
    expect(missing.reassignedNumberStatus.availability).toBe("UNCONFIGURED");
    expect(missing.simSwapStatus.availability).toBe("UNCONFIGURED");
    expect(missing.identityMatchStatus.availability).toBe("UNAVAILABLE");

    const rich = observeLookup({
      env,
      snapshot: {
        phoneNumber: "+13105550100",
        valid: true,
        countryCode: "US",
        lineType: "mobile",
        callerName: "Ada",
        identityMatchStatus: "match",
        reassignedNumberStatus: "no",
        simSwapStatus: "none",
      },
    });
    expect(rich.authorizes).toBe(false);
    expect(authorizationFromLookup(rich)).toBeNull();
    expect(rich.identityMatchStatus).toEqual({ availability: "PRESENT", value: "match" });
    expect(rich.reassignedNumberStatus.availability).toBe("UNCONFIGURED");
    expect(rich.simSwapStatus.availability).toBe("UNCONFIGURED");
  });

  it("does not treat an unconfigured account as a lookup result", () => {
    const observation = observeLookup({
      env: voiceEnv(),
      snapshot: { phoneNumber: "+13105550100", valid: true, countryCode: "US", callerName: "Ada" },
    });
    expect(observation.capabilityState).toBe("UNCONFIGURED");
    expect(observation.authorizes).toBe(false);
    expect(observation.callerName.availability).toBe("UNCONFIGURED");
    expect(observation.normalizedE164.availability).toBe("UNCONFIGURED");
  });
});

describe("verify grants", () => {
  const env = voiceEnv({ TWILIO_VERIFY_SERVICE_SID: "VA_future" });
  const now = Date.parse("2026-09-22T02:00:00Z");

  function approved(action: "sensitive_export" | "credential_change" = "sensitive_export") {
    return issueVerifyActionGrant({
      env,
      tenantId: "tenant-a",
      operatorUserId: "operator-a",
      actionClass: action,
      providerStatus: "approved",
      nowMs: now,
      phone: "+13105550100",
      verificationCode: "918273",
    });
  }

  it("keeps ordinary Claire for a known authorized inbound phone", () => {
    const operatorId = resolveClaireOperatorIdForPhone("+13105550001");
    const ordinary = conversationVerifyPolicy({
      knownAuthorizedOperatorId: operatorId,
      requestedActionClass: null,
    });
    expect(ordinary.conversationOtpRequired).toBe(false);
    expect(ordinary.keepsOrdinaryClaire).toBe(true);
    expect(ordinary.actionGrantRequired).toBe(false);

    const action = conversationVerifyPolicy({
      knownAuthorizedOperatorId: operatorId,
      requestedActionClass: "high_value_spend",
    });
    expect(action.conversationOtpRequired).toBe(false);
    expect(action.actionGrantRequired).toBe(true);
    expect(action.keepsOrdinaryClaire).toBe(false);
  });

  it("is evidence only, scoped, and expired when the clock passes", () => {
    const issued = approved();
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.grant.evidenceOnly).toBe(true);
    expect(issued.grant.executesBusinessAction).toBe(false);
    expect(issued.grant.expiresAtMs - issued.grant.issuedAtMs).toBe(VERIFY_GRANT_TTL_MS);
    expect("verificationCode" in issued.grant).toBe(false);
    expect(verifyGrantExecutes("payment")).toBe(false);
    expect(verifyGrantExecutes("export")).toBe(false);
    expect(verifyGrantExecutes("credential_mutation")).toBe(false);
    expect(verifyGrantExecutes("business_action")).toBe(false);
    expect(verifyGrantBusinessEffects()).toEqual([]);

    const demand = {
      tenantId: "tenant-a",
      operatorUserId: "operator-a",
      actionClass: "sensitive_export" as const,
      nowMs: now + 1,
    };
    expect(verifyGrantCovers(issued.grant, demand)).toBe(true);
    expect(verifyGrantCovers(issued.grant, { ...demand, tenantId: "tenant-b" })).toBe(false);
    expect(verifyGrantCovers(issued.grant, { ...demand, operatorUserId: "operator-b" })).toBe(false);
    expect(verifyGrantCovers(issued.grant, { ...demand, actionClass: "credential_change" })).toBe(false);
    expect(verifyGrantCovers(issued.grant, { ...demand, nowMs: issued.grant.expiresAtMs })).toBe(false);
    expect(issued.log).not.toContain("918273");
    expect(issued.log).not.toContain(TOKEN);
    expect(configLogContainsTwilioSecret(issued.log, env)).toBe(false);
  });

  it("does not grant when Verify is unconfigured", () => {
    const issued = issueVerifyActionGrant({
      env: voiceEnv(),
      tenantId: "tenant-a",
      operatorUserId: "operator-a",
      actionClass: "account_security_change",
      providerStatus: "approved",
      nowMs: now,
      verificationCode: "918273",
    });
    expect(issued.ok).toBe(false);
    expect(issued.grant).toBeNull();
    if (!issued.ok) expect(issued.state).toBe("UNCONFIGURED");
    expect(issued.log).not.toContain("918273");
  });
});

describe("proxy fails closed when unconfigured", () => {
  it("does not create a masked session without a service", () => {
    const plan = planMaskedCommunicationSession({
      env: voiceEnv(),
      tenantId: "tenant-a",
      anchor: { kind: "order", orderId: "order-1" },
    });
    expect(plan.ok).toBe(false);
    expect(plan.created).toBe(false);
    expect(plan.session).toBeNull();
    if (!plan.ok) expect(plan.state).toBe("UNCONFIGURED");
    expect(() => createProductionMaskedSession(voiceEnv())).toThrow(/UNCONFIGURED/);
  });

  it("refuses an anonymous proxy and still does not open a production session", () => {
    const env = voiceEnv({ TWILIO_PROXY_SERVICE_SID: "KS_future" });
    const anonymous = planMaskedCommunicationSession({ env, tenantId: "tenant-a", anchor: null });
    expect(anonymous.ok).toBe(false);
    if (!anonymous.ok) expect(anonymous.reason).toBe("anonymous_proxy_refused");
    const described = planMaskedCommunicationSession({
      env,
      tenantId: "tenant-a",
      anchor: { kind: "driver", driverId: "driver-1" },
    });
    expect(described.ok).toBe(true);
    expect(described.created).toBe(false);
    if (described.ok) {
      expect(described.session.liveSessionCreated).toBe(false);
      expect(described.session.proxySessionSid).toBeNull();
    }
    expect(() => createProductionMaskedSession(env)).toThrow(/not activated/);
  });
});

describe("coach path requires consent", () => {
  it("fails closed for a non-operator listen without a consent record", () => {
    const result = attemptCoachPath({
      tenantId: "tenant-a",
      subject: "non_operator",
      consentRecordId: null,
      requestedState: "COACH_LISTENING",
      env: { CLAIRE_VOICE_RECORDING_ENABLED: "true" },
    });
    expect(result.code).toBe("consent_required");
    expect(result.listening).toBe(false);
    expect(result.dialed).toBe(false);
    expect(result.transcriptionStarted).toBe(false);
    expect(result.recordingEnabled).toBe(false);
    expect(result.session.recordingEnabled).toBe(false);
    expect(result.session.coachingActivated).toBe(false);
    expect(result.binding.state).toBeNull();
  });

  it("does not dial Russell or start private coaching", () => {
    const noConsent = requestThirdPartyOnCall({
      tenantId: "tenant-a",
      displayName: "Russell",
      consentRecordId: null,
      env: { CLAIRE_VOICE_RECORDING_ENABLED: "true" },
    });
    expect(noConsent.code).toBe("consent_required");
    expect(noConsent.dialed).toBe(false);

    const consented = requestThirdPartyOnCall({
      tenantId: "tenant-a",
      displayName: "Russell",
      consentRecordId: "consent-1",
      env: { CLAIRE_VOICE_RECORDING_ENABLED: "true" },
    });
    expect(consented.code).toBe("third_party_dial_not_activated");
    expect(consented.dialed).toBe(false);
    expect(consented.listening).toBe(false);
    expect(consented.transcriptionStarted).toBe(false);

    const coach = attemptCoachPath({
      tenantId: "tenant-a",
      subject: "non_operator",
      consentRecordId: "consent-1",
      requestedState: "COACH_SPOKEN_PRIVATELY",
      env: { CLAIRE_VOICE_RECORDING_ENABLED: "true" },
    });
    expect(coach.code).toBe("coaching_not_activated");
    expect(coach.listening).toBe(false);
    expect(coach.session.transcriptionEnabled).toBe(false);
  });
});

describe("transcript candidates stay unverified", () => {
  it("cannot create completed work, approval, a sale, a promise, WeeklyIntent, Daily Command, or a Narrator event", () => {
    const candidate = classifyTranscriptCandidate({
      evidenceClass: "possible_business_claim",
      text: "The customer approved the sale, the work is complete, and I promise the weekly plan.",
      sentiment: "positive",
    });
    expect(candidate.status).toBe("UNVERIFIED_TRANSCRIPT_EVIDENCE");
    expect(candidate.regard).toBeNull();
    expect(promoteTranscriptCandidate(candidate).promoted).toBe(false);
    expect(authoritiesCreatedByTranscript(candidate)).toEqual([]);
    expect(businessOutcomesCreatedByTranscript(candidate)).toEqual([]);
    for (const authority of TRANSCRIPT_CANNOT_CREATE) {
      expect(authority).toEqual(expect.any(String));
    }
    expect(TRANSCRIPT_CANNOT_CREATE).toEqual([
      "completed_work",
      "customer_approval",
      "sale",
      "verified_promise",
      "WeeklyIntent",
      "DailyCommandPrimary",
      "NarratorEvent",
    ]);
  });
});

describe("taskrouter projection cannot mutate a job", () => {
  it("leaves the canonical job unchanged", () => {
    const job: GoldlineCanonicalJob = {
      tenantId: "tenant-a",
      jobId: "job-1",
      orderId: "order-1",
      driverId: "driver-1",
      availability: "available",
      assignmentStatus: "assigned",
    };
    const before = structuredClone(job);
    const { projection, job: returned } = projectGoldlineJobToTaskRouter(
      job,
      voiceEnv({ TWILIO_TASKROUTER_WORKSPACE_SID: "WS_future" })
    );
    expect(returned).toBe(job);
    expect(job).toEqual(before);
    expect(projection.mutatesCanonicalJob).toBe(false);
    expect(projection.createsTwilioTask).toBe(false);
    expect(projection.createsTwilioWorker).toBe(false);
    expect(projection.goldlineRemainsCanonical).toBe(true);
    expect(projection.capabilityState).toBe("CONFIGURED");
    expect(() => applyTaskRouterProjectionToCanonicalJob(job, projection)).toThrow(
      /cannot mutate a Goldline canonical job/
    );
    expect(job).toEqual(before);
  });
});

describe("comm events survive a transport failure", () => {
  it("keeps the domain event when the transport throws", async () => {
    const event: GoldlineCommEvent = {
      name: "transcript.final",
      tenantId: "tenant-a",
      occurredAt: "2026-09-22T02:00:00.000Z",
      payload: { text: "approved" },
      canonical: "goldline_domain_event",
      syncIsCanonicalState: false,
    };
    const journal = createMemoryCommEventJournal();
    const result = await publishGoldlineCommEvent({
      event,
      journal,
      transport: {
        async publish() {
          throw new Error("sync transport down");
        },
      },
    });
    expect(result).toEqual({ retained: true, transport: "failed" });
    expect(journal.list()).toEqual([event]);
    expect(syncIsCanonicalCommState()).toBe(false);
    expect(commEventCreatesBusinessAuthority(event)).toBe(false);
    expect(journal.list()[0]?.syncIsCanonicalState).toBe(false);
  });
});

describe("branded calling and studio stay inactive", () => {
  it("reports capability without activating a registration or leaking a secret", () => {
    const env = voiceEnv({
      TWILIO_BRANDED_CALLING_CUSTOMER_PROFILE_SID: "BU_future",
      TWILIO_BRANDED_DISPLAY_NAME: "Goldline",
    });
    const report = reportBrandedCalling(env);
    expect(report.capability.state).toBe("CONFIGURED");
    expect(report.registrationActivatedByCode).toBe(false);
    expect(report.claireCallingDependsOnBrandedCalling).toBe(false);
    expect(activateBrandedCallingRegistration().activated).toBe(false);
    const line = brandedCallingLogLine(env);
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain("BU_future");
    expect(configLogContainsTwilioSecret(line, env)).toBe(false);
  });

  it("keeps the Studio fallback documentary", () => {
    const studio = readFileSync(path.join(futureDir, "../../../docs/twilio/GOLDLINE_STUDIO_FALLBACK.md"), "utf8");
    expect(studio).toContain("generic apology");
    expect(studio).toContain("Hang up");
    expect(studio).toContain("generic restricted response");
    expect(studio).toContain("WeeklyIntent");
    expect(studio).toContain("Daily Command");
    expect(studio).toContain("Narrator");
    expect(studio).toMatch(/must not contain/i);
  });
});

describe("future adapters do not call Twilio or open product tables", () => {
  it("stays off the client, the receipt table, and Claire's turn path", () => {
    const sources = readdirSync(futureDir)
      .filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map(name => readFileSync(path.join(futureDir, name), "utf8"))
      .join("\n");
    expect(sources).not.toContain("getTwilioPlatformClient");
    expect(sources).not.toContain("mysqlTable");
    expect(sources).not.toContain("communication_receipts");
    expect(sources).not.toContain("lookups.v2");
    expect(sources).not.toContain("advanceNarrator");
    expect(sources).not.toContain("claire/turn/");
    expect(sources).not.toContain("preDriveConversation");
    expect(sources).not.toContain("voiceCommitment");
    expect(sources).not.toContain("contextAssembler");
    const lookupLog = lookupLogLine(
      observeLookup({ env: voiceEnv({ TWILIO_LOOKUP_ENABLED: "true" }) }),
      voiceEnv()
    );
    expect(lookupLog).not.toContain(TOKEN);
    expect(configLogContainsTwilioSecret(lookupLog, voiceEnv())).toBe(false);
  });
});
