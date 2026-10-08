import {
  DurableWorker,
  type DurableExecutionStore,
  type DurableStepHandler,
} from "../platform/execution/worker";
import { ensureSundayPlanningAppointment } from "./operatorAppointmentPolicy";
import {
  OperatorAppointmentStore,
  type ClaimedOperatorAppointment,
} from "./operatorAppointmentStore";
import { executeOperatorAppointment } from "./operatorAppointmentExecution";
import {
  admitOperatorAppointmentExecution,
  type OperatorAppointmentExecutionContext,
} from "./operatorAppointmentExecutionContext";

export type OperatorAppointmentWorkerOptions = {
  leaseOwner: string;
  leaseMs: number;
  pollMs: number;
  concurrency: number;
  retryBaseMs: number;
};

class ScheduledAppointmentExecutionStore
  implements DurableExecutionStore<ClaimedOperatorAppointment>
{
  constructor(private readonly store: OperatorAppointmentStore) {}

  async deadLetterExpiredSteps() {
    await ensureSundayPlanningAppointment({ store: this.store }).catch(error => {
      console.error(
        "[OperatorAppointmentWorker] Sunday appointment seeding failed",
        error
      );
    });
    return this.store.deadLetterExpiredSteps();
  }

  claimNextStep(input: { leaseOwner: string; leaseMs: number }) {
    return this.store.claimNextStep(input);
  }

  markRunning(step: ClaimedOperatorAppointment) {
    return this.store.markRunning(step);
  }

  heartbeat(step: ClaimedOperatorAppointment, leaseMs: number) {
    return this.store.heartbeat(step, leaseMs);
  }

  async completeStep(step: ClaimedOperatorAppointment, result: unknown) {
    const completed = await this.store.completeStep(step, result);
    if (!completed) {
      throw new Error(
        "Operator appointment completion lost its authority/timezone execution snapshot"
      );
    }
    return true;
  }

  failStep(
    step: ClaimedOperatorAppointment,
    error: unknown,
    retryDelayMs: number
  ) {
    return this.store.failStep(step, error, retryDelayMs);
  }
}

export class OperatorAppointmentWorker {
  private readonly worker: DurableWorker<ClaimedOperatorAppointment>;

  constructor(
    store: OperatorAppointmentStore,
    options: OperatorAppointmentWorkerOptions,
    executor?: (
      step: ClaimedOperatorAppointment,
      context: OperatorAppointmentExecutionContext
    ) => Promise<unknown>
  ) {
    const run =
      executor ??
      ((
        step: ClaimedOperatorAppointment,
        context: OperatorAppointmentExecutionContext
      ) => executeOperatorAppointment(step, new Date(), store, context));
    const handler: DurableStepHandler<ClaimedOperatorAppointment> = async ({
      step,
    }) => {
      const context = admitOperatorAppointmentExecution(step);
      return run(step, context);
    };
    this.worker = new DurableWorker(
      new ScheduledAppointmentExecutionStore(store),
      new Map([["operator_appointment.execute", handler]]),
      {
        ...options,
        getHandlerKey: () => "operator_appointment.execute",
        logPrefix: "OperatorAppointmentWorker",
      }
    );
  }

  get health() {
    return this.worker.health;
  }

  start() {
    return this.worker.start();
  }

  stop() {
    return this.worker.stop();
  }
}
