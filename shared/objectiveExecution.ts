/**
 * One execution classifier for an Objective.
 *
 * mission = physical presence is required.
 * challenge = the work is remote.
 * hybrid_objective = both are required, joined as both-required, with no or/either.
 * null = unknown. Unknown is not Mission.
 *
 * An identifier, a growth motion, or the word "mission" is not evidence.
 * A stored type is kept, including a stored unknown. Derivation runs only
 * when no stored type was supplied.
 */

export const OBJECTIVE_EXECUTION_TYPES = ["mission", "challenge", "hybrid_objective"] as const;

export type ObjectiveExecutionType = (typeof OBJECTIVE_EXECUTION_TYPES)[number];

export type ObjectiveExecutionInput = {
  /** Primary contract or completion text. */
  contract?: string | null;
  completionCondition?: string | null;
  title?: string | null;
  objective?: string | null;
  /** Ignored. An id containing "mission" is not a field Objective. */
  identifier?: string | null;
  /** Ignored. A growth motion is not an execution contract. */
  motion?: string | null;
  /**
   * Present only when a type is already stored.
   * null means stored unknown and must not be re-derived.
   */
  persistedType?: ObjectiveExecutionType | null;
};

export type ObjectiveExecutionDecision = {
  executionType: ObjectiveExecutionType | null;
  fieldRequired: boolean;
  remoteRequired: boolean;
  /** Field and remote each satisfy the work. That is not a Hybrid Objective. */
  eitherAcceptable: boolean;
  source: "persisted" | "derived";
};

export function isObjectiveExecutionType(value: unknown): value is ObjectiveExecutionType {
  return typeof value === "string" && (OBJECTIVE_EXECUTION_TYPES as readonly string[]).includes(value);
}

/**
 * The operator named the execution type. Difficulty, emotion, and the word
 * "ad" are not a type. "today's mission" is a designation, not this classifier.
 */
export function explicitOperatorExecutionType(text: string): ObjectiveExecutionType | null {
  const challenge = /\b(?:as|is)\s+a\s+challenge\b/i.test(text);
  const mission = /\b(?:as|is)\s+a\s+mission\b/i.test(text) && !/\btoday'?s\s+mission\b/i.test(text);
  const hybrid = /\bhybrid\s+objective\b/i.test(text);
  if (hybrid || (challenge && mission)) return "hybrid_objective";
  if (challenge) return "challenge";
  if (mission) return "mission";
  return null;
}

export function classifyObjectiveExecution(input: ObjectiveExecutionInput): ObjectiveExecutionDecision {
  void input.identifier;
  void input.motion;
  if ("persistedType" in input) {
    return persistedDecision(input.persistedType);
  }
  const text = evidenceText(input);
  const field = hasFieldExecution(text);
  const remote = hasRemoteExecution(text);
  if (field && remote) {
    const exclusive = /\b(?:or|either)\b/i.test(text);
    const required = /\b(?:and|both|plus|then)\b/i.test(text) || /\bas well as\b/i.test(text) || text.includes("&");
    if (!required || exclusive) {
      return {
        executionType: null,
        fieldRequired: false,
        remoteRequired: false,
        eitherAcceptable: exclusive,
        source: "derived",
      };
    }
    return {
      executionType: "hybrid_objective",
      fieldRequired: true,
      remoteRequired: true,
      eitherAcceptable: false,
      source: "derived",
    };
  }
  if (field) {
    return {
      executionType: "mission",
      fieldRequired: true,
      remoteRequired: false,
      eitherAcceptable: false,
      source: "derived",
    };
  }
  if (remote) {
    return {
      executionType: "challenge",
      fieldRequired: false,
      remoteRequired: true,
      eitherAcceptable: false,
      source: "derived",
    };
  }
  return {
    executionType: null,
    fieldRequired: false,
    remoteRequired: false,
    eitherAcceptable: false,
    source: "derived",
  };
}

