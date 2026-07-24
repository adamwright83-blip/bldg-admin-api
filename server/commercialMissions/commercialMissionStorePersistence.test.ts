import { describe, expect, it, vi } from "vitest";
import {
  commercialAccountContacts,
  commercialAccountLocations,
  commercialAccounts,
  commercialMissionEvents,
  commercialMissionIrlStepDetails,
  commercialMissions,
  commercialMissionSteps,
  commercialOpportunities,
  opsTasks,
} from "../../drizzle/schema";
import type { CommercialMissionStep } from "@shared/commercialMission";
import { commercialContactIdentityKey } from "../commercialPipeline/commercialPipelineCore";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  createCommercialPipelineForMissionWith: vi.fn(async () => 1),
  syncCommercialPipelineForMissionTransitionWith: vi.fn(),
  writeDayforgeEventWith: vi.fn(async () => undefined),
}));

vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../commercialPipeline/commercialPipelineCore", async importOriginal => ({
  ...(await importOriginal<typeof import("../commercialPipeline/commercialPipelineCore")>()),
  createCommercialPipelineForMissionWith: mocks.createCommercialPipelineForMissionWith,
  syncCommercialPipelineForMissionTransitionWith: mocks.syncCommercialPipelineForMissionTransitionWith,
}));
vi.mock("../dayforgeEvents/dayforgeEventStore", () => ({
  writeDayforgeEventWith: mocks.writeDayforgeEventWith,
}));

import {
  createCommercialMission,
  readCommercialMissionWith,
} from "./commercialMissionStore";

type Row = Record<string, unknown>;

function predicateParameters(predicate: unknown): unknown[] {
  if (!predicate || typeof predicate !== "object") return [];
  const node = predicate as { constructor?: { name?: string }; queryChunks?: unknown[]; value?: unknown };
  if (node.constructor?.name === "Param") return [node.value];
  return (node.queryChunks ?? []).flatMap(predicateParameters);
}

