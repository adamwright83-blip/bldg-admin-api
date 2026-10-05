import { createHash, randomUUID } from "node:crypto";
import {
  CYCLE_TRANSITIONS,
  type AdamApprovalReceipt,
  type Candidate,
  type Cycle,
  type CycleStatus,
  type EvidenceItem,
  type Mission,
} from "../../../shared/presidentCycle";
import type { CycleStore } from "./cycleStore";
import { getForTenant } from "./cycleStore";

/** Seat boundary: evidence may never originate from, or point into, a peer seat's state. */
const FOREIGN_SEAT = /mitch/i;

export function assertNoForeignSeatEvidence(items: EvidenceItem[]) {
  for (const e of items) {
    if (FOREIGN_SEAT.test(e.source) || FOREIGN_SEAT.test(e.ref) || FOREIGN_SEAT.test(e.kind))
      throw new Error(
        `Evidence ${e.id} derives from a peer seat's state and cannot be company truth`
      );
  }
}

export function canonicalDigest(value: unknown): string {
  const sort = (v: any): any =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])]))
        : v;
  return createHash("sha256").update(JSON.stringify(sort(value))).digest("hex");
}

export function setStatus(cycle: Cycle, to: CycleStatus, note: string) {
  if (cycle.status !== to && !CYCLE_TRANSITIONS[cycle.status].includes(to))
    throw new Error(`Illegal cycle transition ${cycle.status} -> ${to}`);
  cycle.statusLog.push({
    at: new Date().toISOString(),
    from: cycle.status,
    to,
    note,
  });
  cycle.status = to;
}

export async function createCycle(
  store: CycleStore,
  input: { tenantId: string; evidence: EvidenceItem[]; cycleId?: string }
): Promise<Cycle> {
  if (!input.tenantId) throw new Error("tenantId required");
  assertNoForeignSeatEvidence(input.evidence);
  if (input.evidence.length === 0)
    throw new Error("A cycle needs real evidence; President does not invent signals");
  const now = new Date().toISOString();
  const cycle: Cycle = {
    cycleId: input.cycleId ?? `cyc_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    tenantId: input.tenantId,
    version: 1,
    status: "GATHERING_EVIDENCE",
    startedAt: now,
    evidence: input.evidence,
    rounds: [],
    deliberationIsFixture: false,
    firstRoundCandidates: [],
    finalCandidates: [],
    presidentProposedIds: [],
    presidentRationale: "",
    approval: null,
    statusLog: [{ at: now, from: null, to: "GATHERING_EVIDENCE", note: "created" }],
    notifications: [],
    missions: [],
    morningReport: null,
    blockedReason: null,
  };
  await store.create(cycle);
  return cycle;
}

/** PRESIDENT_RECOMMENDED -> AWAITING_ADAM_REVIEW, notifying Adam. Never "started working". */
export interface NotificationPort {
  notify(n: { title: string; message: string; link: string }): Promise<void>;
}

export async function pickPresidentThree(final: Candidate[]): Promise<{
  ids: string[];
  rationale: string;
}> {
  const top = [...final].sort((a, b) => a.rank - b.rank).slice(0, 3);
  return {
    ids: top.map(c => c.candidateId),
    rationale: top
      .map(
        c =>
          `#${c.rank} ${c.title}: ${c.whyNow} (risk: ${c.risk}; response to critique: ${c.responseToClaude ?? "n/a"})`
      )
      .join("\n"),
  };
}

export async function presentToAdam(
  store: CycleStore,
  cycleId: string,
  notifier: NotificationPort,
  reviewBaseUrl: string
) {
  const link = `${reviewBaseUrl.replace(/\/$/, "")}/president?cycle=${encodeURIComponent(cycleId)}`;
  const message = "President has 3 recommendations ready for your review.";

  // Enter the review state before external notification, but do not record a
  // delivered notification until the notification service actually accepts it.
  await store.update(cycleId, c => {
    if (c.status === "PRESIDENT_RECOMMENDED") {
      setStatus(c, "AWAITING_ADAM_REVIEW", "recommendations ready for Adam");
      return;
    }
    if (c.status !== "AWAITING_ADAM_REVIEW")
      throw new Error(`Cannot present from ${c.status}`);
  });

  const before = await store.get(cycleId);
  if (before?.notifications.some(n => n.channel === "owner" && n.link === link))
    return;

  await notifier.notify({ title: "President: review ready", message, link });
  await store.update(cycleId, c => {
    if (c.status !== "AWAITING_ADAM_REVIEW")
      throw new Error("Cycle left Adam review state before notification receipt");
    if (!c.notifications.some(n => n.channel === "owner" && n.link === link))
      c.notifications.push({
        at: new Date().toISOString(),
        channel: "owner",
        message,
        link,
      });
  });
}

export type AdamIdentity = AdamApprovalReceipt["approvedBy"];

/**
 * The only writer of ADAM_APPROVED. `approvedBy` must come from the authenticated
 * app session. A model-generated sentence cannot call this path (the HTTP layer
 * is the only caller and it derives identity from the session).
 */
