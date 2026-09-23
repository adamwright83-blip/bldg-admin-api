/**
 * domain.goldline progression read contract for Project J.
 *
 * Durable flags are rows in goldline_domain_progression. A missing row
 * or a null timestamp is unearned. localStorage is not an input.
 * kingdom.brass_republic is a separate column and is not written here.
 */
import { COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE } from "../../shared/colosseumAuthoredFinale";
import { overworldPostRookOpen } from "../../shared/goldlineDomainProgression";
import {
  COLOSSEUM_KINGDOM_BINDING_FUNCTION,
  COLOSSEUM_KINGDOM_BINDING_ID,
  colosseumKingdomBindingSatisfied,
  colosseumLeadHuntDefinition,
} from "./colosseumKingdomBinding";

export type StoredProgressionRow = {
  levelColosseumResolvedAt: Date | null;
  companionRookOwnedAt: Date | null;
  kingdomBrassRepublicCompletedAt: Date | null;
};

export type StoredProgressionLookup =
  | { readable: true; row: StoredProgressionRow | null }
  | { readable: false };

export const GOLDLINE_DOMAIN_PROGRESSION_MIGRATION = {
  authority: "scripts/migrate.mjs",
  label: "CREATE TABLE goldline_domain_progression",
  table: "goldline_domain_progression",
  uniqueKey: "uq_goldline_domain_progression",
  uniqueColumns: ["tenantId", "operatorId"] as const,
  requiredColumns: [
    "tenantId",
    "operatorId",
    "levelColosseumResolvedAt",
    "companionRookOwnedAt",
    "kingdomBrassRepublicCompletedAt",
    "overworldUnlocksJson",
  ] as const,
  proposedDrizzleFile: "drizzle/0097_goldline_domain_progression.sql",
} as const;

const CLIENT_FORGE_KEYS = [
  "resolved",
  "rookOwned",
  "kingdomComplete",
  "levelColosseumResolved",
  "companionRookOwned",
  "kingdomBrassRepublicCompleted",
  "localStorage",
] as const;

export type KingdomBindingStatus = "satisfied" | "unsatisfied" | "uncertain";

export type ProgressionFlagStatus = "earned" | "unearned" | "uncertain";

export type ProgressionFlag = {
  status: ProgressionFlagStatus;
  /** True only when status is earned. Unknown and missing rows stay false. */
  value: boolean;
};

export type GoldlineProgressionRead = {
  tenantId: string;
  operatorId: string;
  kingdomBinding: {
    id: typeof COLOSSEUM_KINGDOM_BINDING_ID;
    function: typeof COLOSSEUM_KINGDOM_BINDING_FUNCTION;
    leadHuntId: "greystar-koreatown-five";
    status: KingdomBindingStatus;
    evidence: "open_channel.day1_ten_doors.outcomes";
    recordedTargetIds: string[];
    missingTargetIds: string[];
  };
  /** Server timestamp levelColosseumResolvedAt. Missing or null is unearned. */
  levelColosseumResolved: ProgressionFlag;
  /** Server timestamp companionRookOwnedAt. Separate from the level and from capability.rook.contact. */
  companionRookOwned: ProgressionFlag;
  /** Separate authored state. Never implied by the Colosseum binding or by level.colosseum. */
  kingdomBrassRepublicCompleted: ProgressionFlag & {
    impliedByLevelColosseum: false;
    impliedByStoredKingdomRow: false;
  };
  overworldUnlocks: {
    status: ProgressionFlagStatus;
    /** postRook is true only when both server values are true. */
    flags: { postRook: boolean };
  };
  capabilityRookContact: {
    granted: boolean;
    readable: boolean;
    grantsCompanionOwnership: false;
    implementationCapabilityId: "rook.outreach_drafting";
  };
  localStorage: "cache_and_present_only";
  schema: {
    blocked: false;
    migration: typeof GOLDLINE_DOMAIN_PROGRESSION_MIGRATION;
  };
};

export class ProgressionForgeError extends Error {
  readonly code = "client_forge_rejected" as const;
  readonly key: string;
  constructor(key: string) {
    super(`Client cannot set durable progression (${key})`);
    this.name = "ProgressionForgeError";
    this.key = key;
  }
}

export class ProgressionNotPermittedError extends Error {
  readonly code = "not_permitted" as const;
  constructor(message: string) {
    super(message);
    this.name = "ProgressionNotPermittedError";
  }
}

export class ProgressionSchemaBlockedError extends Error {
  readonly code = "schema_blocked" as const;
  readonly migrationLabel = GOLDLINE_DOMAIN_PROGRESSION_MIGRATION.label;
  constructor(message: string) {
    super(message);
    this.name = "ProgressionSchemaBlockedError";
  }
}

export function rejectClientProgressionForge(input: unknown): void {
  if (!input || typeof input !== "object") return;
  for (const key of CLIENT_FORGE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      throw new ProgressionForgeError(key);
    }
  }
}

function flagFromTimestamp(readable: boolean, at: Date | null | undefined): ProgressionFlag {
  if (!readable) return { status: "uncertain", value: false };
  if (at) return { status: "earned", value: true };
  return { status: "unearned", value: false };
}

