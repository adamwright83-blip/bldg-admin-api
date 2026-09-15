import {
  ENGINEERING_TERMINAL_STATUSES,
  type EngineeringTerminalStatus,
} from "../../../shared/goldlineCapabilities";

const OPENAI_AGENTS_BETA = "agents=v1";

export type CapabilityEngineeringConfig = {
  apiKey: string;
  agentId: string;
  environmentTemplateId: string;
};

export function capabilityEngineeringConfig(
  env: NodeJS.ProcessEnv = process.env
): CapabilityEngineeringConfig | { missing: string[] } {
  const missing: string[] = [];
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const agentId = env.OPENAI_CAPABILITY_AGENT_ID?.trim() ?? "";
  const environmentTemplateId = env.OPENAI_CAPABILITY_ENV_TEMPLATE_ID?.trim() ?? "";
  if (!apiKey) missing.push("OPENAI_API_KEY");
  if (!agentId) missing.push("OPENAI_CAPABILITY_AGENT_ID");
  if (!environmentTemplateId) missing.push("OPENAI_CAPABILITY_ENV_TEMPLATE_ID");
  if (missing.length) return { missing };
  return { apiKey, agentId, environmentTemplateId };
}

export type EngineeringTerminalResult = {
  status: EngineeringTerminalStatus;
  capability: string | null;
  summary: string;
  tests: string | null;
  branch: string | null;
  pr_url: string | null;
  blocker: string | null;
  requires_human_approval: boolean;
};

const PROGRESS_BLOCKER_RE =
  /\b(workspace starting|waiting for repository|inspecting code|provisioning|cloning)\b/i;

export function isProgressEngineeringEvent(payload: unknown): boolean {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const status = String(record.status ?? record.state ?? "");
  const summary = String(record.summary ?? record.message ?? record.blocker ?? "");
  if (status === "BLOCKED" && PROGRESS_BLOCKER_RE.test(summary)) return true;
  const type = String(record.type ?? "");
  return (
    type.includes("progress") ||
    type.includes("environment") ||
    /agent\.session\.(created|updated|environment)/.test(type)
  );
}

export function parseEngineeringTerminalResult(payload: unknown): EngineeringTerminalResult | null {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const nested =
    record.result && typeof record.result === "object"
      ? (record.result as Record<string, unknown>)
      : record.output && typeof record.output === "object"
        ? (record.output as Record<string, unknown>)
        : record;
  const status = String(nested.status ?? "");
  if (!ENGINEERING_TERMINAL_STATUSES.includes(status as EngineeringTerminalStatus)) {
    return null;
  }
  if (status === "BLOCKED" && isProgressEngineeringEvent(nested)) return null;
  return {
    status: status as EngineeringTerminalStatus,
    capability: typeof nested.capability === "string" ? nested.capability : null,
    summary: typeof nested.summary === "string" ? nested.summary : "",
    tests: typeof nested.tests === "string" ? nested.tests : nested.tests != null ? String(nested.tests) : null,
    branch: typeof nested.branch === "string" ? nested.branch : null,
    pr_url:
      typeof nested.pr_url === "string"
        ? nested.pr_url
        : typeof nested.prUrl === "string"
          ? nested.prUrl
          : null,
    blocker: typeof nested.blocker === "string" ? nested.blocker : null,
    requires_human_approval: nested.requires_human_approval === true || nested.requiresHumanApproval === true,
  };
}

export function parseAgentSse(text: string): unknown[] {
  const events: unknown[] = [];
  for (const block of text.split(/\n\n+/)) {
    const dataLines = block
      .split("\n")
      .filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trim())
      .filter(line => line && line !== "[DONE]");
    if (!dataLines.length) continue;
    const raw = dataLines.join("");
    try {
      events.push(JSON.parse(raw));
    } catch {
      events.push({ type: "unparsed", raw });
    }
  }
  return events;
}

export function extractTerminalFromAgentEvents(events: unknown[]): EngineeringTerminalResult | null {
  let found: EngineeringTerminalResult | null = null;
  for (const event of events) {
    const record = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
    if (isProgressEngineeringEvent(record)) continue;
    const candidates = [record, record.output, record.item, record.result, record.data];
    for (const candidate of candidates) {
      const parsed = parseEngineeringTerminalResult(candidate);
      if (parsed) found = parsed;
    }
  }
  return found;
}

