import { z } from "zod";
import {
  SALES_INTEL_ACQUISITION_MODES,
  SALES_INTEL_SOURCE_PLATFORMS,
  SALES_INTEL_SOURCE_REGISTRY_TYPES,
} from "./salesIntelSourceRegistry";

/**
 * A bulk-import manifest entry (Slice 46). Every field the acquisition
 * pipeline needs to trust the source is real: who verified it, how, and
 * when — a manifest entry without these is invalid, not silently accepted.
 */
export const salesIntelSourceManifestEntrySchema = z.object({
  creatorName: z.string().trim().min(1).max(191),
  platform: z.enum(SALES_INTEL_SOURCE_PLATFORMS),
  canonicalSourceUrl: z.string().trim().min(1).max(1024),
  sourceType: z.enum(SALES_INTEL_SOURCE_REGISTRY_TYPES),
  acquisitionMode: z.enum(SALES_INTEL_ACQUISITION_MODES),
  externalChannelId: z.string().trim().max(191).nullable().optional(),
  creatorHandle: z.string().trim().max(191).nullable().optional(),
  /** Who/what verified this is a real, correctly-identified creator/channel. */
  verifiedAt: z.string().trim().datetime(),
  verificationMethod: z.string().trim().min(1).max(255),
  notes: z.string().trim().max(2048).nullable().optional(),
});
export type SalesIntelSourceManifestEntry = z.infer<
  typeof salesIntelSourceManifestEntrySchema
>;

export const salesIntelSourceManifestSchema = z
  .array(salesIntelSourceManifestEntrySchema)
  .min(1)
  .max(50);

export const SALES_INTEL_SOURCE_IMPORT_CLASSIFICATIONS = [
  "new",
  "already_exists",
  "canonical_duplicate",
  "invalid",
  "unsupported",
] as const;
export type SalesIntelSourceImportClassification =
  (typeof SALES_INTEL_SOURCE_IMPORT_CLASSIFICATIONS)[number];

export type SalesIntelSourceImportPreviewEntry = {
  index: number;
  entry: SalesIntelSourceManifestEntry | null;
  raw: unknown;
  classification: SalesIntelSourceImportClassification;
  reason: string;
  canonicalUrl: string | null;
};
