import twilio from "twilio";

export type ClaireOutboundCallRequest = {
  to: string;
  from: string;
  createOptions: Record<string, unknown>;
};

export type ClaireOutboundCallResult = {
  callSid: string;
};

export async function placeClaireOutboundCall(
  input: ClaireOutboundCallRequest,
  env: NodeJS.ProcessEnv = process.env
): Promise<ClaireOutboundCallResult> {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const authToken = env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  if (!accountSid || !authToken) {
    throw new Error("Twilio outbound calling is not configured");
  }
  const client = twilio(accountSid, authToken);
  const call = await client.calls.create({
    to: input.to,
    from: input.from,
    ...(input.createOptions as any),
  });
  if (!call.sid?.trim()) {
    throw new Error("Twilio accepted a call request without a call SID");
  }
  return { callSid: call.sid };
}
