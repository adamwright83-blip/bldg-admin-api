import { productionConversationStore } from "../../claire/conversation/ledgerService";
import {
  capabilityIsActionable,
  getGoldlineCapability,
  type CapabilityGapRecord,
} from "../../../shared/goldlineCapabilities";
import {
  buildCapabilityEngineeringPrompt,
  capabilityEngineeringConfig,
  continueCapabilityBuilderSession,
  createCapabilityBuilderSession,
  extractTerminalFromAgentEvents,
  type EngineeringTerminalResult,
} from "./agentsClient";
import {
  findOpenCapabilityGap,
  getCapabilityGap,
  insertCapabilityGap,
  updateCapabilityGap,
} from "./capabilityGapStore";

const NOTIFICATION_KIND = {
  NEEDS_APPROVAL: "CAPABILITY_NEEDS_APPROVAL",
  READY: "CAPABILITY_READY_FOR_REVIEW",
  BLOCKED: "CAPABILITY_BLOCKED",
} as const;

export function speakUnsupportedCapability(input: {
  capabilityKey: string;
  itemTitle?: string | null;
}): string {
  const capability = getGoldlineCapability(input.capabilityKey);
  const known = input.itemTitle ? `I know which task you mean. ` : "";
  const label = capability?.description ?? input.capabilityKey;
  return `${known}I can add, update and complete Day Line items, but I can't do that yet: ${label.replace(/\.$/, "")}. Want me to send that to engineering?`;
}

export function speakEngineeringStatus(gap: CapabilityGapRecord): string {
  if (gap.status === "NEEDS_HUMAN") {
    return "Engineering found it needs a database change. It's waiting for your approval.";
  }
  if (gap.status === "PR_READY") {
    return "The PR is ready for review.";
  }
  if (gap.status === "BLOCKED") {
    return gap.blocker
      ? `Engineering is blocked: ${gap.blocker}`
      : "Engineering is blocked on something I can't fix from here.";
  }
  if (gap.status === "ENGINEERING_RUNNING" || gap.status === "APPROVED_FOR_ENGINEERING") {
    return "Engineering is still looking at it. I'll let you know when there's a result.";
  }
  if (gap.status === "ALREADY_SUPPORTED") {
    return "Engineering says that capability already exists — that's a wiring bug, not a missing product.";
  }
  return "I sent it to engineering. I'll let you know what they find.";
}

async function notifyOperator(input: {
  tenantId: string;
  operatorUserId: string;
  gapId: string;
  kind: string;
  title: string;
  body: string;
  ctaLabel: string;
}) {
  await productionConversationStore().insertNotification({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    sessionId: input.gapId,
    kind: input.kind,
    title: input.title,
    body: input.body.slice(0, 512),
    ctaLabel: input.ctaLabel,
    href: `/goldline/capability-gaps/${input.gapId}`,
  });
}

function applyTerminal(gapId: string, terminal: EngineeringTerminalResult) {
  const status =
    terminal.status === "NEEDS_HUMAN"
      ? "NEEDS_HUMAN"
      : terminal.status === "PR_READY"
        ? "PR_READY"
        : terminal.status === "ALREADY_SUPPORTED"
          ? "ALREADY_SUPPORTED"
          : terminal.status === "IMPLEMENTED_NO_PR"
            ? "PR_READY"
            : "BLOCKED";
  return updateCapabilityGap(gapId, {
    status,
    engineeringStatus: terminal.status,
    terminalResultJson: terminal as unknown as Record<string, unknown>,
    branch: terminal.branch,
    prUrl: terminal.pr_url,
    blocker: terminal.blocker,
    requiresHumanApproval: terminal.requires_human_approval || terminal.status === "NEEDS_HUMAN",
  });
}

