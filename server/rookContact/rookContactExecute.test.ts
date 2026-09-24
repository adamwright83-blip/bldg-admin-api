import { readFileSync } from "node:fs";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getTableName } from "drizzle-orm/table";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAuthorityForGoldlineAction } from "../../shared/goldlineActionContract";
import {
  ROOK_CONTACT_BUSINESS_ASSERTIONS,
  groundRookContactLanguage,
} from "./rookContactGrounding";
import { evaluateRookContactTransport } from "./rookContactCallTruth";
import {
  ROOK_CONTACT_EXECUTION_FIXTURE_SOURCE,
  WAYWARD_ROOK_CONTACT_CONSEQUENCE,
} from "../../shared/rookContact";
import {
  authorizeRookContactSession,
  prepareRookContactSession,
  startRookContactBridge,
} from "./rookContactService";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  placeCall: vi.fn(),
  assertCallerId: vi.fn(),
  operatorPhone: vi.fn(),
  fromNumber: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../salesCalls", () => ({
  placeOperatorFirstBridgeCall: mocks.placeCall,
  assertVerifiedOutgoingCallerId: mocks.assertCallerId,
}));
vi.mock("../claire/claireTwilio", () => ({
  authorizedOperatorPhone: mocks.operatorPhone,
  claireTwilioFromNumber: mocks.fromNumber,
}));

const OPERATOR = "+13105550100";
const TWILIO_FROM = "+12135550001";
const CANONICAL = "+13105550123";
const BROWSER = "+19998887777";
const SIBLING = "+13105550888";
const dialect = new MySqlDialect();

type Row = Record<string, unknown>;

