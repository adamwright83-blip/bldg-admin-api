export type DayDirectorCommitment = {
  id: string;
  businessDate: string;
  title: string;
  kind: "growth" | "prep" | "operations";
  quantity: number | null;
  provenance: "user_reported" | "manual";
  status: "open" | "completed";
  completedAt: string | null;
  detailState?: "COMPLETE" | "NEEDS_DETAILS";
  missingDetails?: string[];
  detailNote?: string | null;
  claireProactive?: boolean;
  proactiveSourceKind?: "sales_follow_up" | "dormant_recovery";
  accountProvenance?: {
    name?: string | null;
    accountType?: string | null;
    providerName?: string | null;
    identityKey?: string | null;
  } | null;
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
  detailState?: "COMPLETE" | "NEEDS_DETAILS";
  missingDetails?: string[];
  detailNote?: string | null;
};

export type ProcessingLocation = {
  name: string;
  locality: string | null;
  address: string | null;
};
