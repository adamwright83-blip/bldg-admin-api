import type {
  CommunicationsAnalyticsWindowDays,
  CommunicationsEvidenceSummary,
} from "@shared/communicationsAnalytics";
import { isCommunicationsAnalyticsWindowDays } from "@shared/communicationsAnalytics";
import { getCommunicationsObservationWindow } from "./observationWindow";
import { projectCommunicationsEffectiveness } from "./projectSummary";
import { loadCommunicationsProjectionFacts } from "./queries";

export async function getCommunicationsEffectiveness(input: {
  tenantId: string;
  windowDays?: number;
  now?: Date;
  timeZone?: string;
}): Promise<CommunicationsEvidenceSummary> {
  const windowDays: CommunicationsAnalyticsWindowDays =
    input.windowDays != null && isCommunicationsAnalyticsWindowDays(input.windowDays)
      ? input.windowDays
      : 30;
  const observationWindow = getCommunicationsObservationWindow({
    windowDays,
    now: input.now,
    timeZone: input.timeZone,
  });
  const facts = await loadCommunicationsProjectionFacts({
    tenantId: input.tenantId,
    observationWindow,
  });
  return projectCommunicationsEffectiveness({ facts, observationWindow });
}
