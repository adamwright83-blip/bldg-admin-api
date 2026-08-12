import { createHash } from "node:crypto";
import {
  salesIntelContentIdentityParts,
  salesIntelFrameworkIdentityParts,
  type ObjectionArchetype,
  type SalesIntelChannel,
  type SalesIntelSourceType,
} from "../../shared/salesIntel";
import { salesIntelTeachingIdentityParts } from "../../shared/salesIntelTeaching";

function digest(parts: string[]): string {
  // Unit separator keeps distinct field boundaries from colliding.
  return createHash("sha256").update(parts.join("")).digest("hex");
}

/** Stable content identity used to detect duplicate ingests of one source. */
export function salesIntelContentHash(input: {
  sourceType: SalesIntelSourceType;
  canonicalUrl?: string | null;
  externalContentId?: string | null;
  transcriptText?: string | null;
}): string {
  return digest(salesIntelContentIdentityParts(input));
}

/** Identity of one teaching within a source, across re-extractions. */
export function salesIntelFrameworkKey(input: {
  sourceArtifactId: string;
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
  frameworkName: string;
  exactObjection: string;
}): string {
  return digest(salesIntelFrameworkIdentityParts(input));
}

/**
 * Identity of one GENERAL teaching within a source transcript, across
 * re-extractions of the same segment. Distinct from `salesIntelFrameworkKey`:
 * a general teaching is anchored to its transcript (the specific segment it
 * came from) and its category + title, not an objection.
 */
export function salesIntelTeachingKey(
  input: Parameters<typeof salesIntelTeachingIdentityParts>[0]
): string {
  return digest(salesIntelTeachingIdentityParts(input));
}

/**
 * A varchar(1024) unique index on the raw URL exceeds InnoDB's 3072-byte
 * max key length under utf8mb4 — dedup for the source registry (Slice 37)
 * is enforced on this fixed-width hash instead.
 */
export function salesIntelSourceRegistryUrlHash(canonicalSourceUrl: string): string {
  return digest([canonicalSourceUrl]);
}
