import type { CustomerChurnScore } from "./scoreCustomerChurn";

export type WinBackDraftInput = {
  score: CustomerChurnScore;
  storeName: string;
  senderName: string;
  lastServiceLabel?: string | null;
  unresolvedIssueSummary?: string | null;
  schedulingLink?: string | null;
};

export type WinBackDraft = {
  channel: "sms";
  message: string;
  internalNote: string;
  requiresHumanApproval: true;
  factsUsed: string[];
};

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

function trimSms(text: string): string {
  if (text.length <= 320) return text;
  return `${text.slice(0, 317).trimEnd()}…`;
}

export function buildWinBackDraft(input: WinBackDraftInput): WinBackDraft {
  const factsUsed = [
    `${input.score.daysSinceLastOrder} days since last order`,
    `normal cadence about ${input.score.expectedCadenceDays} days`,
  ];

  const servicePhrase = input.lastServiceLabel?.trim()
    ? ` after your last ${input.lastServiceLabel.trim()} order`
    : "";
  if (input.lastServiceLabel?.trim()) {
    factsUsed.push(`last service: ${input.lastServiceLabel.trim()}`);
  }

  let issueSentence = "";
  if (input.unresolvedIssueSummary?.trim()) {
    issueSentence = ` I also want to make sure we resolved ${input.unresolvedIssueSummary.trim()}.`;
    factsUsed.push(`unresolved issue: ${input.unresolvedIssueSummary.trim()}`);
  }

  const nextStep = input.schedulingLink?.trim()
    ? ` You can schedule here: ${input.schedulingLink.trim()}`
    : " Would you like me to help schedule the next pickup?";

  const message = trimSms(
    `${firstName(input.score.customerName)}, this is ${input.senderName} from ${input.storeName}. I noticed it has been ${input.score.daysSinceLastOrder} days since your last order${servicePhrase}.${issueSentence}${nextStep}`
  );

  return {
    channel: "sms",
    message,
    internalNote:
      input.score.grade === "high"
        ? "High-value lapse. Review the message, confirm any service issue, then send personally."
        : "Review for accuracy before sending. Do not add an unsupported discount.",
    requiresHumanApproval: true,
    factsUsed,
  };
}
