import {
  TWILIO_CAPABILITY_IDS,
  TWILIO_CAPABILITY_REASONS,
  type TwilioCapabilityId,
  type TwilioCapabilityReason,
  type TwilioCapabilityRecord,
  type TwilioCapabilityState,
  type TwilioPlatformConfig,
} from "@shared/twilioPlatform";
import { readTwilioPlatformConfig, twilioPlatformLogSnapshot } from "./config";

/**
 * Capability registry. States are not booleans.
 * voiceGather is the production Claire path when its existing env is present.
 * Unprovisioned products are never LIVE.
 */

export class TwilioCapabilityUnavailableError extends Error {
  readonly capability: TwilioCapabilityId;
  readonly state: TwilioCapabilityState;
  readonly reason: TwilioCapabilityReason | null;

  constructor(record: TwilioCapabilityRecord) {
    super(
      `Twilio capability ${record.id} is ${record.state}${record.reason ? ` (${record.reason})` : ""}`
    );
    this.name = "TwilioCapabilityUnavailableError";
    this.capability = record.id;
    this.state = record.state;
    this.reason = record.reason;
  }
}

const capabilityFailures = new Map<TwilioCapabilityId, TwilioCapabilityReason>();

export function noteTwilioCapabilityFailure(
  id: TwilioCapabilityId,
  reason: TwilioCapabilityReason = TWILIO_CAPABILITY_REASONS.providerFailure
): void {
  capabilityFailures.set(id, reason);
}

export function resetTwilioCapabilityFailuresForTests(): void {
  capabilityFailures.clear();
}

function record(
  id: TwilioCapabilityId,
  state: TwilioCapabilityState,
  reason: TwilioCapabilityReason | null
): TwilioCapabilityRecord {
  return { id, state, reason };
}

function accountGap(config: TwilioPlatformConfig): TwilioCapabilityRecord | null {
  if (!config.accountSidPresent) {
    return record("voiceGather", "UNCONFIGURED", TWILIO_CAPABILITY_REASONS.missingAccountSid);
  }
  if (!config.authTokenPresent) {
    return record("voiceGather", "UNCONFIGURED", TWILIO_CAPABILITY_REASONS.missingAuthToken);
  }
  return null;
}

function withId(
  id: TwilioCapabilityId,
  gap: TwilioCapabilityRecord | null
): TwilioCapabilityRecord | null {
  if (!gap) return null;
  return record(id, gap.state, gap.reason);
}

function voiceReady(config: TwilioPlatformConfig): TwilioCapabilityRecord | null {
  const gap = accountGap(config);
  if (gap) return gap;
  if (!config.claireFromNumber) {
    return record("voiceGather", "UNCONFIGURED", TWILIO_CAPABILITY_REASONS.missingFromNumber);
  }
  if (!config.operatorPhoneConfigured) {
    return record("voiceGather", "UNCONFIGURED", TWILIO_CAPABILITY_REASONS.missingOperatorPhone);
  }
  return null;
}

function applyFailure(ready: TwilioCapabilityRecord): TwilioCapabilityRecord {
  const failure = capabilityFailures.get(ready.id);
  if (!failure) return ready;
  if (ready.state !== "LIVE" && ready.state !== "CONFIGURED") return ready;
  return record(ready.id, "CONFIGURED_FAILING", failure);
}

