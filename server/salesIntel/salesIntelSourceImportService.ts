/**
 * Bulk verified-source import (Slice 46). A manifest entry only ever
 * becomes a production registry record if it has a real creator identity,
 * a canonical source URL, a supported platform/type, successful
 * canonicalization, and a verification timestamp/method — never guessed.
 */
import {
  salesIntelSourceManifestEntrySchema,
  type SalesIntelSourceImportPreviewEntry,
  type SalesIntelSourceManifestEntry,
} from "../../shared/salesIntelSourceImport";
import {
  canonicalizeYouTubeChannelUrl,
  VALID_ACQUISITION_MODES_BY_TYPE,
} from "../../shared/salesIntelSourceRegistry";
import { canonicalizeInstagramUrl, canonicalizeYouTubeUrl } from "../../shared/salesIntel";
import { findSalesIntelSourceByCanonicalUrl } from "./salesIntelSourceRegistryStore";
import {
  ingestSalesIntelSourceRegistration,
  SalesIntelSourceRegistryError,
} from "./salesIntelSourceRegistryService";
import type { SalesIntelSourceRegistryEntry } from "../../shared/salesIntelSourceRegistry";

function canonicalizeForType(entry: {
  sourceType: SalesIntelSourceManifestEntry["sourceType"];
  canonicalSourceUrl: string;
}): string | null {
  if (entry.sourceType === "youtube_channel" || entry.sourceType === "youtube_playlist") {
    return canonicalizeYouTubeChannelUrl(entry.canonicalSourceUrl)?.canonicalUrl ?? null;
  }
  if (entry.sourceType === "youtube_video") {
    return canonicalizeYouTubeUrl(entry.canonicalSourceUrl)?.canonicalUrl ?? null;
  }
  if (entry.sourceType === "instagram_profile_reference") {
    return canonicalizeInstagramUrl(entry.canonicalSourceUrl)?.canonicalUrl ?? null;
  }
  const trimmed = entry.canonicalSourceUrl.trim();
  return trimmed || null;
}

/**
 * Classifies every manifest entry WITHOUT mutating the database — new,
 * already registered, a duplicate of another row in this same manifest,
 * structurally invalid, or an unsupported type/acquisition-mode pairing.
 */
export async function previewSalesIntelSourceImport(
  rawEntries: unknown[]
): Promise<SalesIntelSourceImportPreviewEntry[]> {
  const results: SalesIntelSourceImportPreviewEntry[] = [];
  const seenCanonicalUrls = new Set<string>();

  for (let index = 0; index < rawEntries.length; index += 1) {
    const raw = rawEntries[index];
    const parsed = salesIntelSourceManifestEntrySchema.safeParse(raw);
    if (!parsed.success) {
      results.push({
        index,
        entry: null,
        raw,
        classification: "invalid",
        reason: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "),
        canonicalUrl: null,
      });
      continue;
    }
    const entry = parsed.data;
    const allowedModes = VALID_ACQUISITION_MODES_BY_TYPE[entry.sourceType];
    if (!allowedModes.includes(entry.acquisitionMode)) {
      results.push({
        index,
        entry,
        raw,
        classification: "unsupported",
        reason: `${entry.sourceType} cannot use acquisition mode ${entry.acquisitionMode}`,
        canonicalUrl: null,
      });
      continue;
    }

    const canonicalUrl = canonicalizeForType(entry);
    if (!canonicalUrl) {
      results.push({
        index,
        entry,
        raw,
        classification: "invalid",
        reason: "Could not resolve a canonical identity for this URL and source type",
        canonicalUrl: null,
      });
      continue;
    }

    if (seenCanonicalUrls.has(canonicalUrl)) {
      results.push({
        index,
        entry,
        raw,
        classification: "canonical_duplicate",
        reason: "Duplicate of another entry earlier in this manifest",
        canonicalUrl,
      });
      continue;
    }
    seenCanonicalUrls.add(canonicalUrl);

    const existing = await findSalesIntelSourceByCanonicalUrl(canonicalUrl);
    if (existing) {
      results.push({
        index,
        entry,
        raw,
        classification: "already_exists",
        reason: `Already registered as "${existing.creatorName}" (added ${existing.createdAt})`,
        canonicalUrl,
      });
      continue;
    }

    results.push({ index, entry, raw, classification: "new", reason: "Ready to import", canonicalUrl });
  }

  return results;
}

export type SalesIntelSourceImportApplyResult = {
  imported: SalesIntelSourceRegistryEntry[];
  skipped: Array<{ index: number; reason: string }>;
};

/**
 * Idempotent: importing the same verified manifest twice imports each
 * "new" row once and skips everything already registered or invalid —
 * never a duplicate registry record.
 */
export async function applySalesIntelSourceImport(input: {
  rawEntries: unknown[];
  createdBy: string;
}): Promise<SalesIntelSourceImportApplyResult> {
  const preview = await previewSalesIntelSourceImport(input.rawEntries);
  const imported: SalesIntelSourceRegistryEntry[] = [];
  const skipped: Array<{ index: number; reason: string }> = [];

  for (const item of preview) {
    if (item.classification !== "new" || !item.entry) {
      skipped.push({ index: item.index, reason: item.reason });
      continue;
    }
    try {
      const created = await ingestSalesIntelSourceRegistration({
        creatorName: item.entry.creatorName,
        creatorHandle: item.entry.creatorHandle ?? null,
        platform: item.entry.platform,
        sourceType: item.entry.sourceType,
        sourceUrl: item.entry.canonicalSourceUrl,
        externalChannelId: item.entry.externalChannelId ?? null,
        acquisitionMode: item.entry.acquisitionMode,
        notes: item.entry.notes ?? null,
        createdBy: input.createdBy,
      });
      imported.push(created);
    } catch (error) {
      skipped.push({
        index: item.index,
        reason: error instanceof SalesIntelSourceRegistryError ? error.message : "Import failed",
      });
    }
  }

  return { imported, skipped };
}
