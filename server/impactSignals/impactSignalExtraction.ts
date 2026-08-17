/**
 * Turning a spoken sentence into a proposed signal.
 *
 * Produces a PROPOSAL. Nothing here persists anything and nothing here is
 * trusted — the operator sees the structure, corrects it, and confirms.
 *
 * The prompt's hardest job is refusing to inflate. "I left 35 door hangers" is
 * effort; it is not a lead, and a model that helpfully rounds it up to one
 * would quietly manufacture a pipeline out of a day of walking. So the impact
 * class is constrained explicitly, with the conservative choice named as the
 * default and the funnel spelled out with examples the operator actually said.
 */
import { randomUUID } from "node:crypto";
import { invokeLLM } from "../_core/llm";
import {
  IMPACT_CLASSES,
  SIGNAL_VALUE_TYPES,
  toSignalKey,
  type ImpactSignalProposal,
  type OperatorStopIdentity,
  type ProposedImpactSignal,
} from "../../shared/impactSignal";

const EXTRACTION_MODEL = "claude-opus-5";

/** How to say each stop kind to the model without overclaiming what it is. */
const STOP_PHRASE: Record<OperatorStopIdentity["entityType"], string> = {
  native_order: "pickup or delivery stop",
  external_order: "job owned by another system",
  sourced_target: "sourced local business the operator is visiting",
};

const EXTRACTION_SYSTEM = [
  "You convert one spoken field observation from a laundry operator into structured signals.",
  "",
  "You are structuring what was said. You are not evaluating, improving, or",
  "completing it. If the operator did not say something, it is not there.",
  "",
  "IMPACT CLASS — the single most important field. Choose the WEAKEST class that",
  "honestly fits. Never upgrade effort into outcome.",
  "",
  '  observation      Something true about the world, with no funnel meaning.',
  '                   "This building has 180 units." "They already offer Tide',
  '                   Cleaners." "This building does not allow solicitation."',
  '                   "I spoke to the leasing agent, not the property manager."',
  '  field_activity   Effort the operator expended. "I left 35 door hangers."',
  '  response         The other side did something back. "The manager asked for',
  '                   pricing." "The receptionist gave me the GM email."',
  '  opportunity      A concrete next step now exists. "Meeting scheduled Tuesday."',
  '  customer_outcome A real customer now exists. Only if clearly stated.',
  '  economic_outcome Actual money. "They signed up at $185 a month."',
  "",
  "When in doubt choose `observation`. Most field intel is observation, and that",
  "is the correct answer, not a failure to find something better.",
  "",
  "A complaint reported by someone else is an observation, not a response — e.g.",
  '"residents complain about not having in-unit laundry" is something the manager',
  "told the operator about the world, not an action the manager took toward us.",
  "",
  "STARTING TO TRACK SOMETHING",
  'If the operator is asking to begin tracking a KIND of thing ("start tracking',
  'whether buildings allow solicitation", "I need to start tracking package',
  'lockers"), set startsTracking true. If they also stated this instance\'s value',
  "in the same breath, capture that value too. If they only asked to start",
  'tracking and gave no value, set value to "" and startsTracking true.',
  "",
  "VALUE TYPE",
  "Use `number` for counts and amounts (and set unit). Use `boolean` for yes/no,",
  'with value exactly "true" or "false". Use `text` otherwise.',
  "",
  "One sentence may contain more than one signal — return each separately.",
  "If the speech contains no field observation at all, return an empty list and",
  "put the speech in `unrecognized`.",
].join("\n");

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["signals", "unrecognized"],
  properties: {
    unrecognized: {
      type: ["string", "null"],
      description:
        "The speech, if it contained no recognisable field observation. Null otherwise.",
    },
    signals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "valueType",
          "value",
          "unit",
          "impactClass",
          "entityType",
          "entityLabel",
          "notes",
          "startsTracking",
        ],
        properties: {
          label: {
            type: "string",
            description:
              "What a person would call this signal, e.g. 'Building solicitation policy'.",
          },
          valueType: { type: "string", enum: [...SIGNAL_VALUE_TYPES] },
          value: {
            type: "string",
            description:
              "The value as stated. Empty string if the operator only asked to start tracking.",
          },
          unit: {
            type: ["string", "null"],
            description: "Unit for a number, e.g. 'hangers', 'units', 'USD/month'.",
          },
          impactClass: { type: "string", enum: [...IMPACT_CLASSES] },
          entityType: {
            type: ["string", "null"],
            description:
              "What this is about, e.g. 'building', 'account', 'person'. Only when the operator NAMED it — never inferred from the stop context above.",
          },
          entityLabel: {
            type: ["string", "null"],
            description: "The named thing, if the operator named one. Never invent one.",
          },
          notes: {
            type: ["string", "null"],
            description: "Anything said that does not fit the value.",
          },
          startsTracking: {
            type: "boolean",
            description: "True if the operator asked to begin tracking this kind of thing.",
          },
        },
      },
    },
  },
} as const;

