/**
 * Daily Command is a derived executive picture, not a second task database.
 *
 * Importance and chronology are separate axes. Provenance is mandatory.
 * Narrator OS has no input here.
 */

export const UNKNOWN_CARGO_IDENTITY = "Unknown identity";

export const DAILY_COMMAND_POLICY = [
  "hard safety/payment blockers",
  "fixed-time obligations reserve their actual windows",
  "operator-designated primary owns free/discretionary time",
  "other due external promises",
  "tomorrow-blocking prep",
  "overdue growth work",
  "ordinary operations/admin",
  "housekeeping / optional work",
] as const;

export type DayDirectorKind = "growth" | "prep" | "operations";

export type CommandRole =
  | "primary"
  | "external_commitment"
  | "tomorrow_prep"
  | "housekeeping"
  | "fixed"
  | null;

export type CommandSourceType =
  | "day_director"
  | "field_today"
  | "goldline_cargo"
  | "campaign"
  | "commercial_follow_up"
  | "recurrence_rule";

export type CommandCategory =
  | "fixed"
  | "primary"
  | "externalCommitments"
  | "tomorrowPrep"
  | "growthDebt"
  | "operations"
  | "housekeeping"
  | "cargo";

export type CommandProvenance = {
  reader: string;
  sourceType: CommandSourceType;
  sourceIds: string[];
  quote: string | null;
};

export type CommandCargoLink = {
  kind: "order" | "field";
  id: string;
};

/**
 * Provenance for an explicit operator mission command.
 * Today-only displacement evidence. It does not rewrite the locked week.
 */
export type OperatorMissionMetadata = {
  version: 1;
  source: "operator_explicit";
  scope: "today_only";
  completionCondition: string;
  verification: "operator_reported";
  operatorMissionKey: string;
  requestedAt: string;
  weeklyIntentDisplacement: true;
  sourceCommandRef: string;
  evidenceQuote: string;
  businessDate: string;
};

export function readOperatorMissionMetadata(metadata: unknown): OperatorMissionMetadata | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  const raw =
    record.operatorMission && typeof record.operatorMission === "object"
      ? (record.operatorMission as Record<string, unknown>)
      : null;
  if (!raw) return null;
  if (raw.version !== 1) return null;
  if (raw.source !== "operator_explicit") return null;
  if (raw.scope !== "today_only") return null;
  if (raw.verification !== "operator_reported") return null;
  if (raw.weeklyIntentDisplacement !== true) return null;
  if (typeof raw.completionCondition !== "string" || !raw.completionCondition.trim()) return null;
  if (typeof raw.operatorMissionKey !== "string" || !raw.operatorMissionKey.trim()) return null;
  if (typeof raw.requestedAt !== "string" || !raw.requestedAt.trim()) return null;
  if (typeof raw.sourceCommandRef !== "string" || !raw.sourceCommandRef.trim()) return null;
  if (typeof raw.evidenceQuote !== "string" || !raw.evidenceQuote.trim()) return null;
  if (typeof raw.businessDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.businessDate)) return null;
  return {
    version: 1,
    source: "operator_explicit",
    scope: "today_only",
    completionCondition: raw.completionCondition.trim(),
    verification: "operator_reported",
    operatorMissionKey: raw.operatorMissionKey.trim(),
    requestedAt: raw.requestedAt,
    weeklyIntentDisplacement: true,
    sourceCommandRef: raw.sourceCommandRef.trim(),
    evidenceQuote: raw.evidenceQuote.trim(),
    businessDate: raw.businessDate,
  };
}

export type DayDirectorCommandMetadata = {
  role: CommandRole;
  designatedBy: "operator" | "operator_confirmed_proposal" | null;
  designatedAt: string | null;
  demotedAt: string | null;
  demotedReason: "replaced_by_operator" | null;
  promisedTo: string | null;
  promisedDeadline: string | null;
  identityUnknown: boolean;
  cargoLink: CommandCargoLink | null;
  recurrenceRuleId: string | null;
  constraints: {
    windowStart: string | null;
    windowEnd: string | null;
    scheduleLabel: string | null;
  };
};

export function emptyCommandMetadata(): DayDirectorCommandMetadata {
  return {
    role: null,
    designatedBy: null,
    designatedAt: null,
    demotedAt: null,
    demotedReason: null,
    promisedTo: null,
    promisedDeadline: null,
    identityUnknown: false,
    cargoLink: null,
    recurrenceRuleId: null,
    constraints: { windowStart: null, windowEnd: null, scheduleLabel: null },
  };
}

