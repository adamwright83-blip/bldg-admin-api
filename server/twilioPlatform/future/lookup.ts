import { redactEndpointForLog } from "@shared/twilioPlatform";
import {
  LOOKUP_PREMIUM_PACKAGES,
  type LookupField,
  type LookupObservation,
  type LookupPremiumPackage,
  type LookupProviderSnapshot,
} from "@shared/twilioFuture";
import { evaluateTwilioCapability } from "../capabilities";
import { safeFutureLog } from "./safeLog";

const PACKAGE_ENV: Record<LookupPremiumPackage, string> = {
  lineType: "TWILIO_LOOKUP_LINE_TYPE",
  callerName: "TWILIO_LOOKUP_CALLER_NAME",
  reassignedNumber: "TWILIO_LOOKUP_REASSIGNED_NUMBER",
  identityMatch: "TWILIO_LOOKUP_IDENTITY_MATCH",
  simSwap: "TWILIO_LOOKUP_SIM_SWAP",
};

const E164 = /^\+[1-9]\d{1,14}$/;
const COUNTRY = /^[A-Z]{2}$/;

function unconfigured<T>(): LookupField<T> {
  return { availability: "UNCONFIGURED", value: null };
}

function unavailable<T>(): LookupField<T> {
  return { availability: "UNAVAILABLE", value: null };
}

function presentOrUnavailable<T>(value: T | null): LookupField<T> {
  if (value == null) return unavailable();
  return { availability: "PRESENT", value };
}

function premiumField(
  permitted: boolean,
  value: string | null | undefined
): LookupField<string> {
  if (!permitted) return unconfigured();
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return unavailable();
  return { availability: "PRESENT", value: trimmed };
}

export function lookupPackagesPermittedByAccount(
  env: NodeJS.ProcessEnv = process.env
): readonly LookupPremiumPackage[] {
  return LOOKUP_PREMIUM_PACKAGES.filter(pkg => env[PACKAGE_ENV[pkg]]?.trim().toLowerCase() === "true");
}

function blankObservation(state: LookupObservation["capabilityState"]): LookupObservation {
  return {
    capabilityState: state,
    authorizes: false,
    normalizedE164: unconfigured(),
    valid: unconfigured(),
    country: unconfigured(),
    lineType: unconfigured(),
    callerName: unconfigured(),
    reassignedNumberStatus: unconfigured(),
    identityMatchStatus: unconfigured(),
    simSwapStatus: unconfigured(),
  };
}

/**
 * Maps a caller-supplied Lookup snapshot into Goldline fields.
 * Does not call Twilio. A successful lookup is not authorization.
 */
export function observeLookup(input: {
  env?: NodeJS.ProcessEnv;
  permittedPackages?: readonly LookupPremiumPackage[];
  snapshot?: LookupProviderSnapshot | null;
}): LookupObservation {
  const env = input.env ?? process.env;
  const capability = evaluateTwilioCapability("lookup", env);
  if (capability.state !== "CONFIGURED" && capability.state !== "LIVE") {
    const observation = blankObservation(capability.state);
    if (capability.state === "CONFIGURED_FAILING") {
      return {
        ...observation,
        normalizedE164: unavailable(),
        valid: unavailable(),
        country: unavailable(),
        lineType: unavailable(),
        callerName: unavailable(),
        reassignedNumberStatus: unavailable(),
        identityMatchStatus: unavailable(),
        simSwapStatus: unavailable(),
      };
    }
    return observation;
  }

  const permitted = new Set(input.permittedPackages ?? lookupPackagesPermittedByAccount(env));
  const snapshot = input.snapshot ?? {};
  const phone = snapshot.phoneNumber?.trim() ?? "";
  const country = snapshot.countryCode?.trim().toUpperCase() ?? "";
  return {
    capabilityState: capability.state,
    authorizes: false,
    normalizedE164: presentOrUnavailable(E164.test(phone) ? phone : null),
    valid: typeof snapshot.valid === "boolean" ? { availability: "PRESENT", value: snapshot.valid } : unavailable(),
    country: presentOrUnavailable(COUNTRY.test(country) ? country : null),
    lineType: premiumField(permitted.has("lineType"), snapshot.lineType),
    callerName: premiumField(permitted.has("callerName"), snapshot.callerName),
    reassignedNumberStatus: premiumField(permitted.has("reassignedNumber"), snapshot.reassignedNumberStatus),
    identityMatchStatus: premiumField(permitted.has("identityMatch"), snapshot.identityMatchStatus),
    simSwapStatus: premiumField(permitted.has("simSwap"), snapshot.simSwapStatus),
  };
}

/** Lookup never authorizes an action, including when every field is present. */
export function authorizationFromLookup(_observation: LookupObservation): null {
  return null;
}

export function lookupLogLine(
  observation: LookupObservation,
  env: NodeJS.ProcessEnv = process.env
): string {
  const phone =
    observation.normalizedE164.availability === "PRESENT"
      ? observation.normalizedE164.value
      : null;
  return safeFutureLog(
    {
      capabilityState: observation.capabilityState,
      authorizes: observation.authorizes,
      phone: redactEndpointForLog(phone),
      lineType: observation.lineType.availability,
      callerName: observation.callerName.availability,
      reassignedNumberStatus: observation.reassignedNumberStatus.availability,
      identityMatchStatus: observation.identityMatchStatus.availability,
      simSwapStatus: observation.simSwapStatus.availability,
    },
    env
  );
}
