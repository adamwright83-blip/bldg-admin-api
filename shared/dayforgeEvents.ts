/**
 * Privacy-safe product analytics for the DayForge commercial revenue funnel.
 *
 * These events are deliberately separate from operational audit events. Product
 * analytics answers aggregate funnel questions; `dayforge_audit_events` remains
 * the authoritative, tenant-scoped record of business mutations.
 */
export const DAYFORGE_PRODUCT_EVENT_NAMES = [
  "territory_address_submitted",
  "territory_scan_started",
  "territory_results_loaded",
  "territory_scan_failed",
  "opportunity_opened",
  "sample_mission_created",
  "tenant_signup_started",
  "tenant_signup_completed",
  "mission_created",
  "mission_assigned",
  "mission_game_started",
  "mission_game_abandoned",
  "mission_game_retried",
  "mission_game_completed",
  "mission_phone_unlocked",
  "field_preparation_started",
  "proposal_created",
  "proposal_approved",
  "print_job_created",
  "print_job_ready",
  "field_departed",
  "field_arrived",
  "visit_completed",
  "follow_up_created",
  "proposal_requested",
  "account_won",
  "account_lost",
  "first_order_created",
  "revenue_invoiced",
  "revenue_realized",
  "churn_risk_detected",
  "win_back_prepared",
  "win_back_approved",
  "win_back_sent",
  "customer_returned",
  "recovered_revenue_realized",

  // --- Goldline gameplay events (Slice 19) ---
  // These answer one question: does playing Goldline correlate with more
  // real business-growth behavior? They are deliberately coarse — no
  // conversation content, no transcript text, no contact details. Business
  // outcomes (account_won, follow_up_created, etc. above) remain the
  // authoritative record; these events describe game session behavior only.
  "goldline_session_started",
  "goldline_session_ended",
  "mission_seen",
  "mission_approached",
  "mission_engaged",
  "traversal_jump",
  "traversal_climb",
  "traversal_vault",
  "anchor_encounter_started",
  "gatekeeper_encounter_started",
  "ghost_encounter_started",
  "staller_encounter_started",
  "encounter_resolved",
  "armory_weapon_viewed",
  "armory_weapon_selected",
  "armory_weapon_used",
  "mutation_created",
  "mutation_followed",
  "cold_call_batch_started",
  "cold_call_outcome_saved",
  "cold_call_chain_continued",
  "scout_run_started",
  "scout_discovery_created",
  "scout_mission_created",
  "verified_capture",
] as const;

export type DayforgeProductEventName =
  (typeof DAYFORGE_PRODUCT_EVENT_NAMES)[number];

type ProductAnalyticsScalar = string | number | boolean;

/**
 * Event properties may describe coarse product behavior, never the business or
 * person. Internal entity IDs belong in the event envelope, not this payload.
 */
