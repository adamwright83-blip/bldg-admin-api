import type { GoldlineOnboardingQuestionKey } from "./goldlineOnboarding";

export type JoystickDraftAnswerMap = Partial<
  Record<GoldlineOnboardingQuestionKey, string>
>;

export type JoystickDraftPreview = {
  kind: "joystick_draft_preview";
  generatedAt: string;
  work: { value: string; provenance: "operator_declared" };
  area: {
    declared: string;
    canonicalAddress: string | null;
    latitude: number | null;
    longitude: number | null;
    provenance: "operator_declared" | "geocoded_declaration";
  };
  avoidance: { value: string; provenance: "operator_declared" };
  briefing: {
    text: string;
    provenance: "generated_recommendation";
  };
  recommendedAction: {
    title: string;
    text: string;
    provenance: "generated_recommendation";
  };
};

function required(answers: JoystickDraftAnswerMap, key: GoldlineOnboardingQuestionKey): string {
  const value = answers[key]?.trim();
  if (!value) throw new Error("Complete the three JOYSTICK preview questions first.");
  return value;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
}

export function buildJoystickDraftPreview(input: {
  answers: JoystickDraftAnswerMap;
  geocode?: {
    canonicalAddress: string;
    latitude: number;
    longitude: number;
  } | null;
  now?: Date;
}): JoystickDraftPreview {
  const work = required(input.answers, "daily_work");
  const declaredArea = required(input.answers, "service_area");
  const avoidance = required(input.answers, "avoidance");
  const areaLabel = input.geocode?.canonicalAddress || declaredArea;

  return {
    kind: "joystick_draft_preview",
    generatedAt: (input.now ?? new Date()).toISOString(),
    work: { value: work, provenance: "operator_declared" },
    area: {
      declared: declaredArea,
      canonicalAddress: input.geocode?.canonicalAddress ?? null,
      latitude: input.geocode?.latitude ?? null,
      longitude: input.geocode?.longitude ?? null,
      provenance: input.geocode ? "geocoded_declaration" : "operator_declared",
    },
    avoidance: { value: avoidance, provenance: "operator_declared" },
    briefing: {
      text: `You said your work is ${oneLine(work)} around ${oneLine(areaLabel)}. The part you keep avoiding is ${oneLine(avoidance)}. Start there.`,
      provenance: "generated_recommendation",
    },
    recommendedAction: {
      title: "FIRST MOVE",
      text: "Choose one real instance of the work you keep avoiding and take the smallest verifiable next step.",
      provenance: "generated_recommendation",
    },
  };
}