export async function approveFinalSet(
  store: CycleStore,
  input: {
    tenantId: string;
    cycleId: string;
    approvedCandidateIds: string[];
    approvedBy: AdamIdentity;
  }
): Promise<AdamApprovalReceipt> {
  const { approvedBy } = input;
  if (!approvedBy?.identity || !approvedBy.mechanism || !approvedBy.sessionRef)
    throw new Error("Approval requires authority identity, mechanism and session ref");
  const existing = await getForTenant(store, input.tenantId, input.cycleId);
  if (!existing) throw new Error("Unknown cycle");
  return store.update(input.cycleId, c => {
    if (c.tenantId !== input.tenantId) throw new Error("Unknown cycle");
    if (c.status !== "AWAITING_ADAM_REVIEW")
      throw new Error(`Approval requires AWAITING_ADAM_REVIEW, cycle is ${c.status}`);
    const ids = input.approvedCandidateIds;
    if (ids.length < 1 || ids.length > 3) throw new Error("Approve between 1 and 3 candidates");
    if (new Set(ids).size !== ids.length) throw new Error("Duplicate candidate ids");
    const known = new Set(c.finalCandidates.map(x => x.candidateId));
    for (const id of ids)
      if (!known.has(id)) throw new Error(`Candidate ${id} is not in the final ranked set`);
    const proposed = c.presidentProposedIds;
    const removed = proposed.filter(p => !ids.includes(p));
    const added = ids.filter(i => !proposed.includes(i));
    const approvedAt = new Date().toISOString();
    const base = {
      cycleId: c.cycleId,
      approvedCandidateIds: ids,
      presidentProposedIds: [...proposed],
      substitutions: removed
        .slice(0, added.length)
        .map((r, i) => ({ removed: r, added: added[i] })),
      rejectedCandidateIds: removed,
      approvedAt,
      approvedBy,
    };
    const receipt: AdamApprovalReceipt = {
      receiptId: `rcpt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      ...base,
      digest: canonicalDigest(base),
    };
    c.approval = receipt;
    setStatus(c, "ADAM_APPROVED", `approved by ${approvedBy.identity}`);
    return receipt;
  });
}

export async function declineAll(
  store: CycleStore,
  tenantId: string,
  cycleId: string,
  approvedBy: AdamIdentity
) {
  await store.update(cycleId, c => {
    if (c.tenantId !== tenantId) throw new Error("Unknown cycle");
    setStatus(c, "NO_APPROVAL", `declined by ${approvedBy.identity}`);
  });
}

export function verifyReceipt(r: AdamApprovalReceipt): boolean {
  const { receiptId: _r, digest, ...base } = r;
  return digest === canonicalDigest(base);
}

export type MissionPolicy = {
  defaultCommands: Partial<Record<string, string[]>>;
  maxAttempts: number;
};

/** Creates missions ONLY for candidates in the verified Adam receipt. Idempotent. */
export async function createApprovedMissions(
  store: CycleStore,
  cycleId: string,
  policy: MissionPolicy
): Promise<Mission[]> {
  return store.update(cycleId, c => {
    if (c.missions.length) return c.missions; // duplicate event => no duplicate missions
    if (c.status !== "ADAM_APPROVED" || !c.approval)
      throw new Error("Missions require a durable ADAM_APPROVED receipt");
    if (!verifyReceipt(c.approval)) throw new Error("Approval receipt failed verification");
    const byId = new Map(c.finalCandidates.map(x => [x.candidateId, x]));
    const now = new Date().toISOString();
    const missions: Mission[] = c.approval.approvedCandidateIds.map(id => {
      const cand = byId.get(id)!;
      const engineering = cand.executionDomain === "ENGINEERING";
      const mission: Mission = {
        missionId: `mis_${canonicalDigest({ c: c.cycleId, id }).slice(0, 16)}`,
        cycleId: c.cycleId,
        candidateId: id,
        tenantId: c.tenantId,
        title: cand.title,
        objective: cand.proposedChange,
        businessReason: cand.problem,
        evidenceRefs: cand.evidenceRefs,
        acceptanceCriteria: cand.acceptanceCriteria,
        domain: cand.executionDomain,
        scope: cand.scope,
        constraints: [
          "Work only within the approved scope",
          "Never merge to main",
          "No unrelated refactoring",
        ],
        expectedArtifact: engineering ? "Pull request" : "Written artifact",
        approvedBy: c.approval!.approvedBy,
        approvalReceiptId: c.approval!.receiptId,
        approvedAt: c.approval!.approvedAt,
        riskClass: /high/i.test(cand.risk) ? "HIGH" : /low/i.test(cand.risk) ? "LOW" : "MEDIUM",
        requiredValidation: {
          commands: cand.validationCommands.length
            ? cand.validationCommands
            : (policy.defaultCommands[cand.executionDomain] ?? []),
          browser: cand.browserCheck,
        },
        humanGate: engineering ? "MERGE_REQUIRED" : "NONE",
        dependsOn: [],
        executorActorId: null,
        reviewerActorId: null,
        attempt: 0,
        maxAttempts: policy.maxAttempts,
        status: "ADAM_APPROVED",
        blocker: null,
        lease: null,
        transitions: [],
        receipts: [],
        handback: null,
      };
      return mission;
    });
    // Dependencies: only among approved candidates; text dependencies stay advisory.
    const idToMission = new Map(missions.map(m => [m.candidateId, m.missionId]));
    for (const m of missions)
      m.dependsOn = (byId.get(m.candidateId)!.dependencies ?? [])
        .map(d => idToMission.get(d))
        .filter((x): x is string => !!x && x !== m.missionId);
    c.missions = missions;
    setStatus(c, "EXECUTING", `${missions.length} missions created from receipt ${c.approval.receiptId}`);
    return missions;
  });
}