function evaluate(id: TwilioCapabilityId, config: TwilioPlatformConfig): TwilioCapabilityRecord {
  switch (id) {
    case "voiceGather": {
      const gap = voiceReady(config);
      if (gap) return gap;
      return applyFailure(record(id, "LIVE", null));
    }
    case "conversationRelay": {
      if (!config.conversationRelayEnabled) {
        return record(id, "DISABLED", TWILIO_CAPABILITY_REASONS.featureFlagOff);
      }
      const gap = withId(id, accountGap(config));
      if (gap) return gap;
      return applyFailure(record(id, "CONFIGURED", null));
    }
    case "answeringMachineDetection": {
      if (!config.answeringMachineDetectionEnabled) {
        return record(id, "DISABLED", TWILIO_CAPABILITY_REASONS.featureFlagOff);
      }
      const gap = withId(id, voiceReady(config));
      if (gap) return gap;
      return applyFailure(record(id, "CONFIGURED", null));
    }
    case "sms": {
      const gap = withId(id, accountGap(config));
      if (gap) return gap;
      if (!config.smsFromNumber) {
        return record(id, "UNCONFIGURED", TWILIO_CAPABILITY_REASONS.missingFromNumber);
      }
      return applyFailure(record(id, "LIVE", null));
    }
    case "conversations":
      return sidBacked(id, config, config.conversationsServiceSidPresent);
    case "whatsapp": {
      const gap = withId(id, accountGap(config));
      if (gap) return gap;
      if (!config.whatsappFrom) {
        return record(id, "UNCONFIGURED", TWILIO_CAPABILITY_REASONS.missingFromNumber);
      }
      return applyFailure(record(id, "CONFIGURED", null));
    }
    case "transcription": {
      if (!config.transcriptionEnabled) {
        return record(id, "UNCONFIGURED", TWILIO_CAPABILITY_REASONS.notProvisioned);
      }
      const gap = withId(id, voiceReady(config));
      if (gap) return gap;
      return applyFailure(record(id, "CONFIGURED", null));
    }
    case "conversationIntelligence":
      return sidBacked(id, config, config.intelligenceServiceSidPresent);
    case "lookup": {
      if (!config.lookupEnabled) {
        return record(id, "UNCONFIGURED", TWILIO_CAPABILITY_REASONS.notProvisioned);
      }
      const gap = withId(id, accountGap(config));
      if (gap) return gap;
      return applyFailure(record(id, "CONFIGURED", null));
    }
    case "verify":
      return sidBacked(id, config, config.verifyServiceSidPresent);
    case "proxy":
      return sidBacked(id, config, config.proxyServiceSidPresent);
    case "conference": {
      if (!config.conferenceEnabled) {
        return record(id, "DISABLED", TWILIO_CAPABILITY_REASONS.featureFlagOff);
      }
      const gap = withId(id, voiceReady(config));
      if (gap) return gap;
      return applyFailure(record(id, "CONFIGURED", null));
    }
    case "brandedCalling": {
      if (!config.brandedCallingCustomerProfileSidPresent) {
        return record(id, "UNCONFIGURED", TWILIO_CAPABILITY_REASONS.missingCustomerProfileSid);
      }
      const gap = withId(id, accountGap(config));
      if (gap) return gap;
      return applyFailure(record(id, "CONFIGURED", null));
    }
    case "taskRouter": {
      if (!config.taskRouterWorkspaceSidPresent) {
        return record(id, "UNCONFIGURED", TWILIO_CAPABILITY_REASONS.missingWorkspaceSid);
      }
      const gap = withId(id, accountGap(config));
      if (gap) return gap;
      return applyFailure(record(id, "CONFIGURED", null));
    }
    case "sync":
      return sidBacked(id, config, config.syncServiceSidPresent);
    case "studioFallback": {
      if (!config.studioFallbackEnabled) {
        return record(id, "DISABLED", TWILIO_CAPABILITY_REASONS.featureFlagOff);
      }
      if (!config.studioFlowSidPresent) {
        return record(id, "UNCONFIGURED", TWILIO_CAPABILITY_REASONS.missingFlowSid);
      }
      const gap = withId(id, accountGap(config));
      if (gap) return gap;
      return applyFailure(record(id, "CONFIGURED", null));
    }
    default: {
      const unreachable: never = id;
      return record(unreachable, "UNCONFIGURED", TWILIO_CAPABILITY_REASONS.notProvisioned);
    }
  }
}

function sidBacked(
  id: TwilioCapabilityId,
  config: TwilioPlatformConfig,
  sidPresent: boolean
): TwilioCapabilityRecord {
  if (!sidPresent) {
    return record(id, "UNCONFIGURED", TWILIO_CAPABILITY_REASONS.missingServiceSid);
  }
  const gap = withId(id, accountGap(config));
  if (gap) return gap;
  return applyFailure(record(id, "CONFIGURED", null));
}

export function evaluateTwilioCapability(
  id: TwilioCapabilityId,
  env: NodeJS.ProcessEnv = process.env
): TwilioCapabilityRecord {
  return evaluate(id, readTwilioPlatformConfig(env));
}

export function evaluateTwilioCapabilities(
  env: NodeJS.ProcessEnv = process.env
): TwilioCapabilityRecord[] {
  const config = readTwilioPlatformConfig(env);
  return TWILIO_CAPABILITY_IDS.map(id => evaluate(id, config));
}

export function assertTwilioCapability(
  id: TwilioCapabilityId,
  env: NodeJS.ProcessEnv = process.env
): TwilioCapabilityRecord {
  const current = evaluateTwilioCapability(id, env);
  if (current.state !== "LIVE" && current.state !== "CONFIGURED") {
    throw new TwilioCapabilityUnavailableError(current);
  }
  return current;
}

export function logTwilioCapabilitySummary(env: NodeJS.ProcessEnv = process.env): void {
  const capabilities = evaluateTwilioCapabilities(env).map(item => ({
    id: item.id,
    state: item.state,
    reason: item.reason,
  }));
  console.info(
    "[twilio-platform] capabilities",
    JSON.stringify({ config: twilioPlatformLogSnapshot(env), capabilities })
  );
}
