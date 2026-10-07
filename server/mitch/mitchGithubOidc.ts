import type { Request } from "express";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "joystick-mitch-agent";
const REPOSITORY = "adamwright83-blip/bldg-admin-api";
const JWKS = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks")
);

const WORKFLOWS = {
  "Mitch Claude executor": {
    role: "executor",
    actorId: "github-producer-bus:claude",
    path: ".github/workflows/mitch-claude-executor.yml",
  },
  "Mitch independent reviewer": {
    role: "reviewer",
    actorId: "claude_independent_review",
    path: ".github/workflows/mitch-independent-reviewer.yml",
  },
} as const;

export type MitchGithubRole = "executor" | "reviewer";
export type MitchGithubIdentity = {
  actorId: string;
  role: MitchGithubRole;
  repository: string;
  ref: string;
  sha: string;
  workflow: string;
  runId: string;
};

function bearer(req: Request): string | null {
  const value = req.headers.authorization;
  if (!value || Array.isArray(value)) return null;
  return value.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

function claimString(payload: JWTPayload, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

export async function verifyMitchGithubOidcToken(
  token: string
): Promise<MitchGithubIdentity> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: ISSUER,
    audience: AUDIENCE,
  });

  const repository = claimString(payload, "repository");
  if (repository !== REPOSITORY)
    throw new Error("GitHub OIDC repository is not authorized for Mitch");

  if (claimString(payload, "event_name") !== "workflow_dispatch")
    throw new Error("Mitch GitHub agents may run only from workflow_dispatch");

  const workflow = claimString(payload, "workflow");
  const rule = WORKFLOWS[workflow as keyof typeof WORKFLOWS];
  if (!rule) throw new Error("GitHub OIDC workflow is not authorized for Mitch");

  const ref = claimString(payload, "ref");
  if (ref !== "refs/heads/main")
    throw new Error("Mitch GitHub agents must run from main");

  const workflowRef =
    claimString(payload, "workflow_ref") ||
    claimString(payload, "job_workflow_ref");
  const expected =
    REPOSITORY + "/" + rule.path + "@refs/heads/main";
  if (workflowRef && !workflowRef.startsWith(expected))
    throw new Error("Mitch GitHub workflow file is not authorized");

  return {
    actorId: rule.actorId,
    role: rule.role,
    repository,
    ref,
    sha: claimString(payload, "sha"),
    workflow,
    runId: claimString(payload, "run_id"),
  };
}

export async function requireMitchGithubOidc(
  req: Request
): Promise<MitchGithubIdentity> {
  const token = bearer(req);
  if (!token) throw new Error("GitHub OIDC bearer token required");
  return verifyMitchGithubOidcToken(token);
}

/** Claude Code sends its model-gateway credential as X-Api-Key. */
export async function requireMitchGithubOidcApiKey(
  req: Request
): Promise<MitchGithubIdentity> {
  const raw = req.headers["x-api-key"];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token) throw new Error("GitHub OIDC x-api-key required");
  return verifyMitchGithubOidcToken(token);
}