async function openaiAgentsFetch(input: {
  apiKey: string;
  path: string;
  method?: string;
  body?: unknown;
  stream?: boolean;
}): Promise<Response> {
  const response = await fetch(`https://api.openai.com/v1/agents/${input.path}`, {
    method: input.method ?? "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": OPENAI_AGENTS_BETA,
    },
    body: input.body == null ? undefined : JSON.stringify(input.body),
  });
  return response;
}

export function isOpenAiAuthFailure(status: number, body: string): boolean {
  return (
    status === 401 ||
    status === 403 ||
    /invalid[_ ]api[_ ]key|expired|authentication/i.test(body)
  );
}

export async function createCapabilityBuilderSession(input: {
  config: CapabilityEngineeringConfig;
  prompt: string;
}): Promise<{ sessionId: string; events: unknown[]; body: string }> {
  const response = await openaiAgentsFetch({
    apiKey: input.config.apiKey,
    path: "sessions",
    body: {
      agent_id: input.config.agentId,
      environment: {
        type: "openai_hosted",
        environment_template_id: input.config.environmentTemplateId,
      },
      input: input.prompt,
      stream: true,
    },
    stream: true,
  });
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`OpenAI Agents API session create failed (${response.status})`);
    (error as Error & { status: number; body: string; authFailure: boolean }).status = response.status;
    (error as Error & { status: number; body: string; authFailure: boolean }).body = body.slice(0, 500);
    (error as Error & { authFailure: boolean }).authFailure = isOpenAiAuthFailure(response.status, body);
    throw error;
  }
  const events = parseAgentSse(body);
  const created = events.find(event => {
    const record = event && typeof event === "object" ? (event as Record<string, unknown>) : {};
    return record.type === "agent.session.created" || typeof record.id === "string";
  }) as Record<string, unknown> | undefined;
  const session =
    created && typeof created === "object"
      ? ((created.session as Record<string, unknown> | undefined) ?? created)
      : {};
  const sessionId = String(session.id ?? created?.id ?? "");
  return { sessionId, events, body };
}

export async function continueCapabilityBuilderSession(input: {
  config: CapabilityEngineeringConfig;
  sessionId: string;
  prompt: string;
}): Promise<{ events: unknown[]; body: string }> {
  const response = await openaiAgentsFetch({
    apiKey: input.config.apiKey,
    path: `sessions/${encodeURIComponent(input.sessionId)}/events`,
    body: {
      events: [
        {
          type: "agent.session.input.message",
          input: [
            {
              role: "user",
              content: [{ type: "input_text", text: input.prompt }],
            },
          ],
        },
      ],
    },
  });
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`OpenAI Agents API continue failed (${response.status})`);
    (error as Error & { status: number; authFailure: boolean }).status = response.status;
    (error as Error & { authFailure: boolean }).authFailure = isOpenAiAuthFailure(response.status, body);
    throw error;
  }
  return { events: parseAgentSse(body), body };
}

export function buildCapabilityEngineeringPrompt(input: {
  capabilityKey: string;
  operatorRequest: string;
  expectedBehavior: string;
}): string {
  return [
    `CAPABILITY GAP: ${input.capabilityKey}`,
    `OPERATOR REQUEST: ${input.operatorRequest}`,
    `EXPECTED PRODUCT BEHAVIOR: ${input.expectedBehavior}`,
    "REPO: adamwright83-blip/bldg-admin-api",
    "CONSTRAINTS:",
    "Inspect current main.",
    "Reuse canonical Goldline services. Do not deploy. Do not merge.",
    "Stop for migration, security, or destructive-change approval.",
    "Do not receive or request production DB credentials, Railway deploy tokens, Stripe, Twilio, or customer secrets.",
    "Your GitHub token is scoped only to adamwright83-blip/bldg-admin-api.",
    "Return structured terminal output with status PR_READY | IMPLEMENTED_NO_PR | ALREADY_SUPPORTED | NEEDS_HUMAN | BLOCKED.",
  ].join("\n");
}
