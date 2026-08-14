/**
 * Production-shaped Stronghold Sales Intel chain against disposable MySQL.
 *
 * DAYFORGE_RELEASE_DB=1 DATABASE_URL=<disposable test db> \
 *   pnpm vitest run --config vitest.integration.config.ts server/salesIntel/driverSafeSalesIntel.integration.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  dayforgeSaasEntitlements,
  dayforgeSaasMemberships,
  dayforgeSaasSubscriptions,
  salesIntelSourceArtifacts,
  salesIntelTeachings,
  salesIntelTranscripts,
} from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import { armoryRouter } from "../armory/armoryRouter";
import { getDb } from "../db";
import { toStrongholdIntel } from "../../client/src/game/world/intelligenceFlywheel";
import { projectStronghold } from "../../client/src/game/world/strongholdProjection";
import { appendTranscript, upsertSourceArtifact } from "./salesIntelStore";
import {
  persistTeachingVersion,
  setTeachingReviewState,
} from "./salesIntelTeachingStore";

const runDatabaseGate =
  process.env.DAYFORGE_RELEASE_DB === "1" && Boolean(process.env.DATABASE_URL);

const tenantId = `stronghold-intel-${randomUUID()}`;
const actorId = `driver-${randomUUID()}`;
let artifactId: string | null = null;

function driverContext(
  overrides: {
    tenantId?: string;
    actorId?: string;
  } = {}
): TrpcContext {
  const scopedTenantId = overrides.tenantId ?? tenantId;
  const scopedActorId = overrides.actorId ?? actorId;
  return {
    req: undefined as never,
    res: undefined as never,
    vendorSession: null,
    tenantId: scopedTenantId,
    user: {
      id: 1,
      tenantId: scopedTenantId,
      openId: scopedActorId,
      name: "Stronghold integration driver",
      email: "stronghold-driver@example.test",
      loginMethod: "test",
      role: "driver",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
  };
}

function categoryCount(
  value: {
    byCategory: readonly { category: string; count: number }[];
  } | null,
  category: string
): number {
  return (
    value?.byCategory.find(entry => entry.category === category)?.count ?? 0
  );
}

describe.skipIf(!runDatabaseGate)(
  "driver-safe Stronghold Sales Intel production chain",
  () => {
    afterAll(async () => {
      const database = await getDb();
      if (!database) return;
      if (artifactId) {
        await database
          .delete(salesIntelTeachings)
          .where(eq(salesIntelTeachings.sourceArtifactId, artifactId));
        await database
          .delete(salesIntelTranscripts)
          .where(eq(salesIntelTranscripts.sourceArtifactId, artifactId));
        await database
          .delete(salesIntelSourceArtifacts)
          .where(eq(salesIntelSourceArtifacts.id, artifactId));
      }
      await database
        .delete(dayforgeSaasEntitlements)
        .where(eq(dayforgeSaasEntitlements.tenantId, tenantId));
      await database
        .delete(dayforgeSaasSubscriptions)
        .where(eq(dayforgeSaasSubscriptions.tenantId, tenantId));
      await database
        .delete(dayforgeSaasMemberships)
        .where(eq(dayforgeSaasMemberships.tenantId, tenantId));
    });

    it("reads persisted reviewed intel through real auth, projection, Goldline, and Stronghold boundaries", async () => {
      const database = await getDb();
      if (!database) throw new Error("Database not available");
      const now = new Date();
      await database.insert(dayforgeSaasMemberships).values({
        tenantId,
        userOpenId: actorId,
        role: "field",
        active: true,
      });
      await database.insert(dayforgeSaasSubscriptions).values({
        tenantId,
        planKey: "integration-test",
        stripeCustomerId: `cus_${randomUUID()}`,
        stripeSubscriptionId: `sub_${randomUUID()}`,
        status: "active",
        lastStripeEventId: `evt_${randomUUID()}`,
        lastStripeEventCreatedAt: now,
      });
      await database.insert(dayforgeSaasEntitlements).values({
        tenantId,
        entitlementKey: "dayforge_field",
        source: "manual",
        enabled: true,
      });

      const caller = armoryRouter.createCaller(driverContext());
      const baseline = await caller.strongholdIntel();
      const baselineCategory = categoryCount(baseline, "sales_psychology");

      const source = await upsertSourceArtifact({
        sourceType: "test_fixture",
        sourceUrl: null,
        canonicalUrl: null,
        externalContentId: null,
        creatorName: "Integration Trainer",
        creatorHandle: null,
        publishedAt: null,
        title: "Stronghold driver-safe fixture",
        contentHash: `driver-safe-${randomUUID()}`,
        status: "extracted",
        metadata: { internalMarker: "must-not-leak" },
        ingestedBy: "integration-admin",
      });
      artifactId = source.artifact.id;
      const transcript = await appendTranscript({
        sourceArtifactId: artifactId,
        contentKind: "supplied_transcript",
        text: "Raw transcript that must never cross the driver boundary.",
        segments: [],
        provider: "private-provider",
        model: "private-model",
        analysisVersion: "private-analysis-version",
      });
      const teaching = await persistTeachingVersion({
        sourceArtifactId: artifactId,
        transcriptId: transcript.id,
        teachingKey: `driver-safe-${randomUUID()}`,
        creatorName: "Integration Trainer",
        creatorHandle: "internal-handle",
        category: "sales_psychology",
        title: "Persisted reviewed teaching",
        principle: "Canonical teaching copy remains server-side.",
        whenToUse: [],
        whenNotToUse: [],
        exampleLanguage: [],
        confidence: 0.92,
        extractionVersion: "private-extraction-version",
        extractionProvider: "private-extractor",
        extractionModel: "private-model",
        promptVersion: "private-prompt",
        transcriptStartMs: null,
        transcriptEndMs: null,
        reviewState: "review_required",
      });
      await setTeachingReviewState({
        teachingId: teaching.id,
        reviewState: "accepted",
        reviewedBy: "integration-admin",
      });

      const refreshed = await caller.strongholdIntel();
      expect(categoryCount(refreshed, "sales_psychology")).toBe(
        baselineCategory + 1
      );
      expect(Object.keys(refreshed ?? {})).toEqual([
        "acceptedTeachingCount",
        "byCategory",
      ]);
      expect(JSON.stringify(refreshed)).not.toMatch(
        /Raw transcript|private-|internal-handle|Canonical teaching/
      );

      const stronghold = projectStronghold({
        routeTable: [],
        agents: [],
        intel: refreshed ? toStrongholdIntel(refreshed) : null,
        chronicle: [],
      });
      expect(categoryCount(stronghold.intel, "sales_psychology")).toBe(
        baselineCategory + 1
      );

      await expect(
        armoryRouter
          .createCaller(driverContext({ tenantId: `foreign-${randomUUID()}` }))
          .strongholdIntel()
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      await database
        .update(salesIntelTeachings)
        .set({ transcriptId: randomUUID() })
        .where(eq(salesIntelTeachings.id, teaching.id));
      const afterUnlink = await caller.strongholdIntel();
      expect(categoryCount(afterUnlink, "sales_psychology")).toBe(
        baselineCategory
      );

      await database
        .update(salesIntelTeachings)
        .set({ transcriptId: transcript.id })
        .where(eq(salesIntelTeachings.id, teaching.id));
      await database
        .update(salesIntelSourceArtifacts)
        .set({ status: "failed" })
        .where(eq(salesIntelSourceArtifacts.id, artifactId));
      const afterStaleSource = await caller.strongholdIntel();
      expect(categoryCount(afterStaleSource, "sales_psychology")).toBe(
        baselineCategory
      );
    });
  }
);
