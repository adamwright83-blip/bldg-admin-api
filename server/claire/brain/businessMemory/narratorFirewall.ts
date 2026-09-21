/**
 * Authored narrative material is not business evidence.
 * A presented title such as HELD stays on the Narrator presentation
 * plan. It does not enter Claire Brain business memory.
 */

export function isNarratorBusinessContamination(item: {
  source?: string;
  provenance?: {
    reader?: string;
    identityKey?: string | null;
    providerName?: string | null;
  };
  payload?: unknown;
}): boolean {
  const reader = item.provenance?.reader ?? "";
  const source = item.source ?? "";
  const provider = item.provenance?.providerName ?? "";
  const identity = item.provenance?.identityKey ?? "";
  if (
    reader === "narrator_presentation" ||
    source === "narrator_presentation" ||
    provider === "narrator_presentation"
  ) {
    return true;
  }
  if (identity.startsWith("narrator:")) return true;
  if (!item.payload || typeof item.payload !== "object") return false;
  const payload = item.payload as Record<string, unknown>;
  return payload.authoredNarrative === true || typeof payload.narrativeTitle === "string";
}
