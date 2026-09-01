import type { DataQuality, ProvenancedValue, VerificationClass } from "../../shared/businessGame";

export type FieldTodayItemKind =
  | "job"
  | "pickup"
  | "delivery"
  | "follow_up"
  | "commercial_visit"
  | "commercial_call"
  | "mission_dispatch"
  | "customer_recovery"
  /** A promise the operator made in the field, now due. */
  | "field_commitment"
  /** A place worth returning to because of what someone reported. */
  | "reported_opportunity"
  | "payment_blocker"
  | "route_exception"
  | "contextual_move";

export type FieldTodayItem = {
  id: string;
  kind: FieldTodayItemKind;
  source: { entityType: string; entityId: string; sourceReference: string };
  /**
   * The building this piece of the day belongs to, when one is already known.
   * Null means Goldline has not resolved a physical entity for it — never that
   * the work is placeless, and never a building picked to fill the gap.
   */
  physicalEntityId?: string | null;
  /**
   * Why this is on today's board, in the words of the evidence it came from.
   * Present on anything Goldline surfaced on its own initiative, so the player
   * can always ask "why is this here?" and get a real answer.
   */
  whySurfaced?: string | null;
  scheduledAt: string | null;
  urgency: "blocked" | "overdue" | "urgent" | "scheduled" | "flexible" | "upcoming";
  title: string;
  subtitle: string;
  status: string;
  destination: { address: string; latitude: number | null; longitude: number | null } | null;
  customer: { name: string; phone: string | null; email: string | null } | null;
  money: ProvenancedValue<number> | null;
  verificationClass: VerificationClass;
  actions: Array<{ type: string; label: string; href: string | null; mutation: string | null }>;
};

export type FieldTodayProjection = {
  generatedAt: string;
  businessDate: string;
  currentUserId: string;
  timeline: FieldTodayItem[];
  nextFixedCommitment: FieldTodayItem | null;
  blockers: FieldTodayItem[];
  dataQuality: DataQuality;
};

export type FieldMoveType = "commercial_follow_up" | "customer_recovery_call" | "nearby_commercial_visit" | "commercial_call";

export type FieldMoveCandidate = {
  id: string;
  moveType: FieldMoveType;
  title: string;
  target: { entityType: string; entityId: string; name: string };
  expectedDurationMinutes: number;
  travelMinutes: number | null;
  expectedValue: ProvenancedValue<{ lowCents: number; highCents: number }>;
  confidence: "high" | "medium" | "low" | "unknown";
  relevance: string;
  evidence: string[];
  expiresAt: string | null;
  contactAllowed: boolean;
  withinServiceRadius: boolean | null;
  missionId: number | null;
  missionVersion: number | null;
  destinationPath: string;
};

export type FieldMovesResult = {
  generatedAt: string;
  recommendedMoves: FieldMoveCandidate[];
  reason: "MOVES_AVAILABLE" | "NO_WORTHWHILE_MOVE" | "ROUTE_TOO_TIGHT" | "NO_ELIGIBLE_TARGET" | "CAPACITY_FULL" | "DATA_INSUFFICIENT";
  constraints: {
    availableMinutes: number | null;
    capacityFull: boolean;
    currentLocationAvailable: boolean;
  };
  dataQuality: DataQuality;
};

export type AuthoritativeVisitRouteStop = {
  missionId: number;
  moveId: string;
  accountName: string;
  destinationPath: string;
  position: number;
  requiresDriving: boolean;
  evidenced: boolean;
  visitOutcomeId: number | null;
  /**
   * Real account address/maps link, when the account has one on file — never
   * fabricated. Enables the stop to open the in-game VISIT action surface
   * directly (see GoldlineGameHome.tsx's onSelectRouteStop) without a page
   * navigation. `null` is a truthful "no address on record" — the caller
   * fails closed rather than opening the surface with an invented address.
   */
  address: string | null;
  navigationUrl: string | null;
};

/**
 * Persisted commercial-visit route membership plus derived visit evidence.
 * `coveredCount` is a projection only; it is never written as business truth.
 */
export type AuthoritativeVisitRouteProjection = {
  occurrenceId: string;
  businessDate: string;
  startedAt: string;
  totalStops: number;
  coveredCount: number;
  stops: AuthoritativeVisitRouteStop[];
};
