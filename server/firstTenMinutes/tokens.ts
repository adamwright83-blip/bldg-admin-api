import crypto from "node:crypto";

/**
 * Provider access and refresh tokens are stored encrypted (AES-256-GCM). The key is
 * JOYSTICK_CONNECTION_TOKEN_KEY, or JWT_SECRET when that is unset. Tokens are never logged or returned to a browser.
 */
function tokenKey(env: NodeJS.ProcessEnv): Buffer {
  const secret = env.JOYSTICK_CONNECTION_TOKEN_KEY?.trim() || env.JWT_SECRET?.trim();
  if (!secret) throw new Error("JOYSTICK_CONNECTION_TOKEN_KEY or JWT_SECRET is required to store connections");
  return crypto.createHash("sha256").update(`first-ten-connection:${secret}`).digest();
}

const VERSION = "v1";

export function encryptConnectionToken(value: string, env: NodeJS.ProcessEnv = process.env): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", tokenKey(env), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map(part => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptConnectionToken(stored: string, env: NodeJS.ProcessEnv = process.env): string {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Stored connection token is malformed");
  const decipher = crypto.createDecipheriv("aes-256-gcm", tokenKey(env), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
