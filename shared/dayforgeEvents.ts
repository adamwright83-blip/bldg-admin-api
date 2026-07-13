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

export function isDayforgeProductEventName(
  value: string
): value is DayforgeProductEventName {
  return (DAYFORGE_PRODUCT_EVENT_NAMES as readonly string[]).includes(value);
}
