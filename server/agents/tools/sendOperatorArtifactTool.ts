import type { OperatorArtifact } from "../../operatorArtifact/sendOperatorArtifact";
import { applyOperatorArtifactDecision } from "../../claire/operatorArtifactDecision";
import type { AgentTool } from "../toolRegistry";

const CALLER_DESTINATION_FIELDS = [
  "to",
  "destination",
  "recipient",
  "phone",
  "operatorPhone",
  "recipientPhone",
  "destinationPhone",
  "mediaUrl",
  "mediaUrls",
  "media",
  "mms",
  "whatsapp",
  "persistentAction",
] as const;

/**
 * Operator-voice seam for sendOperatorArtifact. Resident S2S does not
 * allowlist this name. The phone number comes from the authorized operator
 * binding, not from the tool input.
 */
export const sendOperatorArtifactTool: AgentTool<Record<string, unknown>> = {
  name: "sendOperatorArtifactTool",
  description:
    "Send an artifact by SMS to the authorized operator. The caller does not choose the destination number.",
  async execute(input, ctx) {
    const raw = input ?? {};
    const decision = {
      action: "send_operator_artifact" as const,
      tenantId: ctx.tenantId,
      operatorUserId: ctx.actorId ?? "",
      artifact: raw.artifact as OperatorArtifact,
    };
    for (const key of CALLER_DESTINATION_FIELDS) {
      if (key in raw) {
        (decision as Record<string, unknown>)[key] = raw[key];
      }
    }
    const applied = await applyOperatorArtifactDecision(decision);
    if (!applied.applied) {
      return { entityType: "operator_artifact", entityId: null, output: applied };
    }
    return {
      entityType: "operator_artifact",
      entityId: applied.result.messageSid,
      output: applied.result,
    };
  },
};
