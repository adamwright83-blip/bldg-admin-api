/**
 * domain.goldline progression read contract for Project J.
 *
 * Durable flags are server-owned. This module does not create tables.
 * `scripts/migrate.mjs` is the production schema authority (Project 0).
 * Until `goldline_domain_progression` exists, level resolution, Rook
 * ownership, Brass Republic completion, and Overworld unlocks stay
 * unrecorded. localStorage is not an input.
 */
import {
  COLOSSEUM_KINGDOM_BINDING_FUNCTION,
  COLOSSEUM_KINGDOM_BINDING_ID,
  colosseumKingdomBindingSatisfied,
  colosseumLeadHuntDefinition,
} from "./colosseumKingdomBinding";

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

export type UnrecordedFlag = {
  status: "unrecorded";
  value: false;
  reason: "schema_blocked";
  migrationLabel: typeof GOLDLINE_DOMAIN_PROGRESSION_MIGRATION.label;
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
  /** Permitted only after the binding is satisfied. Not stored until the migration lands. */
  levelColosseumResolved: UnrecordedFlag;
  /** Separate from the level flag and from `capability.rook.contact`. */
  companionRookOwned: UnrecordedFlag;
  /** Separate authored state. Never implied by the Colosseum binding or by `kingdom-1-colosseum`. */
  kingdomBrassRepublicCompleted: UnrecordedFlag & {
    impliedByLevelColosseum: false;
    impliedByStoredKingdomRow: false;
  };
  overworldUnlocks: {
    status: "unrecorded";
    flags: Record<string, never>;
    reason: "schema_blocked";
    migrationLabel: typeof GOLDLINE_DOMAIN_PROGRESSION_MIGRATION.label;
  };
  capabilityRookContact: {
    granted: boolean;
    readable: boolean;
    grantsCompanionOwnership: false;
    implementationCapabilityId: "rook.outreach_drafting";
  };
  localStorage: "cache_and_present_only";
  schema: {
    blocked: true;
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

function unrecordedFlag(): UnrecordedFlag {
  return {
    status: "unrecorded",
    value: false,
    reason: "schema_blocked",
    migrationLabel: GOLDLINE_DOMAIN_PROGRESSION_MIGRATION.label,
  };
}

export function projectGoldlineProgression(input: {
  tenantId: string;
  operatorId: string;
  /** null when the outcome read failed. An empty object is a known miss. */
  outcomes: Record<string, unknown> | null;
  outcomesAvailable: boolean;
  capabilityRookContactGranted: boolean;
  capabilityRookContactReadable: boolean;
}): GoldlineProgressionRead {
  rejectClientProgressionForge(input);
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
    levelColosseumResolved: unrecordedFlag(),
    companionRookOwned: unrecordedFlag(),
    kingdomBrassRepublicCompleted: {
      ...unrecordedFlag(),
      impliedByLevelColosseum: false,
      impliedByStoredKingdomRow: false,
    },
    overworldUnlocks: {
      status: "unrecorded",
      flags: {},
      reason: "schema_blocked",
      migrationLabel: GOLDLINE_DOMAIN_PROGRESSION_MIGRATION.label,
    },
    capabilityRookContact: {
      granted: input.capabilityRookContactReadable && input.capabilityRookContactGranted,
      readable: input.capabilityRookContactReadable,
      grantsCompanionOwnership: false,
      implementationCapabilityId: "rook.outreach_drafting",
    },
    localStorage: "cache_and_present_only",
    schema: {
      blocked: true,
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

/**
 * Binding satisfied → authored resolution would be permitted → no row exists
 * to record `level.colosseum` resolved. Never accepts a client resolved flag.
 */
export function attemptRecordLevelColosseumResolved(input: {
  outcomes: Record<string, unknown> | null;
  outcomesAvailable: boolean;
  clientPayload?: unknown;
}): never {
  rejectClientProgressionForge(input);
  rejectClientProgressionForge(input.clientPayload);
  assertBindingAllowsAuthoredResolution(input.outcomes, input.outcomesAvailable);
  throw new ProgressionSchemaBlockedError(
    `${GOLDLINE_DOMAIN_PROGRESSION_MIGRATION.label} is required before level.colosseum can be recorded`
  );
}

/**
 * Rook ownership follows a server-recorded level resolution. The level row
 * cannot exist yet, so ownership is not recorded and is not inferred from
 * the binding or from capability unlocks.
 */
export function attemptRecordCompanionRookOwned(input: {
  outcomes: Record<string, unknown> | null;
  outcomesAvailable: boolean;
  clientPayload?: unknown;
}): never {
  rejectClientProgressionForge(input);
  rejectClientProgressionForge(input.clientPayload);
  assertBindingAllowsAuthoredResolution(input.outcomes, input.outcomesAvailable);
  throw new ProgressionSchemaBlockedError(
    `${GOLDLINE_DOMAIN_PROGRESSION_MIGRATION.label} is required before companion.rook can be recorded; level.colosseum is unrecorded`
  );
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