type Payload = {
  unrecognized: string | null;
  signals: Array<Omit<ProposedImpactSignal, "signalKey" | "metadata">>;
};

/**
 * Reads one spoken observation into proposed signals.
 *
 * A provider failure returns the speech as unrecognised rather than throwing:
 * the operator is mid-day in the field, and losing their sentence is worse than
 * handing it back for manual structuring.
 */
export async function extractImpactSignals(input: {
  speech: string;
  entityHint?: OperatorStopIdentity | null;
}): Promise<ImpactSignalProposal> {
  const contextLines = [
    input.entityHint
      ? [
          `The operator is at a scheduled ${STOP_PHRASE[input.entityHint.entityType]} for: ${input.entityHint.entityLabel}.`,
          "Use it as the entity only when the observation is plainly about where they are.",
          // The hint identifies an order, and the model must not launder that
          // into a claim about a building. It is the one place a category error
          // here would look like canonical data later.
          "This names the STOP, not a building or an account. Do not assert a building identity, and do not treat the address as one.",
        ].join(" ")
      : "The operator's current location is unknown. Leave entity fields null unless they name something.",
    "",
    `Operator said: ${input.speech}`,
  ].join("\n");

  let payload: Payload | null = null;
  try {
    const result = await invokeLLM({
      model: EXTRACTION_MODEL,
      maxTokens: 2048,
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM },
        { role: "user", content: contextLines },
      ],
      outputSchema: {
        name: "field_signals",
        schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
      },
    });
    const raw = result.choices[0]?.message?.content;
    payload = JSON.parse(typeof raw === "string" ? raw : "") as Payload;
  } catch {
    return {
      proposalId: randomUUID(),
      signals: [],
      unrecognized: input.speech,
    };
  }

  if (!payload || !Array.isArray(payload.signals)) {
    return { proposalId: randomUUID(), signals: [], unrecognized: input.speech };
  }

  const signals: ProposedImpactSignal[] = payload.signals
    .map((signal): ProposedImpactSignal | null => {
      const label = (signal.label ?? "").trim();
      if (!label) return null;
      const signalKey = toSignalKey(label);
      if (!signalKey) return null;
      const clean = (v: string | null | undefined) => {
        const t = (v ?? "").trim();
        return t.length > 0 ? t : null;
      };
      return {
        signalKey,
        label,
        valueType: SIGNAL_VALUE_TYPES.includes(signal.valueType)
          ? signal.valueType
          : "text",
        value: (signal.value ?? "").trim(),
        unit: clean(signal.unit),
        // Anything unrecognised collapses to the weakest class rather than a
        // flattering guess.
        impactClass: IMPACT_CLASSES.includes(signal.impactClass)
          ? signal.impactClass
          : "observation",
        entityType: clean(signal.entityType) ?? input.entityHint?.entityType ?? null,
        entityLabel:
          clean(signal.entityLabel) ?? input.entityHint?.entityLabel ?? null,
        notes: clean(signal.notes),
        metadata: null,
        startsTracking: Boolean(signal.startsTracking),
      } satisfies ProposedImpactSignal;
    })
    .filter((s): s is ProposedImpactSignal => s !== null);

  return {
    proposalId: randomUUID(),
    signals,
    unrecognized:
      signals.length === 0 ? (payload.unrecognized ?? input.speech) : null,
  };
}
