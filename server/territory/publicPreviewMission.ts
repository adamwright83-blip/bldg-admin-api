import type { RankedTerritoryOpportunity } from "./territoryDiscovery";

export type PublicPreviewSampleMission = {
  id: string;
  code: "MISSION PREVIEW";
  status: "sample";
  account: RankedTerritoryOpportunity["account"];
  opportunity: RankedTerritoryOpportunity["score"] & {
    primarySignal: string;
    reasons: string[];
    risks: string[];
  };
  brief: {
    laundryOpportunity: string;
    salesAngle: string;
    openingLine: string;
    discoveryQuestions: string[];
    objections: string[];
  };
  steps: Array<{
    key: "scout" | "prepare" | "battle" | "field";
    label: string;
    detail: string;
    status: "completed" | "ready" | "locked";
    position: number;
  }>;
};

export function buildPublicPreviewSampleMission(input: {
  sessionId: string;
  opportunity: RankedTerritoryOpportunity;
}): PublicPreviewSampleMission {
  const accountName = input.opportunity.account.name;
  return {
    id: `preview:${input.sessionId}:${input.opportunity.candidateKey}`,
    code: "MISSION PREVIEW",
    status: "sample",
    account: input.opportunity.account,
    opportunity: {
      ...input.opportunity.score,
      primarySignal: input.opportunity.primarySignal,
      reasons: input.opportunity.score.reasons,
      risks: input.opportunity.score.risks,
    },
    brief: {
      laundryOpportunity: `Recurring commercial laundry service for ${accountName}.`,
      salesAngle: `A local pickup-and-delivery laundry program sized to this account's estimated demand.`,
      openingLine: `Who is the right person to discuss laundry service for ${accountName}?`,
      discoveryQuestions: [
        "How is recurring laundry handled today?",
        "Which items and locations create the most laundry work?",
        "What pickup schedule would fit the operation?",
      ],
      objections: [
        "Current provider",
        "Pricing",
        "Pickup schedule",
        "Turnaround time",
      ],
    },
    steps: [
      {
        key: "scout",
        label: "Scout",
        detail: "Review sourced account evidence and fit.",
        status: "completed",
        position: 0,
      },
      {
        key: "prepare",
        label: "Prepare",
        detail: "Build the pitch and collateral.",
        status: "ready",
        position: 1,
      },
      {
        key: "battle",
        label: "Battle",
        detail: "Complete the BORESLAY mission.",
        status: "locked",
        position: 2,
      },
      {
        key: "field",
        label: "Field",
        detail: "Complete the real-world visit.",
        status: "locked",
        position: 3,
      },
    ],
  };
}