function createMemoryStore() {
  const rows = new Map<object, Row[]>();
  const ids = new Map<object, number>();

  const tableRows = (table: object): Row[] => {
    const existing = rows.get(table);
    if (existing) return existing;
    const created: Row[] = [];
    rows.set(table, created);
    return created;
  };

  const nextId = (table: object): number => {
    const id = (ids.get(table) ?? 0) + 1;
    ids.set(table, id);
    return id;
  };

  const matchingRows = (
    table: object,
    predicate: unknown,
    operation: "select" | "update" = "select",
  ): Row[] => {
    const params = predicateParameters(predicate);
    const source = tableRows(table);
    if (table === commercialMissionEvents) {
      return source.filter(row => row.tenantId === params[0] && row.idempotencyKey === params[1]);
    }
    if (table === commercialAccounts) {
      return source.filter(row => row.tenantId === params[0] && row.identityKey === params[1]);
    }
    if (table === commercialAccountContacts) {
      if (operation === "update") {
        return source.filter(row => row.tenantId === params[0] && row.id === params[1]);
      }
      return source.filter(row =>
        row.tenantId === params[0] &&
        row.accountId === params[1]
      );
    }
    if (table === commercialAccountLocations) {
      if (operation === "update") {
        return source.filter(row => row.tenantId === params[0] && row.id === params[1]);
      }
      return source.filter(row =>
        row.tenantId === params[0] && row.accountId === params[1]
      );
    }
    if (table === commercialMissions) {
      return source.filter(row => row.tenantId === params[0] && row.id === params[1]);
    }
    if (table === commercialMissionSteps || table === commercialMissionIrlStepDetails) {
      return source.filter(row => row.tenantId === params[0] && row.missionId === params[1]);
    }
    return source;
  };

  const insertDefaults = (table: object, values: Row): Row => {
    const now = new Date("2026-07-23T12:00:00.000Z");
    const row = { id: nextId(table), createdAt: now, updatedAt: now, ...values };
    if (table === commercialMissions) {
      Object.assign(row, { status: "candidate", version: 1, expiresAt: null, completedAt: null, ...values });
    }
    if (table === commercialMissionSteps) Object.assign(row, { completedAt: null, ...values });
    return row;
  };

  const insertOrUpdate = (table: object, values: Row, duplicateSet?: Row): Row => {
    const source = tableRows(table);
    const duplicate = table === commercialAccounts
      ? source.find(row => row.tenantId === values.tenantId && row.identityKey === values.identityKey)
      : table === commercialAccountLocations
        ? source.find(row =>
            row.tenantId === values.tenantId &&
            row.accountId === values.accountId &&
            row.locationKey === values.locationKey
          )
        : undefined;
    if (duplicate) {
      Object.assign(duplicate, duplicateSet ?? values);
      return duplicate;
    }
    const row = insertDefaults(table, values);
    source.push(row);
    return row;
  };

  const tx = {
    select: (_selection?: unknown) => ({
      from: (table: object) => {
        let predicate: unknown;
        const execute = () => matchingRows(table, predicate);
        const chain = {
          where(value: unknown) {
            predicate = value;
            return chain;
          },
          limit(_value: number) {
            return chain;
          },
          for(_mode: string) {
            return chain;
          },
          orderBy(..._values: unknown[]) {
            return chain;
          },
          then<TResult1 = Row[], TResult2 = never>(
            onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
            onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ) {
            return Promise.resolve(execute()).then(onfulfilled, onrejected);
          },
        };
        return chain;
      },
    }),
    insert: (table: object) => ({
      values: (input: Row | Row[]) => {
        let result: Array<{ insertId: number }> | undefined;
        const execute = (duplicateSet?: Row) => {
          if (!result) {
            const inserted = (Array.isArray(input) ? input : [input]).map(value =>
              insertOrUpdate(table, value, duplicateSet)
            );
            result = [{ insertId: Number(inserted[0]?.id ?? 0) }];
          }
          return Promise.resolve(result);
        };
        return {
          onDuplicateKeyUpdate: ({ set }: { set: Row }) => execute(set),
          then<TResult1 = Array<{ insertId: number }>, TResult2 = never>(
            onfulfilled?: ((value: Array<{ insertId: number }>) => TResult1 | PromiseLike<TResult1>) | null,
            onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ) {
            return execute().then(onfulfilled, onrejected);
          },
        };
      },
    }),
    update: (table: object) => ({
      set: (values: Row) => ({
        where: (predicate: unknown) => {
          for (const row of matchingRows(table, predicate, "update")) Object.assign(row, values);
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      }),
    }),
  };

  const db = {
    transaction: async <T>(work: (transaction: typeof tx) => Promise<T>): Promise<T> => work(tx),
    select: tx.select,
  };

  return { db, tx, tableRows };
}

function missionInput(input: {
  tenantId?: string;
  idempotencyKey?: string;
  decisionMaker?: Record<string, unknown>;
  steps?: CommercialMissionStep[];
  latitude?: number | null;
  longitude?: number | null;
}) {
  return {
    tenantId: input.tenantId ?? "tenant-a",
    assignedTo: "field-1",
    account: {
      providerName: null,
      providerAccountId: null,
      name: "Arcadia Hospitality",
      accountType: "hotel",
      website: "https://arcadia.example",
      address: "1200 Harbor Avenue, Long Beach, CA",
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      locationCount: 1,
      decisionMaker: {
        name: "Dana Ruiz",
        title: "Operations Director",
        ...input.decisionMaker,
      },
    },
    opportunity: {
      estimatedAnnualValueCents: null,
      estimateConfidence: "medium" as const,
      score: 74,
      primarySignal: "Walk-in conversation",
      reasons: ["Local recurring demand"],
      risks: ["Volume not yet verified"],
      evidence: [{ kind: "operator_note", claim: "Asked for a follow-up" }],
    },
    brief: {
      laundryOpportunity: "Recurring guest-linen overflow",
      salesAngle: "Local pickup with accountable turnaround",
      openingLine: "How do you cover linen overflow today?",
      discoveryQuestions: ["What volume peaks create the most pressure?"],
      objections: ["Existing vendor"],
    },
    steps: input.steps ?? [],
    actor: { type: "operator" as const, id: "operator-1" },
    idempotencyKey: input.idempotencyKey ?? "mission-create-a",
  };
}

describe("commercial mission store persistence", () => {
  it("persists the full contact snapshot and real unknowns without fabricated coordinates or value", async () => {
    const memory = createMemoryStore();
    mocks.getDb.mockResolvedValue(memory.db);

    await createCommercialMission(missionInput({
      decisionMaker: {
        email: "  DANA.RUIZ@ARCADIA.EXAMPLE ",
        phone: " +1 (562) 555-0134 ",
        relationshipType: "decision_maker",
        preferredChannel: "email",
        source: "operator_observation",
        sourceUrl: " https://arcadia.example/team ",
        sourcedAt: "2026-07-22T19:45:00.000Z",
        notes: "  Requested a Tuesday callback. ",
      },
    }));

    expect(memory.tableRows(commercialAccountContacts)).toEqual([
      expect.objectContaining({
        tenantId: "tenant-a",
        name: "Dana Ruiz",
        title: "Operations Director",
        email: "dana.ruiz@arcadia.example",
        phone: "+1 (562) 555-0134",
        relationshipType: "decision_maker",
        preferredChannel: "email",
        source: "operator_observation",
        sourceUrl: "https://arcadia.example/team",
        sourcedAt: new Date("2026-07-22T19:45:00.000Z"),
        notes: "Requested a Tuesday callback.",
      }),
    ]);
    expect(memory.tableRows(commercialAccountLocations)[0]).toEqual(expect.objectContaining({
      latitude: null,
      longitude: null,
    }));
    expect(memory.tableRows(commercialOpportunities)[0]).toEqual(expect.objectContaining({
      estimatedAnnualValueCents: null,
      evidenceJson: [{ kind: "operator_note", claim: "Asked for a follow-up" }],
    }));
    expect(memory.tableRows(opsTasks)[0]).toEqual(expect.objectContaining({
      revenueAtRiskCents: 0,
      metadataJson: expect.objectContaining({
        revenueEstimateStatus: "unavailable",
      }),
    }));
  });

  it("enriches a lower-confidence contact in place and never crosses tenant boundaries", async () => {
    const memory = createMemoryStore();
    mocks.getDb.mockResolvedValue(memory.db);

    await createCommercialMission(missionInput({
      idempotencyKey: "weak-contact",
      decisionMaker: {
        phone: "+1 (562) 555-0134",
        relationshipType: "unknown",
        source: "unplanned_walk_in",
        notes: "Met at the front desk.",
      },
    }));
    const initial = memory.tableRows(commercialAccountContacts)[0]!;
    const initialId = initial.id;

    await createCommercialMission(missionInput({
      idempotencyKey: "enriched-contact",
      latitude: 33.7701,
      longitude: -118.1937,
      decisionMaker: {
        email: "Dana.Ruiz@Arcadia.Example",
        relationshipType: "decision_maker",
        preferredChannel: "email",
        source: "public_website",
        sourceUrl: "https://arcadia.example/leadership",
      },
    }));

    const tenantAContacts = memory.tableRows(commercialAccountContacts)
      .filter(row => row.tenantId === "tenant-a");
    expect(tenantAContacts).toHaveLength(1);
    expect(tenantAContacts[0]).toEqual(expect.objectContaining({
      id: initialId,
      contactKey: commercialContactIdentityKey({ email: "dana.ruiz@arcadia.example" }),
      email: "dana.ruiz@arcadia.example",
      phone: "+1 (562) 555-0134",
      relationshipType: "decision_maker",
      preferredChannel: "email",
      source: "public_website",
      notes: "Met at the front desk.",
    }));
    expect(
      memory.tableRows(commercialAccountLocations).filter(
        row => row.tenantId === "tenant-a",
      ),
    ).toEqual([
      expect.objectContaining({
        latitude: "33.7701",
        longitude: "-118.1937",
      }),
    ]);

    const otherMission = await createCommercialMission(missionInput({
      tenantId: "tenant-b",
      idempotencyKey: "other-tenant-contact",
      decisionMaker: { email: "dana.ruiz@arcadia.example" },
    }));
    expect(memory.tableRows(commercialAccountContacts)).toHaveLength(2);
    expect(memory.tableRows(commercialAccountContacts).filter(row => row.tenantId === "tenant-b")).toHaveLength(1);
    await expect(readCommercialMissionWith(memory.tx as never, {
      tenantId: "tenant-a",
      missionId: otherMission.id,
    })).resolves.toBeNull();
  });

  it("round-trips mission-step IRL instructions, destinations, timing, proof, coaching, and metadata", async () => {
    const memory = createMemoryStore();
    mocks.getDb.mockResolvedValue(memory.db);
    const startedAt = "2026-07-23T16:00:00.000Z";
    const deadlineAt = "2026-07-23T16:20:00.000Z";
    const step: CommercialMissionStep = {
      key: "field-visit",
      label: "Meet the operations director",
      detail: "Check in, qualify the need, and leave the approved one-sheet.",
      type: "field_visit",
      status: "awaiting_review",
      position: 3,
      instructionText: "Ask for Dana at the front desk before starting the discovery questions.",
      revealPolicy: "sequential",
      destinationName: "Arcadia Hotel",
      destinationAddress: "1200 Harbor Avenue, Long Beach, CA",
      destinationLatitude: 33.7701,
      destinationLongitude: -118.1937,
      mapsUrl: "https://maps.example/arcadia",
      countdownDurationSeconds: 1_200,
      startedAt,
      deadlineAt,
      proofRequirement: "photo_optional",
      referenceImageUrl: "https://assets.example/arcadia-reference.png",
      instructionVideoUrl: "https://assets.example/field-brief.mp4",
      pinnedCoachingArtifactId: "14f9a898-f034-4a2f-ae22-5ebad9300ce5",
      verificationState: "pending",
      proofAssetId: "de2477b4-f43c-4b3b-9a8d-9e9040134a03",
      reviewedBy: "reviewer-1",
      reviewedAt: "2026-07-23T16:05:00.000Z",
      rejectionReason: "Reference collar was not visible.",
      fulfillmentMode: "live_provider",
      metadata: { parking: "Loading zone on Ocean Boulevard", checklistVersion: 2 },
    };

    const mission = await createCommercialMission(missionInput({ steps: [step] }));

    expect(memory.tableRows(commercialMissionSteps)[0]).toEqual(expect.objectContaining({
      status: "active",
      stepKey: "field-visit",
    }));
    expect(memory.tableRows(commercialMissionIrlStepDetails)[0]).toEqual(expect.objectContaining({
      destinationLatitude: "33.7701",
      destinationLongitude: "-118.1937",
      startedAt: new Date(startedAt),
      deadlineAt: new Date(deadlineAt),
    }));
    expect(mission.steps).toEqual([expect.objectContaining({
      ...step,
      status: "awaiting_review",
      destinationLatitude: 33.7701,
      destinationLongitude: -118.1937,
      startedAt,
      deadlineAt,
      completedAt: null,
    })]);
  });
});
