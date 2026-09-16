/**
 * FICTION PACKS — interchangeable dramatic interpretations of campaign truth.
 *
 * See docs/goldline/FICTION_PACKS.md. Campaigns own truth; packs own
 * interpretation. A pack may change genre, language, pacing, presentation and
 * payoff. It may never change the objective, the completion condition, the
 * evidence rules, or any business record.
 *
 * FOUR LAWS ARE ENFORCED BY THESE TYPES RATHER THAN BY REVIEW:
 *
 * 1. Beats are FRACTIONS, never counts. A pack cannot express "at 10 of 40"
 *    because `atFraction` is the only threshold there is. An electrician's
 *    8-target run and a mature 60-target run wear the same pack unchanged.
 *
 * 2. The victory beat is SHARED across tempo tiers. `victoryBeat` is one
 *    string and the tiers only supply what comes after it, so "the real work
 *    always gets its full payoff" is a property of the shape, not a promise.
 *    Completion is binary and always honored (FICTION_PACKS.md section 6).
 *
 * 3. No pack may contain a business noun. `assertNoBusinessNouns` fails a pack
 *    that hardcodes a trade or a product, because the same pack has to serve
 *    other tenants (section 4.1).
 *
 * 4. Slots refuse rather than guess. `renderSlots` returns null when a
 *    required slot is missing, mirroring `VoiceLine.requires` in
 *    shared/goldlineVoice.ts, which already solved this problem here.
 */

export const FICTION_SLOT_NAMES = [
  "unit",
  "unitPlural",
  "actionVerb",
  "placementPoint",
  "territory",
  "objective",
  "count",
  "total",
  "remaining",
] as const;
export type FictionSlotName = (typeof FICTION_SLOT_NAMES)[number];

/**
 * The campaign fills these. The pack only ever says what it CALLS them.
 * Every value is a string because a pack must never do arithmetic on a count —
 * that is the campaign's business and the pack has no opinion about it.
 */
export type FictionSlots = Partial<Record<FictionSlotName, string>>;

export type FictionBeat = {
  id: string;
  /**
   * Fires once progress reaches this fraction of the campaign-owned total.
   * Range (0, 1]. There is deliberately no absolute-count field.
   */
  atFraction: number;
  text: string;
  requires: FictionSlotName[];
};

export const TEMPO_TIERS = ["clean_break", "wounded", "gone_to_ground"] as const;
export type TempoTier = (typeof TEMPO_TIERS)[number];

export type FictionPack = {
  id: string;
  version: number;
  /** What the player is cast as. */
  role: string;
  premise: string;
  briefing: string;
  objectiveLabels: {
    unit: string;
    unitPlural: string;
    action: string;
    grid: string;
  };
  progressBeats: FictionBeat[];
  /** How the pack asks for evidence. Never claims the evidence proves more. */
  proofFraming: string;
  /** Shown on completion at EVERY tempo. The one thing tempo cannot touch. */
  victoryBeat: string;
  /** What follows the victory beat. Keyed by tier; never replaces it. */
  tempoTails: Record<TempoTier, string>;
  /** The default incomplete state. Held ground, never debt (section 7). */
  echoPresentation: string;
  /**
   * Legal ONLY against a campaign that declares a real failureCondition.
   * Null for anything that can simply remain unfinished — which is most work.
   */
  failureSequence: string | null;
  visualTheme: Record<string, string>;
  audioTheme: Record<string, string>;
};

/**
 * Words that name somebody's actual trade or product. A pack containing one of
 * these has hardcoded a tenant and will need a rewrite for the next one.
 */
const BUSINESS_NOUNS = [
  "laundry",
  "launder",
  "dry clean",
  "hanger",
  "flyer",
  "plumber",
  "plumbing",
  "electrician",
  "hvac",
  "landscaper",
  "resident",
  "apartment",
];

export function findBusinessNouns(pack: FictionPack): string[] {
  const haystack = [
    pack.role,
    pack.premise,
    pack.briefing,
    pack.proofFraming,
    pack.victoryBeat,
    pack.echoPresentation,
    pack.failureSequence ?? "",
    ...Object.values(pack.objectiveLabels),
    ...Object.values(pack.tempoTails),
    ...pack.progressBeats.map(beat => beat.text),
  ]
    .join(" ~ ")
    .toLowerCase();

  return BUSINESS_NOUNS.filter(noun => haystack.includes(noun));
}

