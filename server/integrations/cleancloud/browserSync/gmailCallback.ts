/* LEGACY DAYFORGE COMPATIBILITY: Jawbreaker Gmail OAuth callback for CleanCloud verification */
import type { Request, Response } from "express";
import { resolveLegacyDayforgeMembership, roleAllows } from "../../../saas/tenantAccess";
import { completeJawbreakerGmailConnection } from "./gmailVerification";

type CallbackContext = {
  tenantId: string;
  user: { openId: string; role: "admin" | "driver" | "user" } | null;
};

/**
 * Google's OAuth redirect is a top-level GET without an app Origin header, so it
 * is handled here rather than as a tRPC mutation (whose CSRF origin guard
 * correctly rejects it). Authorization is equivalent to the operator procedure:
 * signed-in session, tenant membership with an operator role, and a signed state
 * bound to that same tenant and user (verified in completeJawbreakerGmailConnection).
 */
export async function handleJawbreakerGmailCallback(
  req: Request,
  res: Response,
  deps: {
    createContext: (req: Request, res: Response) => Promise<CallbackContext>;
    resolveMembership?: typeof resolveLegacyDayforgeMembership;
    complete?: typeof completeJawbreakerGmailConnection;
  }
) {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !state) {
    res.status(400).send("Gmail authorization was cancelled or incomplete.");
    return;
  }
  try {
    const ctx = await deps.createContext(req, res);
    if (!ctx.user) throw new Error("Not signed in");
    const membership = await (deps.resolveMembership ?? resolveLegacyDayforgeMembership)({
      tenantId: ctx.tenantId,
      userOpenId: ctx.user.openId,
      platformRole: ctx.user.role,
    });
    if (!membership || !roleAllows(membership.role, ["owner", "admin", "operator"]))
      throw new Error("Operator role required");
    const result = await (deps.complete ?? completeJawbreakerGmailConnection)({
      code,
      state,
      sessionTenantId: ctx.tenantId,
      sessionUserId: ctx.user.openId,
    });
    res
      .status(200)
      .send(`Gmail connected for CleanCloud verification${result.connectedEmail ? ` (${result.connectedEmail})` : ""}. You can close this tab.`);
  } catch (error) {
    // Never echo the authorization code or tokens.
    console.warn("[JawbreakerGmail] Authorization failed:", error instanceof Error ? error.message : "unknown");
    res.status(403).send("Gmail authorization failed. Sign in to JOYSTICK as the operator and try again.");
  }
}
