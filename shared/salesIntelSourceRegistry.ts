import { z } from "zod";

/**
 * The curated, admin-managed watch list of creators/channels (Slice 37) —
 * distinct from a `SalesIntelSourceArtifact` (shared/salesIntel.ts), which
 * is one row per individual piece of ingested content. A registry entry
 * describes WHERE to look for future content; an artifact is one thing
 * that was actually found/ingested.
 */
export const SALES_INTEL_SOURCE_PLATFORMS = [
  "youtube",
  "instagram",
  "manual",
] as const;
export type SalesIntelSourcePlatform =
  (typeof SALES_INTEL_SOURCE_PLATFORMS)[number];

export const SALES_INTEL_SOURCE_REGISTRY_TYPES = [
  "youtube_channel",
  "youtube_playlist",
  "youtube_video",
  "instagram_profile_reference",
  "manual_source",
] as const;
export type SalesIntelSourceRegistryType =
  (typeof SALES_INTEL_SOURCE_REGISTRY_TYPES)[number];

/** How content actually gets acquired for this source — never a claim of what we can't do. */
export const SALES_INTEL_ACQUISITION_MODES = [
  "AUTO_YOUTUBE",
  "MANUAL_TRANSCRIPT",
  "MANUAL_MEDIA",
  "URL_REFERENCE_ONLY",
  "PROVIDER_ANALYSIS",
] as const;
export type SalesIntelAcquisitionMode =
  (typeof SALES_INTEL_ACQUISITION_MODES)[number];

export const SALES_INTEL_SOURCE_REGISTRY_STATUSES = ["active", "disabled"] as const;
export type SalesIntelSourceRegistryStatus =
  (typeof SALES_INTEL_SOURCE_REGISTRY_STATUSES)[number];

export type SalesIntelSourceRegistryEntry = {
  id: string;
  creatorName: string;
  creatorHandle: string | null;
  platform: SalesIntelSourcePlatform;
  sourceType: SalesIntelSourceRegistryType;
  canonicalSourceUrl: string;
  externalChannelId: string | null;
  acquisitionMode: SalesIntelAcquisitionMode;
  status: SalesIntelSourceRegistryStatus;
  notes: string | null;
  lastCheckedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Server-enforced pairing: a source can only claim the acquisition mode its
 * type actually supports. Prevents an admin from marking an Instagram
 * reference as AUTO_YOUTUBE, for example.
 */
export const VALID_ACQUISITION_MODES_BY_TYPE: Record<
  SalesIntelSourceRegistryType,
  readonly SalesIntelAcquisitionMode[]
> = {
  youtube_channel: ["AUTO_YOUTUBE", "PROVIDER_ANALYSIS"],
  youtube_playlist: ["AUTO_YOUTUBE", "PROVIDER_ANALYSIS"],
  youtube_video: ["PROVIDER_ANALYSIS", "MANUAL_TRANSCRIPT"],
  instagram_profile_reference: ["URL_REFERENCE_ONLY", "MANUAL_TRANSCRIPT", "MANUAL_MEDIA"],
  manual_source: ["MANUAL_TRANSCRIPT", "MANUAL_MEDIA"],
};

const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

export type CanonicalYouTubeChannel = {
  canonicalUrl: string;
  /** Only ever populated when the URL itself contains the stable channel id — never guessed. */
  externalChannelId: string | null;
};

/**
 * Resolves /channel/UC.../, /@handle, /c/name, and /user/name forms to one
 * canonical URL so formatting differences (www, trailing slash, mobile
 * host) never create duplicate registry entries. Only the /channel/UC...
 * form actually carries the stable channel id in the URL itself — handle
 * and custom-name forms canonicalize for dedup/display but leave
 * externalChannelId null rather than guess at a resolution that would
 * require an API call.
 */
export function canonicalizeYouTubeChannelUrl(
  raw: string
): CanonicalYouTubeChannel | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www[.]/, "").replace(/^m[.]/, "");
  const isYouTube =
    host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com";
  if (!isYouTube) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (!segments.length) return null;

  if (segments[0] === "channel" && segments[1]) {
    const id = segments[1];
    if (!YOUTUBE_CHANNEL_ID.test(id)) return null;
    return { canonicalUrl: `https://www.youtube.com/channel/${id}`, externalChannelId: id };
  }
  if (segments[0].startsWith("@")) {
    return {
      canonicalUrl: `https://www.youtube.com/${segments[0].toLowerCase()}`,
      externalChannelId: null,
    };
  }
  if ((segments[0] === "c" || segments[0] === "user") && segments[1]) {
    return {
      canonicalUrl: `https://www.youtube.com/${segments[0]}/${segments[1]}`,
      externalChannelId: null,
    };
  }
  return null;
}

export const salesIntelSourceRegistryCreateSchema = z.object({
  creatorName: z.string().trim().min(1).max(191),
  creatorHandle: z.string().trim().max(191).nullable().optional(),
  platform: z.enum(SALES_INTEL_SOURCE_PLATFORMS),
  sourceType: z.enum(SALES_INTEL_SOURCE_REGISTRY_TYPES),
  sourceUrl: z.string().trim().min(1).max(1024),
  externalChannelId: z.string().trim().max(191).nullable().optional(),
  acquisitionMode: z.enum(SALES_INTEL_ACQUISITION_MODES),
  notes: z.string().trim().max(2048).nullable().optional(),
});
export type SalesIntelSourceRegistryCreateInput = z.infer<
  typeof salesIntelSourceRegistryCreateSchema
>;
