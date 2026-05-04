import { listAbandonedVendorOnboardingCandidates } from "../../db";
import type { AgentTool } from "../toolRegistry";

function intervalFor(row: { updatedAt: Date; abandoned2hLoggedAt: Date | null; abandoned24hLoggedAt: Date | null; abandoned7dLoggedAt: Date | null }, now: Date) {
  const ageMs = now.getTime() - row.updatedAt.getTime();
  if (ageMs >= 7 * 24 * 60 * 60 * 1000 && !row.abandoned7dLoggedAt) return "7d";
  if (ageMs >= 24 * 60 * 60 * 1000 && !row.abandoned24hLoggedAt) return "24h";
  if (ageMs >= 2 * 60 * 60 * 1000 && !row.abandoned2hLoggedAt) return "2h";
  return null;
}

export const scanAbandonedVendorOnboardingSessionsTool: AgentTool<Record<string, any>> = {
  name: "scanAbandonedVendorOnboardingSessionsTool",
  description: "Find vendor onboarding sessions needing 2h, 24h, or 7d abandonment telemetry.",
  async execute(input, ctx) {
    const now = input.now ? new Date(input.now) : new Date();
    const rows = await listAbandonedVendorOnboardingCandidates(ctx.tenantId, now);
    const candidates = rows.map((row) => ({
      onboardingSessionId: row.id,
      vendorId: row.vendorId,
      sessionId: row.sessionId,
      conversationId: row.conversationId,
      vendorCategory: row.vendorCategory,
      lastCompletedStep: row.lastCompletedStep,
      missingFields: row.missingFieldsJson,
      abandonmentInterval: intervalFor(row, now),
    })).filter((row) => row.abandonmentInterval);
    return { entityType: "vendor_onboarding_abandonment_scan", entityId: ctx.tenantId, output: { candidates, count: candidates.length } };
  },
};
