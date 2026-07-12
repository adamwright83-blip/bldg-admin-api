import type { CommercialMission } from "@shared/commercialMission";

export type BoreslayMissionStartResult = {
  mission: CommercialMission;
  startedAt: string;
  idempotencyKey: string;
};

export type BoreslayMissionCompletionInput = {
  missionId: number;
  score: number;
  bossDamage: number;
  durationMs: number;
  replayJson?: unknown;
  idempotencyKey: string;
};

export type BoreslayMissionCompletionResult = {
  mission: CommercialMission;
  completedAt: string;
  xpAwarded: number;
  streakDays: number;
  phoneMissionReady: boolean;
};

export interface BoreslayMissionTransport {
  loadMission(missionId: number): Promise<CommercialMission>;
  startMission(input: {
    missionId: number;
    idempotencyKey: string;
  }): Promise<BoreslayMissionStartResult>;
  completeMission(
    input: BoreslayMissionCompletionInput
  ): Promise<BoreslayMissionCompletionResult>;
  unlockPhoneMission(input: {
    missionId: number;
    idempotencyKey: string;
  }): Promise<CommercialMission>;
  recordAbandonment(input: {
    missionId: number;
    elapsedMs: number;
    idempotencyKey: string;
  }): Promise<void>;
}

export type ProductionBoreslayMissionSession = {
  mission: CommercialMission;
  startedAt: string | null;
  completion: BoreslayMissionCompletionResult | null;
};

function idempotencyKey(
  missionId: number,
  eventName: string,
  suffix: string | number
): string {
  return `commercial-mission:${missionId}:${eventName}:${suffix}`;
}

export class ProductionBoreslayMissionAdapter {
  readonly mode = "production" as const;
  readonly productionMutationsReachable = true as const;

  private session: ProductionBoreslayMissionSession | null = null;
  private startPromise: Promise<BoreslayMissionStartResult> | null = null;
  private completionPromise: Promise<BoreslayMissionCompletionResult> | null = null;

  constructor(private readonly transport: BoreslayMissionTransport) {}

  async load(missionId: number): Promise<ProductionBoreslayMissionSession> {
    const mission = await this.transport.loadMission(missionId);
    this.session = {
      mission,
      startedAt: mission.status === "game_active" ? new Date().toISOString() : null,
      completion: null,
    };
    return this.session;
  }

  getSnapshot(): ProductionBoreslayMissionSession | null {
    return this.session;
  }

  async start(missionId: number): Promise<BoreslayMissionStartResult> {
    if (this.session?.mission.id === missionId && this.session.startedAt) {
      return {
        mission: this.session.mission,
        startedAt: this.session.startedAt,
        idempotencyKey: idempotencyKey(missionId, "start", this.session.startedAt),
      };
    }

    if (this.startPromise) return this.startPromise;

    const key = idempotencyKey(missionId, "start", "v1");
    this.startPromise = this.transport
      .startMission({ missionId, idempotencyKey: key })
      .then(result => {
        this.session = {
          mission: result.mission,
          startedAt: result.startedAt,
          completion: null,
        };
        return result;
      })
      .finally(() => {
        this.startPromise = null;
      });

    return this.startPromise;
  }

  async complete(
    input: Omit<BoreslayMissionCompletionInput, "idempotencyKey">
  ): Promise<BoreslayMissionCompletionResult> {
    if (this.session?.completion) return this.session.completion;
    if (this.completionPromise) return this.completionPromise;

    const key = idempotencyKey(
      input.missionId,
      "complete",
      `${input.score}:${input.durationMs}`
    );

    this.completionPromise = this.transport
      .completeMission({ ...input, idempotencyKey: key })
      .then(async result => {
        let mission = result.mission;
        if (!result.phoneMissionReady) {
          mission = await this.transport.unlockPhoneMission({
            missionId: input.missionId,
            idempotencyKey: idempotencyKey(input.missionId, "phone-ready", "v1"),
          });
        }

        const normalized = {
          ...result,
          mission,
          phoneMissionReady: mission.status === "phone_ready" || result.phoneMissionReady,
        };
        this.session = {
          mission,
          startedAt: this.session?.startedAt ?? null,
          completion: normalized,
        };
        return normalized;
      })
      .finally(() => {
        this.completionPromise = null;
      });

    return this.completionPromise;
  }

  async abandon(missionId: number, elapsedMs: number): Promise<void> {
    await this.transport.recordAbandonment({
      missionId,
      elapsedMs,
      idempotencyKey: idempotencyKey(missionId, "abandon", Math.floor(elapsedMs / 1000)),
    });
  }

  reset(): void {
    this.session = null;
    this.startPromise = null;
    this.completionPromise = null;
  }
}
