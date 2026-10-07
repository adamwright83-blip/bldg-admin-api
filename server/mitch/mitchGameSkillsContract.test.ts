import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PIN = "d4b0e35550c55ae70bdfcab4ef5a0e94610438a9";
const UPSTREAM = "gamedev-skills/awesome-gamedev-agent-skills";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Mitch upstream game-skill capability contract", () => {
  it.each([
    ".github/workflows/mitch-claude-executor.yml",
    ".github/workflows/mitch-independent-reviewer.yml",
  ])("%s pins the same upstream skill revision and exposes it to Claude", path => {
    const workflow = source(path);
    expect(workflow).toContain(
      "https://github.com/" + UPSTREAM + ".git"
    );
    expect(workflow).toContain(PIN);
    expect(workflow).toContain("MITCH_GAME_SKILLS_DIR");
    expect(workflow).toContain("MITCH_GAME_SKILLS_PIN");
  });

  it("installs the router plus the full specialist catalog into Claude's skill directory", () => {
    const harness = source("scripts/mitch-github-agent.ts");
    expect(harness).toContain('join(claudeDir, "skills")');
    expect(harness).toContain('join(source, "router")');
    expect(harness).toContain('join(source, "skills")');
    expect(harness).toContain('names.includes("router")');
    expect(harness).toContain("names.length < 75");
    expect(harness).toContain("Use the router first");
    expect(harness).toContain("Read,Glob,Grep,Skill");
    expect(harness).toContain("Read,Edit,Write,Glob,Grep,Skill");
    expect(harness).toContain('path.startsWith("e2e/boreslay/")');
    expect(harness).toContain(UPSTREAM);
    expect(harness).toContain(PIN);
  });
});
