/**
 * Slice 3 — companion roster and per-operator earned state types.
 * See docs/goldline/REALITY_BRIDGE.md for the protected source of truth
 * this roster data must match exactly.
 */

export type GoldlineCompanion = {
  id: string;
  tenantId: string;
  companionId: string;
  name: string;
  fictionTruth: string;
  afterAvailableText: string;
  may: string[];
  mayNot: string[];
  fantasyExpression: string[];
  abilityId: string;
  abilityDescription: string;
  unifiedProductPersona: boolean;
  productPersonaNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GoldlineCompanionInput = Omit<
  GoldlineCompanion,
  "id" | "tenantId" | "companionId" | "createdAt" | "updatedAt"
>;

export type CompanionUnlock = {
  id: string;
  tenantId: string;
  operatorId: string;
  companionId: string;
  earnedAt: string;
  earnedViaKingdomId: string;
  earnedViaCampaignId: string;
  evidenceOpsTaskId: number;
};
