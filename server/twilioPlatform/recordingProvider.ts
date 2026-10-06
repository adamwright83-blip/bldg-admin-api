export async function fetchTwilioRecordingMp3(input: {
  accountSid: string;
  authToken: string;
  recordingSid: string;
}): Promise<Buffer | null> {
  const accountSid = input.accountSid.trim();
  const authToken = input.authToken.trim();
  const recordingSid = input.recordingSid.trim();
  if (!accountSid || !authToken || !recordingSid) {
    throw new Error("Twilio recording fetch requires provider authority");
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Recordings/${encodeURIComponent(recordingSid)}.mp3`;
  const response = await fetch(url, {
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
    },
  });
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}