function persistedDecision(value: unknown): ObjectiveExecutionDecision {
  if (!isObjectiveExecutionType(value)) {
    return {
      executionType: null,
      fieldRequired: false,
      remoteRequired: false,
      eitherAcceptable: false,
      source: "persisted",
    };
  }
  if (value === "hybrid_objective") {
    return {
      executionType: value,
      fieldRequired: true,
      remoteRequired: true,
      eitherAcceptable: false,
      source: "persisted",
    };
  }
  if (value === "mission") {
    return {
      executionType: value,
      fieldRequired: true,
      remoteRequired: false,
      eitherAcceptable: false,
      source: "persisted",
    };
  }
  return {
    executionType: "challenge",
    fieldRequired: false,
    remoteRequired: true,
    eitherAcceptable: false,
    source: "persisted",
  };
}

function evidenceText(input: ObjectiveExecutionInput): string {
  const contract = (input.contract ?? "").trim() || (input.completionCondition ?? "").trim();
  if (contract && (hasFieldExecution(contract) || hasRemoteExecution(contract))) return contract;
  const fallback = [input.title, input.objective]
    .map(part => part?.trim() ?? "")
    .filter(part => part.length > 0)
    .join("\n");
  return fallback || contract;
}

/** Naming idioms are not phone calls and are not field visits. */
function withoutNamingIdioms(text: string): string {
  return text
    .replace(/\bcall it(?:\s+(?:a|an))?(?:\s+[a-z]+)?\b/gi, " ")
    .replace(/\bwhat\s+(?:we|you|they|i)\s+call\b/gi, " ");
}

const DIGITAL_VISIT_OBJECT =
  "web\\s*sites?|websites?|pages?|urls?|links?|portals?|dashboards?|inboxes|browsers?|apps?|applications?|online";

const TANGIBLE_OR_PLACE =
  /\b(kits?|samples?|bags?|laundry|linens?|uniforms?|hangers?|supplies|loads?|bins?|carts?|boxes|goods|equipment|materials|towels?|plants?|propert(?:y|ies)|buildings?|desks?|lobbies|lobby|offices?|sites?|doors?|warehouses?|docks?|locations?|addresses?|front desk|(?:the|a|an)\s+orders?)\b/i;

function hasFieldExecution(text: string): boolean {
  const source = withoutNamingIdioms(text);
  if (hasFieldVisit(source)) return true;
  if (/\bon[\s-]?site\b/i.test(source)) return true;
  if (/\bin[\s-]?person\b/i.test(source)) return true;
  if (/\bdoor[\s-]?hangers?\b/i.test(source)) return true;
  if (/\b(?:property|physical) pitch(?:es|ing)?\b/i.test(source)) return true;
  if (/\bpitch(?:es|ing)?\b(?:\s+\w+){0,8}\s+propert(?:y|ies)\b/i.test(source)) return true;
  if (/\bpropert(?:y|ies)\b(?:\s+\w+){0,8}\s+pitch(?:es|ing)?\b/i.test(source)) return true;
  if (/\bdrop[\s-]?offs?\b/i.test(source) || /\bdrop off\b/i.test(source)) return true;
  if (hasPhysicalPickup(source)) return true;
  if (hasPhysicalDelivery(source)) return true;
  return false;
}

function hasFieldVisit(text: string): boolean {
  const digitalObject = new RegExp(`\\b(?:${DIGITAL_VISIT_OBJECT})\\b`, "i");
  const precededByDigital = new RegExp(`\\b(?:${DIGITAL_VISIT_OBJECT})\\s+$`, "i");
  const re = /\bvisit(?:s|ing|ed)?\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 40), match.index);
    if (precededByDigital.test(before)) continue;
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 72);
    const object = /^(?:\s+(?:the|a|an|our|their|its|my))?(?:\s+[\w-]+){0,6}/i.exec(after)?.[0] ?? "";
    if (digitalObject.test(object) && !TANGIBLE_OR_PLACE.test(object) && !/\bon[\s-]?site\b/i.test(object)) {
      continue;
    }
    return true;
  }
  return false;
}

