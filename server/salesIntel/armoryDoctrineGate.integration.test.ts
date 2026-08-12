import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  salesIntelFrameworks,
  salesIntelSourceArtifacts,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  countIndependentSourceSupport,
  persistFrameworkVersion,
  upsertSourceArtifact,
} from "./salesIntelStore";
const run =
    process.env.DAYFORGE_RELEASE_DB === "1" && !!process.env.DATABASE_URL,
  ids: string[] = [];
async function src(status: "extracted" | "analyzed" = "extracted") {
  const t = randomUUID();
  const { artifact } = await upsertSourceArtifact({
    contentHash: `d-${t}`,
    sourceType: "youtube",
    sourceUrl: `https://x/${t}`,
    canonicalUrl: `https://x/${t}`,
    externalContentId: t,
    creatorName: "C",
    creatorHandle: null,
    publishedAt: null,
    title: "T",
    metadata: {},
    ingestedBy: "test",
    status,
  });
  ids.push(artifact.id);
  return artifact;
}
async function fw(
  sourceArtifactId: string,
  reviewState: "accepted" | "review_required" | "rejected",
  active = true
) {
  const row = await persistFrameworkVersion({
    frameworkKey: randomUUID().replaceAll("-", ""),
    sourceArtifactId,
    transcriptId: null,
    creatorName: "C",
    creatorHandle: null,
    archetype: "ANCHOR",
    channel: "phone",
    exactObjection: "x",
    diagnosis: null,
    frameworkName: "F",
    principle: "p",
    responseFamily: "isolate_constraint",
    discoveryQuestions: [],
    exampleLanguage: [],
    whenToUse: [],
    whenNotToUse: [],
    followUpMoves: [],
    badResponses: [],
    confidence: 0.9,
    extractionVersion: "v",
    extractionProvider: "f",
    extractionModel: "f",
    promptVersion: "v",
    transcriptStartMs: null,
    transcriptEndMs: null,
    reviewState,
  });
  if (!active) {
    const db = await getDb();
    if (!db) throw Error("db");
    await db
      .update(salesIntelFrameworks)
      .set({ active: false })
      .where(inArray(salesIntelFrameworks.id, [row.id]));
  }
}
describe.skipIf(!run)("doctrine gate", () => {
  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    await db
      .delete(salesIntelFrameworks)
      .where(inArray(salesIntelFrameworks.sourceArtifactId, ids));
    await db
      .delete(salesIntelSourceArtifacts)
      .where(inArray(salesIntelSourceArtifacts.id, ids));
  });
  it("counts only independent accepted active extracted real sources", async () => {
    const primary = await src(),
      a = await src(),
      p = await src(),
      r = await src(),
      n = await src("analyzed"),
      i = await src();
    await fw(a.id, "accepted");
    await fw(p.id, "review_required");
    await fw(r.id, "rejected");
    await fw(n.id, "accepted");
    await fw(i.id, "accepted", false);
    await fw(primary.id, "accepted");
    expect(
      await countIndependentSourceSupport({
        frameworkId: "unused",
        sourceArtifactId: primary.id,
        archetype: "ANCHOR",
        channel: "phone",
        responseFamily: "isolate_constraint",
      })
    ).toBe(1);
  });
});
