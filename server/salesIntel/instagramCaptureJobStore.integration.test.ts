import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimNextInstagramCaptureJob,
  completeInstagramCaptureJob,
  enqueueInstagramCaptureJob,
  failInstagramCaptureJob,
  getInstagramCaptureJob,
} from "./instagramCaptureJobStore";

const enabled = process.env.DAYFORGE_RELEASE_DB === "1" && Boolean(process.env.DATABASE_URL);
const created: string[] = [];

async function enqueue() {
  const sourceArtifactId = randomUUID();
  const result = await enqueueInstagramCaptureJob({ sourceArtifactId, actorId: "test-driver" });
  created.push(result.job.id);
  return result;
}

describe.skipIf(!enabled)("durable Instagram capture jobs", () => {
  afterEach(async () => {
    if (!created.length) return;
    const db = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      await db.query("DELETE FROM sales_intel_ingestion_jobs WHERE id IN (?)", [created.splice(0)]);
    } finally {
      await db.end();
    }
  });

  it("deduplicates the same source/pipeline and only one worker can claim it", async () => {
    const first = await enqueue();
    const second = await enqueueInstagramCaptureJob({
      sourceArtifactId: first.job.sourceArtifactId,
      actorId: "another-driver",
    });
    expect(first.scheduled).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(second.scheduled).toBe(false);

    const [a, b] = await Promise.all([
      claimNextInstagramCaptureJob({ workerId: "worker-a" }),
      claimNextInstagramCaptureJob({ workerId: "worker-b" }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const claimed = a ?? b;
    expect(claimed?.state).toBe("processing");
    expect(claimed?.attemptCount).toBe(1);
  });

  it("completes only for the lease owner", async () => {
    const queued = await enqueue();
    const claimed = await claimNextInstagramCaptureJob({ workerId: "owner" });
    expect(claimed?.id).toBe(queued.job.id);
    expect(await completeInstagramCaptureJob({ id: queued.job.id, workerId: "wrong" })).toBe(false);
    expect(await completeInstagramCaptureJob({ id: queued.job.id, workerId: "owner" })).toBe(true);
    expect((await getInstagramCaptureJob(queued.job.id))?.state).toBe("completed");
  });

  it("records retry state durably instead of losing work with the process", async () => {
    const queued = await enqueue();
    const claimed = await claimNextInstagramCaptureJob({ workerId: "retry-worker" });
    expect(claimed?.id).toBe(queued.job.id);
    const retried = await failInstagramCaptureJob({
      id: queued.job.id,
      workerId: "retry-worker",
      retryable: true,
      failureCode: "provider_temporary",
      failureMessage: "try later",
    });
    expect(retried?.state).toBe("queued");
    expect(retried?.failureCode).toBe("provider_temporary");
    expect(retried?.leaseOwner).toBeNull();
  });
});
