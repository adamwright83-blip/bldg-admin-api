/**
 * Brain V2 action gateway.
 *
 * The executive grants authority. The gateway verifies the Brain-specific
 * brand, then delegates the final mutation fence to the domain-neutral action
 * execution gate shared with persistent background work.
 */

import {
  actionGrantSourceIsBackground,
  type ExecutiveActionGrant,
} from "../contracts/grants";
import { isExecutiveActionGrant } from "../executive/grants";
import {
  ActionExecutionGateError,
  executeAdmittedAction,
} from "../../../authority/actionExecutionGate";

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
  const background =
    typed.source && actionGrantSourceIsBackground(typed.source)
      ? typed.source
      : null;

  try {
    const execution = await executeAdmittedAction(
      {
        actionName: typed.actionClass,
        tenantId: typed.tenantId ?? null,
        canonicalOperatorId: typed.canonicalOperatorId ?? null,
        authorityBasis: typed.authorityBasis,
        source: background
          ? {
              kind: "background_grant",
              tenantId: background.tenantId,
              canonicalOperatorId: background.canonicalOperatorId,
            }
          : { kind: "conversation" },
        expiresAtMs: typed.expiresAtMs,
        constraints: typed.constraints,
      },
      {
        execute: options.execute
          ? () => options.execute!(typed)
          : undefined,
        executorRequiredMessage:
          "Action Gateway refuses live mutations: live Brain V2 action grant requires an injected production executor",
      }
    );

    if (!execution.executed) {
      return execution;
    }
    return {
      executed: true,
      actionClass: typed.actionClass,
      result: execution.result,
    };
  } catch (error) {
    if (error instanceof ActionExecutionGateError) {
      throw new ActionGatewayError(error.message);
    }
    throw error;
  }
}