export interface DayforgeProductEventPropertyMap {
  territory_address_submitted: {
    sourcePlacement: string;
    addressCountryCode: string;
  };
  territory_scan_started: {
    mode: string;
    providerKey: string;
  };
  territory_results_loaded: {
    resultCount: number;
    providerKey: string;
    durationMs: number;
    topScoreBand: string;
  };
  territory_scan_failed: {
    failureCode: string;
    providerKey: string;
    retryable: boolean;
  };
  opportunity_opened: {
    rank: number;
    scoreBand: string;
    accountType: string;
  };
  sample_mission_created: {
    scoreBand: string;
    estimatedValueBand: string;
    accountType: string;
  };
  tenant_signup_started: {
    sourcePlacement: string;
    planKey: string;
  };
  tenant_signup_completed: {
    sourcePlacement: string;
    planKey: string;
  };
  mission_created: {
    missionKind: string;
    sourceKind: string;
    estimatedValueBand: string;
  };
  mission_assigned: {
    assigneeRole: string;
    assignmentSource: string;
  };
  mission_game_started: {
    attemptNumber: number;
    gameMode: string;
  };
  mission_game_abandoned: {
    attemptNumber: number;
    durationMs: number;
    abandonmentReasonCode: string;
  };
  mission_game_retried: {
    attemptNumber: number;
    priorOutcome: string;
  };
  mission_game_completed: {
    attemptNumber: number;
    durationMs: number;
    xpAwarded: number;
    outcome: string;
  };
  mission_phone_unlocked: {
    unlockSource: string;
    attemptNumber: number;
  };
  field_preparation_started: {
    resume: boolean;
    checklistItemCount: number;
  };
  proposal_created: {
    versionNumber: number;
    templateKey: string;
    estimatedValueBand: string;
  };
  proposal_approved: {
    versionNumber: number;
    approvalSource: string;
  };
  print_job_created: {
    providerKey: string;
    documentKind: string;
  };
  print_job_ready: {
    providerKey: string;
    documentKind: string;
    durationMs: number;
  };
  field_departed: {
    preparationPercent: number;
    navigationMode: string;
  };
  field_arrived: {
    travelDurationMs: number;
    arrivalMethod: string;
  };
  visit_completed: {
    outcome: string;
    durationMs: number;
    proofKind: string;
  };
  follow_up_created: {
    followUpKind: string;
    dueInDays: number;
  };
  proposal_requested: {
    requestSource: string;
    deliveryMode: string;
  };
  account_won: {
    sourceKind: string;
    estimatedValueBand: string;
  };
  account_lost: {
    sourceKind: string;
    lossReasonCode: string;
  };
  first_order_created: {
    attributionSource: string;
    orderValueBand: string;
  };
  revenue_invoiced: {
    revenueBand: string;
    attributionConfidence: string;
  };
  revenue_realized: {
    revenueBand: string;
    attributionConfidence: string;
  };
  churn_risk_detected: {
    riskBand: string;
    confidenceBand: string;
    signalCount: number;
  };
  win_back_prepared: {
    channel: string;
    riskBand: string;
  };
  win_back_approved: {
    channel: string;
    approvalSource: string;
  };
  win_back_sent: {
    channel: string;
    deliveryStatus: string;
  };
  customer_returned: {
    daysSincePreviousOrder: number;
    attributionConfidence: string;
  };
  recovered_revenue_realized: {
    revenueBand: string;
    attributionConfidence: string;
  };

  // --- Goldline gameplay properties ---
  goldline_session_started: { sessionId: string; entryPoint: string };
  goldline_session_ended: { sessionId: string; durationMs: number };
  mission_seen: { sessionId: string; missionState: string };
  mission_approached: { sessionId: string; missionState: string };
  mission_engaged: { sessionId: string; missionState: string; archetype: string };
  traversal_jump: { sessionId: string };
  traversal_climb: { sessionId: string };
  traversal_vault: { sessionId: string };
  anchor_encounter_started: { sessionId: string; channel: string };
  gatekeeper_encounter_started: { sessionId: string; channel: string };
  ghost_encounter_started: { sessionId: string; channel: string };
  staller_encounter_started: { sessionId: string; channel: string };
  encounter_resolved: {
    sessionId: string;
    archetype: string;
    performance: string;
  };
  armory_weapon_viewed: { sessionId: string; provenanceKind: string };
  armory_weapon_selected: { sessionId: string; provenanceKind: string };
  armory_weapon_used: { sessionId: string; provenanceKind: string };
  mutation_created: { sessionId: string; mutationType: string };
  mutation_followed: { sessionId: string; mutationType: string };
  cold_call_batch_started: { sessionId: string; targetCount: number };
  cold_call_outcome_saved: { sessionId: string; outcome: string };
  cold_call_chain_continued: { sessionId: string; combo: number };
  scout_run_started: { sessionId: string };
  scout_discovery_created: { sessionId: string; discoveryCount: number };
  scout_mission_created: { sessionId: string };
  verified_capture: { sessionId: string; estimatedValueBand: string };
}

export type DayforgeProductEventProperties<
  Name extends DayforgeProductEventName,
> = Partial<DayforgeProductEventPropertyMap[Name]>;

