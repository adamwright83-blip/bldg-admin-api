import type {
  SourceConnectorComplianceInput,
  SourceConnectorKey,
} from "./sourceConnectorCompliancePolicy";

export type SourceConnectorRunStatus =
  | "blocked"
  | "needs_configuration"
  | "needs_legal_review";

export type SourceConnectorCandidate = {
  sourceReference: string;
  businessName: string;
  evidence: Readonly<Record<string, unknown>>;
};

export type SourceConnectorRunInput = {
  query: string;
  configurationPresent: boolean;
  compliance: SourceConnectorComplianceInput;
};

export type SourceConnectorRunResult = {
  sourceKey: SourceConnectorKey;
  status: SourceConnectorRunStatus;
  candidates: readonly SourceConnectorCandidate[];
  reasons: readonly string[];
  externalCallPerformed: false;
};

export interface SourceConnectorAdapter {
  readonly sourceKey: SourceConnectorKey;
  readonly enabled: false;
  run(input: SourceConnectorRunInput): Promise<SourceConnectorRunResult>;
}
