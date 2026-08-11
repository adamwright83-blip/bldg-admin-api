/**
 * Verifies that the DayForge release migrations from 0035 onward have been applied by
 * introspecting information_schema for the tables/columns each migration
 * is expected to have created. Exits nonzero if anything required is missing.
 *
 * Usage:
 *   DATABASE_URL=... pnpm dayforge:migrations:verify
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

type RequiredTable = {
  migration: string;
  table: string;
  columns: string[];
};

type RequiredColumnRule = {
  migration: string;
  table: string;
  column: string;
  nullable?: boolean;
  maximumLength?: number;
};

type RequiredIndexRule = {
  migration: string;
  table: string;
  index: string;
  columns: string[];
  unique: boolean;
};

type ForbiddenColumnRule = {
  migration: string;
  table: string;
  column: string;
};

const REQUIRED: RequiredTable[] = [
  {
    migration: "0035_commercial_mission_spine",
    table: "commercial_missions",
    columns: ["id", "tenantId", "status", "code"],
  },
  {
    migration: "0035_commercial_mission_spine",
    table: "commercial_accounts",
    columns: ["id", "tenantId", "identityKey"],
  },
  {
    migration: "0036_territory_intelligence",
    table: "territory_scan_sessions",
    columns: ["id", "tenantId"],
  },
  {
    migration: "0037_commercial_mission_game_results",
    table: "commercial_mission_game_results",
    columns: ["id", "tenantId", "missionId"],
  },
  {
    migration: "0038_commercial_mission_field",
    table: "commercial_mission_field_states",
    columns: ["id", "tenantId", "missionId"],
  },
  {
    migration: "0039_commercial_proposals",
    table: "commercial_proposals",
    columns: ["id", "tenantId"],
  },
  {
    migration: "0040_customer_churn_recovery",
    table: "customer_churn_scans",
    columns: ["id", "tenantId"],
  },
  {
    migration: "0041_commercial_pipeline_conversion",
    table: "commercial_pipeline_records",
    columns: ["id", "tenantId", "missionId", "stage"],
  },
  {
    migration: "0042_dayforge_saas_onboarding_billing",
    table: "dayforge_saas_tenants",
    columns: ["id", "slug", "status"],
  },
  {
    migration: "0043_dayforge_analytics_release",
    table: "dayforge_audit_events",
    columns: ["id", "tenantId", "eventName"],
  },
  {
    migration: "0044_dayforge_release_order_compatibility",
    table: "orders",
    columns: ["residentClientRequestId"],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_account_contacts",
    columns: ["relationshipType", "preferredChannel", "source", "notes"],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_account_locations",
    columns: ["latitude", "longitude"],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_opportunities",
    columns: ["estimatedAnnualValueCents"],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_pipeline_records",
    columns: ["estimatedContractValueCents"],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_mission_irl_step_details",
    columns: [
      "missionStepId",
      "stepType",
      "status",
      "revealPolicy",
      "deadlineAt",
      "proofRequirement",
      "referenceImageUrl",
      "instructionVideoUrl",
      "pinnedCoachingArtifactId",
      "verificationState",
      "proofAssetId",
      "reviewedBy",
      "reviewedAt",
      "rejectionReason",
      "fulfillmentMode",
      "metadataJson",
    ],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_mission_dispatches",
    columns: [
      "missionId",
      "assignedTo",
      "handoffId",
      "dispatchPolicy",
      "channel",
      "status",
      "destinationPath",
      "queuedAt",
      "sentAt",
      "failedAt",
      "openedAt",
      "providerMessageId",
      "failureReason",
      "requestId",
      "createdBy",
    ],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "dayforge_evidence_uploads",
    columns: [
      "missionId",
      "missionStepId",
      "submitterId",
      "storageKey",
      "contentHash",
      "mimeType",
      "sizeBytes",
      "attemptNumber",
      "reviewStatus",
      "reviewerId",
      "reviewedAt",
      "reviewNote",
      "rejectionReason",
      "previousProofId",
      "requestId",
      "purgeAfter",
    ],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "dayforge_evidence_object_deletions",
    columns: [
      "evidenceUploadId",
      "storageKey",
      "storageKeyHash",
      "reason",
      "status",
      "attemptCount",
      "leaseId",
      "lastAttemptAt",
      "nextAttemptAt",
      "deletedAt",
      "lastErrorCode",
      "lastErrorMessage",
      "requestId",
    ],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_mission_coaching_artifacts",
    columns: [
      "missionId",
      "missionStepId",
      "scopeKey",
      "accountId",
      "generationStatus",
      "provider",
      "modelId",
      "promptVersion",
      "contextHash",
      "cacheKey",
      "requestId",
      "version",
      "structuredOutputJson",
      "evidenceReferencesJson",
      "claimsJson",
      "failureCode",
      "fallbackCode",
      "requestedBy",
      "generationLeaseUntil",
      "generationAttemptCount",
      "supersededAt",
      "active",
    ],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_campaign_links",
    columns: [
      "accountId",
      "missionId",
      "pipelineId",
      "campaignName",
      "placement",
      "collateralVersion",
      "salespersonId",
      "referringContactId",
      "tokenHash",
      "status",
      "expiresAt",
      "revokedAt",
      "requestId",
      "createdBy",
    ],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_customer_acquisition_sources",
    columns: [
      "customerIdentityKey",
      "serviceLocationKey",
      "campaignLinkId",
      "accountId",
      "missionId",
      "sourceType",
      "firstTouchAt",
      "status",
      "requestId",
    ],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_order_acquisition_attributions",
    columns: [
      "orderId",
      "firstTouchSourceId",
      "orderCampaignLinkId",
      "accountId",
      "missionId",
      "customerIdentityKey",
      "serviceLocationKey",
      "sourceType",
      "confidence",
      "attributionReason",
      "firstTouchAt",
      "conversionAt",
      "reviewState",
      "requestId",
    ],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_attribution_corrections",
    columns: [
      "acquisitionAttributionId",
      "orderId",
      "previousStateJson",
      "correctedStateJson",
      "reason",
      "correctedBy",
      "requestId",
    ],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "order_payment_projections",
    columns: [
      "orderId",
      "provider",
      "providerPaymentId",
      "currency",
      "state",
      "capturedCents",
      "refundedCents",
      "netPaidCents",
      "paidAt",
      "lastReconciledAt",
      "version",
    ],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "order_payment_events",
    columns: [
      "orderId",
      "provider",
      "providerEventId",
      "eventType",
      "currency",
      "capturedCents",
      "refundedCents",
      "netPaidCents",
      "payloadDigest",
      "occurredAt",
      "requestId",
    ],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_order_attributions",
    columns: [
      "acquisitionAttributionId",
      "status",
      "currency",
      "capturedCents",
      "refundedCents",
      "netPaidCents",
      "financialReviewReason",
      "lastReconciledAt",
    ],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "dayforge_auth_continuations",
    columns: [
      "tokenHash",
      "previewSessionId",
      "previewCandidateKey",
      "phoneHandoffId",
      "returnTo",
      "onboardingSessionId",
      "status",
      "expiresAt",
      "consumedAt",
      "consumedBy",
      "requestId",
    ],
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "dayforge_saas_onboarding_sessions",
    columns: ["authContinuationId"],
  },
  {
    migration: "0051_driver_game_world",
    table: "open_channel_missions",
    columns: [
      "id",
      "tenantId",
      "driverId",
      "businessDate",
      "status",
      "title",
      "operatorBriefing",
      "transcript",
      "generationSource",
      "requestId",
    ],
  },
  {
    migration: "0050_open_channel_missions",
    table: "open_channel_mission_tasks",
    columns: [
      "id",
      "tenantId",
      "missionId",
      "position",
      "title",
      "detail",
      "status",
    ],
  },
  {
    migration: "0051_driver_game_world",
    table: "driver_game_world_nodes",
    columns: [
      "id",
      "tenantId",
      "actorId",
      "missionId",
      "entityType",
      "entityId",
      "locationId",
      "visualState",
      "worldAnchor",
      "unlockedPath",
      "discoveryState",
      "lastResolvedAt",
      "metadataJson",
      "version",
      "createdAt",
      "updatedAt",
    ],
  },
  {
    migration: "0052_goldline_run2_loop",
    table: "driver_cold_call_batches",
    columns: [
      "id",
      "tenantId",
      "actorId",
      "status",
      "combo",
      "completedCount",
      "totalTargets",
      "requestId",
      "sourceReferencesJson",
    ],
  },
  {
    migration: "0052_goldline_run2_loop",
    table: "driver_cold_call_targets",
    columns: [
      "id",
      "batchId",
      "tenantId",
      "actorId",
      "missionId",
      "accountId",
      "position",
      "status",
      "sourceReference",
      "callAttemptEventId",
      "outcome",
    ],
  },
  {
    migration: "0052_goldline_run2_loop",
    table: "driver_capability_unlocks",
    columns: [
      "id",
      "tenantId",
      "scopeId",
      "capabilityId",
      "unlockedByActorId",
      "unlockedAt",
      "sourceReferencesJson",
      "evidenceSummaryJson",
    ],
  },
  {
    migration: "0052_goldline_run2_loop",
    table: "driver_scout_reports",
    columns: [
      "id",
      "tenantId",
      "actorId",
      "requestId",
      "capabilityUnlockId",
      "sourceScanId",
      "criteriaJson",
      "sourceReferencesJson",
      "discoveryCount",
      "generatedAt",
    ],
  },
  {
    migration: "0052_goldline_run2_loop",
    table: "driver_scout_discoveries",
    columns: [
      "id",
      "reportId",
      "tenantId",
      "actorId",
      "candidateKey",
      "providerName",
      "providerAccountId",
      "sourceReference",
      "missionId",
    ],
  },
  {
    migration: "0053_armory_evolution_sales_intel",
    table: "sales_intel_source_artifacts",
    columns: [
      "id",
      "sourceType",
      "canonicalUrl",
      "externalContentId",
      "contentHash",
      "status",
      "failureCode",
      "attemptCount",
      "ingestedBy",
    ],
  },
  {
    migration: "0053_armory_evolution_sales_intel",
    table: "sales_intel_transcripts",
    columns: [
      "id",
      "sourceArtifactId",
      "contentKind",
      "text",
      "provider",
      "model",
      "analysisVersion",
      "version",
    ],
  },
  {
    migration: "0053_armory_evolution_sales_intel",
    table: "sales_intel_frameworks",
    columns: [
      "id",
      "sourceArtifactId",
      "transcriptId",
      "frameworkKey",
      "creatorName",
      "archetype",
      "channel",
      "exactObjection",
      "frameworkName",
      "responseFamily",
      "confidence",
      "extractionVersion",
      "extractionProvider",
      "extractionModel",
      "promptVersion",
      "reviewState",
      "version",
      "active",
      "supersededAt",
    ],
  },
  {
    migration: "0053_armory_evolution_sales_intel",
    table: "armory_weapon_usages",
    columns: [
      "id",
      "tenantId",
      "actorId",
      "missionId",
      "weaponId",
      "frameworkId",
      "archetype",
      "channel",
      "provenanceKind",
      "requestId",
      "usedAt",
    ],
  },
  {
    migration: "0053_armory_evolution_sales_intel",
    table: "armory_weapon_outcomes",
    columns: [
      "id",
      "usageId",
      "tenantId",
      "actorId",
      "missionId",
      "weaponId",
      "outcomeKind",
      "outcomeReference",
      "observedAt",
    ],
  },
  {
    migration: "0054_mission_mutations",
    table: "mission_mutations",
    columns: [
      "id",
      "tenantId",
      "actorId",
      "missionId",
      "sourceState",
      "mutationType",
      "triggerType",
      "triggerReference",
      "worldEffectJson",
      "businessReferencesJson",
      "metadataJson",
    ],
  },
];

const COLUMN_RULES: RequiredColumnRule[] = [
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_account_locations",
    column: "latitude",
    nullable: true,
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_account_locations",
    column: "longitude",
    nullable: true,
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_opportunities",
    column: "estimatedAnnualValueCents",
    nullable: true,
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_pipeline_records",
    column: "estimatedContractValueCents",
    nullable: true,
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "commercial_customer_acquisition_sources",
    column: "campaignLinkId",
    nullable: true,
    maximumLength: 36,
  },
  {
    migration: "0045_dayforge_30_day_foundation",
    table: "dayforge_auth_continuations",
    column: "previewSessionId",
    nullable: true,
    maximumLength: 64,
  },
  {
    migration: "0053_armory_evolution_sales_intel",
    table: "sales_intel_frameworks",
    column: "frameworkKey",
    nullable: false,
    maximumLength: 64,
  },
  {
    migration: "0053_armory_evolution_sales_intel",
    table: "sales_intel_frameworks",
    column: "transcriptId",
    nullable: true,
    maximumLength: 36,
  },
  {
    migration: "0053_armory_evolution_sales_intel",
    table: "sales_intel_source_artifacts",
    column: "contentHash",
    nullable: false,
    maximumLength: 64,
  },
  {
    migration: "0053_armory_evolution_sales_intel",
    table: "armory_weapon_usages",
    column: "tenantId",
    nullable: false,
    maximumLength: 64,
  },
  {
    migration: "0053_armory_evolution_sales_intel",
    table: "armory_weapon_usages",
    column: "frameworkId",
    nullable: true,
    maximumLength: 36,
  },
  {
    migration: "0053_armory_evolution_sales_intel",
    table: "armory_weapon_outcomes",
    column: "tenantId",
    nullable: false,
    maximumLength: 64,
  },
];

const INDEX_RULES: RequiredIndexRule[] = [
  {
    migration: "0051_driver_game_world",
    table: "driver_game_world_nodes",
    index: "uq_driver_game_world_actor_mission",
    columns: ["tenantId", "actorId", "missionId"],
    unique: true,
  },
  {
    migration: "0052_goldline_run2_loop",
    table: "driver_cold_call_batches",
    index: "uq_driver_cold_call_batch_request",
    columns: ["tenantId", "actorId", "requestId"],
    unique: true,
  },
  {
    migration: "0052_goldline_run2_loop",
    table: "driver_cold_call_targets",
    index: "uq_driver_cold_call_batch_mission",
    columns: ["batchId", "missionId"],
    unique: true,
  },
  {
    migration: "0052_goldline_run2_loop",
    table: "driver_capability_unlocks",
    index: "uq_driver_capability_scope",
    columns: ["tenantId", "scopeId", "capabilityId"],
    unique: true,
  },
  {
    migration: "0052_goldline_run2_loop",
    table: "driver_scout_reports",
    index: "uq_driver_scout_report_request",
    columns: ["tenantId", "actorId", "requestId"],
    unique: true,
  },
  {
    migration: "0052_goldline_run2_loop",
    table: "driver_scout_discoveries",
    index: "uq_driver_scout_candidate",
    columns: ["tenantId", "candidateKey"],
    unique: true,
  },
  {
    migration: "0053_armory_evolution_sales_intel",
    table: "sales_intel_source_artifacts",
    index: "uq_sales_intel_source_content",
    columns: ["contentHash"],
    unique: true,
  },
  {
    migration: "0053_armory_evolution_sales_intel",
    table: "sales_intel_transcripts",
    index: "uq_sales_intel_transcript_version",
    columns: ["sourceArtifactId", "version"],
    unique: true,
  },
  {
    migration: "0053_armory_evolution_sales_intel",
    table: "sales_intel_frameworks",
    index: "uq_sales_intel_framework_version",
    columns: ["frameworkKey", "version"],
    unique: true,
  },
  {
    migration: "0053_armory_evolution_sales_intel",
    table: "armory_weapon_usages",
    index: "uq_armory_weapon_usage_request",
    columns: ["tenantId", "requestId"],
    unique: true,
  },
  {
    migration: "0053_armory_evolution_sales_intel",
    table: "armory_weapon_outcomes",
    index: "uq_armory_weapon_outcome",
    columns: ["tenantId", "usageId", "outcomeKind", "outcomeReference"],
    unique: true,
  },
  {
    migration: "0054_mission_mutations",
    table: "mission_mutations",
    index: "uq_mission_mutation_trigger",
    columns: ["tenantId", "actorId", "missionId", "triggerReference"],
    unique: true,
  },
];

const FORBIDDEN_COLUMNS: ForbiddenColumnRule[] = [
  {
    migration: "0051_driver_game_world",
    table: "open_channel_missions",
    column: "laraBriefing",
  },
];

function rowsFrom(result: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(result)) {
    const first = result[0];
    if (Array.isArray(first))
      return first as readonly Record<string, unknown>[];
    if (result.every(item => item && typeof item === "object")) {
      return result as readonly Record<string, unknown>[];
    }
  }
  const rows = (result as { rows?: readonly unknown[] } | null)?.rows;
  return Array.isArray(rows)
    ? (rows as readonly Record<string, unknown>[])
    : [];
}

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("[dayforge-migrations-verify] Database not available");
    process.exit(1);
  }

  let ok = true;
  for (const requirement of REQUIRED) {
    const tableResult = await db.execute(sql`
      SELECT COUNT(*) AS count
        FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name = ${requirement.table}
    `);
    const tableCount = Number(rowsFrom(tableResult)[0]?.count ?? 0);
    if (tableCount === 0) {
      console.log(
        `  [FAIL] ${requirement.migration}: table '${requirement.table}' is missing`
      );
      ok = false;
      continue;
    }

    const columnResult = await db.execute(sql`
      SELECT column_name AS name
        FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = ${requirement.table}
    `);
    const existingColumns = new Set(
      rowsFrom(columnResult).map(row => String(row.name).toLowerCase())
    );
    const missingColumns = requirement.columns.filter(
      column => !existingColumns.has(column.toLowerCase())
    );
    if (missingColumns.length > 0) {
      console.log(
        `  [FAIL] ${requirement.migration}: table '${requirement.table}' missing columns: ${missingColumns.join(", ")}`
      );
      ok = false;
      continue;
    }

    console.log(
      `  [PASS] ${requirement.migration}: '${requirement.table}' present with required columns`
    );
  }

  for (const rule of COLUMN_RULES) {
    const result = await db.execute(sql`
      SELECT is_nullable AS isNullable,
             character_maximum_length AS maximumLength
        FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = ${rule.table}
         AND column_name = ${rule.column}
       LIMIT 1
    `);
    const row = rowsFrom(result)[0];
    const nullable = String(row?.isNullable ?? "").toUpperCase() === "YES";
    const maximumLength =
      row?.maximumLength === null || row?.maximumLength === undefined
        ? null
        : Number(row.maximumLength);
    const nullableMatches =
      rule.nullable === undefined || nullable === rule.nullable;
    const lengthMatches =
      rule.maximumLength === undefined || maximumLength === rule.maximumLength;
    if (!row || !nullableMatches || !lengthMatches) {
      console.log(
        `  [FAIL] ${rule.migration}: '${rule.table}.${rule.column}' has incompatible nullability or length`
      );
      ok = false;
      continue;
    }
    console.log(
      `  [PASS] ${rule.migration}: '${rule.table}.${rule.column}' has compatible nullability and length`
    );
  }

  for (const rule of INDEX_RULES) {
    const result = await db.execute(sql`
      SELECT index_name AS indexName,
             non_unique AS nonUnique,
             seq_in_index AS sequence,
             column_name AS columnName
        FROM information_schema.statistics
       WHERE table_schema = DATABASE()
         AND table_name = ${rule.table}
         AND index_name = ${rule.index}
       ORDER BY seq_in_index
    `);
    const rows = rowsFrom(result);
    const columns = rows.map(row => String(row.columnName));
    const isUnique = rows.length > 0 && Number(rows[0]?.nonUnique) === 0;
    const columnsMatch =
      columns.length === rule.columns.length &&
      columns.every((column, index) => column === rule.columns[index]);
    if (!columnsMatch || isUnique !== rule.unique) {
      console.log(
        `  [FAIL] ${rule.migration}: index '${rule.index}' on '${rule.table}' is missing or incompatible`
      );
      ok = false;
      continue;
    }
    console.log(
      `  [PASS] ${rule.migration}: '${rule.index}' enforces (${rule.columns.join(", ")})`
    );
  }

  for (const rule of FORBIDDEN_COLUMNS) {
    const result = await db.execute(sql`
      SELECT COUNT(*) AS count
        FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = ${rule.table}
         AND column_name = ${rule.column}
    `);
    const count = Number(rowsFrom(result)[0]?.count ?? 0);
    if (count > 0) {
      console.log(
        `  [FAIL] ${rule.migration}: legacy column '${rule.table}.${rule.column}' is still present`
      );
      ok = false;
      continue;
    }
    console.log(
      `  [PASS] ${rule.migration}: legacy column '${rule.table}.${rule.column}' is absent`
    );
  }

  console.log("");
  console.log(
    ok
      ? "[dayforge-migrations-verify] OK"
      : "[dayforge-migrations-verify] FAILED"
  );
  process.exit(ok ? 0 : 1);
}

main().catch(error => {
  console.error("[dayforge-migrations-verify] Failed:", error);
  process.exit(1);
});