export const DAYFORGE_PRODUCT_EVENT_PROPERTY_KEYS = {
  territory_address_submitted: ["sourcePlacement", "addressCountryCode"],
  territory_scan_started: ["mode", "providerKey"],
  territory_results_loaded: [
    "resultCount",
    "providerKey",
    "durationMs",
    "topScoreBand",
  ],
  territory_scan_failed: ["failureCode", "providerKey", "retryable"],
  opportunity_opened: ["rank", "scoreBand", "accountType"],
  sample_mission_created: ["scoreBand", "estimatedValueBand", "accountType"],
  tenant_signup_started: ["sourcePlacement", "planKey"],
  tenant_signup_completed: ["sourcePlacement", "planKey"],
  mission_created: ["missionKind", "sourceKind", "estimatedValueBand"],
  mission_assigned: ["assigneeRole", "assignmentSource"],
  mission_game_started: ["attemptNumber", "gameMode"],
  mission_game_abandoned: [
    "attemptNumber",
    "durationMs",
    "abandonmentReasonCode",
  ],
  mission_game_retried: ["attemptNumber", "priorOutcome"],
  mission_game_completed: [
    "attemptNumber",
    "durationMs",
    "xpAwarded",
    "outcome",
  ],
  mission_phone_unlocked: ["unlockSource", "attemptNumber"],
  field_preparation_started: ["resume", "checklistItemCount"],
  proposal_created: ["versionNumber", "templateKey", "estimatedValueBand"],
  proposal_approved: ["versionNumber", "approvalSource"],
  print_job_created: ["providerKey", "documentKind"],
  print_job_ready: ["providerKey", "documentKind", "durationMs"],
  field_departed: ["preparationPercent", "navigationMode"],
  field_arrived: ["travelDurationMs", "arrivalMethod"],
  visit_completed: ["outcome", "durationMs", "proofKind"],
  follow_up_created: ["followUpKind", "dueInDays"],
  proposal_requested: ["requestSource", "deliveryMode"],
  account_won: ["sourceKind", "estimatedValueBand"],
  account_lost: ["sourceKind", "lossReasonCode"],
  first_order_created: ["attributionSource", "orderValueBand"],
  revenue_invoiced: ["revenueBand", "attributionConfidence"],
  revenue_realized: ["revenueBand", "attributionConfidence"],
  churn_risk_detected: ["riskBand", "confidenceBand", "signalCount"],
  win_back_prepared: ["channel", "riskBand"],
  win_back_approved: ["channel", "approvalSource"],
  win_back_sent: ["channel", "deliveryStatus"],
  customer_returned: ["daysSincePreviousOrder", "attributionConfidence"],
  recovered_revenue_realized: ["revenueBand", "attributionConfidence"],

  goldline_session_started: ["sessionId", "entryPoint"],
  goldline_session_ended: ["sessionId", "durationMs"],
  mission_seen: ["sessionId", "missionState"],
  mission_approached: ["sessionId", "missionState"],
  mission_engaged: ["sessionId", "missionState", "archetype"],
  traversal_jump: ["sessionId"],
  traversal_climb: ["sessionId"],
  traversal_vault: ["sessionId"],
  anchor_encounter_started: ["sessionId", "channel"],
  gatekeeper_encounter_started: ["sessionId", "channel"],
  ghost_encounter_started: ["sessionId", "channel"],
  staller_encounter_started: ["sessionId", "channel"],
  encounter_resolved: ["sessionId", "archetype", "performance"],
  armory_weapon_viewed: ["sessionId", "provenanceKind"],
  armory_weapon_selected: ["sessionId", "provenanceKind"],
  armory_weapon_used: ["sessionId", "provenanceKind"],
  mutation_created: ["sessionId", "mutationType"],
  mutation_followed: ["sessionId", "mutationType"],
  cold_call_batch_started: ["sessionId", "targetCount"],
  cold_call_outcome_saved: ["sessionId", "outcome"],
  cold_call_chain_continued: ["sessionId", "combo"],
  scout_run_started: ["sessionId"],
  scout_discovery_created: ["sessionId", "discoveryCount"],
  scout_mission_created: ["sessionId"],
  verified_capture: ["sessionId", "estimatedValueBand"],
} as const satisfies {
  [Name in DayforgeProductEventName]: readonly (keyof DayforgeProductEventPropertyMap[Name])[];
};

