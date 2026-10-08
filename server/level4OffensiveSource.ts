import {
  getLevel4OffensiveState,
  type Level4OffensiveState,
} from "./level4Offensive";
import type { GenerateOffensiveCopyInput } from "./level4OffensiveCopy";
import type { ExecuteOffensiveInput } from "./level4OffensiveExecute";

export function offensiveCopyFromState(
  input: GenerateOffensiveCopyInput,
  state: Level4OffensiveState
): GenerateOffensiveCopyInput {
  if (input.block === "market_hole") return input;
  if (input.block === "building_penetration") {
    const source = state.buildingPenetration.find(
      item => item.buildingSlug === input.payload.buildingSlug
    );
    if (!source) throw new Error("Canonical building source is unavailable");
    return { ...input, payload: source };
  }
  const source = state.referralRequest;
  if (
    !("userId" in source) ||
    source.firstName !== input.payload.firstName ||
    source.lastInitial !== input.payload.lastInitial
  )
    throw new Error(
      "Canonical referral source changed; refresh before generating copy"
    );
  return { ...input, payload: source };
}
export function offensiveActionFromState(
  input: ExecuteOffensiveInput,
  state: Level4OffensiveState
): ExecuteOffensiveInput {
  if (input.block === "market_hole_outreach") return input;
  if (input.block === "building_penetration") {
    const source = state.buildingPenetration.find(
      item => item.buildingSlug === input.buildingSlug
    );
    if (!source) throw new Error("Canonical building source is unavailable");
    return { ...input, buildingName: source.buildingName, metadata: source };
  }
  const source = state.referralRequest;
  if (!("userId" in source) || source.userId !== input.userId)
    throw new Error(
      "Canonical referral source changed; refresh before executing"
    );
  return {
    ...input,
    firstName: source.firstName,
    lastInitial: source.lastInitial,
    orderCount: source.orderCount,
    ltvCents: source.ltvCents,
  };
}
export async function admitOffensiveCopySource(
  tenantId: string,
  input: GenerateOffensiveCopyInput
) {
  if (input.block === "market_hole") return input;
  return offensiveCopyFromState(input, await getLevel4OffensiveState(tenantId));
}
export async function admitOffensiveActionSource(
  tenantId: string,
  input: ExecuteOffensiveInput
) {
  if (input.block === "market_hole_outreach") return input;
  return offensiveActionFromState(
    input,
    await getLevel4OffensiveState(tenantId)
  );
}