export function demotePrimaryCommand(
  command: DayDirectorCommandMetadata,
  nowIso: string
): DayDirectorCommandMetadata {
  return {
    ...command,
    role: null,
    designatedBy: null,
    designatedAt: command.designatedAt,
    demotedAt: nowIso,
    demotedReason: "replaced_by_operator",
  };
}

export function readCommandMetadata(metadata: unknown): DayDirectorCommandMetadata {
  const base = emptyCommandMetadata();
  if (!metadata || typeof metadata !== "object") return base;
  const record = metadata as Record<string, unknown>;
  const command =
    record.command && typeof record.command === "object"
      ? (record.command as Record<string, unknown>)
      : record;
  const role = command.role;
  const designatedBy = command.designatedBy;
  const demotedReason = command.demotedReason;
  const cargoLink =
    command.cargoLink && typeof command.cargoLink === "object"
      ? (command.cargoLink as Record<string, unknown>)
      : null;
  const constraints =
    command.constraints && typeof command.constraints === "object"
      ? (command.constraints as Record<string, unknown>)
      : {};
  return {
    role:
      role === "primary" ||
      role === "external_commitment" ||
      role === "tomorrow_prep" ||
      role === "housekeeping" ||
      role === "fixed"
        ? role
        : null,
    designatedBy:
      designatedBy === "operator" || designatedBy === "operator_confirmed_proposal"
        ? designatedBy
        : null,
    designatedAt: typeof command.designatedAt === "string" ? command.designatedAt : null,
    demotedAt: typeof command.demotedAt === "string" ? command.demotedAt : null,
    demotedReason: demotedReason === "replaced_by_operator" ? demotedReason : null,
    promisedTo: typeof command.promisedTo === "string" ? command.promisedTo : null,
    promisedDeadline: typeof command.promisedDeadline === "string" ? command.promisedDeadline : null,
    identityUnknown: command.identityUnknown === true,
    cargoLink:
      cargoLink && (cargoLink.kind === "order" || cargoLink.kind === "field") && typeof cargoLink.id === "string"
        ? { kind: cargoLink.kind, id: cargoLink.id }
        : null,
    recurrenceRuleId: typeof command.recurrenceRuleId === "string" ? command.recurrenceRuleId : null,
    constraints: {
      windowStart: typeof constraints.windowStart === "string" ? constraints.windowStart : null,
      windowEnd: typeof constraints.windowEnd === "string" ? constraints.windowEnd : null,
      scheduleLabel:
        typeof constraints.scheduleLabel === "string"
          ? constraints.scheduleLabel
          : typeof record.scheduleLabel === "string"
            ? record.scheduleLabel
            : null,
    },
  };
}

export type DailyCommandItem = {
  id: string;
  title: string;
  category: CommandCategory;
  dayDirectorKind: DayDirectorKind | null;
  status: "open" | "completed";
  importanceRank: number;
  chronology: {
    axis: "fixed_window" | "unscheduled_discretionary";
    windowStart: string | null;
    windowEnd: string | null;
    label: string | null;
  };
  promisedTo: string | null;
  identityUnknown: boolean;
  cargoLink: CommandCargoLink | null;
  recurrenceRuleId: string | null;
  detailState: "COMPLETE" | "NEEDS_DETAILS";
  provenance: CommandProvenance;
};

export type CommandOccupancy = {
  id: string;
  title: string;
  scheduledAt: string | null;
  kind: "protected" | "pickup" | "delivery" | "job";
  durationMinutes: number | null;
};

export type CommandConstraints = {
  fingerprint: string;
  protectDiscretionary: boolean;
  occupancies: CommandOccupancy[];
  primaryOpen: boolean;
  prepOpenIds: string[];
};

export type DailyCommand = {
  businessDate: string;
  actorId: string;
  primary: DailyCommandItem | null;
  fixed: DailyCommandItem[];
  externalCommitments: DailyCommandItem[];
  tomorrowPrep: DailyCommandItem[];
  growthDebt: DailyCommandItem[];
  operations: DailyCommandItem[];
  housekeeping: DailyCommandItem[];
  cargo: DailyCommandItem[];
  constraints: CommandConstraints;
  epistemic: {
    businessTruthItemIds: string[];
    executiveJudgment: {
      discretionaryOwnerId: string | null;
      policy: readonly string[];
    };
  };
  /**
   * Present only when today's open primary commitment itself carries an explicit
   * operator mission command. A different Daily Command title is not this field.
   */
  explicitOperatorMission?: OperatorMissionMetadata | null;
};

