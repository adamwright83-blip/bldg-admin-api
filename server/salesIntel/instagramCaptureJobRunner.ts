import { randomUUID } from "node:crypto";
import {
  claimNextInstagramCaptureJob,
  completeInstagramCaptureJob,
  failInstagramCaptureJob,
} from "./instagramCaptureJobStore";
import { processInstagramSalesIntelCapture } from "./instagramCaptureService";

const WORKER_ID = `instagram-${process.pid}-${randomUUID().slice(0, 8)}`;
let wakeTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;
let activeRun: Promise<void> | null = null;

export async function runInstagramCaptureJobsOnce(input?: {
  workerId?: string;
  maxJobs?: number;
  process?: typeof processInstagramSalesIntelCapture;
}): Promise<number> {
  const workerId = input?.workerId ?? WORKER_ID;
  const maxJobs = Math.max(1, Math.min(input?.maxJobs ?? 4, 20));
  const processJob = input?.process ?? processInstagramSalesIntelCapture;
  let processed = 0;

  while (processed < maxJobs) {
    const job = await claimNextInstagramCaptureJob({ workerId });
    if (!job) break;
    try {
      const status = await processJob({
        sourceArtifactId: job.sourceArtifactId,
        actorId: job.actorId,
      });
      const retryableFailure =
        (status.status === "failed" || status.status === "awaiting_content") &&
        Boolean(status.failureRetryable);
      if (retryableFailure) {
        await failInstagramCaptureJob({
          id: job.id,
          workerId,
          retryable: true,
          failureCode: status.failureCode ?? "instagram_capture_retryable",
          failureMessage: status.failureMessage ?? "Instagram capture needs another attempt.",
        });
      } else if (status.status === "failed") {
        await failInstagramCaptureJob({
          id: job.id,
          workerId,
          retryable: false,
          failureCode: status.failureCode ?? "instagram_capture_failed",
          failureMessage: status.failureMessage ?? "Instagram capture failed.",
        });
      } else {
        await completeInstagramCaptureJob({ id: job.id, workerId });
      }
    } catch (error) {
      await failInstagramCaptureJob({
        id: job.id,
        workerId,
        retryable: true,
        failureCode: "instagram_capture_worker_error",
        failureMessage: error instanceof Error ? error.message : "Instagram capture worker failed",
      });
    }
    processed += 1;
  }
  return processed;
}

async function drain() {
  if (activeRun) return activeRun;
  activeRun = runInstagramCaptureJobsOnce()
    .then(() => undefined)
    .finally(() => {
      activeRun = null;
    });
  return activeRun;
}

export function kickInstagramCaptureJobRunner(delayMs = 25) {
  if (wakeTimer) return;
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    void drain().catch(error => console.warn("[Sales Intel] Instagram job drain failed", error));
  }, Math.max(0, delayMs));
  wakeTimer.unref?.();
}

export function startInstagramCaptureJobRunner() {
  if (process.env.SALES_INTEL_JOB_RUNNER_DISABLED === "1" || intervalTimer) return;
  kickInstagramCaptureJobRunner(100);
  intervalTimer = setInterval(() => {
    void drain().catch(error => console.warn("[Sales Intel] Instagram job sweep failed", error));
  }, 60_000);
  intervalTimer.unref?.();
}

export function stopInstagramCaptureJobRunnerForTests() {
  if (wakeTimer) clearTimeout(wakeTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  wakeTimer = null;
  intervalTimer = null;
}
