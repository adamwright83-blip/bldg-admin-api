import { and, eq, isNull } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import {
  dayDirectorCommitments,
  dayDirectorProcessingLocations,
  dayDirectorPromptStates,
  towerWarsPromises,
} from "../../drizzle/schema";
import type { DayDirectorProposal } from "../../shared/dayDirector";
import { getDb } from "../db";
import { invokeLLM } from "../_core/llm";
import { ENV } from "../_core/env";

const proposalSchema = {
  name: "day_director_commitment",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "kind", "quantity", "prerequisites", "question"],
    properties: {
      title: { type: "string" },
      kind: { type: "string", enum: ["growth", "prep", "operations"] },
      quantity: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
      prerequisites: { type: "array", items: { type: "string" }, maxItems: 3 },
      question: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
  },
};

function keyFor(text: string) {
  return createHash("sha256")
    .update(text.trim().toLowerCase().replace(/\s+/g, " "))
    .digest("hex")
    .slice(0, 32);
}

function contentText(result: Awaited<ReturnType<typeof invokeLLM>>): string {
  const content = result.choices[0]?.message.content;
  if (typeof content === "string") return content;
  return (content ?? [])
    .filter(part => part.type === "text")
    .map(part => (part.type === "text" ? part.text : ""))
    .join("");
}

export async function getDayDirectorState(input: {
  tenantId: string;
  actorId: string;
  businessDate: string;
}) {
  const db = await getDb();
  if (!db)
    return {
      processingLocation: null,
      commitments: [],
      dismissedPromptKeys: [],
      intelligenceAvailable: Boolean(ENV.anthropicApiKey?.trim()),
    };
  const [locations, commitments, prompts] = await Promise.all([
    db
      .select()
      .from(dayDirectorProcessingLocations)
      .where(
        and(
          eq(dayDirectorProcessingLocations.tenantId, input.tenantId),
          eq(dayDirectorProcessingLocations.active, true)
        )
      )
      .limit(1),
    db
      .select()
      .from(dayDirectorCommitments)
      .where(
        and(
          eq(dayDirectorCommitments.tenantId, input.tenantId),
          eq(dayDirectorCommitments.actorId, input.actorId),
          eq(dayDirectorCommitments.businessDate, input.businessDate)
        )
      ),
    db
      .select()
      .from(dayDirectorPromptStates)
      .where(
        and(
          eq(dayDirectorPromptStates.tenantId, input.tenantId),
          eq(dayDirectorPromptStates.actorId, input.actorId),
          eq(dayDirectorPromptStates.businessDate, input.businessDate),
          eq(dayDirectorPromptStates.state, "dismissed")
        )
      ),
  ]);
  return {
    processingLocation: locations[0]
      ? {
          name: locations[0].name,
          locality: locations[0].locality,
          address: locations[0].address,
        }
      : null,
    commitments: commitments.map(row => ({
      id: row.id,
      businessDate: row.businessDate,
      title: row.title,
      kind: row.kind,
      quantity: row.quantity,
      provenance: row.provenance,
      status: row.status,
      completedAt: row.completedAt?.toISOString() ?? null,
    })),
    dismissedPromptKeys: prompts.map(row => row.promptKey),
    intelligenceAvailable: Boolean(ENV.anthropicApiKey?.trim()),
  };
}

export async function proposeCommitment(input: {
  tenantId: string;
  sourceText: string;
}): Promise<DayDirectorProposal> {
  const sourceText = input.sourceText.trim();
  const promptKey = `commitment:${keyFor(sourceText)}`;
  if (!ENV.anthropicApiKey?.trim()) {
    return {
      promptKey,
      title: sourceText.slice(0, 255),
      kind: "growth",
      quantity: null,
      sourceText,
      prerequisites: [],
      question: null,
      intelligence: "manual_fallback",
    };
  }
  try {
    const result = await invokeLLM({
      tenantId: input.tenantId,
      model: ENV.anthropicModel,
      maxTokens: 500,
      temperature: 0,
      outputSchema: proposalSchema,
      messages: [
        {
          role: "system",
          content:
            "Normalize only the user's explicit commitment. Do not invent tasks or outcomes. Ask at most one question, only if its answer changes today's actionability.",
        },
        { role: "user", content: sourceText },
      ],
    });
    const parsed = JSON.parse(contentText(result));
    if (
      !parsed.title ||
      !["growth", "prep", "operations"].includes(parsed.kind)
    )
      throw new Error("malformed structured output");
    return {
      promptKey,
      title: String(parsed.title).slice(0, 255),
      kind: parsed.kind,
      quantity: Number.isInteger(parsed.quantity) ? parsed.quantity : null,
      sourceText,
      prerequisites: Array.isArray(parsed.prerequisites)
        ? parsed.prerequisites.slice(0, 3).map(String)
        : [],
      question: typeof parsed.question === "string" ? parsed.question : null,
      intelligence: "anthropic",
    };
  } catch (error) {
    console.warn(
      "[DayDirector] Anthropic proposal unavailable",
      error instanceof Error ? error.message : error
    );
    return {
      promptKey,
      title: sourceText.slice(0, 255),
      kind: "growth",
      quantity: null,
      sourceText,
      prerequisites: [],
      question: null,
      intelligence: "manual_fallback",
    };
  }
}

