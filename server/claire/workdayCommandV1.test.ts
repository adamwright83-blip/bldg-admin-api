import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("V1 production reads Daily Command", () => {
  it("wires the command picture into the production turn engine", () => {
    const reasoning = readFileSync(path.join(process.cwd(), "server/claire/reasoning.ts"), "utf8");
    const preDrive = readFileSync(path.join(process.cwd(), "server/claire/preDriveRuntime.ts"), "utf8");
    const turn = readFileSync(path.join(process.cwd(), "server/claire/turn/claireTurn.ts"), "utf8");
    expect(reasoning).toMatch(/toDailyCommandPromptSection/);
    expect(reasoning).toMatch(/workdayCommand/);
    expect(preDrive).toMatch(/loadDailyCommand/);
    expect(turn).toMatch(/speakMorningReconciliationAsk/);
    const reconciliation = turn.slice(
      turn.indexOf("morning_reconciliation"),
      turn.indexOf("parseBriefingDeterministically")
    );
    expect(reconciliation).not.toMatch(/narratorOs/);
    const command = readFileSync(path.join(process.cwd(), "server/claire/workdayCommandService.ts"), "utf8");
    expect(command).not.toMatch(/narratorOs/);
  });
});
