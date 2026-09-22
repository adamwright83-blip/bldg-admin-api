import type { TwilioCapabilityRecord } from "@shared/twilioPlatform";
import { evaluateTwilioCapability } from "../capabilities";
import { safeFutureLog } from "./safeLog";

/**
 * Reporting only. Registration stays in Trust Hub.
 * This module cannot approve a brand, assign a number, or change Claire's dial path.
 */
export type BrandedCallingReport = {
  capability: TwilioCapabilityRecord;
  registrationActivatedByCode: false;
  claireCallingDependsOnBrandedCalling: false;
  displayName: string | null;
  callReason: string | null;
  basicFeatures: readonly ["display_name"];
  enhancedFeatures: readonly ["display_name", "logo", "call_reason"];
};

export function reportBrandedCalling(env: NodeJS.ProcessEnv = process.env): BrandedCallingReport {
  return {
    capability: evaluateTwilioCapability("brandedCalling", env),
    registrationActivatedByCode: false,
    claireCallingDependsOnBrandedCalling: false,
    displayName: env.TWILIO_BRANDED_DISPLAY_NAME?.trim() || null,
    callReason: env.TWILIO_BRANDED_CALL_REASON?.trim() || null,
    basicFeatures: ["display_name"],
    enhancedFeatures: ["display_name", "logo", "call_reason"],
  };
}

export function activateBrandedCallingRegistration(): {
  activated: false;
  reason: "registration_not_activated_by_code";
} {
  return { activated: false, reason: "registration_not_activated_by_code" };
}

export function brandedCallingLogLine(env: NodeJS.ProcessEnv = process.env): string {
  const report = reportBrandedCalling(env);
  return safeFutureLog(
    {
      state: report.capability.state,
      reason: report.capability.reason,
      registrationActivatedByCode: report.registrationActivatedByCode,
      claireCallingDependsOnBrandedCalling: report.claireCallingDependsOnBrandedCalling,
      displayNamePresent: Boolean(report.displayName),
    },
    env
  );
}
