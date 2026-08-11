import { createHash } from "node:crypto";
import {
  salesIntelContentIdentityParts,
  salesIntelFrameworkIdentityParts,
  type ObjectionArchetype,
  type SalesIntelChannel,
  type SalesIntelSourceType,
} from "../../shared/salesIntel";

function digest(parts: string[]): string {
  // Unit separator keeps distinct field boundaries from colliding.
  return createHash("sha256").update(parts.join("")).digest("hex");
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
