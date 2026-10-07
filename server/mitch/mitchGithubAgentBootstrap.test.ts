import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Mitch autonomous executor bootstrap", () => {
  it("is ESM-safe before the structured failure handler loads", () => {
    const agent = source("scripts/mitch-github-agent.ts");
    expect(agent).toContain("fileURLToPath(import.meta.url)");
    expect(agent).not.toMatch(/\b__dirname\b/);
  });

  it("reports a failed GitHub Actions executor step before preserving job failure", () => {
    const workflow = source(".github/workflows/mitch-claude-executor.yml");
    expect(workflow).toContain("continue-on-error: true");
    expect(workflow).toContain("scripts/mitch-github-agent-failure.ts");
    expect(workflow).toContain("Preserve executor failure status");
  });

  it("allows only an explicitly named stranded executor lease to be recovered", () => {
    const worker = source("server/mitch/producerWorkerMain.ts");
    expect(worker).toContain("MITCH_RECOVER_FAILED_WORK_ORDER_ID");
    expect(worker).toContain('order.claimedBy !== "github-producer-bus:claude"');
    expect(worker).toContain('["claimed", "executing"].includes(order.status)');
    expect(worker).not.toContain("recoverAllClaimed");
  });
});
