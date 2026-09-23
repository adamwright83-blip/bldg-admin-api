import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ClaireDriveContext } from "../claire/contextAssembler";
import {
  claireRookContactResidueSection,
  type ClaireRookContactResidueContext,
} from "../claire/rookContactResidueContext";
import { runClaireTurn } from "../claire/turn/claireTurn";
import {
  findServerAuthoritativeWaywardContactProof,
  recordIsolatedPreviewRookContactGrant,
  rookContactGrantAllowsExecution,
  rookContactGrantIsProductionAuthority,
} from "../goldlineProgression/rookContactAuthority";
import { evaluateProductionEligibility } from "../narratorOs/eligibility";
import { createInMemoryNarratorStore } from "../narratorOs/memoryStore";
import { narrativeMemoryView } from "../narratorOs/narrativeReadModels";
import {
  ROOK_CONTACT_EXECUTION_FIXTURE_SOURCE,
  ROOK_CONTACT_ISOLATED_PREVIEW_GRANT_SOURCE,
  WAYWARD_ROOK_CONTACT_CONSEQUENCE,
} from "../../shared/rookContact";
import { readRookContactInterventionSurface } from "./rookContactInterventionRead";
import {
  recordRookContactInterventionResidue,
  residueProvesBusinessOutcome,
  RookContactResidueError,
  socialResiduesForScope,
} from "./rookContactResidue";
import type { RookContactSession } from "./rookContactSessionStore";
import { evaluateRookContactTransport } from "./rookContactCallTruth";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION = "22222222-2222-4222-8222-222222222222";

function session(patch: Partial<RookContactSession> = {}): RookContactSession {
  return {
    contactSessionId: SESSION_ID,
    tenantId: "tenant-a",
    operatorId: "op-a",
    accountId: 10,
    contactId: 20,
    capabilityId: "capability.rook.contact",
    implementationCapabilityId: "rook.outreach_drafting",
    evidenceRefs: [
      { source: "commercial_account", id: "10" },
      { source: "commercial_account_contact", id: "20" },
    ],
    operatorAuthorizedAt: new Date("2026-09-23T03:00:00.000Z"),
    callAttemptId: 42,
    status: "dialing_operator",
    createdAt: new Date("2026-09-23T03:00:00.000Z"),
    updatedAt: new Date("2026-09-23T03:00:00.000Z"),
    ...patch,
  };
}

function residueContext(
  patch: Partial<ClaireRookContactResidueContext> = {}
): ClaireRookContactResidueContext {
  return {
    event: "rook.contact_intervention",
    contactSessionId: SESSION_ID,
    accountId: 10,
    contactId: 20,
    accountName: "Koreatown Hotel",
    contactName: "Avery Chen",
    occurredAt: "2026-09-23T03:05:00.000Z",
    authoredRookFraming: "UNKNOWN",
    evidenceRefs: [
      { source: "commercial_account", id: "10" },
      { source: "commercial_account_contact", id: "20" },
    ],
    tenantId: "tenant-a",
    operatorUserId: "op-a",
    ...patch,
  };
}

const context = {
  phase: "pre_drive",
  generatedAt: "2026-09-23T12:00:00.000Z",
  businessDate: "2026-09-23",
  actorId: "op-a",
  truthLaw: "game_projection_never_creates_business_truth",
  nextFixedCommitment: null,
  blockers: [],
  relevantTimeline: [],
  mission: null,
} as ClaireDriveContext;