function hasPhysicalPickup(text: string): boolean {
  const stripped = text
    .replace(/\bpick[\s-]?up the phone\b/gi, " ")
    .replace(/\bpick[\s-]?up where we left off\b/gi, " ")
    .replace(/\bpick[\s-]?up the slack\b/gi, " ")
    .replace(/\bpick[\s-]?up the pace\b/gi, " ")
    .replace(/\bpick[\s-]?up the conversation\b/gi, " ")
    .replace(/\bpick[\s-]?up the thread\b/gi, " ")
    .replace(/\bpick[\s-]?up the call\b/gi, " ");
  if (/\bphysical pick[\s-]?ups?\b/i.test(stripped)) return true;
  const compound = /\bpick-?ups?\b/i.test(stripped);
  const phrasal = /\bpick up\b/i.test(stripped);
  if (!compound && !phrasal) return false;
  if (compound && !phrasal) return true;
  return TANGIBLE_OR_PLACE.test(stripped) || /\bon[\s-]?site\b/i.test(stripped);
}

function hasPhysicalDelivery(text: string): boolean {
  if (/\bphysical deliver(?:y|ies|ed|ing)?\b/i.test(text)) return true;
  const stripped = text
    .replace(/\bemail deliver(?:y|ies|ed|ing)?\b/gi, " ")
    .replace(/\b(?:e-?mail|sms|text|message|digital|news|results|reports?)\s+deliver(?:y|ies|ed|ing)?\b/gi, " ")
    .replace(/\bdeliver(?:y|ies|ed|ing)? (?:the |an |a )?(?:e-?mail|sms|text|message)s?\b/gi, " ")
    .replace(
      /\bdeliver(?:y|ies)?\s+of\s+(?:the\s+|a\s+|an\s+)?(?:news|results|reports?|updates?|presentations?|speeches|numbers|verdicts?)\b/gi,
      " "
    )
    .replace(
      /\bdeliver(?:ed|ing)?\s+(?:the\s+|a\s+|an\s+)?(?:news|results|reports?|updates?|presentations?|speeches|numbers|verdicts?)\b/gi,
      " "
    )
    .replace(/\bdeliver on\b/gi, " ");
  if (/\bdeliver(?:ies|y)\b/i.test(stripped)) return true;
  if (!/\bdeliver(?:ed|ing)?\b/i.test(stripped)) return false;
  return TANGIBLE_OR_PLACE.test(stripped) || /\bon[\s-]?site\b/i.test(stripped);
}

function hasRemoteExecution(text: string): boolean {
  const source = withoutNamingIdioms(text);
  if (/\b(?:cold[\s-]?)?calls?\b/i.test(source) || /\bcalling\b/i.test(source)) return true;
  if (/\bphones?\b/i.test(source) || /\bphoning\b/i.test(source)) return true;
  if (/\btexts?\b/i.test(source) || /\btexting\b/i.test(source) || /\bsms\b/i.test(source)) return true;
  if (/\be-?mails?\b/i.test(source) || /\bemailing\b/i.test(source)) return true;
  if (hasRemoteMessage(source)) return true;
  if (/\bpublish(?:ed|ing|es)?\b/i.test(source)) return true;
  if (/\bbrowser\b/i.test(source)) return true;
  if (/\badmin work\b/i.test(source) || /\badmin console\b/i.test(source)) return true;
  if (/\b(?:in|via|using|through) (?:the )?admin\b(?!\s+(?:district|building|office|person|staff))/i.test(source)) {
    return true;
  }
  return /\bremote follow[\s-]?ups?\b/i.test(source);
}

/** A send channel. "Message delivery" as a bare noun is not one. */
function hasRemoteMessage(text: string): boolean {
  if (/\bmessaging\b/i.test(text)) return true;
  if (/\b(?:by|via|through)\s+(?:a\s+|the\s+|an\s+)?messages?\b/i.test(text)) return true;
  if (/\b(?:send|sent|sending)\s+(?:a\s+|the\s+|an\s+)?messages?\b/i.test(text)) return true;
  return /\bmessages?\s+(?:sent|send|sending)\b/i.test(text);
}
