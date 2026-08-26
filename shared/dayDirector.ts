export type DayDirectorCommitment = {
  id: string;
  businessDate: string;
  title: string;
  kind: "growth" | "prep" | "operations";
  quantity: number | null;
  provenance: "user_reported" | "manual";
  status: "open" | "completed";
  completedAt: string | null;
};

export type DayDirectorProposal = {
  promptKey: string;
  title: string;
  kind: "growth" | "prep" | "operations";
  quantity: number | null;
  sourceText: string;
  prerequisites: string[];
  question: string | null;
  intelligence: "anthropic" | "manual_fallback";
};

export type ProcessingLocation = {
  name: string;
  locality: string | null;
  address: string | null;
};
