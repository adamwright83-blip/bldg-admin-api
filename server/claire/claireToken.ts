import { createHmac, timingSafeEqual } from "node:crypto";
import type { ClaireDebriefProposal } from "./reasoning";

export type ClaireDriveTokenPayload = {
  v: 1;
  kind: "drive_call";
  tenantId: string;
  userId: string;
  missionId: number;
  phase: "post_stop";
  exp: number;
};

export type ClaireApprovalTokenPayload = {
  v: 1;
  kind: "debrief_approval";
  tenantId: string;
  userId: string;
  missionId: number;
  requestId: string;
  proposal: ClaireDebriefProposal;
  exp: number;
};

export type ClaireTokenPayload =
  | ClaireDriveTokenPayload
  | ClaireApprovalTokenPayload;

export type ClaireTokenInput =
  | Omit<ClaireDriveTokenPayload, "v" | "exp">
  | Omit<ClaireApprovalTokenPayload, "v" | "exp">;

function secretOrThrow(explicit?: string): string {
  const secret = explicit ?? process.env.JWT_SECRET ?? "";
  if (!secret) throw new Error("JWT_SECRET is required for Claire call tokens");
  return secret;
}

function signature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function issueClaireToken(
  payload: ClaireTokenInput,
  options?: { ttlSeconds?: number; nowMs?: number; secret?: string }
): string {
  const nowMs = options?.nowMs ?? Date.now();
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      v: 1,
      exp: Math.floor(nowMs / 1000) + (options?.ttlSeconds ?? 30 * 60),
    })
  ).toString("base64url");
  return `${body}.${signature(body, secretOrThrow(options?.secret))}`;
}

export function verifyClaireToken(
  token: string,
  options?: { nowMs?: number; secret?: string }
): ClaireTokenPayload {
  const [body, suppliedSignature, extra] = token.split(".");
  if (!body || !suppliedSignature || extra) throw new Error("Invalid Claire token");
  const expected = signature(body, secretOrThrow(options?.secret));
  const suppliedBytes = Buffer.from(suppliedSignature);
  const expectedBytes = Buffer.from(expected);
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    throw new Error("Invalid Claire token signature");
  }
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as
    Partial<ClaireTokenPayload>;
  const now = Math.floor((options?.nowMs ?? Date.now()) / 1000);
  if (parsed.v !== 1 || typeof parsed.exp !== "number" || parsed.exp <= now) {
    throw new Error("Claire token expired or invalid");
  }
  if (
    typeof parsed.tenantId !== "string" ||
    typeof parsed.userId !== "string" ||
    typeof parsed.missionId !== "number" ||
    (parsed.kind !== "drive_call" && parsed.kind !== "debrief_approval")
  ) {
    throw new Error("Claire token payload is invalid");
  }
  return parsed as ClaireTokenPayload;
}
