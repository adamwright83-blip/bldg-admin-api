import { CALL_SESSION_GROUPING_RULE } from "@shared/communicationsAnalytics";
import type { TwilioCommunicationReceipt } from "@shared/twilioPlatform";
import type { ClaireSessionLinkRecord, CommunicationContextLinkRecord } from "./records";

export { CALL_SESSION_GROUPING_RULE };

function walkRoot(
  callSid: string,
  parentBySid: Map<string, string>
): string {
  const seen = new Set<string>();
  let current = callSid;
  while (parentBySid.has(current) && !seen.has(current)) {
    seen.add(current);
    current = parentBySid.get(current)!;
  }
  return current;
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    this.add(id);
    const current = this.parent.get(id)!;
    if (current === id) return id;
    const root = this.find(current);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  groups(): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      const list = grouped.get(root) ?? [];
      list.push(id);
      grouped.set(root, list);
    }
    return grouped;
  }
}

export function parentPointerMap(
  receipts: readonly TwilioCommunicationReceipt[]
): Map<string, string> {
  const parentBySid = new Map<string, string>();
  for (const receipt of receipts) {
    const callSid = receipt.callSid?.trim() ?? "";
    const parentCallSid = receipt.parentCallSid?.trim() ?? "";
    if (!callSid || !parentCallSid || parentCallSid === callSid) continue;
    parentBySid.set(callSid, parentCallSid);
  }
  return parentBySid;
}

export function claireConversationIdByCallSid(input: {
  sessions: readonly ClaireSessionLinkRecord[];
  contextLinks: readonly CommunicationContextLinkRecord[];
}): Map<string, string> {
  const bySid = new Map<string, string>();
  for (const session of input.sessions) {
    const sid = session.providerCallSid?.trim() ?? "";
    const conversationId = session.claireConversationId.trim();
    if (sid && conversationId) bySid.set(sid, conversationId);
  }
  for (const link of input.contextLinks) {
    if (link.source !== "claire_session_link") continue;
    if (link.goldlineEntityKind !== "conversation") continue;
    const sid = link.providerResourceSid.trim();
    const conversationId = link.goldlineEntityId?.trim() ?? "";
    if (sid && conversationId && !bySid.has(sid)) bySid.set(sid, conversationId);
  }
  return bySid;
}

export type CallSessionGroup = {
  callSessionKey: string;
  callSids: string[];
  rootCallSid: string;
  claireConversationId: string | null;
  collapsedLegCount: number;
};

/**
 * Collapse parent+child CallSids that are the same Goldline communication
 * session. Do not collapse independent calls. Projection only.
 */
export function groupCallSessions(input: {
  receipts: readonly TwilioCommunicationReceipt[];
  sessions: readonly ClaireSessionLinkRecord[];
  contextLinks: readonly CommunicationContextLinkRecord[];
}): CallSessionGroup[] {
  const uf = new UnionFind();
  const parentBySid = parentPointerMap(input.receipts);
  const conversationBySid = claireConversationIdByCallSid(input);

  for (const receipt of input.receipts) {
    const callSid = receipt.callSid?.trim() ?? "";
    if (!callSid) continue;
    uf.add(callSid);
    const parent = parentBySid.get(callSid);
    if (parent) {
      uf.add(parent);
      uf.union(callSid, parent);
    }
  }
  for (const sid of conversationBySid.keys()) uf.add(sid);

  const sidsByConversation = new Map<string, string[]>();
  for (const [sid, conversationId] of conversationBySid) {
    const list = sidsByConversation.get(conversationId) ?? [];
    list.push(sid);
    sidsByConversation.set(conversationId, list);
  }
  for (const sids of sidsByConversation.values()) {
    for (let i = 1; i < sids.length; i += 1) {
      uf.union(sids[0]!, sids[i]!);
    }
  }

  const groups: CallSessionGroup[] = [];
  for (const members of uf.groups().values()) {
    const callSids = [...new Set(members)].sort();
    const rootCallSid = walkRoot(callSids[0]!, parentBySid);
    const conversationId =
      callSids.map(sid => conversationBySid.get(sid) ?? null).find(Boolean) ??
      null;
    const callSessionKey = conversationId
      ? `claire:${conversationId}`
      : `call:${walkRoot(rootCallSid, parentBySid)}`;
    groups.push({
      callSessionKey,
      callSids,
      rootCallSid: walkRoot(rootCallSid, parentBySid),
      claireConversationId: conversationId,
      collapsedLegCount: Math.max(0, callSids.length - 1),
    });
  }
  return groups.sort((a, b) => a.callSessionKey.localeCompare(b.callSessionKey));
}
