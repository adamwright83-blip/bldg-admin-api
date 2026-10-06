import type { Request } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "joystick-president-agent";
const REPOSITORY = "adamwright83-blip/bldg-admin-api";
const JWKS = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks")
);

export type PresidentGithubIdentity = {
  actorId: string;
  repository: string;
  ref: string;
  sha: string;
  workflow: string;
  runId: string;
  eventName: string;
};

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || Array.isArray(h)) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

function claimString(payload: JWTPayload, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

export async function verifyPresidentGithubOidcToken(
  token: string
): Promise<PresidentGithubIdentity> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  const repository = claimString(payload, "repository");
  if (repository !== REPOSITORY)
    throw new Error("GitHub OIDC repository is not authorized");

  const eventName = claimString(payload, "event_name");
  if (!["schedule", "workflow_dispatch"].includes(eventName))
    throw new Error("GitHub OIDC event is not authorized");

  const workflow = claimString(payload, "workflow");
  if (workflow !== "President autonomous agent")
    throw new Error("GitHub OIDC workflow is not authorized");

  const ref = claimString(payload, "ref");
  if (!ref.startsWith("refs/heads/"))
    throw new Error("GitHub OIDC ref must be a branch");

  return {
    actorId: "president-github-actions-agent",
    repository,
    ref,
    sha: claimString(payload, "sha"),
    workflow,
    runId: claimString(payload, "run_id"),
    eventName,
  };
}

export async function requirePresidentGithubOidc(
  req: Request
): Promise<PresidentGithubIdentity> {
  const token = bearer(req);
  if (!token) throw new Error("GitHub OIDC bearer token required");
  return verifyPresidentGithubOidcToken(token);
}

/** Claude Code sends its gateway credential as X-Api-Key. */
export async function requirePresidentGithubOidcApiKey(
  req: Request
): Promise<PresidentGithubIdentity> {
  const raw = req.headers["x-api-key"];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token) throw new Error("GitHub OIDC x-api-key required");
  return verifyPresidentGithubOidcToken(token);
}
