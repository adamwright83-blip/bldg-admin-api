import { randomUUID } from "node:crypto";
import mysql, { type ResultSetHeader, type RowDataPacket } from "mysql2/promise";

export const INSTAGRAM_CAPTURE_PIPELINE_VERSION = "instagram-media-to-teachings-v1";
const JOB_TYPE = "instagram_media_to_teachings" as const;

export type InstagramCaptureJobState = "queued" | "processing" | "completed" | "failed";
export type InstagramCaptureJob = {
  id: string;
  jobKey: string;
  sourceArtifactId: string;
  actorId: string;
  jobType: typeof JOB_TYPE;
  pipelineVersion: string;
  state: InstagramCaptureJobState;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
};

type JobRow = RowDataPacket & InstagramCaptureJob;

function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required for Sales Intel ingestion jobs");
  return value;
}

async function connection() {
  return mysql.createConnection(databaseUrl());
}

export function instagramCaptureJobKey(sourceArtifactId: string) {
  return `instagram:${sourceArtifactId}:${INSTAGRAM_CAPTURE_PIPELINE_VERSION}`;
}

export async function enqueueInstagramCaptureJob(input: {
  sourceArtifactId: string;
  actorId: string;
}): Promise<{ job: InstagramCaptureJob; scheduled: boolean }> {
  const db = await connection();
  try {
    await db.beginTransaction();
    const key = instagramCaptureJobKey(input.sourceArtifactId);
    const [existingRows] = await db.execute<JobRow[]>(
      "SELECT * FROM sales_intel_ingestion_jobs WHERE jobKey = ? FOR UPDATE",
      [key]
    );
    const existing = existingRows[0];
    if (existing) {
      const staleProcessing =
        existing.state === "processing" &&
        (!existing.leaseExpiresAt || existing.leaseExpiresAt.getTime() <= Date.now());
      const shouldRequeue = existing.state === "failed" || staleProcessing;
      if (shouldRequeue) {
        await db.execute(
          `UPDATE sales_intel_ingestion_jobs
             SET state='queued', actorId=?, nextAttemptAt=CURRENT_TIMESTAMP,
                 leaseOwner=NULL, leaseExpiresAt=NULL, completedAt=NULL
           WHERE id=?`,
          [input.actorId, existing.id]
        );
      }
      await db.commit();
      const job = await getInstagramCaptureJob(existing.id);
      if (!job) throw new Error("Sales Intel ingestion job disappeared after enqueue");
      return { job, scheduled: shouldRequeue };
    }

    const id = randomUUID();
    await db.execute(
      `INSERT INTO sales_intel_ingestion_jobs
       (id, jobKey, sourceArtifactId, actorId, jobType, pipelineVersion, state, attemptCount, maxAttempts, nextAttemptAt)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, 5, CURRENT_TIMESTAMP)`,
      [id, key, input.sourceArtifactId, input.actorId, JOB_TYPE, INSTAGRAM_CAPTURE_PIPELINE_VERSION]
    );
    await db.commit();
    const job = await getInstagramCaptureJob(id);
    if (!job) throw new Error("Sales Intel ingestion job failed to persist");
    return { job, scheduled: true };
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    await db.end();
  }
}

export async function getInstagramCaptureJob(id: string): Promise<InstagramCaptureJob | null> {
  const db = await connection();
  try {
    const [rows] = await db.execute<JobRow[]>(
      "SELECT * FROM sales_intel_ingestion_jobs WHERE id=? LIMIT 1",
      [id]
    );
    return rows[0] ?? null;
  } finally {
    await db.end();
  }
}

export async function getInstagramCaptureJobForSource(sourceArtifactId: string): Promise<InstagramCaptureJob | null> {
  const db = await connection();
  try {
    const [rows] = await db.execute<JobRow[]>(
      "SELECT * FROM sales_intel_ingestion_jobs WHERE jobKey=? LIMIT 1",
      [instagramCaptureJobKey(sourceArtifactId)]
    );
    return rows[0] ?? null;
  } finally {
    await db.end();
  }
}

export async function claimNextInstagramCaptureJob(input: {
  workerId: string;
  leaseMs?: number;
}): Promise<InstagramCaptureJob | null> {
  const leaseMs = Math.max(5_000, Math.min(input.leaseMs ?? 5 * 60_000, 30 * 60_000));
  const db = await connection();
  try {
    await db.beginTransaction();
    const [rows] = await db.query<JobRow[]>(
      `SELECT * FROM sales_intel_ingestion_jobs
       WHERE jobType=? AND attemptCount < maxAttempts AND (
         (state='queued' AND nextAttemptAt <= CURRENT_TIMESTAMP) OR
         (state='processing' AND leaseExpiresAt IS NOT NULL AND leaseExpiresAt <= CURRENT_TIMESTAMP)
       )
       ORDER BY nextAttemptAt ASC, createdAt ASC
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [JOB_TYPE]
    );
    const candidate = rows[0];
    if (!candidate) {
      await db.commit();
      return null;
    }
    await db.execute(
      `UPDATE sales_intel_ingestion_jobs
       SET state='processing', attemptCount=attemptCount+1, leaseOwner=?,
           leaseExpiresAt=DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MICROSECOND),
           failureCode=NULL, failureMessage=NULL
       WHERE id=?`,
      [input.workerId, leaseMs * 1000, candidate.id]
    );
    await db.commit();
    return getInstagramCaptureJob(candidate.id);
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    await db.end();
  }
}

export async function completeInstagramCaptureJob(input: { id: string; workerId: string }): Promise<boolean> {
  const db = await connection();
  try {
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE sales_intel_ingestion_jobs
       SET state='completed', completedAt=CURRENT_TIMESTAMP, leaseOwner=NULL, leaseExpiresAt=NULL,
           failureCode=NULL, failureMessage=NULL
       WHERE id=? AND state='processing' AND leaseOwner=?`,
      [input.id, input.workerId]
    );
    return result.affectedRows === 1;
  } finally {
    await db.end();
  }
}

export async function failInstagramCaptureJob(input: {
  id: string;
  workerId: string;
  retryable: boolean;
  failureCode: string;
  failureMessage: string;
}): Promise<InstagramCaptureJob | null> {
  const db = await connection();
  try {
    const [rows] = await db.execute<JobRow[]>(
      "SELECT * FROM sales_intel_ingestion_jobs WHERE id=? LIMIT 1",
      [input.id]
    );
    const job = rows[0];
    if (!job || job.state !== "processing" || job.leaseOwner !== input.workerId) return job ?? null;
    const canRetry = input.retryable && job.attemptCount < job.maxAttempts;
    const backoffSeconds = Math.min(15 * 60, Math.max(15, 15 * 2 ** Math.max(0, job.attemptCount - 1)));
    await db.execute(
      canRetry
        ? `UPDATE sales_intel_ingestion_jobs SET state='queued', nextAttemptAt=DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND), leaseOwner=NULL, leaseExpiresAt=NULL, failureCode=?, failureMessage=? WHERE id=? AND leaseOwner=?`
        : `UPDATE sales_intel_ingestion_jobs SET state='failed', leaseOwner=NULL, leaseExpiresAt=NULL, failureCode=?, failureMessage=? WHERE id=? AND leaseOwner=?`,
      canRetry
        ? [backoffSeconds, input.failureCode, input.failureMessage.slice(0, 500), input.id, input.workerId]
        : [input.failureCode, input.failureMessage.slice(0, 500), input.id, input.workerId]
    );
    return getInstagramCaptureJob(input.id);
  } finally {
    await db.end();
  }
}