export type CommandCommitmentSource = {
  id: string;
  title: string;
  kind: DayDirectorKind;
  status: "open" | "completed";
  sourceText: string | null;
  detailState: "COMPLETE" | "NEEDS_DETAILS";
  scheduleKind: string | null;
  scheduleLabel: string | null;
  command: DayDirectorCommandMetadata;
  operatorMission?: OperatorMissionMetadata | null;
};

export type CommandRouteSource = {
  id: string;
  title: string;
  kind: string;
  scheduledAt: string | null;
  status: string;
  sourceReference: string;
};

export type CommandCargoSource = {
  id: string;
  title: string;
  customerDisplayName: string;
  identityUnknown: boolean;
  unlinked: boolean;
  custodyLocation: string | null;
  linkedOrderId: number | null;
  fieldCargoId: string | null;
  source: "order" | "field";
};

export type CommandCampaignSource = {
  active: boolean;
  remainingCount: number | null;
  remainingProven: boolean;
  campaignName: string;
};

export type CommandFollowUpSource = {
  id: string;
  title: string;
  sourceReference: string;
  status: "open" | "completed";
};

export const IMPORTANCE_RANK: Record<CommandCategory, number> = {
  fixed: 1,
  primary: 2,
  externalCommitments: 3,
  tomorrowPrep: 4,
  growthDebt: 5,
  operations: 6,
  housekeeping: 7,
  cargo: 1,
};

function item(input: Omit<DailyCommandItem, "importanceRank"> & { category: CommandCategory }): DailyCommandItem {
  return { ...input, importanceRank: IMPORTANCE_RANK[input.category] };
}

function hasWindow(commitment: CommandCommitmentSource): boolean {
  const kind = commitment.scheduleKind?.toUpperCase() ?? "";
  if (kind === "EXACT_TIME" || kind === "FLEXIBLE_WINDOW") return true;
  const label = commitment.scheduleLabel ?? commitment.command.constraints.scheduleLabel;
  return Boolean(label && /\d|noon|morning|afternoon|evening|window/i.test(label));
}

function looksFixed(commitment: CommandCommitmentSource): boolean {
  if (commitment.command.role === "fixed") return true;
  const text = `${commitment.title} ${commitment.sourceText ?? ""}`;
  return hasWindow(commitment) && /\b(pick ?up|drop ?off|deliver|delivery|appointment|window)\b/i.test(text);
}

function chronologyOf(commitment: CommandCommitmentSource): DailyCommandItem["chronology"] {
  const start = commitment.command.constraints.windowStart;
  const end = commitment.command.constraints.windowEnd;
  const label = commitment.scheduleLabel ?? commitment.command.constraints.scheduleLabel;
  if (hasWindow(commitment) || start || end) {
    return { axis: "fixed_window", windowStart: start, windowEnd: end, label };
  }
  return { axis: "unscheduled_discretionary", windowStart: null, windowEnd: null, label };
}

function commitmentProvenance(commitment: CommandCommitmentSource): CommandProvenance {
  return {
    reader: "getDayDirectorState",
    sourceType: commitment.command.recurrenceRuleId ? "recurrence_rule" : "day_director",
    sourceIds: commitment.command.recurrenceRuleId
      ? [commitment.id, commitment.command.recurrenceRuleId]
      : [commitment.id],
    quote: commitment.sourceText,
  };
}

/** The open primary's own metadata, and only when its stored quote contains the command. */
function explicitOperatorMissionFrom(
  commitment: CommandCommitmentSource | null,
  businessDate: string
): OperatorMissionMetadata | null {
  const mission = commitment?.operatorMission;
  if (!mission || mission.businessDate !== businessDate) return null;
  const quote = mission.evidenceQuote.trim();
  const source = commitment?.sourceText ?? "";
  if (!quote || !source.toLowerCase().includes(quote.toLowerCase())) return null;
  return mission;
}

function routeChronology(route: CommandRouteSource): DailyCommandItem["chronology"] {
  if (route.scheduledAt) {
    return { axis: "fixed_window", windowStart: route.scheduledAt, windowEnd: null, label: route.scheduledAt };
  }
  return { axis: "unscheduled_discretionary", windowStart: null, windowEnd: null, label: null };
}