const SENSITIVE_PROPERTY_KEY =
  /(address(?!CountryCode)|email|phone|name|contact|decision.?maker|notes?|message|text|raw|replay|payload|evidence|latitude|longitude|postal|street|unit)/i;

function isSafeProductAnalyticsValue(
  value: unknown
): value is ProductAnalyticsScalar {
  if (typeof value === "string") {
    return value.length <= 191;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return typeof value === "boolean";
}

/**
 * Returns only catalogued scalar properties. Unknown, sensitive, nested, and
 * oversized values are discarded so arbitrary client payloads cannot reach an
 * analytics destination.
 */
export function sanitizeDayforgeProductEventProperties<
  Name extends DayforgeProductEventName,
>(
  eventName: Name,
  properties: Record<string, unknown> | null | undefined
): DayforgeProductEventProperties<Name> {
  if (!properties) return {};

  const allowed = new Set<string>(
    DAYFORGE_PRODUCT_EVENT_PROPERTY_KEYS[eventName]
  );
  const sanitized: Record<string, ProductAnalyticsScalar> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (
      !SENSITIVE_PROPERTY_KEY.test(key) &&
      allowed.has(key) &&
      isSafeProductAnalyticsValue(value)
    ) {
      sanitized[key] = value;
    }
  }

  return sanitized as DayforgeProductEventProperties<Name>;
}

/** Strict server-boundary validation for callers that must fail closed. */
export function assertDayforgeProductEventProperties<
  Name extends DayforgeProductEventName,
>(
  eventName: Name,
  properties: Record<string, unknown> | null | undefined
): void {
  if (!properties) return;

  const sanitized = sanitizeDayforgeProductEventProperties(
    eventName,
    properties
  );
  const rejectedKeys = Object.keys(properties).filter(
    key => !Object.prototype.hasOwnProperty.call(sanitized, key)
  );

  if (rejectedKeys.length > 0) {
    throw new Error(
      `Unsafe or unsupported DayForge product analytics properties for ${eventName}: ${rejectedKeys.join(
        ", "
      )}`
    );
  }
}

/**
 * The subset of DayforgeProductEventName a Goldline gameplay client may
 * submit through the client-facing event endpoint. Deliberately a strict
 * whitelist, not "every product event name" — business-critical events
 * (account_won, revenue_realized, etc.) are only ever written by trusted
 * server-side domain code as a side effect of a real mutation, never
 * accepted directly from a client payload.
 */
export const GOLDLINE_CLIENT_EVENT_NAMES = [
  "goldline_session_started",
  "goldline_session_ended",
  "mission_seen",
  "mission_approached",
  "mission_engaged",
  "traversal_jump",
  "traversal_climb",
  "traversal_vault",
  "anchor_encounter_started",
  "gatekeeper_encounter_started",
  "ghost_encounter_started",
  "staller_encounter_started",
  "encounter_resolved",
  "armory_weapon_viewed",
  "armory_weapon_selected",
  "armory_weapon_used",
  "mutation_created",
  "mutation_followed",
  "cold_call_batch_started",
  "cold_call_outcome_saved",
  "cold_call_chain_continued",
  "scout_run_started",
  "scout_discovery_created",
  "scout_mission_created",
  "verified_capture",
] as const satisfies readonly DayforgeProductEventName[];

export type GoldlineClientEventName = (typeof GOLDLINE_CLIENT_EVENT_NAMES)[number];

export function isGoldlineClientEventName(
  value: string
): value is GoldlineClientEventName {
  return (GOLDLINE_CLIENT_EVENT_NAMES as readonly string[]).includes(value);
}

export function isDayforgeProductEventName(
  value: string
): value is DayforgeProductEventName {
  return (DAYFORGE_PRODUCT_EVENT_NAMES as readonly string[]).includes(value);
}
