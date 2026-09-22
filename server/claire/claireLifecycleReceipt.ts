import { recordExistingCallStatusReceipt } from "./amdVoicemail";

/**
 * Writes a communications receipt from an existing Claire Twilio callback
 * body. Recording callbacks without CallStatus write nothing. This does
 * not add a webhook URL.
 */
export async function writeClaireLifecycleReceipt(
  body: Record<string, string>
): Promise<void> {
  await recordExistingCallStatusReceipt(body);
}
