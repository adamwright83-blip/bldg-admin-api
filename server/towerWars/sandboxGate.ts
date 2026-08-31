import { TRPCError } from "@trpc/server";
import { zonedYmd } from "../dashboardZoned";

export function sandboxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GOLDLINE_SANDBOX_ENABLED === "true";
}

export function requireSandboxEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (!sandboxEnabled(env)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Goldline Sandbox is disabled on this server." });
  }
}

export function isCompletedReplayDate(
  businessDate: string,
  now: Date,
  timeZone: string
): boolean {
  return businessDate < zonedYmd(now, timeZone);
}