export async function acceptProposal(input: {
  tenantId: string;
  actorId: string;
  businessDate: string;
  proposal: DayDirectorProposal;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const row = {
    id: randomUUID(),
    tenantId: input.tenantId,
    actorId: input.actorId,
    businessDate: input.businessDate,
    idempotencyKey: input.proposal.promptKey,
    title: input.proposal.title.trim().slice(0, 255),
    kind: input.proposal.kind,
    quantity: input.proposal.quantity,
    provenance: (input.proposal.intelligence === "manual_fallback"
      ? "manual"
      : "user_reported") as "manual" | "user_reported",
    sourceText: input.proposal.sourceText,
    metadataJson: {
      prerequisites: input.proposal.prerequisites,
      intelligence: input.proposal.intelligence,
    },
  };
  await db
    .insert(dayDirectorCommitments)
    .values(row)
    .onDuplicateKeyUpdate({ set: { title: row.title } });
  await setPromptState({
    ...input,
    promptKey: input.proposal.promptKey,
    state: "accepted",
  });
  const [stored] = await db
    .select()
    .from(dayDirectorCommitments)
    .where(
      and(
        eq(dayDirectorCommitments.tenantId, input.tenantId),
        eq(dayDirectorCommitments.actorId, input.actorId),
        eq(dayDirectorCommitments.businessDate, input.businessDate),
        eq(dayDirectorCommitments.idempotencyKey, input.proposal.promptKey)
      )
    )
    .limit(1);
  return stored;
}

export async function setPromptState(input: {
  tenantId: string;
  actorId: string;
  businessDate: string;
  promptKey: string;
  state: "accepted" | "dismissed";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .insert(dayDirectorPromptStates)
    .values(input)
    .onDuplicateKeyUpdate({ set: { state: input.state } });
  return { ok: true };
}

export async function completeDayDirectorCommitment(input: {
  tenantId: string;
  actorId: string;
  commitmentId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [commitment] = await tx
      .select()
      .from(dayDirectorCommitments)
      .where(
        and(
          eq(dayDirectorCommitments.tenantId, input.tenantId),
          eq(dayDirectorCommitments.actorId, input.actorId),
          eq(dayDirectorCommitments.id, input.commitmentId)
        )
      )
      .limit(1);
    if (!commitment) throw new Error("Day Director commitment not found");
    const alreadyCompleted = commitment.status === "completed";
    const completedAt = commitment.completedAt ?? new Date();
    if (!alreadyCompleted) {
      await tx
        .update(dayDirectorCommitments)
        .set({ status: "completed", completedAt })
        .where(
          and(
            eq(dayDirectorCommitments.tenantId, input.tenantId),
            eq(dayDirectorCommitments.actorId, input.actorId),
            eq(dayDirectorCommitments.id, input.commitmentId)
          )
        );
    }
    const metadata = commitment.metadataJson as {
      towerWarsPromiseId?: unknown;
    } | null;
    const towerWarsPromiseId =
      typeof metadata?.towerWarsPromiseId === "string"
        ? metadata.towerWarsPromiseId
        : null;
    if (towerWarsPromiseId) {
      await tx
        .update(towerWarsPromises)
        .set({
          fulfilledAt: completedAt,
          fulfilledBy: input.actorId,
          fulfillmentEvidence: `Completed through Day Director commitment ${commitment.id}`,
        })
        .where(
          and(
            eq(towerWarsPromises.tenantId, input.tenantId),
            eq(towerWarsPromises.id, towerWarsPromiseId),
            isNull(towerWarsPromises.fulfilledAt)
          )
        );
    }
    return { ok: true as const, alreadyCompleted };
  });
}
