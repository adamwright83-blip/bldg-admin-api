import type {
  OperatorRepresentativeItem,
  OperatorRepresentativeItemDetail,
  OperatorRepresentativeTalkIntent,
  OperatorRepresentativeTalkResponse,
} from "./types";
import type { OperatorRepresentativeSnapshot } from "./readModel";
import type { DaphneAdaptationLifecycleEntry } from "./adaptation";
import type { OperatorRepresentativeDirectiveKind } from "./directives";

export type OperatorRepresentativeDirectiveRequest = {
  kind: OperatorRepresentativeDirectiveKind;
  itemId: string;
  value?: string;
};

export type OperatorRepresentativeTalkResult = OperatorRepresentativeTalkResponse & {
  directiveRequest?: OperatorRepresentativeDirectiveRequest;
};

function classify(question: string): OperatorRepresentativeTalkIntent {
  const q = question.toLowerCase();
  if (/\b(don't|do not|stop)\s+(use|using)\b|\bignore this\b/.test(q)) return "suppress";
  if (/\bask me\b|\bcheck with me\b|\bconfirm with me\b/.test(q)) return "ask_instead";
  if (/\b(not true|isn't true|is not true|wrong|incorrect|correct that)\b/.test(q)) return "correct";
  if (/\b(why|where did|evidence|source|come from)\b/.test(q)) return "why";
  if (/\b(are you using|do you use|using this|active adaptation)\b/.test(q)) return "using";
  if (/\b(communication channel|phone|sms|text|email|channel do i prefer)\b/.test(q)) return "channel";
  if (/\b(best working time|work best|working time|what time.*prefer|morning.*prefer)\b/.test(q)) return "working_time";
  if (/\b(what.*know|known about me|know about me)\b/.test(q)) return "known";
  if (/\b(learned|learning|pattern)\b/.test(q)) return "learning";
  if (/\b(uncertain|unsure|not sure|don't know|do not know)\b/.test(q)) return "uncertain";
  if (/\b(changed|change recently|different now|adapted)\b/.test(q)) return "changed";
  return "general";
}

function take(items: OperatorRepresentativeItem[], count = 3): OperatorRepresentativeItem[] {
  return items.slice(0, count);
}

function sentenceList(items: OperatorRepresentativeItem[]): string {
  return items.map(item => item.title).join("; ");
}

function evidenceRefs(detail: OperatorRepresentativeItemDetail | undefined): string[] {
  return detail?.evidence.map(item => item.id) ?? [];
}

function focused(snapshot: OperatorRepresentativeSnapshot, itemId?: string | null) {
  if (!itemId) return undefined;
  return snapshot.details.get(itemId);
}

function declaredPreference(
  snapshot: OperatorRepresentativeSnapshot,
  matcher: (item: OperatorRepresentativeItem) => boolean
): OperatorRepresentativeItem | undefined {
  return snapshot.home.known.find(
    item =>
      item.provenanceClass === "operator_declared" &&
      matcher(item)
  );
}

export function answerOperatorRepresentativeQuestion(input: {
  question: string;
  snapshot: OperatorRepresentativeSnapshot;
  focusedItemId?: string | null;
  correctionValue?: string | null;
  adaptationLifecycle?: DaphneAdaptationLifecycleEntry[];
}): OperatorRepresentativeTalkResult {
  const question = input.question.trim();
  const intent = classify(question);
  const detail = focused(input.snapshot, input.focusedItemId);
  const base = {
    intent,
    itemRefs: [] as string[],
    evidenceRefs: [] as string[],
    uncertainty: [] as string[],
    suggestedActions: [] as OperatorRepresentativeTalkResponse["suggestedActions"],
    needsClarification: false,
  };

  if (intent === "suppress") {
    if (!detail) {
      return {
        ...base,
        reply: "Tell me which item you want me to stop using.",
        needsClarification: true,
      };
    }
    if (!detail.canSuppress) {
      return {
        ...base,
        reply: "That item is not an adaptation signal I can suppress here.",
        itemRefs: [detail.item.id],
      };
    }
    return {
      ...base,
      reply: "You told me not to use this signal for adaptation. I won't delete the underlying source.",
      itemRefs: [detail.item.id],
      evidenceRefs: evidenceRefs(detail),
      suggestedActions: ["undo_directive", "view_evidence"],
      directiveRequest: { kind: "suppress", itemId: detail.item.id },
    };
  }

  if (intent === "ask_instead") {
    if (!detail) {
      return {
        ...base,
        reply: "Tell me which item you want me to ask you about instead of using silently.",
        needsClarification: true,
      };
    }
    if (!detail.canAskInstead) {
      return {
        ...base,
        reply: "That item is not eligible for an ask-first directive.",
        itemRefs: [detail.item.id],
      };
    }
    return {
      ...base,
      reply: "I'll treat this as ask-first. JOYSTICK should confirm with you instead of silently relying on this signal.",
      itemRefs: [detail.item.id],
      evidenceRefs: evidenceRefs(detail),
      suggestedActions: ["undo_directive", "view_evidence"],
      directiveRequest: { kind: "ask_instead", itemId: detail.item.id },
    };
  }

  if (intent === "correct") {
    if (!detail) {
      return {
        ...base,
        reply: "Tell me which item is wrong, then tell me the corrected value.",
        needsClarification: true,
      };
    }
    if (!detail.canCorrect) {
      return {
        ...base,
        reply: "I can't rewrite that source here. I can show you where it came from, but Operator Representative does not rewrite business truth.",
        itemRefs: [detail.item.id],
        evidenceRefs: evidenceRefs(detail),
        suggestedActions: ["view_evidence"],
      };
    }
    const correctionValue = input.correctionValue?.trim();
    if (!correctionValue) {
      return {
        ...base,
        reply: "What should I use instead?",
        itemRefs: [detail.item.id],
        needsClarification: true,
      };
    }
    return {
      ...base,
      reply: `I'll record your correction as: “${correctionValue}”.`,
      itemRefs: [detail.item.id],
      evidenceRefs: evidenceRefs(detail),
      suggestedActions: ["undo_directive", "view_evidence"],
      directiveRequest: { kind: "correction", itemId: detail.item.id, value: correctionValue },
    };
  }

  if (intent === "why" || intent === "using") {
    if (!detail) {
      return {
        ...base,
        reply: "Open the item you want me to explain, then ask again.",
        needsClarification: true,
      };
    }
    const lifecycle = input.adaptationLifecycle?.find(
      item => item.targetItemId === detail.item.id
    );
    const using = lifecycle
      ? lifecycle.lifecycle === "used"
        ? `Yes. A durable receipt proves Claire used this ${lifecycle.useCount} time${lifecycle.useCount === 1 ? "" : "s"}.`
        : lifecycle.lifecycle === "wired_unused"
          ? "It is wired to Claire, but no durable receipt proves Claire has used it yet."
          : lifecycle.lifecycle === "disabled"
            ? "It is wired, but live adaptation is off, so Claire is not using it."
            : lifecycle.lifecycle === "revoked_historical"
              ? `It is revoked now. Durable history shows ${lifecycle.useCount} past use${lifecycle.useCount === 1 ? "" : "s"}.`
              : lifecycle.lifecycle === "revoked_unused"
                ? "It was revoked before any durable use was recorded."
                : "It is not wired into live Claire behavior."
      : detail.item.adaptationState === "active"
        ? "It is active."
        : detail.item.adaptationState === "suppressed"
          ? "You told JOYSTICK not to use it."
          : detail.item.adaptationState === "ask_instead"
            ? "You told JOYSTICK to ask you before relying on it. I do not have receipt-backed use status in this view."
            : detail.item.adaptationState === "eligible_not_wired"
              ? "It is visible, but it is not wired into live Claire behavior."
              : "It is not eligible for live adaptation.";
    return {
      ...base,
      reply:
        intent === "using"
          ? using
          : `${detail.provenance}. ${detail.meaning} ${using}`,
      itemRefs: [detail.item.id],
      evidenceRefs: evidenceRefs(detail),
      uncertainty: detail.uncertaintyReasons,
      suggestedActions: [
        "view_evidence",
        ...(detail.canCorrect ? (["correct_item"] as const) : []),
        ...(detail.canSuppress ? (["suppress_item"] as const) : []),
        ...(detail.canAskInstead ? (["ask_instead"] as const) : []),
      ],
    };
  }

  if (intent === "channel") {
    const item = declaredPreference(input.snapshot, candidate =>
      candidate.targetKey?.toLowerCase().includes("channel") === true ||
      candidate.title.toLowerCase().includes("channel")
    );
    if (!item) {
      return {
        ...base,
        reply: "I don't have an authoritative declared communication-channel preference for you. I won't infer one from channel_affinity or assignedOption.",
        uncertainty: ["channel_semantics_unestablished"],
      };
    }
    return {
      ...base,
      reply: `What I can say is what you explicitly declared: ${item.summary}`,
      itemRefs: [item.id],
      suggestedActions: ["view_evidence", "correct_item"],
    };
  }

  if (intent === "working_time") {
    const item = declaredPreference(input.snapshot, candidate =>
      candidate.targetKey?.toLowerCase().includes("time") === true ||
      candidate.title.toLowerCase().includes("working hours")
    );
    if (!item) {
      return {
        ...base,
        reply: "I don't have an authoritative declared working-time preference. Observed timing patterns are not enough for me to call one a preference.",
        uncertainty: ["working_time_not_declared"],
      };
    }
    return {
      ...base,
      reply: `You explicitly declared: ${item.summary}`,
      itemRefs: [item.id],
      suggestedActions: ["view_evidence", "correct_item"],
    };
  }

  const categories =
    intent === "known"
      ? input.snapshot.home.known
      : intent === "learning"
        ? input.snapshot.home.learning
        : intent === "uncertain"
          ? input.snapshot.home.uncertain
          : intent === "changed"
            ? input.snapshot.home.changed
            : [];

  if (intent !== "general") {
    const items = take(categories);
    if (!items.length) {
      const copy =
        intent === "known"
          ? "You haven't explicitly told JOYSTICK enough yet."
          : intent === "learning"
            ? "I don't have enough qualifying evidence to show a learning pattern yet."
            : intent === "uncertain"
              ? "No active uncertainty is surfaced right now."
              : "No Operator adaptation changes are recorded yet.";
      return { ...base, reply: copy };
    }
    const lead =
      intent === "known"
        ? "What I know comes from explicit or canonical sources:"
        : intent === "learning"
          ? "These are descriptive patterns, not traits or preferences:"
          : intent === "uncertain"
            ? "Here is what I am not prepared to claim yet:"
            : "These are stored changes or explicit directives:";
    return {
      ...base,
      reply: `${lead} ${sentenceList(items)}.`,
      itemRefs: items.map(item => item.id),
      suggestedActions: ["view_evidence"],
    };
  }

  return {
    ...base,
    reply: `I can explain what you explicitly told me, what the evidence is starting to show, what is uncertain, and what JOYSTICK has changed. Right now I have ${input.snapshot.home.counts.known} known, ${input.snapshot.home.counts.learning} learning, ${input.snapshot.home.counts.uncertain} uncertain, and ${input.snapshot.home.counts.changed} changed items.`,
    itemRefs: [
      ...take(input.snapshot.home.known, 1),
      ...take(input.snapshot.home.learning, 1),
      ...take(input.snapshot.home.uncertain, 1),
      ...take(input.snapshot.home.changed, 1),
    ].map(item => item.id),
    suggestedActions: ["view_evidence"],
  };
}