function matches(row: Row, predicate: unknown): boolean {
  const query = dialect.sqlToQuery(predicate as SQL);
  const token = /`[^`]+`\.`([^`]+)` (is not null|is null|= \?)/g;
  let param = 0;
  for (const match of query.sql.matchAll(token)) {
    const column = match[1]!;
    const op = match[2]!;
    if (op === "is null") {
      if (row[column] != null) return false;
    } else if (op === "is not null") {
      if (row[column] == null) return false;
    } else if (op === "= ?") {
      if (row[column] !== query.params[param++]) return false;
    }
  }
  return true;
}

function memoryDb() {
  const progression: Row[] = [];
  const grants: Row[] = [];
  const accounts: Row[] = [];
  const contacts: Row[] = [];
  const sessions: Row[] = [];
  const missions: Row[] = [{ id: "mission-1", status: "active", completedAt: null }];
  const challenges: Row[] = [{ id: "challenge-1", status: "open", completedAt: null }];
  const tables: Record<string, Row[]> = {
    goldline_domain_progression: progression,
    goldline_domain_capability_grants: grants,
    commercial_accounts: accounts,
    commercial_account_contacts: contacts,
    goldline_rook_contact_sessions: sessions,
  };
  function stored(table: Parameters<typeof getTableName>[0]) {
    const name = getTableName(table);
    const rows = tables[name];
    if (!rows) throw new Error(`unexpected table ${name}`);
    return rows;
  }
  const db = {
    progression,
    grants,
    accounts,
    contacts,
    sessions,
    missions,
    challenges,
    select() {
      return {
        from(table: Parameters<typeof getTableName>[0]) {
          const rows = stored(table);
          return {
            where(predicate: unknown) {
              const found = rows.filter(row => matches(row, predicate));
              return { limit: async (n: number) => found.slice(0, n) };
            },
          };
        },
      };
    },
    insert(table: Parameters<typeof getTableName>[0]) {
      const rows = stored(table);
      return {
        values: async (value: Row) => {
          rows.push({ ...value });
        },
      };
    },
    update(table: Parameters<typeof getTableName>[0]) {
      const rows = stored(table);
      return {
        set(patch: Row) {
          return {
            where: async (predicate: unknown) => {
              let affectedRows = 0;
              for (const row of rows) {
                if (matches(row, predicate)) {
                  Object.assign(row, patch);
                  affectedRows += 1;
                }
              }
              return [{ affectedRows }];
            },
          };
        },
      };
    },
  };
  return db;
}

function seedReady(db: ReturnType<typeof memoryDb>, patch?: { rook?: boolean; grant?: boolean }) {
  const rook = patch?.rook !== false;
  const grant = patch?.grant !== false;
  db.progression.push({
    id: "prog-1",
    tenantId: "tenant-a",
    operatorId: "op-a",
    levelColosseumResolvedAt: new Date("2026-09-23T00:00:00.000Z"),
    companionRookOwnedAt: rook ? new Date("2026-09-23T01:00:00.000Z") : null,
    kingdomBrassRepublicCompletedAt: null,
  });
  if (grant) {
    db.grants.push({
      id: "grant-1",
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityId: "capability.rook.contact",
      grantedAt: new Date("2026-09-23T02:00:00.000Z"),
      grantSource: ROOK_CONTACT_EXECUTION_FIXTURE_SOURCE,
    });
  }
  db.accounts.push(
    { id: 10, tenantId: "tenant-a", name: "Koreatown Hotel" },
    { id: 11, tenantId: "tenant-a", name: "Other Account" },
    { id: 10, tenantId: "tenant-b", name: "Other Tenant Hotel" }
  );
  db.contacts.push(
    {
      id: 20,
      tenantId: "tenant-a",
      accountId: 10,
      name: "Avery Chen",
      title: "General Manager",
      phone: CANONICAL,
    },
    {
      id: 21,
      tenantId: "tenant-a",
      accountId: 10,
      name: "Sibling Contact",
      title: null,
      phone: SIBLING,
    },
    {
      id: 22,
      tenantId: "tenant-a",
      accountId: 10,
      name: "No Phone",
      title: null,
      phone: null,
    },
    {
      id: 30,
      tenantId: "tenant-b",
      accountId: 10,
      name: "Other Tenant",
      title: null,
      phone: "+13105550002",
    }
  );
}

const actor = { tenantId: "tenant-a", operatorId: "op-a" };

describe("CONTACT execution", () => {
  let db: ReturnType<typeof memoryDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ROOK_CONTACT_EXECUTION_FIXTURE = "1";
    db = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    mocks.placeCall.mockResolvedValue({ attemptId: 42, repLegCallSid: "CA_operator" });
    mocks.assertCallerId.mockResolvedValue(undefined);
    mocks.fromNumber.mockReturnValue(TWILIO_FROM);
    mocks.operatorPhone.mockImplementation(async ({ tenantId, actorId }: { tenantId: string; actorId: string }) => {
      if (tenantId !== "tenant-a" || actorId !== "op-a") throw new Error("operator phone refused");
      return OPERATOR;
    });
  });

  afterEach(() => {
    delete process.env.ROOK_CONTACT_EXECUTION_FIXTURE;
  });

  it("17. CONTACT not granted does not create an executable session", async () => {
    seedReady(db, { grant: false });
    await expect(
      prepareRookContactSession({ ...actor, accountId: 10, contactId: 20 })
    ).rejects.toThrow(/not granted/);
    expect(db.sessions).toHaveLength(0);
    expect(mocks.placeCall).not.toHaveBeenCalled();
  });

  it("a client consequence row does not prepare, even with the execution fixture flag", async () => {
    seedReady(db, { grant: false });
    db.grants.push({
      id: "grant-client",
      tenantId: "tenant-a",
      operatorId: "op-a",
      capabilityId: "capability.rook.contact",
      grantedAt: new Date("2026-09-23T02:00:00.000Z"),
      grantSource: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
    });
    await expect(
      prepareRookContactSession({ ...actor, accountId: 10, contactId: 20 })
    ).rejects.toThrow(/not granted/);
    expect(db.sessions).toHaveLength(0);
  });

  it("an execution fixture does not prepare when NODE_ENV is production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      seedReady(db);
      await expect(
        prepareRookContactSession({ ...actor, accountId: 10, contactId: 20 })
      ).rejects.toThrow(/not granted/);
      expect(db.sessions).toHaveLength(0);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("18. Rook not owned cannot use CONTACT", async () => {
    seedReady(db, { rook: false, grant: true });
    await expect(
      prepareRookContactSession({ ...actor, accountId: 10, contactId: 20 })
    ).rejects.toThrow(/companion\.rook/);
    expect(db.sessions).toHaveLength(0);
    expect(mocks.placeCall).not.toHaveBeenCalled();
    expect(db.progression[0]?.companionRookOwnedAt).toBeNull();
  });

  it("19. a missing canonical contact fails closed", async () => {
    seedReady(db);
    await expect(
      prepareRookContactSession({ ...actor, accountId: 10, contactId: 999 })
    ).rejects.toThrow(/canonical commercial contact/);
    await expect(
      prepareRookContactSession({ ...actor, accountId: 10, contactId: 22 })
    ).rejects.toThrow(/no phone/);
    expect(db.sessions).toHaveLength(0);
    expect(mocks.placeCall).not.toHaveBeenCalled();
  });

  it("20. a wrong-tenant target or a sibling-contact swap fails closed", async () => {
    seedReady(db);
    await expect(
      prepareRookContactSession({ ...actor, accountId: 10, contactId: 30 })
    ).rejects.toThrow(/canonical commercial contact/);
    await expect(
      prepareRookContactSession({ ...actor, accountId: 11, contactId: 20 })
    ).rejects.toThrow(/canonical commercial contact/);
    const session = await prepareRookContactSession({ ...actor, accountId: 10, contactId: 20 });
    await expect(
      authorizeRookContactSession({
        ...actor,
        contactSessionId: session.contactSessionId,
        contactId: 21,
      })
    ).rejects.toThrow(/does not match/);
    expect(db.sessions).toHaveLength(1);
    expect(db.sessions[0]?.status).toBe("prepared");
    expect(db.sessions[0]?.operatorAuthorizedAt).toBeNull();
    expect(mocks.placeCall).not.toHaveBeenCalled();
  });

  it("21. a browser-supplied phone cannot redirect the call", async () => {
    seedReady(db);
    await expect(
      prepareRookContactSession({
        ...actor,
        accountId: 10,
        contactId: 20,
        phone: BROWSER,
      } as never)
    ).rejects.toThrow(/phone/);
    expect(db.sessions).toHaveLength(0);
    const session = await prepareRookContactSession({ ...actor, accountId: 10, contactId: 20 });
    await authorizeRookContactSession({
      ...actor,
      contactSessionId: session.contactSessionId,
      contactId: 20,
    });
    await expect(
      startRookContactBridge({
        ...actor,
        contactSessionId: session.contactSessionId,
        phone: BROWSER,
      } as never)
    ).rejects.toThrow(/phone/);
    expect(mocks.placeCall).not.toHaveBeenCalled();
    expect(JSON.stringify(db.sessions)).not.toContain(BROWSER);
  });

  it("22. the server resolves the phone from the canonical contact", async () => {
    seedReady(db);
    const session = await prepareRookContactSession({ ...actor, accountId: 10, contactId: 20 });
    const contact = db.contacts.find(row => row.id === 20);
    if (!contact) throw new Error("missing contact");
    contact.phone = "+13105550777";
    await authorizeRookContactSession({
      ...actor,
      contactSessionId: session.contactSessionId,
      contactId: 20,
    });
    await startRookContactBridge({ ...actor, contactSessionId: session.contactSessionId });
    expect(mocks.placeCall).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      legs: {
        operatorLegTo: OPERATOR,
        operatorLegFrom: TWILIO_FROM,
        prospectLegTo: "+13105550777",
        prospectCallerId: OPERATOR,
      },
    });
    expect(JSON.stringify(db.sessions[0])).not.toContain("+13105550777");
    expect(db.sessions[0]?.capabilityId).toBe("capability.rook.contact");
    expect(db.sessions[0]?.implementationCapabilityId).toBe("rook.outreach_drafting");
  });

  it("23. no operator authorization means no dial", async () => {
    seedReady(db);
    const session = await prepareRookContactSession({ ...actor, accountId: 10, contactId: 20 });
    await expect(
      startRookContactBridge({ ...actor, contactSessionId: session.contactSessionId })
    ).rejects.toThrow(/authorization/);
    expect(mocks.placeCall).not.toHaveBeenCalled();
    expect(db.sessions[0]?.status).toBe("prepared");
    await expect(
      startRookContactBridge({
        tenantId: "tenant-a",
        operatorId: "op-b",
        contactSessionId: session.contactSessionId,
      })
    ).rejects.toThrow();
    expect(mocks.placeCall).not.toHaveBeenCalled();
  });

  it("24. authorization may start the operator-first bridge", async () => {
    seedReady(db);
    const kingdomBefore = db.progression[0]?.kingdomBrassRepublicCompletedAt;
    const missionBefore = JSON.stringify(db.missions);
    const challengeBefore = JSON.stringify(db.challenges);
    const session = await prepareRookContactSession({ ...actor, accountId: 10, contactId: 20 });
    const authorized = await authorizeRookContactSession({
      ...actor,
      contactSessionId: session.contactSessionId,
      contactId: 20,
    });
    expect(authorized.operatorAuthorizedAt).toBeInstanceOf(Date);
    expect(mocks.placeCall).not.toHaveBeenCalled();
    const started = await startRookContactBridge({
      ...actor,
      contactSessionId: session.contactSessionId,
    });
    expect(started.status).toBe("dialing_operator");
    expect(started.callAttemptId).toBe(42);
    expect(mocks.placeCall).toHaveBeenCalledTimes(1);
    await startRookContactBridge({ ...actor, contactSessionId: session.contactSessionId });
    expect(mocks.placeCall).toHaveBeenCalledTimes(1);
    expect(db.progression[0]?.kingdomBrassRepublicCompletedAt).toBe(kingdomBefore);
    expect(JSON.stringify(db.missions)).toBe(missionBefore);
    expect(JSON.stringify(db.challenges)).toBe(challengeBefore);
    expect(defaultAuthorityForGoldlineAction("CALL")).toBe("HUMAN_EXECUTION");
  });

  it("24b. concurrent starts can place only one operator call", async () => {
    seedReady(db);
    const session = await prepareRookContactSession({ ...actor, accountId: 10, contactId: 20 });
    await authorizeRookContactSession({
      ...actor,
      contactSessionId: session.contactSessionId,
      contactId: 20,
    });

    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    mocks.placeCall.mockImplementationOnce(async () => {
      await gate;
      return { attemptId: 42, repLegCallSid: "CA_operator" };
    });

    const first = startRookContactBridge({ ...actor, contactSessionId: session.contactSessionId });
    for (let i = 0; i < 20 && mocks.placeCall.mock.calls.length === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(mocks.placeCall).toHaveBeenCalledTimes(1);

    await expect(
      startRookContactBridge({ ...actor, contactSessionId: session.contactSessionId })
    ).rejects.toThrow(/already starting|already claimed/);
    expect(mocks.placeCall).toHaveBeenCalledTimes(1);

    release();
    const started = await first;
    expect(started.callAttemptId).toBe(42);
    expect(db.sessions[0]?.status).toBe("dialing_operator");
    expect(db.sessions[0]?.callAttemptId).toBe(42);
  });

  it("25. the operator is dialed first", async () => {
    seedReady(db);
    const session = await prepareRookContactSession({ ...actor, accountId: 10, contactId: 20 });
    await authorizeRookContactSession({
      ...actor,
      contactSessionId: session.contactSessionId,
      contactId: 20,
    });
    await startRookContactBridge({ ...actor, contactSessionId: session.contactSessionId });
    const legs = mocks.placeCall.mock.calls[0]?.[0]?.legs;
    expect(legs.operatorLegTo).toBe(OPERATOR);
    expect(legs.prospectCallerId).toBe(OPERATOR);
    expect(legs.operatorLegFrom).toBe(TWILIO_FROM);
    expect(legs.operatorLegTo).not.toBe(legs.prospectLegTo);
    expect(mocks.assertCallerId.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.placeCall.mock.invocationCallOrder[0]!
    );
  });

  it("26. the prospect is not dialed before the operator answers", async () => {
    seedReady(db);
    const session = await prepareRookContactSession({ ...actor, accountId: 10, contactId: 20 });
    await authorizeRookContactSession({
      ...actor,
      contactSessionId: session.contactSessionId,
      contactId: 20,
    });
    await startRookContactBridge({ ...actor, contactSessionId: session.contactSessionId });
    const request = mocks.placeCall.mock.calls[0]?.[0];
    expect(request).not.toHaveProperty("to");
    expect(request).not.toHaveProperty("customerPhone");
    const source = readFileSync(new URL("./rookContactService.ts", import.meta.url), "utf8");
    expect(source).toContain("placeOperatorFirstBridgeCall");
    expect(source).not.toMatch(/calls\.create/);
    expect(source).not.toMatch(/parseYes|\bdo it\b|transcript\.match/);
  });

  it("27. recording stays off", async () => {
    const bridge = readFileSync(new URL("../salesCalls.ts", import.meta.url), "utf8");
    const source = readFileSync(new URL("./rookContactService.ts", import.meta.url), "utf8");
    expect(bridge).toContain("record: false");
    expect(bridge).toContain('record: "do-not-record"');
    expect(bridge).toContain("recordingEnabled: false");
    expect(source).not.toMatch(/record:\s*true|recordingEnabled:\s*true/);
    seedReady(db);
    const session = await prepareRookContactSession({ ...actor, accountId: 10, contactId: 20 });
    await authorizeRookContactSession({
      ...actor,
      contactSessionId: session.contactSessionId,
      contactId: 20,
    });
    await startRookContactBridge({ ...actor, contactSessionId: session.contactSessionId });
    expect(mocks.placeCall.mock.calls[0]?.[0]).not.toHaveProperty("record");
  });

  it("28. duration alone is not business success", () => {
    const read = evaluateRookContactTransport({
      tenantId: "tenant-a",
      attemptId: 42,
      attemptStatus: "completed_success",
      durationSeconds: 95,
      repLegCallSid: "CA_rep",
      customerLegCallSid: "CA_customer",
      receipts: [],
      proposedOutcome: "spoke",
    });
    expect(read.durationSeconds).toBe(95);
    expect(read.spoke).toBe(false);
    expect(read.visitBooked).toBe(false);
    expect(read.businessSuccess).toBe(false);
  });

  it("29. CALL_COMPLETED alone is not spoke", () => {
    const read = evaluateRookContactTransport({
      tenantId: "tenant-a",
      attemptId: 42,
      attemptStatus: "completed_success",
      durationSeconds: 40,
      repLegCallSid: "CA_rep",
      customerLegCallSid: "CA_customer",
      receipts: [
        {
          attemptId: 42,
          tenantId: "tenant-a",
          eventType: "CALL_COMPLETED",
          callSid: "CA_customer",
          parentCallSid: "CA_rep",
        },
      ],
      proposedOutcome: "spoke",
    });
    expect(read.spoke).toBe(false);
    expect(read.businessSuccess).toBe(false);
  });

  it("30. the same attempt's prospect CALL_CONNECTED may satisfy a connected conversation", () => {
    const read = evaluateRookContactTransport({
      tenantId: "tenant-a",
      attemptId: 42,
      attemptStatus: "completed_success",
      durationSeconds: 40,
      repLegCallSid: "CA_rep",
      customerLegCallSid: "CA_customer",
      receipts: [
        {
          attemptId: 42,
          tenantId: "tenant-a",
          eventType: "CALL_CONNECTED",
          callSid: "CA_customer",
          parentCallSid: "CA_rep",
        },
      ],
      proposedOutcome: "spoke",
    });
    expect(read.spoke).toBe(true);
    expect(read.businessSuccess).toBe(true);
    const booked = evaluateRookContactTransport({
      tenantId: "tenant-a",
      attemptId: 42,
      attemptStatus: "customer_connected",
      repLegCallSid: "CA_rep",
      customerLegCallSid: null,
      receipts: [],
      proposedOutcome: "visit_booked",
    });
    expect(booked.visitBooked).toBe(true);
  });

  it("31. another attempt's connection cannot satisfy this one", () => {
    const read = evaluateRookContactTransport({
      tenantId: "tenant-a",
      attemptId: 42,
      attemptStatus: "completed_success",
      durationSeconds: 80,
      repLegCallSid: "CA_rep",
      customerLegCallSid: "CA_customer",
      receipts: [
        {
          attemptId: 99,
          tenantId: "tenant-a",
          eventType: "CALL_CONNECTED",
          callSid: "CA_customer",
          parentCallSid: "CA_rep",
        },
      ],
      proposedOutcome: "spoke",
    });
    expect(read.spoke).toBe(false);
    expect(read.visitBooked).toBe(false);
    expect(read.businessSuccess).toBe(false);
  });
});