export function commandConstraintsFingerprint(input: {
  primaryId: string | null;
  primaryStatus: string | null;
  prep: Array<{ id: string; status: string }>;
  fixed: Array<{ id: string; windowStart: string | null; windowEnd: string | null }>;
  hard: Array<{ id: string; status: string }>;
}): string {
  return JSON.stringify({
    primaryId: input.primaryId,
    primaryStatus: input.primaryStatus,
    prep: input.prep,
    fixed: input.fixed,
    hard: input.hard,
  });
}

export function deriveDailyCommand(input: {
  businessDate: string;
  actorId: string;
  commitments: CommandCommitmentSource[];
  route: CommandRouteSource[];
  cargo: CommandCargoSource[];
  campaign: CommandCampaignSource | null;
  followUps: CommandFollowUpSource[];
}): DailyCommand {
  const openCommitments = input.commitments.filter(row => row.status === "open");
  const primaries = openCommitments.filter(row => row.command.role === "primary");
  const primarySource = primaries[0] ?? null;
  const explicitOperatorMission = explicitOperatorMissionFrom(primarySource, input.businessDate);

  const primary = primarySource
    ? item({
        id: `day-director:${primarySource.id}`,
        title: primarySource.title,
        category: "primary",
        dayDirectorKind: primarySource.kind,
        status: primarySource.status,
        chronology: chronologyOf(primarySource),
        promisedTo: primarySource.command.promisedTo,
        identityUnknown: primarySource.command.identityUnknown,
        cargoLink: primarySource.command.cargoLink,
        recurrenceRuleId: primarySource.command.recurrenceRuleId,
        detailState: primarySource.detailState,
        provenance: commitmentProvenance(primarySource),
      })
    : null;

  const seen = new Set<string>(primary ? [primary.id] : []);
  const take = (candidate: DailyCommandItem) => {
    if (seen.has(candidate.id) && candidate.category !== "externalCommitments" && candidate.category !== "fixed") {
      return null;
    }
    seen.add(candidate.id);
    return candidate;
  };

  const fixed: DailyCommandItem[] = [];
  const externalCommitments: DailyCommandItem[] = [];
  const tomorrowPrep: DailyCommandItem[] = [];
  const growthDebt: DailyCommandItem[] = [];
  const operations: DailyCommandItem[] = [];
  const housekeeping: DailyCommandItem[] = [];

  for (const commitment of input.commitments) {
    const base = {
      id: `day-director:${commitment.id}`,
      title: commitment.title,
      dayDirectorKind: commitment.kind,
      status: commitment.status,
      chronology: chronologyOf(commitment),
      promisedTo: commitment.command.promisedTo,
      identityUnknown: commitment.command.identityUnknown,
      cargoLink: commitment.command.cargoLink,
      recurrenceRuleId: commitment.command.recurrenceRuleId,
      detailState: commitment.detailState,
      provenance: commitmentProvenance(commitment),
    };

    if (looksFixed(commitment) && commitment.status === "open") {
      const next = item({ ...base, category: "fixed" });
      fixed.push(next);
    }
    if (
      (commitment.command.role === "external_commitment" || commitment.command.promisedTo) &&
      commitment.status === "open"
    ) {
      externalCommitments.push(item({ ...base, category: "externalCommitments" }));
    }
    if (primary && commitment.id === primarySource?.id) continue;
    if (commitment.status !== "open") continue;

    if (commitment.command.role === "housekeeping") {
      const next = take(item({ ...base, category: "housekeeping" }));
      if (next) housekeeping.push(next);
      continue;
    }
    if (commitment.kind === "prep" || commitment.command.role === "tomorrow_prep") {
      const next = take(item({ ...base, category: "tomorrowPrep" }));
      if (next) tomorrowPrep.push(next);
      continue;
    }
    if (commitment.kind === "growth") {
      const next = take(item({ ...base, category: "growthDebt" }));
      if (next) growthDebt.push(next);
      continue;
    }
    const next = take(item({ ...base, category: "operations" }));
    if (next) operations.push(next);
  }

  const ROUTE_FIXED = new Set(["pickup", "delivery", "job"]);
  const ROUTE_GROWTH = new Set(["follow_up", "commercial_visit", "commercial_call", "field_commitment"]);
  const ROUTE_BLOCKER = new Set(["payment_blocker"]);

  for (const route of input.route) {
    const id = `route:${route.id}`;
    const base = {
      id,
      title: route.title,
      dayDirectorKind: null as DayDirectorKind | null,
      status: "open" as const,
      chronology: routeChronology(route),
      promisedTo: null,
      identityUnknown: false,
      cargoLink: null,
      recurrenceRuleId: null,
      detailState: "COMPLETE" as const,
      provenance: {
        reader: "getFieldToday",
        sourceType: "field_today" as const,
        sourceIds: [route.id, route.sourceReference],
        quote: null,
      },
    };
    if (ROUTE_FIXED.has(route.kind)) {
      fixed.push(item({ ...base, category: "fixed" }));
      continue;
    }
    if (ROUTE_GROWTH.has(route.kind)) {
      growthDebt.push(item({ ...base, dayDirectorKind: "growth", category: "growthDebt" }));
      continue;
    }
    if (ROUTE_BLOCKER.has(route.kind)) {
      operations.push({ ...item({ ...base, category: "operations" }), importanceRank: 0 });
    }
  }

  for (const followUp of input.followUps) {
    if (followUp.status !== "open") continue;
    const id = `follow-up:${followUp.id}`;
    if (seen.has(id) || growthDebt.some(row => row.id === id || row.title === followUp.title)) continue;
    growthDebt.push(
      item({
        id,
        title: followUp.title,
        category: "growthDebt",
        dayDirectorKind: "growth",
        status: "open",
        chronology: { axis: "unscheduled_discretionary", windowStart: null, windowEnd: null, label: null },
        promisedTo: null,
        identityUnknown: false,
        cargoLink: null,
        recurrenceRuleId: null,
        detailState: "COMPLETE",
        provenance: {
          reader: "commercialFollowUp",
          sourceType: "commercial_follow_up",
          sourceIds: [followUp.id, followUp.sourceReference],
          quote: null,
        },
      })
    );
  }

  if (input.campaign?.active && input.campaign.remainingProven && (input.campaign.remainingCount ?? 0) > 0) {
    growthDebt.push(
      item({
        id: `campaign:${input.campaign.campaignName}`,
        title: `${input.campaign.campaignName}: ${input.campaign.remainingCount} visits remaining`,
        category: "growthDebt",
        dayDirectorKind: "growth",
        status: "open",
        chronology: { axis: "unscheduled_discretionary", windowStart: null, windowEnd: null, label: null },
        promisedTo: null,
        identityUnknown: false,
        cargoLink: null,
        recurrenceRuleId: null,
        detailState: "COMPLETE",
        provenance: {
          reader: "getClaireCampaignSummary",
          sourceType: "campaign",
          sourceIds: [input.campaign.campaignName],
          quote: null,
        },
      })
    );
  }

  const cargo: DailyCommandItem[] = [];
  const cargoSeen = new Set<string>();
  for (const row of input.cargo) {
    const key = row.source === "order" ? `order:${row.linkedOrderId ?? row.id}` : `field:${row.fieldCargoId ?? row.id}`;
    if (cargoSeen.has(key)) continue;
    cargoSeen.add(key);
    cargo.push(
      item({
        id: `cargo:${row.id}`,
        title: row.title,
        category: "cargo",
        dayDirectorKind: "operations",
        status: "open",
        chronology: { axis: "unscheduled_discretionary", windowStart: null, windowEnd: null, label: row.custodyLocation },
        promisedTo: null,
        identityUnknown: row.identityUnknown || row.customerDisplayName === UNKNOWN_CARGO_IDENTITY,
        cargoLink: row.source === "order" && row.linkedOrderId != null
          ? { kind: "order", id: String(row.linkedOrderId) }
          : row.fieldCargoId
            ? { kind: "field", id: row.fieldCargoId }
            : null,
        recurrenceRuleId: null,
        detailState: row.identityUnknown || row.unlinked ? "NEEDS_DETAILS" : "COMPLETE",
        provenance: {
          reader: "listCargo",
          sourceType: "goldline_cargo",
          sourceIds: [row.id, ...(row.fieldCargoId ? [row.fieldCargoId] : []), ...(row.linkedOrderId != null ? [String(row.linkedOrderId)] : [])],
          quote: null,
        },
      })
    );
  }

  const prepOpen = tomorrowPrep.filter(row => row.status === "open");
  const primaryOpen = Boolean(primary && primary.status === "open");
  const occupancies: CommandOccupancy[] = [
    ...fixed
      .filter(row => row.chronology.axis === "fixed_window")
      .map(row => ({
        id: row.id,
        title: row.title,
        scheduledAt: row.chronology.windowStart,
        kind: /pickup/i.test(row.title) ? ("pickup" as const) : /deliver|drop/i.test(row.title) ? ("delivery" as const) : ("job" as const),
        durationMinutes: null,
      })),
    ...[primary, ...prepOpen]
      .filter((row): row is DailyCommandItem => Boolean(row && row.chronology.axis === "fixed_window"))
      .map(row => ({
        id: row.id,
        title: row.title,
        scheduledAt: row.chronology.windowStart,
        kind: "protected" as const,
        durationMinutes: null,
      })),
  ];

  const fingerprint = commandConstraintsFingerprint({
    primaryId: primary?.id ?? null,
    primaryStatus: primary?.status ?? null,
    prep: prepOpen.map(row => ({ id: row.id, status: row.status })),
    fixed: occupancies.map(row => ({
      id: row.id,
      windowStart: row.scheduledAt,
      windowEnd: null,
    })),
    hard: operations
      .filter(row => row.importanceRank === 0)
      .map(row => ({ id: row.id, status: row.status })),
  });

  const all = [
    ...(primary ? [primary] : []),
    ...fixed,
    ...externalCommitments,
    ...tomorrowPrep,
    ...growthDebt,
    ...operations,
    ...housekeeping,
    ...cargo,
  ];

  return {
    businessDate: input.businessDate,
    actorId: input.actorId,
    primary,
    fixed,
    externalCommitments,
    tomorrowPrep,
    growthDebt,
    operations,
    housekeeping,
    cargo,
    constraints: {
      fingerprint,
      protectDiscretionary: primaryOpen || prepOpen.length > 0,
      occupancies,
      primaryOpen,
      prepOpenIds: prepOpen.map(row => row.id),
    },
    epistemic: {
      businessTruthItemIds: all.map(row => row.id),
      executiveJudgment: {
        discretionaryOwnerId: primaryOpen ? primary!.id : null,
        policy: DAILY_COMMAND_POLICY,
      },
    },
    ...(explicitOperatorMission ? { explicitOperatorMission } : {}),
  };
}

