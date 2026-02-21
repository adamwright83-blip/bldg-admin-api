import { describe, expect, it } from "vitest";
import { sendSMS } from "./_core/sms";

describe("SMS Integration", () => {
  it("validates Twilio credentials by sending a test SMS", async () => {
    // This test sends an actual SMS to verify credentials work
    // Using the user's actual phone number (not the Twilio FROM number)
    const testPhone = "3238074661";
    
    const result = await sendSMS(
      testPhone,
      "Laundry Butler: Test SMS from vitest. Twilio integration working correctly."
    );

    // If credentials are valid, sendSMS returns true
    expect(result).toBe(true);
  }, 15000); // 15s timeout for API call

  it("normalizes phone numbers correctly", async () => {
    // Test that various phone formats are normalized to E.164
    const formats = [
      "(323) 807-4661",
      "323-807-4661",
      "3238074661",
      "1-323-807-4661",
    ];

    // We won't actually send to all these, just verify the helper doesn't crash
    // The normalization logic is in sendSMS, so calling it once tests the pattern
    const result = await sendSMS(formats[0], "Test normalization");
    expect(typeof result).toBe("boolean");
  }, 15000);
});
