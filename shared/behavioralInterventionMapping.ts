/**
 * Versioned intervention-definition registry (foundation §6).
 * Annotations are hypotheses (`proposed`). Never write TDF/BCT onto ledger rows.
 */
export const INTERVENTION_POLICY_VERSION = 1 as const;
export const INTERVENTION_DEFINITION_VERSION = 1 as const;

export const STANDARD_PRESENTATION = "STANDARD_PRESENTATION" as const;

export type CombComponent = "capability" | "opportunity" | "motivation";

/** Subset of TDF domains we actually map. Taxonomy, not diagnosis. */
export type TdfDomain =
  | "environmental_context_and_resources"
  | "memory_attention_and_decision_processes";

export type BcwInterventionFunction =
  | "enablement"
  | "environmental_restructuring"
  | "training"
  | "persuasion"
  | "incentivisation"
  | "coercion"
  | "restriction"
  | "modelling"
  | "education";

export type EpistemicClass =
  | "operator-declared"
  | "behavior-observed"
  | "claire-inference"
  | "historical-model-inference";

export type AnnotationStatus = "proposed" | "expert_reviewed" | "empirically_supported";

export type ProposedBctAnnotation = {
  bctId: string;
  label: string;
  annotationStatus: AnnotationStatus;
};

export type InterventionDefinitionRecord = {
  interventionKey: string;
  version: typeof INTERVENTION_DEFINITION_VERSION;
  framework: "COM-B/TDF/BCW/BCTTv1";
  frameworkVersion: "proposed-slice4-v1";
  comb: CombComponent;
  tdfDomain: TdfDomain;
  interventionFunction: BcwInterventionFunction;
  bcts: readonly ProposedBctAnnotation[];
  annotationStatus: "proposed";
};

/** Graded-task / enablement mapping used when time/opportunity friction is possible. */
export const ENABLEMENT_TIME_FRICTION: InterventionDefinitionRecord = {
  interventionKey: "enablement_time_opportunity_friction",
  version: INTERVENTION_DEFINITION_VERSION,
  framework: "COM-B/TDF/BCW/BCTTv1",
  frameworkVersion: "proposed-slice4-v1",
  comb: "opportunity",
  tdfDomain: "environmental_context_and_resources",
  interventionFunction: "enablement",
  bcts: [
    {
      bctId: "1.4",
      label: "Action planning",
      annotationStatus: "proposed",
    },
    {
      bctId: "8.7",
      label: "Graded tasks",
      annotationStatus: "proposed",
    },
  ],
  annotationStatus: "proposed",
};

export const DIAGNOSIS_FORBIDDEN_PATTERNS = [
  /\bavoidant\b/i,
  /\bavoidance\b/i,
  /\blazy\b/i,
  /\bunmotivated\b/i,
  /\blacks motivation\b/i,
  /\badhd\b/i,
  /\bintimidated\b/i,
  /\bfearful\b/i,
  /\bpersonality\b/i,
  /\bdiagnos/i,
  /\bworks better\b/i,
  /\bcaused completion\b/i,
  /\bresponds best\b/i,
  /\bmore effective\b/i,
];
