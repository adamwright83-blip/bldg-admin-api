import {
  sendOperatorArtifact,
  type OperatorSmsPort,
  type SendOperatorArtifactInput,
  type SendOperatorArtifactResult,
} from "../operatorArtifact/sendOperatorArtifact";

/**
 * Claire decides, then this seam sends. A hold does not call Twilio.
 * The send still cannot carry a caller-supplied destination: that check
 * stays inside sendOperatorArtifact.
 */

export type OperatorArtifactDecision =
  | { action: "hold" }
  | ({ action: "send_operator_artifact" } & SendOperatorArtifactInput);

export type OperatorArtifactDecisionResult =
  | { applied: false; action: "hold" }
  | {
      applied: true;
      action: "send_operator_artifact";
      result: SendOperatorArtifactResult;
    };

export async function applyOperatorArtifactDecision(
  decision: OperatorArtifactDecision,
  options?: { port?: OperatorSmsPort; env?: NodeJS.ProcessEnv }
): Promise<OperatorArtifactDecisionResult> {
  if (decision.action === "hold") {
    return { applied: false, action: "hold" };
  }
  const { action: _action, ...input } = decision;
  const result = await sendOperatorArtifact(input, options);
  return { applied: true, action: "send_operator_artifact", result };
}