export async function approveCapabilityEngineering(input: {
  tenantId: string;
  operatorUserId: string;
  capabilityKey: string;
  operatorRequest: string;
  conversationSessionId?: string | null;
  expectedBehavior?: string;
}): Promise<{ gap: CapabilityGapRecord | null; reused: boolean; unavailableReason: string | null; speak: string }> {
  if (capabilityIsActionable(input.capabilityKey)) {
    return {
      gap: null,
      reused: false,
      unavailableReason: null,
      speak: "That capability already exists, so I won't send it to engineering.",
    };
  }
  const existing = await findOpenCapabilityGap({
    tenantId: input.tenantId,
    capabilityKey: input.capabilityKey,
  });
  const inserted = existing
    ? existing
    : await insertCapabilityGap({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        capabilityKey: input.capabilityKey,
        operatorRequest: input.operatorRequest,
        conversationSessionId: input.conversationSessionId,
      });
  if ("unavailable" in inserted) {
    return {
      gap: null,
      reused: false,
      unavailableReason: inserted.reason,
      speak: "Sent. I'll let you know what engineering finds.",
    };
  }
  const gap = inserted;
  if (existing?.engineeringSessionId) {
    return {
      gap,
      reused: true,
      unavailableReason: null,
      speak: "Sent. I'll let you know what engineering finds.",
    };
  }
  const config = capabilityEngineeringConfig();
  if ("missing" in config) {
    await updateCapabilityGap(gap.id, {
      status: "BLOCKED",
      engineeringStatus: "BLOCKED",
      blocker: `Missing server env: ${config.missing.join(", ")}`,
      requiresHumanApproval: true,
    });
    await notifyOperator({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      gapId: gap.id,
      kind: NOTIFICATION_KIND.BLOCKED,
      title: "CAPABILITY BLOCKED",
      body: `Engineering cannot start until ${config.missing.join(", ")} is configured.`,
      ctaLabel: "VIEW ENGINEERING REQUEST",
    });
    return { gap, reused: false, unavailableReason: null, speak: "Sent. I'll let you know what engineering finds." };
  }
  await updateCapabilityGap(gap.id, {
    status: "ENGINEERING_RUNNING",
    engineeringStatus: "RUNNING",
  });
  try {
    const started = await createCapabilityBuilderSession({
      config,
      prompt: buildCapabilityEngineeringPrompt({
        capabilityKey: input.capabilityKey,
        operatorRequest: input.operatorRequest,
        expectedBehavior:
          input.expectedBehavior ??
          getGoldlineCapability(input.capabilityKey)?.description ??
          input.capabilityKey,
      }),
    });
    await updateCapabilityGap(gap.id, {
      engineeringSessionId: started.sessionId || null,
    });
    const terminal = extractTerminalFromAgentEvents(started.events);
    if (terminal) {
      const updated = await applyTerminal(gap.id, terminal);
      if (updated) await notifyForTerminal(updated, terminal);
    }
  } catch (error) {
    const authFailure = Boolean((error as { authFailure?: boolean }).authFailure);
    await updateCapabilityGap(gap.id, {
      status: authFailure ? "IDENTIFIED" : "BLOCKED",
      engineeringStatus: authFailure ? "RETRYABLE_AUTH" : "BLOCKED",
      blocker: authFailure
        ? "OpenAI authentication failed. Request preserved for retry."
        : error instanceof Error
          ? error.message.slice(0, 500)
          : "Engineering invocation failed",
      requiresHumanApproval: true,
    });
    await notifyOperator({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      gapId: gap.id,
      kind: NOTIFICATION_KIND.BLOCKED,
      title: "CAPABILITY BLOCKED",
      body: authFailure
        ? "OpenAI key failed. The request was kept so we can retry."
        : "Engineering could not start.",
      ctaLabel: "VIEW ENGINEERING REQUEST",
    });
  }
  return { gap, reused: Boolean(existing), unavailableReason: null, speak: "Sent. I'll let you know what engineering finds." };
}

async function notifyForTerminal(gap: CapabilityGapRecord, terminal: EngineeringTerminalResult) {
  if (terminal.status === "NEEDS_HUMAN") {
    await notifyOperator({
      tenantId: gap.tenantId,
      operatorUserId: gap.operatorUserId,
      gapId: gap.id,
      kind: NOTIFICATION_KIND.NEEDS_APPROVAL,
      title: "CAPABILITY NEEDS APPROVAL",
      body: `${getGoldlineCapability(gap.capabilityKey)?.description ?? gap.capabilityKey}. ${terminal.summary || terminal.blocker || "Engineering needs your approval to continue."}`.slice(0, 512),
      ctaLabel: "VIEW ENGINEERING REQUEST",
    });
    return;
  }
  if (terminal.status === "PR_READY" || terminal.status === "IMPLEMENTED_NO_PR") {
    await notifyOperator({
      tenantId: gap.tenantId,
      operatorUserId: gap.operatorUserId,
      gapId: gap.id,
      kind: NOTIFICATION_KIND.READY,
      title: "CAPABILITY READY FOR REVIEW",
      body: `${terminal.summary || "Engineering prepared the capability."}${terminal.tests ? ` ${terminal.tests}` : ""}`.slice(0, 512),
      ctaLabel: "VIEW CHANGES",
    });
    return;
  }
  if (terminal.status === "BLOCKED") {
    await notifyOperator({
      tenantId: gap.tenantId,
      operatorUserId: gap.operatorUserId,
      gapId: gap.id,
      kind: NOTIFICATION_KIND.BLOCKED,
      title: "CAPABILITY BLOCKED",
      body: (terminal.blocker || "Engineering is blocked.").slice(0, 512),
      ctaLabel: "VIEW ENGINEERING REQUEST",
    });
  }
}

export async function continueCapabilityEngineering(input: {
  tenantId: string;
  operatorUserId: string;
  gapId: string;
  approve: boolean;
}): Promise<CapabilityGapRecord | null> {
  const gap = await getCapabilityGap({
    tenantId: input.tenantId,
    id: input.gapId,
    operatorUserId: input.operatorUserId,
  });
  if (!gap) return null;
  if (!input.approve) {
    return updateCapabilityGap(gap.id, { status: "CLOSED", blocker: "Operator declined continuation" });
  }
  if (!gap.engineeringSessionId) {
    return gap;
  }
  const config = capabilityEngineeringConfig();
  if ("missing" in config) return gap;
  await updateCapabilityGap(gap.id, {
    status: "ENGINEERING_RUNNING",
    engineeringStatus: "RUNNING",
  });
  const continued = await continueCapabilityBuilderSession({
    config,
    sessionId: gap.engineeringSessionId,
    prompt:
      "Human approval granted to prepare the additive migration and implementation. You may create migration/code/tests and open a PR. Do not apply the migration to production. Do not merge or deploy.",
  });
  const terminal = extractTerminalFromAgentEvents(continued.events);
  if (!terminal) return getCapabilityGap({ tenantId: input.tenantId, id: gap.id });
  const updated = await applyTerminal(gap.id, terminal);
  if (updated) await notifyForTerminal(updated, terminal);
  return updated;
}

export async function loadCapabilityGapForOperator(input: {
  tenantId: string;
  operatorUserId: string;
  id: string;
  isAdmin?: boolean;
}): Promise<CapabilityGapRecord | null> {
  return getCapabilityGap({
    tenantId: input.tenantId,
    id: input.id,
    operatorUserId: input.isAdmin ? undefined : input.operatorUserId,
  });
}