describe("CONTACT language", () => {
  it("32. unknown stays unknown", () => {
    const [sentence] = groundRookContactLanguage({
      sentences: [{ text: "Who handles linen here?", proposedLabel: "VERIFIED" }],
      evidence: [],
    });
    expect(sentence?.label).toBe("UNKNOWN");
    expect(sentence?.verifiedAccountFact).toBe(false);
    expect(sentence?.authority).toBe(false);
    expect(sentence?.blocked).toBe(false);
  });

  it("33. a stored genuine fact may be used", () => {
    const [name] = groundRookContactLanguage({
      sentences: [{ text: "Avery Chen", claimKey: "contact_name", proposedLabel: "UNKNOWN" }],
      evidence: [
        {
          id: "contact:20:name",
          claimKey: "contact_name",
          displayValue: "Avery Chen",
          sourceType: "canonical_contact",
        },
      ],
    });
    expect(name?.label).toBe("GROUNDED");
    expect(name?.verifiedAccountFact).toBe(true);
    expect(name?.authority).toBe("evidence");
    expect(name?.blocked).toBe(false);

    const [asked] = groundRookContactLanguage({
      sentences: [{ text: "They asked you to call." }],
      evidence: [
        {
          id: "fact-asked",
          claimKey: "asked_to_call",
          displayValue: "They asked you to call.",
          sourceType: "canonical_contact",
        },
      ],
    });
    expect(asked?.label).toBe("VERIFIED");
    expect(asked?.verifiedAccountFact).toBe(true);
    expect(asked?.blocked).toBe(false);
    expect(asked?.authority).toBe("evidence");
  });

  it("34. general guidance is not a verified account fact", () => {
    const [guidance] = groundRookContactLanguage({
      sentences: [
        {
          text: "Ask who handles linen.",
          claimKey: "opening_guidance",
          proposedLabel: "VERIFIED",
        },
      ],
      evidence: [
        {
          id: "guide-1",
          claimKey: "opening_guidance",
          displayValue: "Ask who handles linen.",
          sourceType: "general_guidance",
        },
      ],
    });
    expect(guidance?.label).toBe("GENERAL_GUIDANCE");
    expect(guidance?.verifiedAccountFact).toBe(false);
    expect(guidance?.authority).toBe(false);

    const [disguised] = groundRookContactLanguage({
      sentences: [{ text: "They asked you to call.", proposedLabel: "VERIFIED" }],
      evidence: [
        {
          id: "guide-asked",
          claimKey: "asked_to_call",
          displayValue: "They asked you to call.",
          sourceType: "general_guidance",
        },
      ],
    });
    expect(disguised?.blocked).toBe(true);
    expect(disguised?.verifiedAccountFact).toBe(false);
    expect(disguised?.label).toBe("UNKNOWN");
  });

  function expectBlocked(texts: string[]) {
    for (const text of texts) {
      const [sentence] = groundRookContactLanguage({
        sentences: [{ text, proposedLabel: "VERIFIED" }],
        evidence: [],
      });
      expect(sentence?.blocked, text).toBe(true);
      expect(sentence?.verifiedAccountFact, text).toBe(false);
      expect(sentence?.authority, text).toBe(false);
      expect(sentence?.label, text).toBe("UNKNOWN");
    }
  }

  it("35. blocks asked-for and expected calls without evidence", () => {
    expectBlocked(["They asked you to call.", "They're expecting your call."]);
  });

  it("36. blocks availability and follow-up claims without evidence", () => {
    expectBlocked(["They're available right now.", "They wanted you to follow up."]);
  });

  it("37. blocks reply and interest claims without evidence, including a call receipt", () => {
    expectBlocked(["They replied.", "They were interested."]);
    const [fromReceipt] = groundRookContactLanguage({
      sentences: [{ text: "They were interested." }],
      evidence: [
        {
          id: "receipt-1",
          claimKey: "interested",
          displayValue: "They were interested.",
          sourceType: "communication_receipt",
        },
      ],
    });
    expect(fromReceipt?.blocked).toBe(true);
    expect(fromReceipt?.verifiedAccountFact).toBe(false);
  });

  it("38. blocks referral and prior-conversation claims without evidence", () => {
    expectBlocked(["They referred us.", "You spoke last week."]);
  });

  it("39. blocks approval and readiness claims without evidence", () => {
    expectBlocked(["They approved this.", "They're ready to move forward."]);
  });

  it("40. blocks familiarity claims without evidence, and character voice is not that claim", () => {
    expectBlocked(["They already know who you are."]);
    expect(ROOK_CONTACT_BUSINESS_ASSERTIONS).toHaveLength(11);
    const [opening] = groundRookContactLanguage({
      sentences: [{ text: "I found an opening", proposedLabel: "VERIFIED" }],
      evidence: [],
    });
    expect(opening?.label).toBe("MODEL_PHRASING");
    expect(opening?.blocked).toBe(false);
    expect(opening?.authority).toBe(false);
    expect(opening?.verifiedAccountFact).toBe(false);
    const [smuggled] = groundRookContactLanguage({
      sentences: [{ text: "I found an opening", claimKey: "asked_to_call", proposedLabel: "VERIFIED" }],
      evidence: [],
    });
    expect(smuggled?.blocked).toBe(true);
    expect(smuggled?.verifiedAccountFact).toBe(false);
    expect(smuggled?.authority).toBe(false);
  });
});
