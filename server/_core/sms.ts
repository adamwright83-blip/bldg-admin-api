import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromPhone = process.env.TWILIO_PHONE_NUMBER;

if (!accountSid || !authToken || !fromPhone) {
  console.warn("[SMS] Twilio credentials not configured");
}

const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

/**
 * Send SMS notification to customer
 * @param to Customer phone number (any format, will be normalized)
 * @param message SMS body text
 * @returns true if sent successfully, false otherwise
 */
export async function sendSMS(to: string, message: string): Promise<boolean> {
  if (!client || !fromPhone) {
    console.warn("[SMS] Twilio not configured, skipping SMS");
    return false;
  }

  try {
    // Normalize phone: remove all non-digits, then add +1 if not present
    const digits = to.replace(/\D/g, "");
    const normalizedPhone = digits.startsWith("1") ? `+${digits}` : `+1${digits}`;

    await client.messages.create({
      body: message,
      from: fromPhone,
      to: normalizedPhone,
    });

    console.log(`[SMS] Sent to ${normalizedPhone}: ${message.substring(0, 50)}...`);
    return true;
  } catch (err) {
    console.error("[SMS] Failed to send:", err);
    return false;
  }
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
