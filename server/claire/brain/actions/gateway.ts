/**
 * Action gateway. Execute grants. Do not interpret speech.
 * Live mutations are impossible while Brain V2 has no production authority.
 */

import type { ExecutiveActionGrant } from "../contracts/grants";
import { isExecutiveActionGrant } from "../executive/grants";

export class ActionGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionGatewayError";
  }
}

export type ActionGatewayResult = {
  executed: false;
  reason: string;
};

export async function executeGrantedAction(grant: unknown): Promise<ActionGatewayResult> {
  if (!isExecutiveActionGrant(grant)) {
    throw new ActionGatewayError("bypass Executive Function: action mutation requires a branded ExecutiveActionGrant");
  }
  const typed: ExecutiveActionGrant = grant;
  if (!typed.constraints.shadowOnly || typed.constraints.mutationAllowed) {
    throw new ActionGatewayError("Brain V2 action gateway refuses live mutations until authorized cutover");
  }
  return { executed: false, reason: "shadow_only" };
}
