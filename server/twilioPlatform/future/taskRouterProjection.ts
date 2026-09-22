import type {
  GoldlineCanonicalJob,
  GoldlineDispatchTask,
  GoldlineWorkerCapability,
  TaskRouterProjection,
} from "@shared/twilioFuture";
import { evaluateTwilioCapability } from "../capabilities";

export class TaskRouterCanonicalMutationError extends Error {
  constructor() {
    super("taskrouter adapter cannot mutate a Goldline canonical job");
    this.name = "TaskRouterCanonicalMutationError";
  }
}

function toDispatchTask(job: GoldlineCanonicalJob): GoldlineDispatchTask {
  return {
    tenantId: job.tenantId,
    jobId: job.jobId,
    orderId: job.orderId,
    driverId: job.driverId,
    availability: job.availability,
  };
}

function toWorker(job: GoldlineCanonicalJob): GoldlineWorkerCapability | null {
  if (!job.driverId) return null;
  return { driverId: job.driverId, skills: [] };
}

/**
 * Describes how a Goldline job would project into TaskRouter.
 * Does not create a Twilio worker or task, and does not write the job.
 */
export function projectGoldlineJobToTaskRouter(
  job: GoldlineCanonicalJob,
  env: NodeJS.ProcessEnv = process.env
): { projection: TaskRouterProjection; job: GoldlineCanonicalJob } {
  const capability = evaluateTwilioCapability("taskRouter", env);
  const projection: TaskRouterProjection = {
    kind: "taskrouter_projection",
    goldlineRemainsCanonical: true,
    createsTwilioWorker: false,
    createsTwilioTask: false,
    mutatesCanonicalJob: false,
    capabilityState: capability.state,
    task: toDispatchTask(job),
    worker: toWorker(job),
  };
  return { projection, job };
}

export function applyTaskRouterProjectionToCanonicalJob(
  _job: GoldlineCanonicalJob,
  _projection: TaskRouterProjection
): never {
  throw new TaskRouterCanonicalMutationError();
}