export function projectGoldlineProgression(input: {
  tenantId: string;
  operatorId: string;
  /** null when the outcome read failed. An empty object is a known miss. */
  outcomes: Record<string, unknown> | null;
  outcomesAvailable: boolean;
  capabilityRookContactGranted: boolean;
  capabilityRookContactReadable: boolean;
  /** Omitted lookups are treated as no row: unearned, not completed. */
  stored?: StoredProgressionLookup;
}): GoldlineProgressionRead {
  rejectClientProgressionForge(input);
  const stored = input.stored ?? { readable: true, row: null };
  const levelColosseumResolved = flagFromTimestamp(
    stored.readable,
    stored.readable ? stored.row?.levelColosseumResolvedAt : null
  );
  const companionRookOwned = flagFromTimestamp(
    stored.readable,
    stored.readable ? stored.row?.companionRookOwnedAt : null
  );
  const kingdomBrassRepublicCompleted = flagFromTimestamp(
    stored.readable,
    stored.readable ? stored.row?.kingdomBrassRepublicCompletedAt : null
  );
  const postRook = overworldPostRookOpen({ levelColosseumResolved, companionRookOwned });
  const definition = colosseumLeadHuntDefinition();
  const targetIds = definition?.targetIds ?? [];
  const outcomeKeys = input.outcomesAvailable && input.outcomes ? Object.keys(input.outcomes) : [];
  const recordedTargetIds = targetIds.filter(id => outcomeKeys.includes(id));
  const missingTargetIds = targetIds.filter(id => !recordedTargetIds.includes(id));
  const status: KingdomBindingStatus = !input.outcomesAvailable
    ? "uncertain"
    : input.outcomes && colosseumKingdomBindingSatisfied(input.outcomes)
      ? "satisfied"
      : "unsatisfied";

  return {
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    kingdomBinding: {
      id: COLOSSEUM_KINGDOM_BINDING_ID,
      function: COLOSSEUM_KINGDOM_BINDING_FUNCTION,
      leadHuntId: "greystar-koreatown-five",
      status,
      evidence: "open_channel.day1_ten_doors.outcomes",
      recordedTargetIds,
      missingTargetIds,
    },
    levelColosseumResolved,
    companionRookOwned,
    kingdomBrassRepublicCompleted: {
      ...kingdomBrassRepublicCompleted,
      impliedByLevelColosseum: false,
      impliedByStoredKingdomRow: false,
    },
    overworldUnlocks: {
      status: stored.readable ? (postRook ? "earned" : "unearned") : "uncertain",
      flags: { postRook },
    },
    capabilityRookContact: {
      granted: input.capabilityRookContactReadable && input.capabilityRookContactGranted,
      readable: input.capabilityRookContactReadable,
      grantsCompanionOwnership: false,
      implementationCapabilityId: "rook.outreach_drafting",
    },
    localStorage: "cache_and_present_only",
    schema: {
      blocked: false,
      migration: GOLDLINE_DOMAIN_PROGRESSION_MIGRATION,
    },
  };
}

function assertBindingAllowsAuthoredResolution(outcomes: Record<string, unknown> | null, outcomesAvailable: boolean) {
  if (!outcomesAvailable || !outcomes) {
    throw new ProgressionNotPermittedError(
      "kingdom_binding.level.colosseum is uncertain; authored Colosseum resolution is not permitted"
    );
  }
  if (!colosseumKingdomBindingSatisfied(outcomes)) {
    throw new ProgressionNotPermittedError(
      "kingdom_binding.level.colosseum is not satisfied; authored Colosseum resolution is not permitted"
    );
  }
}

/** The only Colosseum write gate. A client resolved flag is rejected first. */
export function assertLevelColosseumRecordPermitted(input: {
  outcomes: Record<string, unknown> | null;
  outcomesAvailable: boolean;
  clientPayload?: unknown;
}): void {
  rejectClientProgressionForge(input);
  rejectClientProgressionForge(input.clientPayload);
  assertBindingAllowsAuthoredResolution(input.outcomes, input.outcomesAvailable);
}

/**
 * Rook is a separate write. Five visits and a resolved level do not own him.
 * The Clockhead finale's authored consequence is required, the level timestamp
 * must already be stored for this tenant and operator, and the binding remains
 * required. A client rookOwned flag is rejected and is not evidence.
 */
export function assertCompanionRookRecordPermitted(input: {
  outcomes: Record<string, unknown> | null;
  outcomesAvailable: boolean;
  levelColosseumResolvedAt: Date | null;
  authoredConsequence?: unknown;
  clientPayload?: unknown;
}): void {
  rejectClientProgressionForge(input);
  rejectClientProgressionForge(input.clientPayload);
  if (input.authoredConsequence !== COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE) {
    throw new ProgressionNotPermittedError(
      "companion.rook requires the authored Clockhead finale; recorded visits and level.colosseum do not own Rook"
    );
  }
  assertBindingAllowsAuthoredResolution(input.outcomes, input.outcomesAvailable);
  if (!input.levelColosseumResolvedAt) {
    throw new ProgressionNotPermittedError(
      "companion.rook cannot be recorded until level.colosseum is server-recorded for this operator"
    );
  }
}

/**
 * Kingdom completion is a separate authored state. The Colosseum binding
 * does not permit it, including after the progression table exists.
 */
export function attemptRecordKingdomBrassRepublicCompleted(input: {
  outcomes: Record<string, unknown> | null;
  outcomesAvailable: boolean;
  clientPayload?: unknown;
}): never {
  rejectClientProgressionForge(input);
  rejectClientProgressionForge(input.clientPayload);
  throw new ProgressionNotPermittedError(
    "kingdom.brass_republic completion is a separate authored state and is not permitted by kingdom_binding.level.colosseum"
  );
}
