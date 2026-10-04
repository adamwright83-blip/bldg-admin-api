import { timingSafeEqual } from "node:crypto";

export type MitchAgentWakeKind =
  | "implementation_request"
  | "design_review_request"
  | "retest_request";

export type MitchAgentWake = {
  wakeId: string;
  actorId: string;
  kind: MitchAgentWakeKind;
  tenantId: string;
  gameId: string;
  milestoneId: string;
  workOrderId: string;
  buildId?: string | null;
  issueCommentUrl?: string | null;
};

export interface IMitchAgentWakeProvider {
  hasTarget(actorId: string): boolean;
  wake(input: MitchAgentWake): Promise<void>;
}

export type MitchAgentWakeTarget = {
  url: string;
  token: string;
};

export class HttpMitchAgentWakeProvider implements IMitchAgentWakeProvider {
  constructor(private readonly targets: Record<string, MitchAgentWakeTarget>) {
    const entries = Object.entries(targets);
    if (!entries.length) throw new Error("Mitch agent wake targets are required");
    for (const [actorId, target] of entries) {
      if (!actorId.trim() || !target?.url || !target?.token)
        throw new Error("Each Mitch wake target requires actorId, url, and token");
      new URL(target.url);
    }
  }

  hasTarget(actorId: string): boolean {
    return Boolean(this.targets[actorId]);
  }

  async wake(input: MitchAgentWake): Promise<void> {
    const target = this.targets[input.actorId];
    if (!target) throw new Error(`No outbound wake target configured for actor "${input.actorId}"`);
    const response = await fetch(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${target.token}`,
        "x-mitch-wake-id": input.wakeId,
      },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Mitch could not wake actor "${input.actorId}" (${response.status}): ${body.slice(0, 400)}`
      );
    }
  }
}

/** Constant-time helper used by actor-scoped callback credentials. */
export function secureTokenEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
