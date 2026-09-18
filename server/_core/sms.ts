import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromPhone =
  process.env.TWILIO_FROM_NUMBER ?? process.env.TWILIO_PHONE_NUMBER;

if (!accountSid || !authToken || !fromPhone) {
  console.warn("[SMS] Twilio credentials not configured");
}

const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

export type SmsSendReceipt = {
  accepted: boolean;
  providerMessageId: string | null;
  providerStatus: string | null;
  evidenceName:
    | "provider_accepted"
    | "provider_rejected"
    | "provider_unconfigured"
    | "send_outcome_unknown";
};

function readHttpStatus(error: unknown): number | null {
  let candidate: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!candidate || typeof candidate !== "object") return null;
    const record = candidate as { status?: unknown; statusCode?: unknown; cause?: unknown };
    for (const value of [record.status, record.statusCode]) {
      const status = typeof value === "string" ? Number(value) : value;
      if (typeof status === "number" && Number.isInteger(status) && status >= 100) return status;
    }
    candidate = record.cause;
  }
  return null;
}

/**
 * `provider_rejected` only when the provider authoritatively refused the request.
 * Timeouts, disconnects, 5xx, 429, 408, and missing HTTP status are unknown.
 */
export function classifyTwilioSendFailure(
  error: unknown
): "provider_rejected" | "send_outcome_unknown" {
  const status = readHttpStatus(error);
  if (status != null && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return "provider_rejected";
  }
  return "send_outcome_unknown";
}

export function normalizeSmsPhone(to: string): string {
  const digits = to.replace(/\D/g, "");
  return digits.startsWith("1") ? `+${digits}` : `+1${digits}`;
}

/**
 * Authoritative outbound SMS. Proves Twilio accepted the create request
 * (Message SID returned). Does not prove delivery or read.
 */
export async function sendSMSWithReceipt(
  to: string,
  message: string,
  options?: { idempotencyKey?: string }
): Promise<SmsSendReceipt> {
  if (!client || !fromPhone) {
    console.warn("[SMS] Twilio not configured, skipping SMS");
    return {
      accepted: false,
      providerMessageId: null,
      providerStatus: null,
      evidenceName: "provider_unconfigured",
    };
  }

  try {
    const created = options?.idempotencyKey
      ? await createTwilioMessageWithIdempotency({
          to: normalizeSmsPhone(to),
          body: message,
          idempotencyKey: options.idempotencyKey,
        })
      : await client.messages.create({
          body: message,
          from: fromPhone,
          to: normalizeSmsPhone(to),
        });
    const sid = typeof created.sid === "string" && created.sid.length > 0 ? created.sid : null;
    if (!sid) {
      console.warn("[SMS] Twilio returned no Message SID; treating as unknown outcome");
      return {
        accepted: false,
        providerMessageId: null,
        providerStatus: typeof created.status === "string" ? created.status : null,
        evidenceName: "send_outcome_unknown",
      };
    }
    console.info("[SMS] Twilio accepted a message");
    return {
      accepted: true,
      providerMessageId: sid,
      providerStatus: typeof created.status === "string" ? created.status : null,
      evidenceName: "provider_accepted",
    };
  } catch (err) {
    const evidenceName = classifyTwilioSendFailure(err);
    console.error(
      evidenceName === "provider_rejected" ? "[SMS] Twilio rejected a message" : "[SMS] Twilio send outcome is unknown",
      err instanceof Error ? { errorName: err.name } : { errorName: "unknown" },
    );
    return {
      accepted: false,
      providerMessageId: null,
      providerStatus: null,
      evidenceName,
    };
  }
}

async function createTwilioMessageWithIdempotency(input: {
  to: string;
  body: string;
  idempotencyKey: string;
}): Promise<{ sid?: string; status?: string }> {
  if (!client || !fromPhone || !accountSid) {
    throw new Error("Twilio is not configured.");
  }
  const response = await client.request({
    method: "post",
    uri: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    headers: { "Idempotency-Key": input.idempotencyKey },
    data: {
      To: input.to,
      From: fromPhone,
      Body: input.body,
    },
  });
  const body = (response as { body?: { sid?: string; status?: string } }).body ?? {};
  return {
    sid: typeof body.sid === "string" ? body.sid : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
  };
}

/**
 * Send SMS notification to customer
 * @param to Customer phone number (any format, will be normalized)
 * @param message SMS body text
 * @returns true if Twilio accepted the create request, false otherwise
 */
export async function sendSMS(to: string, message: string): Promise<boolean> {
  const receipt = await sendSMSWithReceipt(to, message);
  return receipt.accepted;
}

/**
 * Send "pickup en route" notification
 */
export async function notifyPickupEnRoute(phone: string): Promise<boolean> {
  return sendSMS(
    phone,
    "Laundry Butler: Your driver is on the way for pickup now. Thank you for trusting us with your garments — we'll take excellent care of everything."
  );
}

/**
 * Send "card charged" notification
 */
export async function notifyCardCharged(phone: string, amountDollars: string): Promise<boolean> {
  return sendSMS(
    phone,
    `Laundry Butler: Your order has been processed and your card charged $${amountDollars}. We appreciate the opportunity to serve you and will notify you when delivery is on the way.`
  );
}

/**
 * Send "delivery en route" notification
 */
export async function notifyDeliveryEnRoute(phone: string): Promise<boolean> {
  return sendSMS(
    phone,
    "Laundry Butler: Your fresh laundry is on the way back to you now. Thank you again for choosing Laundry Butler — we're grateful to serve you."
  );
}
