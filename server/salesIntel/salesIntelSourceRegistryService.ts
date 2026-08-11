import { canonicalizeInstagramUrl, canonicalizeYouTubeUrl } from "../../shared/salesIntel";
import {
  canonicalizeYouTubeChannelUrl,
  VALID_ACQUISITION_MODES_BY_TYPE,
  type SalesIntelSourceRegistryCreateInput,
  type SalesIntelSourceRegistryEntry,
} from "../../shared/salesIntelSourceRegistry";
import {
  createSalesIntelSource,
  findSalesIntelSourceByCanonicalUrl,
} from "./salesIntelSourceRegistryStore";

/**
 * Resolves a raw admin-supplied URL to a canonical identity for the given
 * source type — never inventing an id we can't actually read from the URL.
 */
function canonicalizeForType(input: {
  sourceType: SalesIntelSourceRegistryCreateInput["sourceType"];
  sourceUrl: string;
}): { canonicalUrl: string; externalChannelId: string | null } | null {
  if (input.sourceType === "youtube_channel" || input.sourceType === "youtube_playlist") {
    const resolved = canonicalizeYouTubeChannelUrl(input.sourceUrl);
    if (!resolved) return null;
    return { canonicalUrl: resolved.canonicalUrl, externalChannelId: resolved.externalChannelId };
  }
  if (input.sourceType === "youtube_video") {
    const resolved = canonicalizeYouTubeUrl(input.sourceUrl);
    if (!resolved) return null;
    return { canonicalUrl: resolved.canonicalUrl, externalChannelId: resolved.externalContentId };
  }
  if (input.sourceType === "instagram_profile_reference") {
    const resolved = canonicalizeInstagramUrl(input.sourceUrl);
    if (!resolved) return null;
    return { canonicalUrl: resolved.canonicalUrl, externalChannelId: null };
  }
  // manual_source: no platform to canonicalize against — trim and reuse as-is.
  const trimmed = input.sourceUrl.trim();
  return trimmed ? { canonicalUrl: trimmed, externalChannelId: null } : null;
}

export class SalesIntelSourceRegistryError extends Error {}

export async function ingestSalesIntelSourceRegistration(
  input: SalesIntelSourceRegistryCreateInput & { createdBy: string }
): Promise<SalesIntelSourceRegistryEntry> {
  const allowedModes = VALID_ACQUISITION_MODES_BY_TYPE[input.sourceType];
  if (!allowedModes.includes(input.acquisitionMode)) {
    throw new SalesIntelSourceRegistryError(
      `${input.sourceType} sources cannot use acquisition mode ${input.acquisitionMode}. Allowed: ${allowedModes.join(", ")}`
    );
  }

  const canonical = canonicalizeForType(input);
  if (!canonical) {
    throw new SalesIntelSourceRegistryError(
      "Could not resolve a canonical identity for this URL — check the URL matches the selected source type."
    );
  }

  const existing = await findSalesIntelSourceByCanonicalUrl(canonical.canonicalUrl);
  if (existing) {
    throw new SalesIntelSourceRegistryError(
      `This source is already registered (${existing.creatorName}, added ${existing.createdAt}). Disable/re-enable it instead of adding a duplicate.`
    );
  }

  return createSalesIntelSource({
    creatorName: input.creatorName,
    creatorHandle: input.creatorHandle ?? null,
    platform: input.platform,
    sourceType: input.sourceType,
    canonicalSourceUrl: canonical.canonicalUrl,
    externalChannelId: input.externalChannelId?.trim() || canonical.externalChannelId,
    acquisitionMode: input.acquisitionMode,
    notes: input.notes ?? null,
    createdBy: input.createdBy,
  });
}