describe("Rook CONTACT authority repair", () => {
  it("fails closed because Wayward has no server-authoritative CONTACT beat", () => {
    expect(
      findServerAuthoritativeWaywardContactProof({
        tenantId: "tenant-a",
        operatorId: "op-a",
      })
    ).toEqual({
      proven: false,
      reason: "no_server_authoritative_wayward_contact_beat",
    });
    const wayward = readFileSync(
      resolve(process.cwd(), "client/src/pages/goldline/wayward/WaywardRuntime.ts"),
      "utf8"
    );
    expect(wayward).not.toMatch(/rookContact|wayward\.rook_contact_demonstrated/);
    const progress = readFileSync(
      resolve(process.cwd(), "client/src/pages/goldline/stages/waywardProgress.ts"),
      "utf8"
    );
    expect(progress).toMatch(/localStorage/);
  });

  it("refuses the client consequence, replacement tokens, and preview as production authority", () => {
    for (const grantSource of [
      WAYWARD_ROOK_CONTACT_CONSEQUENCE,
      "wayward.entered",
      "rook",
      ROOK_CONTACT_ISOLATED_PREVIEW_GRANT_SOURCE,
      ROOK_CONTACT_EXECUTION_FIXTURE_SOURCE,
      "browser-signed",
    ]) {
      expect(rookContactGrantIsProductionAuthority({ grantSource })).toBe(false);
    }
    expect(rookContactGrantIsProductionAuthority(null)).toBe(false);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.ROOK_CONTACT_EXECUTION_FIXTURE = "1";
    try {
      expect(
        rookContactGrantAllowsExecution({
          grantSource: ROOK_CONTACT_EXECUTION_FIXTURE_SOURCE,
        })
      ).toBe(false);
      expect(
        rookContactGrantAllowsExecution({
          grantSource: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
        })
      ).toBe(false);
    } finally {
      process.env.NODE_ENV = previous;
      delete process.env.ROOK_CONTACT_EXECUTION_FIXTURE;
    }
  });

  it("does not let isolated preview run in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(
        recordIsolatedPreviewRookContactGrant({
          tenantId: "tenant-a",
          operatorId: "op-a",
          grantedAt: new Date(),
        })
      ).rejects.toThrow(/production/);
    } finally {
      process.env.NODE_ENV = previous;
    }
    const router = readFileSync(
      resolve(process.cwd(), "server/rookContact/rookContactRouter.ts"),
      "utf8"
    );
    expect(router).not.toMatch(/recordIsolatedPreviewRookContactGrant|ROOK_CONTACT_EXECUTION_FIXTURE/);
    const authority = readFileSync(
      resolve(process.cwd(), "server/goldlineProgression/rookContactAuthority.ts"),
      "utf8"
    );
    expect(authority).not.toMatch(/localStorage\.|sessionStorage\.|getItem\(/);
  });

  it("records residue only for the loaded CONTACT session", async () => {
    const store = createInMemoryNarratorStore();
    const known = session();
    await expect(
      recordRookContactInterventionResidue({
        store,
        session: known,
        accountName: "Koreatown Hotel",
        contactName: "Avery Chen",
        occurredAt: "2026-09-23T03:05:00.000Z",
        claimedSessionId: OTHER_SESSION,
        claimedTenantId: known.tenantId,
        claimedOperatorId: known.operatorId,
      })
    ).rejects.toBeInstanceOf(RookContactResidueError);
    await expect(
      recordRookContactInterventionResidue({
        store,
        session: session({ callAttemptId: null, status: "prepared" }),
        accountName: "Koreatown Hotel",
        contactName: "Avery Chen",
        occurredAt: "2026-09-23T03:05:00.000Z",
        claimedSessionId: SESSION_ID,
        claimedTenantId: "tenant-a",
        claimedOperatorId: "op-a",
      })
    ).rejects.toBeInstanceOf(RookContactResidueError);

    const entry = await recordRookContactInterventionResidue({
      store,
      session: known,
      accountName: "Koreatown Hotel",
      contactName: "Avery Chen",
      occurredAt: "2026-09-23T03:05:00.000Z",
      claimedSessionId: known.contactSessionId,
      claimedTenantId: known.tenantId,
      claimedOperatorId: known.operatorId,
    });
    expect(entry.kind).toBe("SOCIAL_RESIDUE");
    expect(entry.tenantId).toBe("tenant-a");
    expect(entry.operatorUserId).toBe("op-a");
    expect(entry.socialResidue?.contactSessionId).toBe(SESSION_ID);
    expect(entry.socialResidue?.authoredRookFraming).toBe("UNKNOWN");
    expect(entry.goldlineOutcomeId).toBeNull();
    expect(JSON.stringify(entry)).not.toMatch(/lied|motive|diagnos|Fucking Rook/i);
    expect(residueProvesBusinessOutcome(entry)).toBe(false);

    const again = await recordRookContactInterventionResidue({
      store,
      session: known,
      accountName: "Koreatown Hotel",
      contactName: "Avery Chen",
      occurredAt: "2026-09-23T03:05:00.000Z",
      claimedSessionId: known.contactSessionId,
      claimedTenantId: known.tenantId,
      claimedOperatorId: known.operatorId,
    });
    expect(again.id).toBe(entry.id);

    const owner = await store.load({ tenantId: "tenant-a", operatorUserId: "op-a" });
    expect(socialResiduesForScope(owner!)).toHaveLength(1);
    const memory = narrativeMemoryView(owner!);
    expect(memory.socialResidues).toHaveLength(1);
    expect(memory.socialResidues[0]?.residue.contactSessionId).toBe(SESSION_ID);
    expect(memory.verifiedGoldlineOutcomes).toHaveLength(0);
    expect(memory.socialResidues[0]?.residue.authoredRookFraming).toBe("UNKNOWN");

    const otherTenant = await store.load({ tenantId: "tenant-b", operatorUserId: "op-a" });
    expect(otherTenant).toBeNull();
    const otherOperator = await store.load({ tenantId: "tenant-a", operatorUserId: "op-b" });
    expect(otherOperator).toBeNull();

    const fresh = await store.initOperator({ tenantId: "tenant-b", operatorUserId: "op-b" });
    const withResidue = evaluateProductionEligibility({
      snapshot: owner!,
      verifiedGoldline: [],
      nowMs: Date.parse("2026-09-23T04:00:00.000Z"),
      mode: "interactive",
      registry: [],
      graph: [],
    });
    const without = evaluateProductionEligibility({
      snapshot: fresh,
      verifiedGoldline: [],
      nowMs: Date.parse("2026-09-23T04:00:00.000Z"),
      mode: "interactive",
      registry: [],
      graph: [],
    });
    expect(withResidue.eligibleBeatIds).toEqual(without.eligibleBeatIds);
  });

  it("keeps prospect connection distinct from commercial advance", () => {
    const connected = evaluateRookContactTransport({
      tenantId: "tenant-a",
      attemptId: 42,
      attemptStatus: "CALL_COMPLETED",
      durationSeconds: 90,
      repLegCallSid: "CA_rep",
      customerLegCallSid: "CA_customer",
      receipts: [],
      proposedOutcome: "spoke",
    });
    expect(connected.spoke).toBe(false);
    const surface = readRookContactInterventionSurface({
      interventionRecorded: true,
      correctProspectConnected: true,
      authoritativeCommercialAdvance: null,
    });
    expect(surface).toEqual({
      interventionHappened: true,
      correctProspectConnected: true,
      meaningfulCommercialAdvance: "UNKNOWN",
      completed: false,
    });
    const withNoise = readRookContactInterventionSurface({
      interventionRecorded: true,
      correctProspectConnected: true,
      authoritativeCommercialAdvance: null,
      ...({
        businessSuccess: true,
        durationSeconds: 90,
        attemptStatus: "CALL_COMPLETED",
      } as object),
    });
    expect(withNoise.meaningfulCommercialAdvance).toBe("UNKNOWN");
    expect(withNoise.completed).toBe(false);
    expect(
      readRookContactInterventionSurface({
        interventionRecorded: false,
        correctProspectConnected: false,
        authoritativeCommercialAdvance: "YES",
      }).meaningfulCommercialAdvance
    ).toBe("YES");
    const readSource = readFileSync(
      resolve(process.cwd(), "server/rookContact/rookContactInterventionRead.ts"),
      "utf8"
    );
    expect(readSource).not.toMatch(/Kingdom #2|Last Valet|villain|win condition/i);
    const truth = readFileSync(
      resolve(process.cwd(), "server/rookContact/rookContactCallTruth.ts"),
      "utf8"
    );
    expect(truth).toMatch(/businessSuccess: connectedClaim/);
  });

  it("gives Claire V1 the residue only when the turn is about that intervention", async () => {
    const residue = residueContext();
    const unrelated = claireRookContactResidueSection({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      utterance: "How many orders came in yesterday?",
      residues: [residue],
    });
    expect(unrelated).toBeNull();
    const otherTenant = claireRookContactResidueSection({
      tenantId: "tenant-b",
      operatorUserId: "op-a",
      utterance: "What did Rook do on that call?",
      residues: [residue],
    });
    expect(otherTenant).toBeNull();
    const otherOperator = claireRookContactResidueSection({
      tenantId: "tenant-a",
      operatorUserId: "op-b",
      utterance: `Tell me about session ${SESSION_ID}`,
      residues: [residue],
    });
    expect(otherOperator).toBeNull();
    const matched = claireRookContactResidueSection({
      tenantId: "tenant-a",
      operatorUserId: "op-a",
      utterance: "What did Rook do when he called Avery Chen?",
      residues: [residue],
    });
    expect(matched).toContain(SESSION_ID);
    expect(matched).toContain("Avery Chen");
    expect(matched).toContain("UNKNOWN");
    expect(matched).toContain("Not business authority");
    expect(matched).not.toMatch(/Fucking Rook|Rook lied|he wanted/i);

    const seen: Array<string | null | undefined> = [];
    await runClaireTurn(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        dayDirectorActorId: "actor-a",
        utterance: "How should I think about pacing the rest of the day?",
        surface: "text",
        state: {},
        context,
        conversationKey: "thread-unrelated",
        rookContactResidues: [residue],
      },
      {
        doctrineTurn: async () => null,
        commitment: async () => ({ kind: "not_applicable" }) as never,
        followUp: async input => {
          seen.push(input.rookContactResidueSection);
          return "Pace the afternoon around the real stops.";
        },
        accounts: async () => [],
        dayWork: async () => {
          throw new Error("no day work");
        },
        unpaid: async () => [],
        searchMemory: async () => [],
        business: {
          plan: async () => null,
          runQuery: async () => ({ status: "unsupported" }) as never,
        },
        now: () => new Date("2026-09-23T15:00:00.000Z"),
        timeZone: () => "America/Los_Angeles",
      }
    );
    expect(seen).toEqual([null]);

    seen.length = 0;
    await runClaireTurn(
      {
        tenantId: "tenant-a",
        operatorUserId: "op-a",
        dayDirectorActorId: "actor-a",
        utterance: "How should I think about pacing the rest of the day after what Rook did?",
        surface: "text",
        state: {},
        context,
        conversationKey: "thread-rook",
        rookContactResidues: [residue],
      },
      {
        doctrineTurn: async () => null,
        commitment: async () => ({ kind: "not_applicable" }) as never,
        followUp: async input => {
          seen.push(input.rookContactResidueSection);
          return "Pace the afternoon around the real stops.";
        },
        accounts: async () => [],
        dayWork: async () => {
          throw new Error("no day work");
        },
        unpaid: async () => [],
        searchMemory: async () => [],
        business: {
          plan: async () => null,
          runQuery: async () => ({ status: "unsupported" }) as never,
        },
        now: () => new Date("2026-09-23T15:00:00.000Z"),
        timeZone: () => "America/Los_Angeles",
      }
    );
    expect(seen[0]).toContain("rook.contact_intervention");
    expect(seen[0]).not.toMatch(/Fucking Rook/);

    const turn = readFileSync(resolve(process.cwd(), "server/claire/turn/claireTurn.ts"), "utf8");
    const twilio = readFileSync(resolve(process.cwd(), "server/claire/claireTwilio.ts"), "utf8");
    expect(turn.indexOf("await deps.followUp(")).toBeGreaterThan(0);
    expect(twilio.indexOf("await runClaireTurn(")).toBeLessThan(
      twilio.indexOf("observeShadowTurnDetached(")
    );
    const residueSource = readFileSync(
      resolve(process.cwd(), "server/claire/rookContactResidueContext.ts"),
      "utf8"
    );
    expect(residueSource).not.toMatch(/observeShadowTurn|from ["'].*brain/);
  });
});
