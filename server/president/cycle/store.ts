import { presidentCycleSchema, type PresidentCycle } from "../../../shared/presidentCycle";
import type { MysqlPresidentIntelligenceStore } from "../intelligenceStore";

export class PresidentCycleStore {
  constructor(private readonly intelligence: MysqlPresidentIntelligenceStore) {}

  private key(id: string) { return `president-cycle:${id}`; }

  async get(id: string): Promise<PresidentCycle | null> {
    const record = await this.intelligence.current("DECISION", this.key(id));
    if (!record) return null;
    return presidentCycleSchema.parse(record.payload);
  }

  async put(cycle: PresidentCycle): Promise<PresidentCycle> {
    const parsed = presidentCycleSchema.parse(cycle);
    await this.intelligence.appendCurrent({
      kind: "DECISION",
      key: this.key(parsed.id),
      evidenceIds: parsed.evidenceIds,
      idempotencyKey: `cycle:${parsed.id}:${parsed.state}:${parsed.updatedAt}`,
      payload: parsed,
    });
    return parsed;
  }

  async exclusive<T>(cycleId: string, op: () => Promise<T>): Promise<T> {
    return this.intelligence.exclusive(`cycle:${cycleId}`, op);
  }
}
