import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PresidentAssessment } from "../../shared/presidentContracts";
import { assertPresidentStage1Assessment } from "../../shared/presidentContracts";
export interface PresidentAssessmentStore {
  findByEvidence(
    sha: string,
    snapshot: string
  ): Promise<PresidentAssessment | null>;
  saveIfAbsent(value: PresidentAssessment): Promise<PresidentAssessment>;
  count(): Promise<number>;
}
export class MemoryPresidentAssessmentStore
  implements PresidentAssessmentStore
{
  protected rows = new Map<string, PresidentAssessment>();
  private key(a: string, b: string) {
    return `${a}:${b}`;
  }
  async findByEvidence(a: string, b: string) {
    return this.rows.get(this.key(a, b)) ?? null;
  }
  async saveIfAbsent(value: PresidentAssessment) {
    assertPresidentStage1Assessment(value);
    const key = this.key(
      value.inspectedRepositorySha,
      value.evidenceSnapshotId
    );
    const prior = this.rows.get(key);
    if (prior) return prior;
    this.rows.set(key, structuredClone(value));
    return value;
  }
  async count() {
    return this.rows.size;
  }
}
/** Durable non-production witness store. It owns President rows only. */
export class FilePresidentAssessmentStore implements PresidentAssessmentStore {
  constructor(private readonly path: string) {}
  private async all(): Promise<PresidentAssessment[]> {
    try {
      return JSON.parse(await readFile(this.path, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
  async findByEvidence(a: string, b: string) {
    return (
      (await this.all()).find(
        x => x.inspectedRepositorySha === a && x.evidenceSnapshotId === b
      ) ?? null
    );
  }
  async saveIfAbsent(value: PresidentAssessment) {
    assertPresidentStage1Assessment(value);
    const all = await this.all();
    const prior = all.find(
      x =>
        x.inspectedRepositorySha === value.inspectedRepositorySha &&
        x.evidenceSnapshotId === value.evidenceSnapshotId
    );
    if (prior) return prior;
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify([...all, value], null, 2) + "\n", {
      flag: "wx",
    });
    await rename(temp, this.path);
    return value;
  }
  async count() {
    return (await this.all()).length;
  }
}