export function validateFictionPack(pack: FictionPack): FictionPack {
  if (!pack.id.trim()) throw new Error("Fiction pack id is required");
  if (!Number.isInteger(pack.version) || pack.version < 1) {
    throw new Error("Fiction pack version must be a positive integer");
  }
  if (!pack.victoryBeat.trim()) {
    throw new Error("Fiction pack must define a victory beat");
  }
  if (!pack.echoPresentation.trim()) {
    throw new Error(
      "Fiction pack must define an echo presentation — incomplete work is held ground, not silence"
    );
  }

  for (const tier of TEMPO_TIERS) {
    if (!pack.tempoTails[tier]?.trim()) {
      throw new Error(`Fiction pack is missing a tempo tail for ${tier}`);
    }
  }

  const seen = new Set<string>();
  for (const beat of pack.progressBeats) {
    if (seen.has(beat.id)) {
      throw new Error(`Duplicate fiction beat id: ${beat.id}`);
    }
    seen.add(beat.id);
    if (!(beat.atFraction > 0 && beat.atFraction <= 1)) {
      throw new Error(
        `Beat ${beat.id} must fire at a fraction in (0, 1] — packs never know absolute counts`
      );
    }
    for (const slot of beat.requires) {
      if (!beat.text.includes(`{${slot}}`)) {
        throw new Error(
          `Beat ${beat.id} requires slot {${slot}} but never renders it`
        );
      }
    }
  }

  const freeform: Array<[string, string]> = [
    ["victoryBeat", pack.victoryBeat],
    ["echoPresentation", pack.echoPresentation],
    ...TEMPO_TIERS.map(
      tier => [`tempoTails.${tier}`, pack.tempoTails[tier]] as [string, string]
    ),
    ...(pack.failureSequence
      ? ([["failureSequence", pack.failureSequence]] as Array<[string, string]>)
      : []),
  ];
  for (const [field, template] of freeform) {
    for (const match of template.matchAll(/\{(\w+)\}/g)) {
      if (!(FICTION_SLOT_NAMES as readonly string[]).includes(match[1])) {
        throw new Error(
          `Fiction pack ${pack.id} references unknown slot {${match[1]}} in ${field}`
        );
      }
    }
  }

  const nouns = findBusinessNouns(pack);
  if (nouns.length > 0) {
    throw new Error(
      `Fiction pack ${pack.id} hardcodes business nouns (${nouns.join(", ")}) — packs bind to slots so other trades can wear them`
    );
  }

  return pack;
}

/**
 * Renders a template, or refuses. Refusing is the point: a line that cannot be
 * filled truthfully does not get shown with a hole in it.
 */
export function renderSlots(
  template: string,
  requires: readonly FictionSlotName[],
  slots: FictionSlots
): string | null {
  for (const slot of requires) {
    const value = slots[slot];
    if (value == null || value === "") return null;
  }
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = slots[name as FictionSlotName];
    return value == null || value === "" ? whole : value;
  });
}

/**
 * Every known slot a template actually references. Unknown `{words}` are left
 * alone — they are prose, not slots.
 */
export function requiredSlotsIn(template: string): FictionSlotName[] {
  const found = new Set<FictionSlotName>();
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    const name = match[1] as FictionSlotName;
    if ((FICTION_SLOT_NAMES as readonly string[]).includes(name)) {
      found.add(name);
    }
  }
  return [...found];
}

/**
 * Renders a template that carries no explicit `requires` list, deriving the
 * requirement from the text itself. Victory lines, tempo tails and Echo copy
 * go through here, so the refusal law covers every string a pack can show and
 * not just its beats.
 */
export function renderStrict(
  template: string,
  slots: FictionSlots
): string | null {
  return renderSlots(template, requiredSlotsIn(template), slots);
}

/**
 * The beats a run has reached, in order. Pure transformation of a real
 * fraction — a beat may dramatize state, never introduce it (section 4.2).
 */
export function resolveReachedBeats(
  pack: FictionPack,
  fraction: number,
  slots: FictionSlots
): Array<{ id: string; text: string }> {
  return pack.progressBeats
    .filter(beat => fraction >= beat.atFraction)
    .sort((a, b) => a.atFraction - b.atFraction)
    .map(beat => ({
      id: beat.id,
      text: renderSlots(beat.text, beat.requires, slots),
    }))
    .filter((beat): beat is { id: string; text: string } => beat.text != null);
}

export type TempoInput = {
  sessionCount: number;
  largestGapDays: number;
};

/**
 * CEILING ONLY. Every tier is a win; the tier decides what happened to the
 * antagonist afterwards. There is no tier that means the operator failed, and
 * this function cannot return one (section 6).
 */
export function gradeTempo(input: TempoInput): TempoTier {
  if (input.sessionCount <= 2 && input.largestGapDays <= 2) return "clean_break";
  if (input.sessionCount <= 4 && input.largestGapDays <= 7) return "wounded";
  return "gone_to_ground";
}

export type CompletionCopy = {
  victory: string;
  tail: string;
  tier: TempoTier;
};

/**
 * The victory line is identical at every tempo, by construction. The tail is
 * appended after it, never in place of it.
 */
export function composeCompletion(
  pack: FictionPack,
  tempo: TempoInput,
  slots: FictionSlots
): CompletionCopy {
  const tier = gradeTempo(tempo);
  const victory = renderStrict(pack.victoryBeat, slots);
  const tail = renderStrict(pack.tempoTails[tier], slots);
  if (victory == null || tail == null) {
    throw new Error(
      `Fiction pack ${pack.id} cannot render its completion: a required slot was not supplied`
    );
  }
  return { victory, tail, tier };
}

/**
 * A pack's failure sequence may only be used when the campaign declares a real
 * failure condition. Otherwise unfinished work is an Echo, which is held
 * ground and not a verdict.
 */
export function resolveIncompleteCopy(
  pack: FictionPack,
  input: { campaignHasFailureCondition: boolean; failureConditionMet: boolean },
  slots: FictionSlots
): { kind: "echo" | "failure"; text: string } {
  if (
    input.campaignHasFailureCondition &&
    input.failureConditionMet &&
    pack.failureSequence
  ) {
    const text = renderStrict(pack.failureSequence, slots);
    if (text == null) {
      throw new Error(
        `Fiction pack ${pack.id} cannot render its failure sequence: a required slot was not supplied`
      );
    }
    return { kind: "failure", text };
  }
  const echo = renderStrict(pack.echoPresentation, slots);
  if (echo == null) {
    throw new Error(
      `Fiction pack ${pack.id} cannot render its echo: a required slot was not supplied`
    );
  }
  return { kind: "echo", text: echo };
}
