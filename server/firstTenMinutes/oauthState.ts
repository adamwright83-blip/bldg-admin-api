import crypto from "node:crypto";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import type { ConnectionProvider } from "../../shared/firstTenMinutes";

/**
 * The OAuth `state` a first-ten connection carries through Google's or Slack's consent screen: signed, ten minutes,
 * bound to one journey, one provider and one start origin, and to the browser that started it by a nonce whose hash
 * is in the state and whose value is in a short-lived HttpOnly cookie. A callback that fails any of these refuses.
 */
const PURPOSE = "first_ten_connect";
const TTL_SECONDS = 10 * 60;
export const FIRST_TEN_NONCE_COOKIE = "joystick_first_ten_connect";

function stateKey(env: NodeJS.ProcessEnv): Uint8Array {
  const secret = env.JWT_SECRET?.trim();
  if (!secret) throw new Error("JWT_SECRET is required to sign connection state");
  return new TextEncoder().encode(`first-ten-state:${secret}`);
}

export type ConnectState = {
  journeyId: string;
  provider: ConnectionProvider;
  origin: string;
  nonceHash: string;
  /** "send": the person is giving JOYSTICK permission to send from the account their crew already read */
  purpose?: "send";
};

export function newConnectNonce(): { nonce: string; nonceHash: string } {
  const nonce = crypto.randomBytes(32).toString("base64url");
  return { nonce, nonceHash: hashNonce(nonce) };
}

export function hashNonce(nonce: string): string {
  return crypto.createHash("sha256").update(nonce).digest("hex");
}

export async function signConnectState(state: ConnectState, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new SignJWT({ purpose: PURPOSE, jid: state.journeyId, prv: state.provider, org: state.origin, nh: state.nonceHash, ...(state.purpose ? { for: state.purpose } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(stateKey(env));
}

export type StateCheck =
  | { ok: true; state: ConnectState }
  | { ok: false; reason: "expired" | "invalid" };

export async function verifyConnectState(
  token: string,
  expected: { provider: ConnectionProvider; nonce: string | null | undefined },
  env: NodeJS.ProcessEnv = process.env
): Promise<StateCheck> {
  try {
    const { payload } = await jwtVerify(token, stateKey(env), { algorithms: ["HS256"] });
    if (
      payload.purpose !== PURPOSE ||
      payload.prv !== expected.provider ||
      typeof payload.jid !== "string" ||
      typeof payload.org !== "string" ||
      typeof payload.nh !== "string"
    ) {
      return { ok: false, reason: "invalid" };
    }
    // The browser that returns must be the browser that left.
    if (!expected.nonce || !crypto.timingSafeEqual(Buffer.from(hashNonce(expected.nonce)), Buffer.from(payload.nh))) {
      return { ok: false, reason: "invalid" };
    }
    return {
      ok: true,
      state: { journeyId: payload.jid, provider: expected.provider, origin: payload.org, nonceHash: payload.nh, ...(payload.for === "send" ? { purpose: "send" as const } : {}) },
    };
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}
