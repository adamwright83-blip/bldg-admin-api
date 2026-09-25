/**
 * Brain V2 action gateway.
 *
 * The executive grants authority. The gateway executes that grant through an
 * injected production adapter; it never interprets speech and never invents
 * scope. Shadow grants remain inert.
 */

import type { ExecutiveActionGrant } from "../contracts/grants";
import { isExecutiveActionGrant } from "../executive/grants";

export class ActionGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionGatewayError";
  }
}

export type LiveActionExecutor<T = unknown> = (
  grant: ExecutiveActionGrant
) => Promise<T>;

export type ActionGatewayResult<T = unknown> =
  | {
      executed: false;
      reason: "shadow_only";
    }
  | {
      executed: true;
      actionClass: ExecutiveActionGrant["actionClass"];
      result: T;
    };

export async function executeGrantedAction<T = unknown>(
  grant: unknown,
  options: {
    execute?: LiveActionExecutor<T>;
  } = {}
): Promise<ActionGatewayResult<T>> {
  if (!isExecutiveActionGrant(grant)) {
    throw new ActionGatewayError(
      "bypass Executive Function: action mutation requires a branded ExecutiveActionGrant"
    );
  }

  const typed: ExecutiveActionGrant = grant;

  if (typed.constraints.shadowOnly) {
    if (typed.constraints.mutationAllowed) {
      throw new ActionGatewayError("shadow grant may not carry mutation authority");
    }
    return { executed: false, reason: "shadow_only" };
  }

  if (!typed.constraints.mutationAllowed) {
    throw new ActionGatewayError("live grant is missing mutation authority");
  }

  if (!options.execute) {
    throw new ActionGatewayError(
      "Action Gateway refuses live mutations without an injected production executor"
    );
  }

  return {
    executed: true,
    actionClass: typed.actionClass,
    result: await options.execute(typed),
  };
}
