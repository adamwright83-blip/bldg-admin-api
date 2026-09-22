import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function slice(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

const WRITERS =
  /projectRecurrenceForDate|confirmRecurrenceRule|ensureAdamBoard|createOpsTask|narratorOs|weeklyIntent|WeeklyIntent|insert\(orders\)|upsertObligation/;

describe("Daily Command authority", () => {
  it("exposes only the read contract", () => {
    const contract = source("server/claire/dailyCommandContract.ts");
    expect(contract).toMatch(/export \{ loadDailyCommand, type LoadDailyCommandInput \}/);
    expect(contract).toMatch(/DailyCommand/);
    expect(contract).toMatch(/DailyCommandItem/);
    expect(contract).not.toMatch(/projectRecurrenceForDate|deriveDailyCommand|confirmRecurrenceRule|ensureAdamBoard/);
  });

  it("keeps loadDailyCommand a read", () => {
    const reader = source("server/claire/workdayCommandService.ts");
    expect(reader).not.toMatch(WRITERS);
    expect(reader).toMatch(/export async function loadDailyCommand/);
  });

  it("does not project recurrence from the persistence-free mission compute", () => {
    const mission = source("server/missionDirector/missionDirectorService.ts");
    const compute = slice(
      mission,
      "export async function computeMissionPlan",
      "const activeRuns"
    );
    expect(compute).toMatch(/loadDailyCommand/);
    expect(compute).not.toMatch(/projectRecurrenceForDate|confirmRecurrenceRule|ensureAdamBoard/);
    const persist = slice(mission, "async function planForDateInner", "export async function recordPlanUsage");
    expect(persist).toMatch(/projectRecurrenceForDate/);
  });

  it("keeps Narrator and locked-week storage out of the command reader", () => {
    const commandFiles = [
      "server/claire/workdayCommandService.ts",
      "shared/claireWorkdayCommand.ts",
      "server/claire/workdayCommandLanguage.ts",
      "server/claire/workdayCommandKind.ts",
    ];
    for (const file of commandFiles) {
      expect(source(file)).not.toMatch(/narratorOs|WeeklyIntent|weekly_intent/);
    }
    const contract = source("server/claire/dailyCommandContract.ts");
    expect(contract).not.toMatch(/from ["'][^"']*weekly|from ["'][^"']*narrator/i);
  });

});
