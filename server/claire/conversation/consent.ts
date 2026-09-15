/**
 * Narrow dogfood gate. Recording is off unless explicitly enabled.
 * Claire already only dials CLAIRE_OPERATOR_PHONE; this env flag is the
 * product consent switch so future tenants cannot inherit recording.
 */
export function isClaireVoiceRecordingEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = env.CLAIRE_VOICE_RECORDING_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function recordingConsentLabel(enabled: boolean): string {
  return enabled ? "dogfood_explicit" : "disabled";
}