export function toDailyCommandPromptSection(command: DailyCommand): string {
  const line = (label: string, items: DailyCommandItem[]) =>
    items.length ? `${label}: ${items.map(row => row.title).join("; ")}.` : null;
  const primary = command.primary
    ? `Protected primary: ${command.primary.title}${command.primary.promisedTo ? ` (promised to ${command.primary.promisedTo})` : ""}.`
    : "No operator-designated primary.";
  const judgment = command.epistemic.executiveJudgment.discretionaryOwnerId
    ? "Discretionary time belongs to the protected primary; lower-value work stays visible but must not replace it."
    : "No protected primary is owning discretionary time.";
  return [
    `Daily Command for ${command.businessDate}.`,
    primary,
    line("Fixed obligations", command.fixed),
    line("External commitments", command.externalCommitments),
    line("Tomorrow prep", command.tomorrowPrep),
    line("Growth debt", command.growthDebt),
    line("Operations", command.operations),
    line("Housekeeping", command.housekeeping),
    line("Vehicle cargo", command.cargo),
    judgment,
    "Importance and chronology are separate. Do not invent missing work. Narrator OS is not consulted.",
  ]
    .filter(Boolean)
    .join(" ");
}

export type GameBindingEligibility = {
  commandItemId: string;
  sourceType: CommandSourceType;
  sourceIds: string[];
  eligible: boolean;
  reason: "real_work_exists" | "not_business_truth";
};

/** Game may skin real work. It may not mint Daily Command obligations. */
export function gameBindingsForCommand(command: DailyCommand): GameBindingEligibility[] {
  const rows = [
    ...(command.primary ? [command.primary] : []),
    ...command.fixed,
    ...command.externalCommitments,
    ...command.tomorrowPrep,
    ...command.growthDebt,
    ...command.operations,
  ];
  return rows.map(row => ({
    commandItemId: row.id,
    sourceType: row.provenance.sourceType,
    sourceIds: row.provenance.sourceIds,
    eligible: row.provenance.sourceIds.length > 0,
    reason: row.provenance.sourceIds.length > 0 ? "real_work_exists" : "not_business_truth",
  }));
}
